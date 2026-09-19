import { describe, expect, it } from 'vitest'

import { fixtureClock, fixtureEventTime } from '../test/fixtures'
import { endEpisode, markEpisodeEndUnknown, startEpisode } from './episodes'

describe('episode lifecycle', () => {
  it('starts an incomplete episode without inventing pain or impact', () => {
    const result = startEpisode(
      {
        id: 'episode-started',
        start: fixtureEventTime('2024-09-18T12:00', 'Europe/Helsinki'),
      },
      { clock: fixtureClock, existingEpisodes: [] },
    )

    expect(result).toMatchObject({ valid: true, value: { id: 'episode-started', state: 'ongoing', end: null } })
  })

  it('transitions an ongoing episode to ended only after validating the end', () => {
    const started = startEpisode(
      {
        id: 'episode-ended',
        start: fixtureEventTime('2024-09-18T12:00', 'Europe/Helsinki'),
      },
      { clock: fixtureClock, existingEpisodes: [] },
    )

    expect(started.valid).toBe(true)
    if (started.valid) {
      const ended = endEpisode(
        started.value,
        fixtureEventTime('2024-09-18T13:00', 'Europe/Helsinki'),
        { clock: fixtureClock, existingEpisodes: [started.value] },
      )

      expect(ended).toMatchObject({ valid: true, value: { state: 'ended', end: { offset: '+03:00' } } })
    }
  })

  it('supports forgotten-end recovery without creating a known duration', () => {
    const started = startEpisode(
      {
        id: 'episode-unknown',
        start: fixtureEventTime('2024-09-18T12:00', 'Europe/Helsinki'),
      },
      { clock: fixtureClock, existingEpisodes: [] },
    )

    expect(started.valid).toBe(true)
    if (started.valid) {
      expect(markEpisodeEndUnknown(started.value, { clock: fixtureClock })).toMatchObject({
        valid: true,
        value: { state: 'end_unknown', end: null },
      })
    }
  })
})
