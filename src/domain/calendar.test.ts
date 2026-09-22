import { describe, expect, it } from 'vitest'

import { emptyDiaryFixture, fixtureEventTime } from '../test/fixtures'
import type { DailyRecord, Dose, Episode, Reading } from './types'
import {
  classifyDay,
  dayBeforeSummary,
  headacheEvidenceDays,
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
})
