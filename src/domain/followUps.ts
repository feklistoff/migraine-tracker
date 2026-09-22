import { Temporal } from '@js-temporal/polyfill'

import { compareInstants, elapsedMilliseconds, eventTimeFromInstant } from './time'
import type { DiaryFacts, Dose, Reading, RecordedTime } from './types'

export type FollowUpStatus = 'disabled' | 'superseded' | 'answered' | 'pending' | 'overdue' | 'expired'

export interface DoseFollowUp {
  dose: Dose
  response?: Reading
  dueAt: RecordedTime | null
  expiresAt: RecordedTime | null
  status: FollowUpStatus
}

const FOLLOW_UP_VISIBILITY_MS = 24 * 60 * 60 * 1000

function orderDoses(one: Dose, two: Dose): number {
  const chronological = compareInstants(one.takenAt, two.takenAt)
  if (chronological !== 0) return chronological
  const logged = one.createdAt.localeCompare(two.createdAt)
  return logged || one.id.localeCompare(two.id)
}

export function latestDoseForEpisode(doses: readonly Dose[], episodeId: string): Dose | undefined {
  return doses.filter((dose) => dose.episodeId === episodeId).sort(orderDoses).at(-1)
}

function latestResponsesByDose(readings: readonly Reading[]): Map<string, Reading> {
  const latestByDose = new Map<string, Reading>()
  for (const reading of readings) {
    if (!reading.linkedDoseId) continue
    const existing = latestByDose.get(reading.linkedDoseId)
    const comparison = existing ? compareInstants(existing.measuredAt, reading.measuredAt) : -1
    if (!existing || comparison < 0 || (comparison === 0 && existing.id.localeCompare(reading.id) < 0)) {
      latestByDose.set(reading.linkedDoseId, reading)
    }
  }
  return latestByDose
}

export function followUpDueTime(takenAt: RecordedTime, intervalMinutes: number): RecordedTime {
  const instant = Temporal.Instant.from(takenAt.instant).add({ minutes: intervalMinutes })
  return eventTimeFromInstant(instant, takenAt.timeZone)
}

export function deriveDoseFollowUps(
  doses: readonly Dose[],
  readings: readonly Reading[],
  now: RecordedTime,
): DoseFollowUp[] {
  const latestByEpisode = new Map<string, Dose>()
  for (const dose of doses) {
    const latest = latestByEpisode.get(dose.episodeId)
    if (!latest || orderDoses(latest, dose) < 0) latestByEpisode.set(dose.episodeId, dose)
  }
  const latestResponseByDose = latestResponsesByDose(readings)

  return [...doses]
    .sort(orderDoses)
    .map((dose) => {
      if (!dose.followUpEnabled) {
        return { dose, dueAt: null, expiresAt: null, status: 'disabled' as const }
      }

      const dueAt = followUpDueTime(dose.takenAt, dose.followUpIntervalMinutes)
      const expiresAt = eventTimeFromInstant(
        Temporal.Instant.from(dueAt.instant).add({ milliseconds: FOLLOW_UP_VISIBILITY_MS }),
        dueAt.timeZone,
      )
      const response = latestResponseByDose.get(dose.id)
      if (response) return { dose, response, dueAt, expiresAt, status: 'answered' as const }
      if (latestByEpisode.get(dose.episodeId)?.id !== dose.id) {
        return { dose, dueAt, expiresAt, status: 'superseded' as const }
      }

      const relativeToDue = compareInstants(now, dueAt)
      if (relativeToDue < 0) return { dose, dueAt, expiresAt, status: 'pending' as const }
      if (compareInstants(now, expiresAt) < 0) return { dose, dueAt, expiresAt, status: 'overdue' as const }
      return { dose, dueAt, expiresAt, status: 'expired' as const }
    })
}

export function todayFollowUps(facts: DiaryFacts, now: RecordedTime): DoseFollowUp[] {
  if (!facts.settings.followUpEnabled) return []
  return deriveDoseFollowUps(facts.doses, facts.readings, now)
    .filter((check) => check.status === 'pending' || check.status === 'overdue')
    .sort((one, two) => compareInstants(one.dueAt!, two.dueAt!))
}

export function responseDelayMilliseconds(dose: Dose, response: Reading): number {
  return elapsedMilliseconds(dose.takenAt, response.measuredAt)
}
