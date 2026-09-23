import { describe, expect, it } from 'vitest'

import { emptyDiaryFixture, fixtureEventTime } from '../test/fixtures'
import type { DailyRecord, Dose, Episode, Reading } from './types'
import {
  classifyDay,
  dayBeforeSummary,
  episodesForDay,
  headacheEvidenceDays,
  selectCalendarMonth,
} from './calendar'

const audit = {
  createdAt: '2024-09-18T10:00:00Z',
  updatedAt: '2024-09-18T10:00:00Z',
}

function episode(overrides: Partial<Episode> = {}): Episode {
  return {
    ...audit,
    id: 'episode-1',
    start: fixtureEventTime('2024-09-15T22:00'),
    state: 'end_unknown',
    end: null,
    note: null,
    ...overrides,
  }
}

function reading(overrides: Partial<Reading> = {}): Reading {
  return {
    ...audit,
    id: 'reading-1',
    episodeId: 'episode-1',
    measuredAt: fixtureEventTime('2024-09-17T12:00'),
    pain: { kind: 'numeric', value: 4 },
    impact: null,
    note: null,
    linkedDoseId: null,
    atOnset: false,
    ...overrides,
  }
}

function dose(overrides: Partial<Dose> = {}): Dose {
  return {
    ...audit,
    id: 'dose-1',
    episodeId: 'episode-1',
    takenAt: fixtureEventTime('2024-09-18T01:00'),
    savedMedicineId: null,
    medicineName: 'Ibuprofen',
    doseText: '400 mg',
    followUpEnabled: false,
    followUpIntervalMinutes: 120,
    ...overrides,
  }
}

function dailyRecord(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    ...audit,
    day: '2024-09-18',
    headacheFreeAt: null,
    alcohol: null,
    sleep: null,
    stress: null,
    ...overrides,
  }
}

describe('calendar selectors', () => {
  it('[R-02.6/Q-02] derives unknown-ended evidence only from onset, positive readings and doses', () => {
    const facts = emptyDiaryFixture()
    facts.episodes = [episode()]
    facts.readings = [
      reading({ id: 'positive', measuredAt: fixtureEventTime('2024-09-17T12:00'), pain: { kind: 'numeric', value: 4 } }),
      reading({ id: 'zero', measuredAt: fixtureEventTime('2024-09-16T12:00'), pain: { kind: 'numeric', value: 0 } }),
      reading({ id: 'none', measuredAt: fixtureEventTime('2024-09-19T12:00'), pain: { kind: 'verbal', value: 'none' } }),
    ]
    facts.doses = [dose()]

    expect([...headacheEvidenceDays(facts, fixtureEventTime('2024-09-18T14:05'))]).toEqual([
      '2024-09-15',
      '2024-09-17',
      '2024-09-18',
    ])
  })

  it('[R-02.7/R-02.8] keeps notes-only days unknown and lets headache evidence win over confirmation', () => {
    const facts = emptyDiaryFixture()
    facts.dailyRecords = [
      dailyRecord({ day: '2024-09-17', alcohol: true }),
      dailyRecord({ day: '2024-09-18', headacheFreeAt: fixtureEventTime('2024-09-18T09:00') }),
    ]

    expect(classifyDay(facts, '2024-09-17', fixtureEventTime('2024-09-18T14:05'))).toBe('unknown')
    expect(classifyDay(facts, '2024-09-18', fixtureEventTime('2024-09-18T14:05'))).toBe('headache-free')

    facts.episodes = [episode({ start: fixtureEventTime('2024-09-18T12:00'), state: 'ended', end: fixtureEventTime('2024-09-18T13:00') })]
    expect(classifyDay(facts, '2024-09-18', fixtureEventTime('2024-09-18T14:05'))).toBe('headache')
  })

  it('summarises nullable day-before answers without treating blank answers as no', () => {
    expect(dayBeforeSummary(dailyRecord())).toBe('Alcohol, sleep, stress · not noted yet')
    expect(dayBeforeSummary(dailyRecord({ alcohol: false, sleep: 'not_enough', stress: true }))).toBe(
      'No alcohol · Not enough sleep · Stressful',
    )
  })

  it('[R-04.1] counts past days, excludes unrecorded today and future days, and lists missing dates', () => {
    const facts = emptyDiaryFixture()
    const now = fixtureEventTime('2024-09-18T14:05')
    facts.episodes = [episode({ start: fixtureEventTime('2024-09-03T10:00'), state: 'ended', end: fixtureEventTime('2024-09-03T12:00') })]
    facts.dailyRecords = [
      dailyRecord({ day: '2024-09-04', headacheFreeAt: fixtureEventTime('2024-09-04T20:00') }),
      dailyRecord({ day: '2024-09-05', sleep: 'fair_amount' }),
    ]

    const month = selectCalendarMonth(facts, '2024-09', now, 1)
    expect(month.leadingBlankCount).toBe(6)
    expect(month.days).toHaveLength(30)
    expect(month.coverage).toMatchObject({ eligibleDays: 17, recordedDays: 2, headacheDays: 1, headacheFreeDays: 1 })
    expect(month.coverage.missingDays).toHaveLength(15)
    expect(month.coverage.missingDays).toContain('2024-09-05')
    expect(month.coverage.missingDays).not.toContain('2024-09-18')
    expect(month.days[17]).toMatchObject({ day: '2024-09-18', status: 'unknown', isToday: true, isFuture: false, eligible: false })
    expect(month.days[18]).toMatchObject({ day: '2024-09-19', isFuture: true, eligible: false })

    facts.dailyRecords.push(dailyRecord({ day: '2024-09-18', headacheFreeAt: now }))
    expect(selectCalendarMonth(facts, '2024-09', now).coverage).toMatchObject({ eligibleDays: 18, recordedDays: 3 })
    expect(selectCalendarMonth(facts, '2024-08', now).coverage.eligibleDays).toBe(31)
    expect(selectCalendarMonth(facts, '2024-10', now).coverage.eligibleDays).toBe(0)
  })

  it('[R-02.5/R-02.6] lists every episode touching a day without adding a midnight end or unknown gap', () => {
    const facts = emptyDiaryFixture()
    const now = fixtureEventTime('2024-09-18T14:05')
    facts.episodes = [
      episode({ id: 'carry', start: fixtureEventTime('2024-08-31T23:00'), state: 'ended', end: fixtureEventTime('2024-09-02T00:00') }),
      episode({ id: 'same-day', start: fixtureEventTime('2024-09-01T12:00'), state: 'ended', end: fixtureEventTime('2024-09-01T13:00') }),
      episode({ id: 'unknown', start: fixtureEventTime('2024-09-03T12:00'), state: 'end_unknown', end: null }),
    ]
    facts.readings = [reading({ id: 'unknown-reading', episodeId: 'unknown', measuredAt: fixtureEventTime('2024-09-05T10:00') })]

    expect(episodesForDay(facts, '2024-09-01', now).map(({ episode: item, relation }) => [item.id, relation])).toEqual([
      ['carry', 'continued'],
      ['same-day', 'began'],
    ])
    expect(episodesForDay(facts, '2024-09-02', now)).toEqual([])
    expect(episodesForDay(facts, '2024-09-04', now)).toEqual([])
    expect(episodesForDay(facts, '2024-09-05', now).map(({ relation }) => relation)).toEqual(['recorded'])
  })
})
