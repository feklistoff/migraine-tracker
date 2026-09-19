import { describe, expect, it } from 'vitest'

import { emptyDiaryFixture, fixtureClock, fixtureEventTime } from '../test/fixtures'
import type { Dose, Episode, Reading } from './types'
import {
  validateDoseBounds,
  validateEpisode,
  validateEpisodeSet,
  validatePain,
  validateReadingBounds,
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
    expect(validatePain({ kind: 'numeric', value: 11 })).toMatchObject({ valid: false })
    expect(validatePain({ kind: 'numeric', value: 4.5 })).toMatchObject({ valid: false })
  })

  it('rejects future episode starts and known ends', () => {
    const future = fixtureEventTime('2024-09-18T18:00', 'Europe/Helsinki')
    const futureEnd = fixtureEventTime('2024-09-18T18:01', 'Europe/Helsinki')

    expect(validateEpisode(episode({ start: future }), { clock: fixtureClock })).toMatchObject({ valid: false })
    expect(
      validateEpisode(
        episode({ start: fixtureEventTime('2024-09-18T12:00', 'Europe/Helsinki'), state: 'ended', end: futureEnd }),
        { clock: fixtureClock },
      ),
    ).toMatchObject({ valid: false })
  })

  it('enforces state/end consistency and end-not-before-start', () => {
    const start = fixtureEventTime('2024-09-18T12:00', 'Europe/Helsinki')
    const beforeStart = fixtureEventTime('2024-09-18T11:59', 'Europe/Helsinki')

    expect(validateEpisode(episode({ state: 'ongoing', end: beforeStart }), { clock: fixtureClock })).toMatchObject({
      valid: false,
    })
    expect(validateEpisode(episode({ state: 'ended', end: null }), { clock: fixtureClock })).toMatchObject({
      valid: false,
    })
    expect(
      validateEpisode(episode({ start, state: 'ended', end: beforeStart }), { clock: fixtureClock }),
    ).toMatchObject({ valid: false })
    expect(validateEpisode(episode({ state: 'end_unknown', end: beforeStart }), { clock: fixtureClock })).toMatchObject({
      valid: false,
    })
  })

  it('enforces child bounds, while allowing post-end readings but not post-end doses', () => {
    const ended = episode({
      state: 'ended',
      end: fixtureEventTime('2024-09-18T13:00', 'Europe/Helsinki'),
    })
    const beforeStart = fixtureEventTime('2024-09-18T11:59', 'Europe/Helsinki')
    const afterEnd = fixtureEventTime('2024-09-18T13:30', 'Europe/Helsinki')
    const future = fixtureEventTime('2024-09-18T18:00', 'Europe/Helsinki')

    expect(validateReadingBounds(reading({ measuredAt: beforeStart }), ended, { clock: fixtureClock })).toMatchObject({
      valid: false,
    })
    expect(validateReadingBounds(reading({ measuredAt: future }), ended, { clock: fixtureClock })).toMatchObject({
      valid: false,
    })
    expect(validateReadingBounds(reading({ measuredAt: afterEnd }), ended, { clock: fixtureClock })).toMatchObject({
      valid: true,
    })
    expect(validateDoseBounds(dose({ takenAt: beforeStart }), ended, { clock: fixtureClock })).toMatchObject({
      valid: false,
    })
    expect(validateDoseBounds(dose({ takenAt: afterEnd }), ended, { clock: fixtureClock })).toMatchObject({
      valid: false,
    })
    expect(validateDoseBounds(dose({ takenAt: future }), ended, { clock: fixtureClock })).toMatchObject({ valid: false })
  })

  it('rejects overlapping known intervals, allows adjacent endpoints, and ignores unknown ends', () => {
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

    expect(validateEpisodeSet([first, overlapping], { clock: fixtureClock })).toMatchObject({ valid: false })
    expect(validateEpisodeSet([first, adjacent], { clock: fixtureClock })).toMatchObject({ valid: true })
    expect(validateEpisodeSet([unknown, first], { clock: fixtureClock })).toMatchObject({ valid: true })
  })

  it('rejects more than one ongoing episode and includes the current instant in overlap checks', () => {
    const ongoing = episode({ id: 'ongoing' })
    const secondOngoing = episode({
      id: 'second',
      start: fixtureEventTime('2024-09-18T12:31', 'Europe/Helsinki'),
    })
    const futureStartingEnded = episode({
      id: 'future',
      start: fixtureEventTime('2024-09-18T18:00', 'Europe/Helsinki'),
      state: 'ended',
      end: fixtureEventTime('2024-09-18T18:00', 'Europe/Helsinki'),
    })

    expect(validateEpisodeSet([ongoing, secondOngoing], { clock: fixtureClock })).toMatchObject({ valid: false })
    expect(validateEpisodeSet([ongoing, futureStartingEnded], { clock: fixtureClock })).toMatchObject({ valid: false })
  })

  it('does not treat an empty diary as a failed validation result', () => {
    const empty = emptyDiaryFixture()

    expect(validateEpisodeSet(empty.episodes, { clock: fixtureClock })).toEqual({ valid: true, value: [] })
  })
})
