import { Temporal } from '@js-temporal/polyfill'

import { civilDay, civilDaysForInterval, compareInstants } from './time'
import type { CivilDay, DailyRecord, DiaryFacts, Episode, Pain, RecordedTime } from './types'

export type DiaryDayStatus = 'headache' | 'headache-free' | 'unknown'

/**
 * A positive reading is evidence of a headache day. Zero and verbal "none"
 * remain observations, but do not prove that the day contained a headache.
 */
export function isPositivePain(pain: Pain | null): boolean {
  return pain !== null && (pain.kind === 'numeric' ? pain.value > 0 : pain.value !== 'none')
}

/**
 * Return the days evidenced by one episode. Unknown-ended episodes do not
 * invent an interval: their onset is the only episode-derived day.
 */
export function episodeEvidenceDays(episode: Episode, now: RecordedTime): CivilDay[] {
  if (episode.state === 'end_unknown') return [civilDay(episode.start)]

  const end = episode.end ?? now
  return civilDaysForInterval(episode.start, end, { endExclusive: episode.end !== null })
}

/**
 * Shared headache-day selector for Today, History and future statistics.
 * Every timestamp is attributed using the event's own recorded timezone.
 */
export function headacheEvidenceDays(facts: DiaryFacts, now: RecordedTime): Set<CivilDay> {
  const days = new Set<CivilDay>()

  for (const episode of facts.episodes) {
    for (const day of episodeEvidenceDays(episode, now)) days.add(day)
  }
  for (const reading of facts.readings) {
    if (isPositivePain(reading.pain)) days.add(civilDay(reading.measuredAt))
  }
  for (const dose of facts.doses) days.add(civilDay(dose.takenAt))

  return new Set([...days].sort())
}

export function dailyRecordForDay(facts: DiaryFacts, day: CivilDay): DailyRecord | undefined {
  return facts.dailyRecords.find((record) => record.day === day)
}

export function isValidCivilDay(day: string): boolean {
  try {
    Temporal.PlainDate.from(day)
    return true
  } catch {
    return false
  }
}

export function classifyDay(facts: DiaryFacts, day: CivilDay, now: RecordedTime): DiaryDayStatus {
  if (headacheEvidenceDays(facts, now).has(day)) return 'headache'
  return dailyRecordForDay(facts, day)?.headacheFreeAt ? 'headache-free' : 'unknown'
}

/**
 * Human-readable summary for the answers about the day before a daily key.
 * Missing answers are omitted; if all are missing, the summary stays explicit
 * that the information is unrecorded rather than implying "no".
 */
export function dayBeforeSummary(record: Pick<DailyRecord, 'alcohol' | 'sleep' | 'stress'> | null | undefined): string {
  const parts: string[] = []
  if (record?.alcohol === true) parts.push('Alcohol')
  if (record?.alcohol === false) parts.push('No alcohol')
  if (record?.sleep === 'not_enough') parts.push('Not enough sleep')
  if (record?.sleep === 'fair_amount') parts.push('Fair amount of sleep')
  if (record?.sleep === 'too_much') parts.push('Too much sleep')
  if (record?.stress === true) parts.push('Stressful')
  if (record?.stress === false) parts.push('Not stressful')
  return parts.length > 0 ? parts.join(' · ') : 'Alcohol, sleep, stress · not noted yet'
}

export function isBeforeDay(one: CivilDay, two: CivilDay): boolean {
  return Temporal.PlainDate.compare(Temporal.PlainDate.from(one), Temporal.PlainDate.from(two)) < 0
}

export function compareCivilDays(one: CivilDay, two: CivilDay): -1 | 0 | 1 {
  const comparison = Temporal.PlainDate.compare(Temporal.PlainDate.from(one), Temporal.PlainDate.from(two))
  return comparison < 0 ? -1 : comparison > 0 ? 1 : 0
}

export { civilDay, compareInstants }
