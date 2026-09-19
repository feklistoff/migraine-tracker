import { Temporal } from '@js-temporal/polyfill'

import type { RecordedTime } from './types'

export type InstantLike = string | Temporal.Instant
export type CivilTimeOccurrence = 'first' | 'second'

export interface CivilDateTimeInput {
  date: string
  time: string
  timeZone: string
  occurrence?: CivilTimeOccurrence
}

export type CivilDateTimeResolution =
  | {
      ok: true
      time: RecordedTime
      occurrence: 'none' | CivilTimeOccurrence
      zonedDateTime: Temporal.ZonedDateTime
    }
  | {
      ok: false
      code: 'invalid' | 'ambiguous' | 'nonexistent'
      message: string
    }

export interface Clock {
  now(): Temporal.Instant
  timeZone(): string
}

function asInstant(value: InstantLike): Temporal.Instant {
  return value instanceof Temporal.Instant ? value : Temporal.Instant.from(value)
}

function assertTimeZone(timeZone: string): void {
  // Constructing a ZonedDateTime is the polyfill-supported way to validate an
  // IANA zone. It also accepts the useful canonical `UTC` identifier.
  Temporal.ZonedDateTime.from(
    {
      timeZone,
      year: 2000,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    },
    { disambiguation: 'reject' },
  )
}

export function eventTimeFromInstant(value: InstantLike, timeZone: string): RecordedTime {
  const instant = asInstant(value)
  const zonedDateTime = instant.toZonedDateTimeISO(timeZone)

  return {
    instant: instant.toString(),
    timeZone: zonedDateTime.timeZoneId,
    offset: zonedDateTime.offset,
  }
}

export function instantFromEventTime(value: RecordedTime): Temporal.Instant {
  return asInstant(value.instant)
}

export function zonedDateTimeFromEventTime(value: RecordedTime): Temporal.ZonedDateTime {
  return instantFromEventTime(value).toZonedDateTimeISO(value.timeZone)
}

export function civilDay(value: RecordedTime): string {
  return zonedDateTimeFromEventTime(value).toPlainDate().toString()
}

export function compareInstants(one: RecordedTime | InstantLike, two: RecordedTime | InstantLike): -1 | 0 | 1 {
  const oneInstant = typeof one === 'object' && 'instant' in one ? instantFromEventTime(one) : asInstant(one)
  const twoInstant = typeof two === 'object' && 'instant' in two ? instantFromEventTime(two) : asInstant(two)
  const comparison = Temporal.Instant.compare(oneInstant, twoInstant)

  return comparison < 0 ? -1 : comparison > 0 ? 1 : 0
}

export function elapsedMilliseconds(start: RecordedTime | InstantLike, end: RecordedTime | InstantLike): number {
  const startInstant = typeof start === 'object' && 'instant' in start ? instantFromEventTime(start) : asInstant(start)
  const endInstant = typeof end === 'object' && 'instant' in end ? instantFromEventTime(end) : asInstant(end)

  return endInstant.epochMilliseconds - startInstant.epochMilliseconds
}

function civilPlainDateTime(input: CivilDateTimeInput): Temporal.PlainDateTime {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new RangeError('Date must use YYYY-MM-DD.')
  }
  if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(input.time)) {
    throw new RangeError('Time must use HH:mm or HH:mm:ss.')
  }

  return Temporal.PlainDateTime.from(`${input.date}T${input.time}`)
}

function zonedForPlainDateTime(
  plainDateTime: Temporal.PlainDateTime,
  timeZone: string,
  disambiguation: 'earlier' | 'later',
): Temporal.ZonedDateTime {
  return Temporal.ZonedDateTime.from(
    {
      timeZone,
      year: plainDateTime.year,
      month: plainDateTime.month,
      day: plainDateTime.day,
      hour: plainDateTime.hour,
      minute: plainDateTime.minute,
      second: plainDateTime.second,
      millisecond: plainDateTime.millisecond,
      microsecond: plainDateTime.microsecond,
      nanosecond: plainDateTime.nanosecond,
    },
    { disambiguation },
  )
}

export function resolveCivilDateTime(input: CivilDateTimeInput): CivilDateTimeResolution {
  try {
    assertTimeZone(input.timeZone)
    const plainDateTime = civilPlainDateTime(input)
    const earlier = zonedForPlainDateTime(plainDateTime, input.timeZone, 'earlier')
    const later = zonedForPlainDateTime(plainDateTime, input.timeZone, 'later')
    const earlierMatches = earlier.toPlainDateTime().equals(plainDateTime)
    const laterMatches = later.toPlainDateTime().equals(plainDateTime)
    const sameInstant = earlier.toInstant().equals(later.toInstant())

    if (!earlierMatches && !laterMatches) {
      return {
        ok: false,
        code: 'nonexistent',
        message: `${input.date} ${input.time} does not exist in ${input.timeZone}; choose another time.`,
      }
    }

    if (!sameInstant && earlierMatches && laterMatches && input.occurrence === undefined) {
      return {
        ok: false,
        code: 'ambiguous',
        message: `${input.date} ${input.time} occurs twice in ${input.timeZone}; choose the first or second occurrence.`,
      }
    }

    const occurrence = sameInstant ? 'none' : input.occurrence ?? 'first'
    const chosen = occurrence === 'second' ? later : earlier

    return {
      ok: true,
      time: eventTimeFromInstant(chosen.toInstant(), chosen.timeZoneId),
      occurrence,
      zonedDateTime: chosen,
    }
  } catch (error) {
    return {
      ok: false,
      code: 'invalid',
      message: error instanceof Error ? error.message : 'The date and time could not be understood.',
    }
  }
}

export function systemClock(): Clock {
  return {
    now: () => Temporal.Now.instant(),
    timeZone: () => Temporal.Now.timeZoneId(),
  }
}

export function fixedClock(now: InstantLike, timeZone: string): Clock {
  const instant = asInstant(now)
  assertTimeZone(timeZone)

  return {
    now: () => instant,
    timeZone: () => timeZone,
  }
}

export function nowEventTime(clock: Clock = systemClock()): RecordedTime {
  return eventTimeFromInstant(clock.now(), clock.timeZone())
}
