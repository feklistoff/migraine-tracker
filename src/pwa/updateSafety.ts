const blockers = new Map<symbol, string>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Register a draft, pending write, or restore transaction that must finish before an update activates. */
export function registerUpdateBlocker(reason: string): () => void {
  const key = Symbol(reason)
  blockers.set(key, reason)
  emit()
  return () => {
    if (blockers.delete(key)) emit()
  }
}

/** Restore uses this same hook around its complete replacement and repository refresh. */
export function beginCriticalOperation(reason: string): () => void {
  return registerUpdateBlocker(reason)
}

export function getUpdateBlockers(): string[] {
  return [...new Set(blockers.values())]
}

export function subscribeUpdateBlockers(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
