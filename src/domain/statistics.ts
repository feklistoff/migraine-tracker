import { episodeEvidenceDays, selectCalendarMonth, type MonthCoverage } from './calendar'
import { civilDay, compareInstants, elapsedMilliseconds } from './time'
import type { DiaryFacts, Dose, Episode, Reading, RecordedTime } from './types'

export interface TypicalLength {
  medianMilliseconds: number | null
  sampleCount: number
  excludedOngoing: number
  excludedUnknownEnd: number
}

export interface TreatmentDose {
  dose: Dose
  baseline: Reading | null
  baselineAgeMilliseconds: number | null
  baselineAmbiguous: boolean
  response: Reading | null
  responseDelayMilliseconds: number | null
}

export interface TreatmentRow {
  episode: Episode
  doses: TreatmentDose[]
}

export interface StatisticsMonth {
  month: string
  coverage: MonthCoverage
  headachesStarted: number
  ranPastMidnight: number
  medicationDays: number
  doses: number
  typicalLength: TypicalLength
  treatmentRows: TreatmentRow[]
  hasUnknownEnds: boolean
}

function inMonth(time: RecordedTime, month: string): boolean {
  return civilDay(time).slice(0, 7) === month
}

function compareByTimeAndId<T extends { id: string }>(one: T, two: T, time: (item: T) => RecordedTime): number {
  return compareInstants(time(one), time(two)) || one.id.localeCompare(two.id)
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function treatmentDose(dose: Dose, baseline: Reading | null, sameBaselineTimeCount: number, response: Reading | null): TreatmentDose {
  return {
    dose,
    baseline,
    baselineAgeMilliseconds: baseline ? elapsedMilliseconds(baseline.measuredAt, dose.takenAt) : null,
    baselineAmbiguous: Boolean(baseline && (compareInstants(baseline.measuredAt, dose.takenAt) === 0 || sameBaselineTimeCount > 1)),
    response,
    responseDelayMilliseconds: response ? elapsedMilliseconds(dose.takenAt, response.measuredAt) : null,
  }
}

/** Descriptive R-04 views derived only from canonical diary facts. */
export function selectStatisticsMonth(facts: DiaryFacts, month: string, now: RecordedTime): StatisticsMonth {
  const calendar = selectCalendarMonth(facts, month, now)
  const started = facts.episodes.filter((episode) => inMonth(episode.start, calendar.month))
  const monthDoses = facts.doses.filter((dose) => inMonth(dose.takenAt, calendar.month))
  const finishedDurations = started
    .filter((episode) => episode.state === 'ended' && episode.end !== null)
    .map((episode) => elapsedMilliseconds(episode.start, episode.end!))
  const dosesByEpisode = new Map<string, Dose[]>()
  const readingsByEpisode = new Map<string, Reading[]>()
  for (const dose of monthDoses) {
    const current = dosesByEpisode.get(dose.episodeId) ?? []
    current.push(dose)
    dosesByEpisode.set(dose.episodeId, current)
  }
  for (const reading of facts.readings) {
    const current = readingsByEpisode.get(reading.episodeId) ?? []
    current.push(reading)
    readingsByEpisode.set(reading.episodeId, current)
  }

  const treatmentRows = facts.episodes
    .filter((episode) => dosesByEpisode.has(episode.id))
    .map((episode) => {
      const readings = [...(readingsByEpisode.get(episode.id) ?? [])]
        .sort((one, two) => compareByTimeAndId(one, two, (item) => item.measuredAt))
      const painReadings = readings.filter((reading) => reading.pain !== null)
      const responses = new Map<string, Reading>()
      for (const reading of readings) {
        if (reading.linkedDoseId && !responses.has(reading.linkedDoseId)) responses.set(reading.linkedDoseId, reading)
      }
      const doses = [...(dosesByEpisode.get(episode.id) ?? [])]
        .sort((one, two) => compareByTimeAndId(one, two, (item) => item.takenAt))
      let painIndex = 0
      let baseline: Reading | null = null
      let sameBaselineTimeCount = 0
      const summaries = doses.map((dose) => {
        while (painIndex < painReadings.length && compareInstants(painReadings[painIndex].measuredAt, dose.takenAt) <= 0) {
          const candidate = painReadings[painIndex]
          sameBaselineTimeCount = baseline && compareInstants(candidate.measuredAt, baseline.measuredAt) === 0 ? sameBaselineTimeCount + 1 : 1
          baseline = candidate
          painIndex += 1
        }
        return treatmentDose(dose, baseline, sameBaselineTimeCount, responses.get(dose.id) ?? null)
      })
      return { episode, doses: summaries }
    })
    .sort((one, two) =>
      compareInstants(two.doses.at(-1)!.dose.takenAt, one.doses.at(-1)!.dose.takenAt) || one.episode.id.localeCompare(two.episode.id))

  return {
    month: calendar.month,
    coverage: calendar.coverage,
    headachesStarted: started.length,
    ranPastMidnight: started.filter((episode) => episode.state !== 'end_unknown' && episodeEvidenceDays(episode, now).length > 1).length,
    medicationDays: new Set(monthDoses.map((dose) => civilDay(dose.takenAt))).size,
    doses: monthDoses.length,
    typicalLength: {
      medianMilliseconds: median(finishedDurations),
      sampleCount: finishedDurations.length,
      excludedOngoing: started.filter((episode) => episode.state === 'ongoing').length,
      excludedUnknownEnd: started.filter((episode) => episode.state === 'end_unknown').length,
    },
    treatmentRows,
    hasUnknownEnds: facts.episodes.some((episode) =>
      episode.state === 'end_unknown' && (
        inMonth(episode.start, calendar.month) ||
        monthDoses.some((dose) => dose.episodeId === episode.id) ||
        readingsByEpisode.get(episode.id)?.some((reading) => inMonth(reading.measuredAt, calendar.month))
      )),
  }
}
