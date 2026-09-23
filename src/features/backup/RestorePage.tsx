import { useRef, useState, type ChangeEvent } from 'react'

import { AppShell, PageHeader } from '../../app/AppShell'
import { routeHref, type AppRoute } from '../../app/Router'
import { MAX_BACKUP_BYTES } from '../../data/backup/validate'
import { prepareRestore, restoreBackup, type RestorePreview } from '../../data/backup/restore'
import { StaleRevisionError, type DiaryRepository } from '../../data/repository'
import { beginCriticalOperation } from '../../pwa/updateSafety'
import './backup.css'

type RestoreRoute = Extract<AppRoute, { kind: 'page'; page: 'restore' }>

function dateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function RestorePage({ route, repository }: { route: RestoreRoute; repository: DiaryRepository }) {
  const input = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setPreview(null)
    setFileName(file.name)
    setError(null)
    setRestored(false)
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('The backup exceeds 20 MiB. Contact support before attempting a larger restore.')
      setPreview(await prepareRestore(repository, await file.text()))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The file could not be read.')
    } finally {
      setBusy(false)
    }
  }

  const replace = async () => {
    if (!preview || busy) return
    if (!window.confirm('Replace every record and setting on this device with this backup? This cannot be undone.')) return
    setBusy(true)
    setError(null)
    try {
      await restoreBackup(repository, preview, {
        beginCriticalOperation: () => beginCriticalOperation('Replacing diary from backup'),
      })
      setPreview(null)
      setRestored(true)
    } catch (cause) {
      if (cause instanceof StaleRevisionError) {
        setPreview(null)
        setError('The diary changed since this preview. Choose the file again to review the current data.')
      } else {
        setError(cause instanceof Error ? cause.message : 'The diary could not be replaced. The existing data remains available.')
      }
    } finally {
      setBusy(false)
    }
  }

  const changeList = preview ? [...preview.difference.records.removed, ...preview.difference.records.changed] : []
  return (
    <AppShell route={route}>
      <PageHeader title="Restore" backHref={routeHref({ kind: 'page', page: 'settings', tab: route.tab })} backLabel="Back to Settings" />
      <div className="backup-page">
        <p className="backup-intro">Choose a headache diary JSON backup. We’ll check the complete file and show what would change before replacing anything.</p>
        <input ref={input} className="backup-file-input" aria-label="Choose backup file" type="file" accept=".json,application/json" onChange={(event) => void chooseFile(event)} disabled={busy} />
        {!fileName ? <button className="primary-action backup-wide" type="button" onClick={() => input.current?.click()} disabled={busy}>Choose file</button> : null}
        {busy ? <p role="status">Checking your backup…</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {restored ? <section className="form-card" role="status"><h2>Diary restored</h2><p>The backup replaced the local diary. All views now use the restored records.</p><a className="primary-action backup-link" href="#today">Return to Today</a></section> : null}
        {fileName && !restored ? (
          <section className="form-card backup-file-card">
            <h2>{fileName}</h2>
            {preview ? <><p>Made {dateTime(preview.envelope.createdAt)}</p><span className="saved-pill">Complete diary backup</span></> : null}
            <button className="text-action" type="button" onClick={() => input.current?.click()} disabled={busy}>Choose another</button>
          </section>
        ) : null}
        {preview ? <>
          <div className="backup-comparison">
            <section className="form-card"><h2>In the backup</h2><p>{preview.backupCounts.headaches} headaches</p><p>{preview.backupCounts.days} days</p><p>{preview.backupCounts.medicines} medicines</p><p>Settings included</p></section>
            <section className="form-card"><h2>On this device now</h2><p>{preview.currentCounts.headaches} headaches</p><p>{preview.currentCounts.days} days</p><p>{preview.currentCounts.medicines} medicines</p><p>Current settings</p></section>
          </div>
          <p className="field-hint">Days count stored daily records, not elapsed calendar days.</p>
          <section className="backup-note" aria-label="Replacement changes">
            <strong>Restoring replaces everything on this device.</strong>
            {preview.difference.identical ? <p>The diary records and settings match this backup.</p> : <>
              <p>{preview.difference.records.removed.length} records would be removed, {preview.difference.records.changed.length} changed records would be replaced, and {preview.difference.records.added.length} records would be added. {preview.difference.settingsChanged ? 'Settings would change.' : 'Settings match.'}</p>
              {changeList.length > 0 ? <ul>{changeList.slice(0, 8).map((record) => <li key={`${record.collection}-${record.id}`}>{record.label}</li>)}</ul> : null}
              {changeList.length > 8 ? <p>And {changeList.length - 8} more removed or changed records.</p> : null}
            </>}
          </section>
          <a className="secondary-action backup-link" href={routeHref({ kind: 'page', page: 'backup', tab: route.tab })}>Back up this device first</a>
          <button className="primary-action backup-wide" type="button" onClick={() => void replace()} disabled={busy}>Replace with this backup</button>
          <p className="field-hint">You’ll be asked to confirm before anything changes.</p>
        </> : null}
      </div>
    </AppShell>
  )
}
