const RESTORE_SIGNAL_KEY = 'headache-diary:restore-committed'

/** Tell other same-origin app tabs that their in-memory diary was replaced. */
export function notifyOtherTabsOfRestore(): void {
  try {
    // Storage events are delivered to other documents, not to the writer.
    // The value is only an invalidation token; diary data stays in IndexedDB.
    window.localStorage.setItem(RESTORE_SIGNAL_KEY, `${Date.now()}-${Math.random()}`)
  } catch {
    // A blocked localStorage must not turn a committed restore into a failure.
  }
}

export function subscribeToOtherTabRestores(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === RESTORE_SIGNAL_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
