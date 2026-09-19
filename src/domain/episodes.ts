import type { Clock } from './time'
import { elapsedMilliseconds } from './time'
import type { Episode, RecordedTime } from './types'
import { validateEpisode, validateEpisodeSet, type ValidationResult } from './validation'

export interface StartEpisodeInput {
  id?: string
  start: RecordedTime
  note?: string | null
}

export interface EpisodeContext {
  clock: Clock
  existingEpisodes: readonly Episode[]
}

function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  throw new Error('A UUID-capable crypto source is required to create a diary record.')
}

function auditNow(clock: Clock): string {
  return clock.now().toString()
}

export function startEpisode(input: StartEpisodeInput, context: EpisodeContext): ValidationResult<Episode> {
  const timestamp = auditNow(context.clock)
  const candidate: Episode = {
    id: input.id ?? newId(),
    start: input.start,
    state: 'ongoing',
    end: null,
    note: input.note ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const result = validateEpisodeSet([...context.existingEpisodes, candidate], { clock: context.clock })
  return result.valid ? { valid: true, value: candidate } : { valid: false, issues: result.issues }
}

export function endEpisode(
  episode: Episode,
  end: RecordedTime,
  context: EpisodeContext,
): ValidationResult<Episode> {
  const candidate: Episode = {
    ...episode,
    state: 'ended',
    end,
    updatedAt: auditNow(context.clock),
  }
  const validation = validateEpisode(candidate, {
    clock: context.clock,
    existingEpisodes: context.existingEpisodes,
  })
  return validation
}

export function markEpisodeEndUnknown(
  episode: Episode,
  context: Pick<EpisodeContext, 'clock'>,
): ValidationResult<Episode> {
  const candidate: Episode = {
    ...episode,
    state: 'end_unknown',
    end: null,
    updatedAt: auditNow(context.clock),
  }
  return validateEpisode(candidate, { clock: context.clock })
}

export function editEpisodeBounds(
  episode: Episode,
  changes: Partial<Pick<Episode, 'start' | 'end' | 'state'>>,
  context: EpisodeContext,
): ValidationResult<Episode> {
  const candidate: Episode = {
    ...episode,
    ...changes,
    updatedAt: auditNow(context.clock),
  }
  const validation = validateEpisode(candidate, {
    clock: context.clock,
    existingEpisodes: context.existingEpisodes,
  })
  return validation
}

export function episodeElapsedMilliseconds(episode: Episode, clock: Clock): number | null {
  if (episode.state === 'end_unknown') return null
  const end = episode.state === 'ended' && episode.end !== null ? episode.end : clock.now()
  return elapsedMilliseconds(episode.start, end)
}
