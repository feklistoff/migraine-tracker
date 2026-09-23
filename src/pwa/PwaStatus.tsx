import { useEffect, useRef, useState } from 'react'

import { getUpdateBlockers, subscribeUpdateBlockers } from './updateSafety'

function standalone(): boolean {
  return (window.matchMedia?.('(display-mode: standalone)').matches ?? false) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
}

async function requestStoragePersistence(): Promise<void> {
  try {
    if (!navigator.storage?.persist || localStorage.getItem('headache-diary:persistence-requested') === '1') return
    localStorage.setItem('headache-diary:persistence-requested', '1')
    await navigator.storage.persist()
  } catch {
    // Backups remain the recovery path when persistence is unavailable.
  }
}

function askWaitingWorker(worker: ServiceWorker): Promise<{ applied: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = window.setTimeout(() => resolve({ applied: false, reason: 'The update did not respond. Try again.' }), 5000)
    channel.port1.onmessage = (event: MessageEvent<{ applied: boolean; reason?: string }>) => {
      window.clearTimeout(timer)
      resolve(event.data)
    }
    worker.postMessage({ type: 'APPLY_UPDATE' }, [channel.port2])
  })
}

export function PwaStatus() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)
  const [blockers, setBlockers] = useState(getUpdateBlockers)
  const [applying, setApplying] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [reloadAfterActivation, setReloadAfterActivation] = useState(false)
  const reloadAfterActivationRequested = useRef(false)

  useEffect(() => subscribeUpdateBlockers(() => setBlockers(getUpdateBlockers())), [])

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    let cancelled = false
    let current: ServiceWorkerRegistration | undefined
    const scope = import.meta.env.BASE_URL
    const onWaiting = () => {
      if (!cancelled && current?.waiting) setWaiting(current.waiting)
    }
    const onUpdateFound = () => {
      const installing = current?.installing
      installing?.addEventListener('statechange', onWaiting)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void current?.update().catch(() => undefined)
    }
    const onPageHide = () => {
      navigator.serviceWorker.controller?.postMessage({ type: 'CLIENT_CLOSING' })
    }
    const onCanActivate = (event: MessageEvent) => {
      if (event.data?.type === 'CAN_ACTIVATE_UPDATE') {
        const canActivate = getUpdateBlockers().length === 0
        if (canActivate) reloadAfterActivationRequested.current = true
        event.ports[0]?.postMessage({ canActivate })
      }
    }
    const onUpdateAborted = (event: MessageEvent) => {
      if (event.data?.type === 'UPDATE_ABORTED') reloadAfterActivationRequested.current = false
    }
    const onControllerChange = () => {
      setWaiting(null)
      if (reloadAfterActivationRequested.current) setReloadAfterActivation(true)
    }
    navigator.serviceWorker.addEventListener('message', onCanActivate)
    navigator.serviceWorker.addEventListener('message', onUpdateAborted)
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    void navigator.serviceWorker.register(`${scope}sw.js`, { scope, updateViaCache: 'none' })
      .then((next) => {
        if (cancelled) return
        current = next
        setRegistration(next)
        next.addEventListener('updatefound', onUpdateFound)
        onWaiting()
        void next.update().catch(() => undefined)
      })
      .catch(() => undefined)
    void requestStoragePersistence()
    return () => {
      cancelled = true
      current?.removeEventListener('updatefound', onUpdateFound)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      navigator.serviceWorker.removeEventListener('message', onCanActivate)
      navigator.serviceWorker.removeEventListener('message', onUpdateAborted)
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  useEffect(() => {
    if (reloadAfterActivation && blockers.length === 0) window.location.reload()
  }, [reloadAfterActivation, blockers.length])

  const apply = async () => {
    if (!waiting || blockers.length || applying) return
    setApplying(true)
    setMessage(null)
    const result = await askWaitingWorker(waiting)
    if (!result.applied) {
      reloadAfterActivationRequested.current = false
      setApplying(false)
      setMessage(result.reason ?? 'The update is still waiting. Try again after finishing your work.')
    }
  }

  if (!waiting) return null
  return (
    <aside className="pwa-update" role="status" aria-label="App update available">
      <strong>App update ready</strong>
      <p>{blockers.length ? 'Finish or discard the open form and wait for saves to finish.' : 'Your diary stays on this device.'}</p>
      {message ? <p className="pwa-update__error">{message}</p> : null}
      <button type="button" onClick={() => void apply()} disabled={blockers.length > 0 || applying || !registration}>
        {applying ? 'Updating…' : 'Update now'}
      </button>
    </aside>
  )
}

export function InstallationGuidance() {
  if (standalone()) return null
  return (
    <section className="settings-section" aria-labelledby="install-guidance-title">
      <h2 id="install-guidance-title">Install on this iPhone</h2>
      <p className="field-hint settings-caption">
        Open this page in Safari, tap Share, then Add to Home Screen before recording. Safari and the installed app may keep separate diaries.
        If you have already recorded in Safari, make a backup from Settings there before switching to the installed app.
      </p>
    </section>
  )
}
