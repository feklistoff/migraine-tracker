import { describe, expect, it } from 'vitest'

import {
  emptyDiaryFixture,
  endedEpisodeFixture,
  incompleteEpisodeFixture,
  mixedPainFixture,
  multipleDoseFixture,
  ongoingEpisodeFixture,
  unknownEndedEpisodeFixture,
} from './fixtures'

describe('domain fixtures', () => {
  it('cover the empty and lifecycle states without seeded production data', () => {
    expect(emptyDiaryFixture().episodes).toHaveLength(0)
    expect(incompleteEpisodeFixture().episodes[0].state).toBe('ongoing')
    expect(endedEpisodeFixture().episodes[0].state).toBe('ended')
    expect(ongoingEpisodeFixture().episodes[0].state).toBe('ongoing')
    expect(unknownEndedEpisodeFixture().episodes[0].state).toBe('end_unknown')
  })

  it('includes multiple doses and mixed numeric/verbal pain without coercion', () => {
    const doses = multipleDoseFixture()
    const mixed = mixedPainFixture()

    expect(doses.doses).toHaveLength(2)
    expect(mixed.readings.map((reading) => reading.pain)).toEqual([
      { kind: 'numeric', value: 7 },
      { kind: 'verbal', value: 'mild' },
      null,
    ])
  })
})
