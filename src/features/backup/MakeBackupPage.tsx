import { useCallback, useEffect, useState } from 'react'

import { AppShell, PageHeader } from '../../app/AppShell'
import { appVersion } from '../../app/buildInfo'
import { routeHref, type AppRoute } from '../../app/Router'
import { createBackup, type GeneratedBackup } from '../../data/backup/export'
import type { DiaryRepository } from '../../data/repository'
import './backup.css'

type BackupRoute = Extract<AppRoute, { kind: 'page'; page: 'backup' }>

function dateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} bytes` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function MakeBackupPage({ route, repository }: { route: BackupRoute; repository: DiaryRepository }) {
  const [backup, setBackup] = useState<GeneratedBackup | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shareMessage, setShareMessage] = useState<string | null>(null)

  const makeFile = useCallback(async () => {
    setBusy(true)
    setError(null)
    setShareMessage(null)
    try {
      setBackup(await createBackup(repository, appVersion))
    } catch (cause) {
      setBackup(null)
      setError(cause instanceof Error ? cause.message : 'The file could not be made.')
    } finally {
      setBusy(false)
    }
  }, [repository])

  useEffect(() => { void makeFile() }, [makeFile])

  const downloadFile = () => {
    if (!backup || busy) return
    setError(null)
    setShareMessage(null)
    try {
      const url = URL.createObjectURL(backup.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = backup.fileName
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setShareMessage('Download started. The app can’t confirm where — or whether — the file was saved.')
    } catch {
      setError('The download could not start. Try a browser that supports file downloads.')
    }
  }

  const saveFile = async () => {
    if (!backup || busy) return
    if (shareSupported) {
      const file = new File([backup.blob], backup.fileName, { type: 'application/json' })
      setError(null)
      setShareMessage(null)
      try {
        await navigator.share({ files: [file], title: 'Headache diary backup' })
        setShareMessage('Sharing finished. The app can’t confirm where — or whether — the file was saved.')
      } catch (cause) {
        if (typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AbortError') {
          setShareMessage('Sharing was canceled. The file is still ready here.')
        } else {
          setError('The share sheet could not open. Use Download backup below.')
        }
      }
      return
    }
    downloadFile()
  }

  const shareSupported = typeof File !== 'undefined' && Boolean(typeof navigator.share === 'function' && navigator.canShare?.({ files: [new File([''], 'backup.json', { type: 'application/json' })] }))
  return (
    <AppShell route={route}>
      <PageHeader title="Make backup" backHref={routeHref({ kind: 'page', page: 'settings', tab: route.tab })} backLabel="Back to Settings" />
      <div className="backup-page">
        <p className="backup-intro">Your diary is stored only on this device. A backup file lets you restore it later, for example after reinstalling the app.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {backup ? (
          <section className="form-card backup-file-card" aria-label="Backup file">
            <span className="saved-pill">File ready</span>
            <h2>{backup.fileName}</h2>
            <p>{backup.envelope.facts.episodes.length} headaches, {backup.envelope.facts.dailyRecords.length} stored days, {backup.envelope.facts.medicines.length} saved medicines and settings · {size(backup.bytes)}</p>
            <button className="primary-action" type="button" onClick={() => void saveFile()} disabled={busy}>{shareSupported ? 'Save to Files' : 'Download backup'}</button>
            {shareSupported ? <button className="secondary-action" type="button" onClick={downloadFile} disabled={busy}>Download backup</button> : null}
            {shareSupported ? <ol className="backup-steps"><li>Tap Save to Files.</li><li>Choose a location, such as On My iPhone.</li><li>Tap Save.</li></ol> : null}
          </section>
        ) : busy ? <section className="form-card" aria-live="polite">Making your backup file…</section> : null}
        <section className="backup-note">Keep a copy off this device too. This JSON file contains plain-text health data; choose a place you trust.</section>
        {backup ? <p className="backup-status">File made {dateTime(backup.envelope.createdAt)}. The app can’t confirm where — or whether — it was saved.</p> : null}
        {shareMessage ? <p role="status" className="backup-status">{shareMessage}</p> : null}
        <button className="secondary-action backup-wide" type="button" onClick={() => void makeFile()} disabled={busy}>Make a new file</button>
      </div>
    </AppShell>
  )
}
