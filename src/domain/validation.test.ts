import { describe, expect, it } from 'vitest'

import { emptyDiaryFixture, fixtureClock, fixtureEventTime } from '../test/fixtures'
import type { Dose, Episode, Reading } from './types'
import {
  validateDoseBounds,
  validateEpisode,
  validateEpisodeSet,
  validatePain,
  validateReadingBounds,
  type ValidationResult,
} from './validation'

const audit = {
  createdAt: '2024-09-18T10:00:00Z',
  updatedAt: '2024-09-18T10:00:00Z',
}

function episode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'episode-1',
    start: fixtureEventTime('2024-09-18T12:00', 'Europe/Helsinki'),
    state: 'ongoing',
    end: null,
    note: null,
    ...audit,
    ...overrides,
  }
}

function reading(overrides: Partial<Reading> = {}): Reading {
  return {
    id: 'reading-1',
    episodeId: 'episode-1',
    measuredAt: fixtureEventTime('2024-09-18T12:30', 'Europe/Helsinki'),
    pain: { kind: 'numeric', value: 6 },
    impact: 'slowed',
    note: null,
    linkedDoseId: null,
    atOnset: false,
    ...audit,
    ...overrides,
  }
}

function issueCodes<T>(result: ValidationResult<T>): string[] {
  return result.valid ? [] : result.issues.map((item) => item.code)
}

function dose(overrides: Partial<Dose> = {}): Dose {
  return {
    id: 'dose-1',
    episodeId: 'episode-1',
    takenAt: fixtureEventTime('2024-09-18T12:45', 'Europe/Helsinki'),
    savedMedicineId: null,
    medicineName: 'Ibuprofen',
    doseText: '400 mg',
    followUpEnabled: true,
    followUpIntervalMinutes: 120,
    ...audit,
    ...overrides,
  }
}

describe('domain validation', () => {
  it('preserves verbal pain and null as distinct valid values', () => {
    const verbal = { kind: 'verbal' as const, value: 'moderate' as const }

    expect(validatePain(verbal)).toEqual({ valid: true, value: verbal })
    expect(validatePain(null)).toEqual({ valid: true, value: null })
    expect(issueCodes(validatePain({ kind: 'numeric', value: 11 }))).toEqual(['invalid-pain'])
    expect(issueCodes(validatePain({ kind: 'numeric', value: 4.5 }))).toEqual(['invalid-pain'])
  })

  it('[R-02.1] rejects future episode starts and known ends', () => {
    const future = fixtureEventTime('2024-09-18T18:00', 'Europe/Helsinki')
    const futureEnd = fixtureEventTime('2024-09-18T18:01', 'Europe/Helsinki')

    expect(issueCodes(validateEpisode(episode({ start: future }), { clock: fixtureClock }))).toEqual(['future'])
    expect(
      issueCodes(
        validateEpisode(
          episode({ start: fixtureEventTime('2024-09-18T12:00', 'Europe/Helsinki'), state: 'ended', end: futureEnd }),
          { clock: fixtureClock },
        ),
      ),
    ).toEqual(['future'])
  })

  it('[R-02.1] enforces state/end consistency, zero duration and end-not-before-start', () => {
    const start = fixtureEventTime('2024-09-18T12:00', 'Europe/Helsinki')
    const beforeStart = fixtureEventTime('2024-09-18T11:59', 'Europe/Helsinki')
    const invalidOffset = { ...start, offset: '+00:00' }

    expect(issueCodes(validateEpisode(episode({ state: 'ongoing', end: beforeStart }), { clock: fixtureClock }))).toEqual([
      'invalid-state',
      'end-before-start',
    ])
    expect(issueCodes(validateEpisode(episode({ state: 'ended', end: null }), { clock: fixtureClock }))).toEqual(['invalid-state'])
    expect(
      issueCodes(validateEpisode(episode({ start, state: 'ended', end: beforeStart }), { clock: fixtureClock })),
    ).toEqual(['end-before-start'])
    expect(issueCodes(validateEpisode(episode({ start, state: 'ended', end: start }), { clock: fixtureClock }))).toEqual([])
    expect(issueCodes(validateEpisode(episode({ start: invalidOffset }), { clock: fixtureClock }))).toEqual(['invalid-time'])
    expect(issueCodes(validateEpisode(episode({ state: 'end_unknown', end: beforeStart }), { clock: fixtureClock }))).toEqual([
      'invalid-state',
      'end-before-start',
    ])
  })

  it('[R-02.3] enforces child bounds, while allowing post-end readings but not post-end doses', () => {
    const ended = episode({
      state: 'ended',
      end: fixtureEventTime('2024-09-18T13:00', 'Europe/Helsinki'),
    })
    const beforeStart = fixtureEventTime('2024-09-18T11:59', 'Europe/Helsinki')
    const afterEnd = fixtureEventTime('2024-09-18T13:30', 'Europe/Helsinki')
    const future = fixtureEventTime('2024-09-18T18:00', 'Europe/Helsinki')

    expect(issueCodes(validateReadingBounds(reading({ measuredAt: beforeStart }), ended, { clock: fixtureClock }))).toEqual([
      'child-before-start',
    ])
    expect(issueCodes(validateReadingBounds(reading({ measuredAt: future }), ended, { clock: fixtureClock }))).toEqual(['future'])
    expect(issueCodes(validateReadingBounds(reading({ measuredAt: afterEnd }), ended, { clock: fixtureClock }))).toEqual([])
    expect(issueCodes(validateDoseBounds(dose({ takenAt: beforeStart }), ended, { clock: fixtureClock }))).toEqual([
      'child-before-start',
    ])
    expect(issueCodes(validateDoseBounds(dose({ takenAt: afterEnd }), ended, { clock: fixtureClock }))).toEqual(['dose-after-end'])
    expect(issueCodes(validateDoseBounds(dose({ takenAt: future }), ended, { clock: fixtureClock }))).toEqual([
      'future',
      'dose-after-end',
    ])
  })

  it('[R-02.10] rejects overlapping known intervals, allows adjacent endpoints, and ignores unknown ends', () => {
    const first = episode({
      id: 'first',
      state: 'ended',
      end: fixtureEventTime('2024-09-18T13:00', 'Europe/Helsinki'),
    })
    const overlapping = episode({
      id: 'second',
      start: fixtureEventTime('2024-09-18T12:59', 'Europe/Helsinki'),
      state: 'ended',
      end: fixtureEventTime('2024-09-18T14:00', 'Europe/Helsinki'),
    })
    const adjacent = episode({
      id: 'second',
      start: fixtureEventTime('2024-09-18T13:00', 'Europe/Helsinki'),
      state: 'ended',
      end: fixtureEventTime('2024-09-18T14:00', 'Europe/Helsinki'),
    })
    const unknown = episode({ id: 'unknown', state: 'end_unknown', end: null })

    expect(issueCodes(validateEpisodeSet([first, overlapping], { clock: fixtureClock }))).toEqual(['overlap'])
    expect(issueCodes(validateEpisodeSet([first, adjacent], { clock: fixtureClock }))).toEqual([])
    expect(issueCodes(validateEpisodeSet([unknown, first], { clock: fixtureClock }))).toEqual([])
  })

  it('reports the single-ongoing rule separately from overlap with the current instant', () => {
    const ongoing = episode({ id: 'ongoing' })
    const secondOngoing = episode({
      id: 'second',
      start: fixtureEventTime('2024-09-18T12:31', 'Europe/Helsinki'),
    })
    const endedDuringOngoing = episode({
      id: 'ended-during-ongoing',
      start: fixtureEventTime('2024-09-18T15:00', 'Europe/Helsinki'),
      state: 'ended',
      end: fixtureEventTime('2024-09-18T16:00', 'Europe/Helsinki'),
    })

    expect(issueCodes(validateEpisodeSet([ongoing, secondOngoing], { clock: fixtureClock }))).toEqual([
      'multiple-ongoing',
      'overlap',
    ])
    expect(issueCodes(validateEpisodeSet([ongoing, endedDuringOngoing], { clock: fixtureClock }))).toEqual(['overlap'])
  })

  it('does not treat an empty diary as a failed validation result', () => {
    const empty = emptyDiaryFixture()

    expect(validateEpisodeSet(empty.episodes, { clock: fixtureClock })).toEqual({ valid: true, value: [] })
  })
})
