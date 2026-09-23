import { describe, expect, it } from 'vitest'

import { emptyDiaryFixture, fixtureEventTime } from '../test/fixtures'
import { selectStatisticsMonth } from './statistics'
import type { DailyRecord, DiaryFacts, Dose, Episode, Pain, Reading } from './types'

const audit = { createdAt: '2024-09-18T10:00:00Z', updatedAt: '2024-09-18T10:00:00Z' }
const now = fixtureEventTime('2024-09-18T17:05')

function episode(id: string, start: string, state: Episode['state'], end: string | null = null): Episode {
  return { ...audit, id, start: fixtureEventTime(start), state, end: end ? fixtureEventTime(end) : null, note: null }
}

function dose(id: string, episodeId: string, takenAt: string): Dose {
  return {
    ...audit, id, episodeId, takenAt: fixtureEventTime(takenAt), savedMedicineId: null,
    medicineName: 'Medicine', doseText: '1 tablet', followUpEnabled: true, followUpIntervalMinutes: 120,
  }
}

function reading(id: string, episodeId: string, measuredAt: string, pain: Pain | null, linkedDoseId: string | null = null): Reading {
  return {
    ...audit, id, episodeId, measuredAt: fixtureEventTime(measuredAt), pain, impact: null,
    note: null, linkedDoseId, atOnset: false,
  }
}

function confirmation(day: string): DailyRecord {
  return { ...audit, day, headacheFreeAt: fixtureEventTime(`${day}T09:00`), alcohol: null, sleep: null, stress: null }
}

describe('R-04 Statistics month selection', () => {
  it('reuses calendar coverage and counts starts, medication days and a cross-month finished median', () => {
    const facts: DiaryFacts = {
      ...emptyDiaryFixture(),
      episodes: [
        episode('carried', '2024-08-31T23:00', 'ended', '2024-09-02T00:00'),
        episode('two-hours', '2024-09-03T10:00', 'ended', '2024-09-03T12:00'),
        episode('four-hours', '2024-09-04T10:00', 'ended', '2024-09-04T14:00'),
        episode('unknown', '2024-09-05T10:00', 'end_unknown'),
        episode('ongoing', '2024-09-17T23:00', 'ongoing'),
      ],
      doses: [dose('carried-dose', 'carried', '2024-09-01T11:00'), dose('unknown-dose', 'unknown', '2024-09-07T11:00')],
      dailyRecords: [confirmation('2024-09-06'), confirmation('2024-09-08')],
    }

    const result = selectStatisticsMonth(facts, '2024-09', now)

    expect(result.coverage).toMatchObject({ eligibleDays: 18, recordedDays: 9, headacheDays: 7 })
    expect(result.coverage.missingDays).not.toContain('2024-09-18')
    expect(result.headachesStarted).toBe(4)
    expect(result.ranPastMidnight).toBe(1)
    expect(result.medicationDays).toBe(2)
    expect(result.doses).toBe(2)
    expect(result.typicalLength).toEqual({ medianMilliseconds: 3 * 60 * 60 * 1000, sampleCount: 2, excludedOngoing: 1, excludedUnknownEnd: 1 })
    expect(result.treatmentRows.map((row) => row.episode.id)).toEqual(['unknown', 'carried'])
    expect(result.hasUnknownEnds).toBe(true)
    expect(selectStatisticsMonth(facts, '2024-08', now).hasUnknownEnds).toBe(false)
  })

  it('takes the median of finished starts, including an end in the next month, and preserves no-sample state', () => {
    const facts: DiaryFacts = {
      ...emptyDiaryFixture(),
      episodes: [
        episode('a', '2024-09-02T08:00', 'ended', '2024-09-02T09:00'),
        episode('b', '2024-09-03T08:00', 'ended', '2024-09-03T11:00'),
        episode('c', '2024-09-04T08:00', 'ended', '2024-09-04T13:00'),
        episode('cross-month', '2024-09-30T23:00', 'ended', '2024-10-01T06:00'),
      ],
    }

    const september = selectStatisticsMonth(facts, '2024-09', fixtureEventTime('2024-10-02T12:00'))
    expect(september.typicalLength).toEqual({ medianMilliseconds: 4 * 60 * 60 * 1000, sampleCount: 4, excludedOngoing: 0, excludedUnknownEnd: 0 })
    expect(september.ranPastMidnight).toBe(1)
    expect(selectStatisticsMonth(facts, '2024-08', now).typicalLength.medianMilliseconds).toBeNull()
  })

  it('keeps dose order, explicit response links, stale baselines and mixed pain types visible', () => {
    const facts: DiaryFacts = {
      ...emptyDiaryFixture(),
      episodes: [episode('treated', '2024-09-09T08:00', 'ended', '2024-09-09T17:00')],
      doses: [dose('second', 'treated', '2024-09-09T12:00'), dose('first', 'treated', '2024-09-09T10:00')],
      readings: [
        reading('baseline', 'treated', '2024-09-09T08:00', { kind: 'numeric', value: 7 }),
        reading('response', 'treated', '2024-09-09T11:55', { kind: 'verbal', value: 'mild' }, 'first'),
        reading('same-time', 'treated', '2024-09-09T12:00', { kind: 'verbal', value: 'moderate' }),
      ],
    }

    const result = selectStatisticsMonth(facts, '2024-09', now)
    expect(result.medicationDays).toBe(1)
    expect(result.doses).toBe(2)
    expect(result.treatmentRows).toHaveLength(1)
    const [first, second] = result.treatmentRows[0].doses
    expect(first.dose.id).toBe('first')
    expect(first.baseline?.id).toBe('baseline')
    expect(first.baselineAgeMilliseconds).toBe(2 * 60 * 60 * 1000)
    expect(first.response?.id).toBe('response')
    expect(first.responseDelayMilliseconds).toBe(115 * 60 * 1000)
    expect(second.dose.id).toBe('second')
    expect(second.baseline?.id).toBe('same-time')
    expect(second.baselineAmbiguous).toBe(true)
    expect(second.response).toBeNull()
  })

  it('is unchanged when fact arrays are permuted and never counts future month coverage', () => {
    const first = episode('first', '2024-09-01T10:00', 'ended', '2024-09-01T12:00')
    const second = episode('second', '2024-09-02T10:00', 'ended', '2024-09-02T12:00')
    const facts = { ...emptyDiaryFixture(), episodes: [first, second], doses: [dose('dose-a', first.id, '2024-09-01T11:00')] }
    const reversed = { ...facts, episodes: [...facts.episodes].reverse(), doses: [...facts.doses].reverse() }
    expect(selectStatisticsMonth(facts, '2024-09', now)).toEqual(selectStatisticsMonth(reversed, '2024-09', now))
    expect(selectStatisticsMonth(facts, '2024-10', now).coverage.eligibleDays).toBe(0)
  })
})
