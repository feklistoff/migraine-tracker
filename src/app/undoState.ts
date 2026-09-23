import type { DiaryFacts } from '../domain/types'

export interface UndoState {
  episodeId: string
  revision: number
}

const PENDING_UNDO_STORAGE_KEY = 'headache-diary-pending-undo'
const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000

export function readUndoState(): UndoState | undefined {
  try {
    const saved = window.localStorage.getItem(PENDING_UNDO_STORAGE_KEY)
    if (!saved) return undefined
    const parsed: unknown = JSON.parse(saved)
    if (
      !parsed || typeof parsed !== 'object' ||
      typeof (parsed as Record<string, unknown>).episodeId !== 'string' ||
      !Number.isSafeInteger((parsed as Record<string, unknown>).revision)
    ) {
      window.localStorage.removeItem(PENDING_UNDO_STORAGE_KEY)
      return undefined
    }
    return {
      episodeId: (parsed as { episodeId: string }).episodeId,
      revision: (parsed as { revision: number }).revision,
    }
  } catch {
    return undefined
  }
}

export function writeUndoState(state: UndoState | undefined): void {
  try {
    if (state) window.localStorage.setItem(PENDING_UNDO_STORAGE_KEY, JSON.stringify(state))
    else window.localStorage.removeItem(PENDING_UNDO_STORAGE_KEY)
  } catch {
    // Undo remains available for the current session if browser storage is unavailable.
  }
}

export function isUndoStateAvailable(
  state: UndoState | undefined,
  facts: DiaryFacts,
  nowMilliseconds: number,
): state is UndoState {
  if (!state || state.revision !== facts.metadata.revision) return false
  const episode = facts.episodes.find((candidate) => candidate.id === state.episodeId)
  if (!episode || episode.state !== 'ended' || !episode.end) return false
  return nowMilliseconds - Date.parse(episode.end.instant) <= UNDO_WINDOW_MS
}
