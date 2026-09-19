import type { Clock } from './time'
import { compareInstants, instantFromEventTime } from './time'
import type { Dose, Episode, Impact, Pain, Reading, RecordedTime } from './types'

export type ValidationIssueCode =
  | 'invalid-time'
  | 'invalid-pain'
  | 'invalid-impact'
  | 'invalid-state'
  | 'future'
  | 'end-before-start'
  | 'child-before-start'
  | 'dose-after-end'
  | 'overlap'
  | 'multiple-ongoing'
  | 'invalid-pain-entry-default'
  | 'invalid-follow-up-enabled'
  | 'invalid-follow-up-interval'
  | 'invalid-day'
  | 'missing-medicine'
  | 'invalid-medicine'

export interface ValidationIssue {
  code: ValidationIssueCode
  path: string
  message: string
}

export type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; issues: ValidationIssue[] }

export interface ValidationContext {
  clock: Clock
  existingEpisodes?: readonly Episode[]
}

const verbalPainValues = new Set(['none', 'mild', 'moderate', 'severe'])
const impacts = new Set<Impact>(['normal', 'slowed', 'stopped'])
const followUpIntervals = new Set([30, 60, 90, 120])

function valid<T>(value: T): ValidationResult<T> {
  return { valid: true, value }
}

function invalid<T>(...issues: ValidationIssue[]): ValidationResult<T> {
  return { valid: false, issues }
}

function issue(code: ValidationIssueCode, path: string, message: string): ValidationIssue {
  return { code, path, message }
}

function compareSafely(one: RecordedTime, two: RecordedTime): -1 | 0 | 1 | null {
  try {
    return compareInstants(one, two)
  } catch {
    return null
  }
}

function validateEventTime(value: { instant: string; timeZone: string; offset: string }, path: string): ValidationIssue | null {
  try {
    const canonical = value
    const resolved = instantFromEventTime(canonical).toZonedDateTimeISO(canonical.timeZone)
    if (resolved.offset !== canonical.offset) {
      return issue(
        'invalid-time',
        path,
        `The recorded offset ${canonical.offset} does not match ${canonical.timeZone} at this instant.`,
      )
    }
    return null
  } catch {
    return issue('invalid-time', path, 'The recorded date and time is not valid.')
  }
}

function futureIssue(value: { instant: string }, clock: Clock, path: string): ValidationIssue | null {
  try {
    return compareInstants(value.instant, clock.now()) > 0
      ? issue('future', path, 'This time cannot be in the future.')
      : null
  } catch {
    return issue('invalid-time', path, 'The recorded date and time is not valid.')
  }
}

export function validatePain(value: Pain | null): ValidationResult<Pain | null> {
  if (value === null) return valid(null)

  if (value.kind === 'numeric' && Number.isInteger(value.value) && value.value >= 0 && value.value <= 10) {
    return valid(value)
  }
  if (value.kind === 'verbal' && verbalPainValues.has(value.value)) {
    return valid(value)
  }

  return invalid(issue('invalid-pain', 'pain', 'Pain must be a whole number from 0 to 10 or a supported word.'))
}

export function validateImpact(value: Impact | null): ValidationResult<Impact | null> {
  if (value === null || impacts.has(value)) return valid(value)
  return invalid(issue('invalid-impact', 'impact', 'Choose a valid activity impact.'))
}

function basicEpisodeValidation(episode: Episode, clock: Clock): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const startTimeIssue = validateEventTime(episode.start, 'start')
  if (startTimeIssue) issues.push(startTimeIssue)

  const startFutureIssue = futureIssue(episode.start, clock, 'start')
  if (startFutureIssue) issues.push(startFutureIssue)

  if (episode.state === 'ended' && episode.end === null) {
    issues.push(issue('invalid-state', 'end', 'An ended headache needs an end time.'))
  }
  if (episode.state !== 'ended' && episode.end !== null) {
    issues.push(issue('invalid-state', 'end', 'An ongoing or unknown-ended headache cannot have an end time.'))
  }
  if (!['ongoing', 'ended', 'end_unknown'].includes(episode.state)) {
    issues.push(issue('invalid-state', 'state', 'The headache state is not recognised.'))
  }

  if (episode.end !== null) {
    const endTimeIssue = validateEventTime(episode.end, 'end')
    if (endTimeIssue) issues.push(endTimeIssue)
    const endFutureIssue = futureIssue(episode.end, clock, 'end')
    if (endFutureIssue) issues.push(endFutureIssue)
    const endComparedToStart = startTimeIssue || endTimeIssue ? null : compareSafely(episode.end, episode.start)
    if (endComparedToStart !== null && endComparedToStart < 0) {
      issues.push(issue('end-before-start', 'end', 'The end time cannot be before the start time.'))
    }
  }

  return issues
}

export function validateEpisode(episode: Episode, context: ValidationContext): ValidationResult<Episode> {
  const issues = basicEpisodeValidation(episode, context.clock)
  if (issues.length > 0) return invalid(...issues)

  if (context.existingEpisodes) {
    const others = context.existingEpisodes.filter((candidate) => candidate.id !== episode.id)
    const collection = validateEpisodeSet([...others, episode], { clock: context.clock })
    if (!collection.valid) return invalid(...collection.issues)
  }

  return valid(episode)
}

export function validateReadingBounds(
  reading: Reading,
  episode: Episode,
  context: Pick<ValidationContext, 'clock'>,
): ValidationResult<Reading> {
  const issues: ValidationIssue[] = []
  const timeIssue = validateEventTime(reading.measuredAt, 'measuredAt')
  if (timeIssue) issues.push(timeIssue)
  const future = futureIssue(reading.measuredAt, context.clock, 'measuredAt')
  if (future) issues.push(future)
  const measuredComparedToStart = timeIssue ? null : compareSafely(reading.measuredAt, episode.start)
  if (measuredComparedToStart !== null && measuredComparedToStart < 0) {
    issues.push(issue('child-before-start', 'measuredAt', 'A reading cannot be before the headache started.'))
  }

  const pain = validatePain(reading.pain)
  if (!pain.valid) issues.push(...pain.issues)
  const impact = validateImpact(reading.impact)
  if (!impact.valid) issues.push(...impact.issues)

  // Post-end readings are deliberately allowed by R-02.3 and are labelled by
  // callers when they build the timeline.
  return issues.length > 0 ? invalid(...issues) : valid(reading)
}

export function validateDoseBounds(
  dose: Dose,
  episode: Episode,
  context: Pick<ValidationContext, 'clock'>,
): ValidationResult<Dose> {
  const issues: ValidationIssue[] = []
  const timeIssue = validateEventTime(dose.takenAt, 'takenAt')
  if (timeIssue) issues.push(timeIssue)
  const future = futureIssue(dose.takenAt, context.clock, 'takenAt')
  if (future) issues.push(future)
  const doseComparedToStart = timeIssue ? null : compareSafely(dose.takenAt, episode.start)
  if (doseComparedToStart !== null && doseComparedToStart < 0) {
    issues.push(issue('child-before-start', 'takenAt', 'A dose cannot be before the headache started.'))
  }
  const doseComparedToEnd = timeIssue || episode.end === null ? null : compareSafely(dose.takenAt, episode.end)
  if (episode.state === 'ended' && doseComparedToEnd !== null && doseComparedToEnd > 0) {
    issues.push(issue('dose-after-end', 'takenAt', 'Edit the headache end time before recording a dose after it ended.'))
  }
  if (!followUpIntervals.has(dose.followUpIntervalMinutes)) {
    issues.push(issue('invalid-follow-up-interval', 'followUpIntervalMinutes', 'Follow-up interval must be 30, 60, 90 or 120 minutes.'))
  }

  return issues.length > 0 ? invalid(...issues) : valid(dose)
}

function intervalFor(episode: Episode, clock: Clock): { start: Episode['start']; end: Episode['end'] } | null {
  if (episode.state === 'end_unknown') return null
  if (episode.state === 'ended') return { start: episode.start, end: episode.end }
  return { start: episode.start, end: { instant: clock.now().toString(), timeZone: clock.timeZone(), offset: '' } }
}

function intervalOverlaps(
  one: { start: Episode['start']; end: Episode['end'] },
  two: { start: Episode['start']; end: Episode['end'] },
): boolean {
  if (one.end === null || two.end === null) return false
  // Strict comparisons make shared endpoints adjacent rather than overlapping.
  try {
    return compareInstants(one.start, two.end) < 0 && compareInstants(two.start, one.end) < 0
  } catch {
    return false
  }
}

export function validateEpisodeSet(
  episodes: readonly Episode[],
  context: Pick<ValidationContext, 'clock'>,
): ValidationResult<Episode[]> {
  const issues: ValidationIssue[] = []
  episodes.forEach((episode, index) => {
    issues.push(...basicEpisodeValidation(episode, context.clock).map((item) => ({ ...item, path: `episodes[${index}].${item.path}` })))
  })

  const ongoingCount = episodes.filter((episode) => episode.state === 'ongoing').length
  if (ongoingCount > 1) {
    issues.push(issue('multiple-ongoing', 'episodes', 'Only one headache can be ongoing at a time.'))
  }

  for (let index = 0; index < episodes.length; index += 1) {
    const first = intervalFor(episodes[index], context.clock)
    if (!first) continue
    for (let otherIndex = index + 1; otherIndex < episodes.length; otherIndex += 1) {
      const second = intervalFor(episodes[otherIndex], context.clock)
      if (second && intervalOverlaps(first, second)) {
        issues.push(
          issue(
            'overlap',
            `episodes[${index}].start`,
            `This known headache interval overlaps episodes[${otherIndex}].`,
          ),
        )
      }
    }
  }

  return issues.length > 0 ? invalid(...issues) : valid([...episodes])
}
