import { describe, expect, it } from 'vitest'

import {
  civilDay,
  elapsedMilliseconds,
  eventTimeFromInstant,
  fixedClock,
  nowEventTime,
  resolveCivilDateTime,
} from './time'

describe('domain time', () => {
  it('stores the event-local day and resolved offset with an instant', () => {
    const beforeSpringForward = eventTimeFromInstant('2024-03-31T00:30:00Z', 'Europe/Helsinki')
    const afterSpringForward = eventTimeFromInstant('2024-03-31T01:30:00Z', 'Europe/Helsinki')

    expect(beforeSpringForward).toEqual({
      instant: '2024-03-31T00:30:00Z',
      timeZone: 'Europe/Helsinki',
      offset: '+02:00',
    })
    expect(afterSpringForward.offset).toBe('+03:00')
    expect(civilDay(afterSpringForward)).toBe('2024-03-31')
  })

  it('keeps civil boundaries in the recorded zone, including leap day and year change', () => {
    const leapDay = eventTimeFromInstant('2024-02-29T23:59:00Z', 'UTC')
    const newYear = eventTimeFromInstant('2025-01-01T00:00:00Z', 'UTC')

    expect(civilDay(leapDay)).toBe('2024-02-29')
    expect(civilDay(newYear)).toBe('2025-01-01')
  })

  it('requires an explicit occurrence for a repeated civil time', () => {
    const ambiguous = resolveCivilDateTime({
      date: '2024-11-03',
      time: '01:30',
      timeZone: 'America/New_York',
    })
    const first = resolveCivilDateTime({
      date: '2024-11-03',
      time: '01:30',
      timeZone: 'America/New_York',
      occurrence: 'first',
    })
    const second = resolveCivilDateTime({
      date: '2024-11-03',
      time: '01:30',
      timeZone: 'America/New_York',
      occurrence: 'second',
    })

    expect(ambiguous).toMatchObject({ ok: false, code: 'ambiguous' })
    expect(first).toMatchObject({ ok: true, time: { offset: '-04:00' }, occurrence: 'first' })
    expect(second).toMatchObject({ ok: true, time: { offset: '-05:00' }, occurrence: 'second' })

    if (first.ok && second.ok) {
      expect(first.time.instant).not.toBe(second.time.instant)
    }
  })

  it('rejects a nonexistent spring-forward civil time instead of normalising it', () => {
    const result = resolveCivilDateTime({
      date: '2024-03-10',
      time: '02:30',
      timeZone: 'America/New_York',
    })

    expect(result).toMatchObject({ ok: false, code: 'nonexistent' })
  })

  it('uses an injectable clock for current event context', () => {
    const clock = fixedClock('2024-09-18T13:05:00Z', 'Europe/Helsinki')

    expect(nowEventTime(clock)).toEqual({
      instant: '2024-09-18T13:05:00Z',
      timeZone: 'Europe/Helsinki',
      offset: '+03:00',
    })
  })

  it('measures elapsed instants across short and long DST days', () => {
    const springStart = resolveCivilDateTime({
      date: '2024-03-10',
      time: '00:30',
      timeZone: 'America/New_York',
    })
    const springEnd = resolveCivilDateTime({
      date: '2024-03-10',
      time: '03:30',
      timeZone: 'America/New_York',
    })
    const autumnStart = resolveCivilDateTime({
      date: '2024-11-03',
      time: '00:30',
      timeZone: 'America/New_York',
    })
    const autumnEnd = resolveCivilDateTime({
      date: '2024-11-03',
      time: '02:30',
      timeZone: 'America/New_York',
    })

    expect(springStart.ok && springEnd.ok).toBe(true)
    expect(autumnStart.ok && autumnEnd.ok).toBe(true)

    if (springStart.ok && springEnd.ok && autumnStart.ok && autumnEnd.ok) {
      expect(elapsedMilliseconds(springStart.time, springEnd.time)).toBe(2 * 60 * 60 * 1000)
      expect(elapsedMilliseconds(autumnStart.time, autumnEnd.time)).toBe(3 * 60 * 60 * 1000)
    }
  })
})
