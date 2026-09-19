import { useState, type ChangeEvent } from 'react'

import {
  clearSpikePersistenceCheck,
  readSpikePersistenceCheck,
  writeSpikePersistenceCheck,
} from './spikeStorage'

interface SyntheticBackup {
  createdAt: string
  format: 'headache-diary-platform-spike'
  sample: {
    id: 'synthetic-check'
    label: 'Synthetic data only'
  }
  version: 1
}

interface LocaleSnapshot {
  formattedNow: string
  locale: string
  timeZone: string
  weekStart: string
}

function localDateValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localTimeValue(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function createSyntheticBackup(): SyntheticBackup {
  return {
    createdAt: new Date().toISOString(),
    format: 'headache-diary-platform-spike',
    sample: {
      id: 'synthetic-check',
      label: 'Synthetic data only',
    },
    version: 1,
  }
}

function backupFileName(backup: SyntheticBackup): string {
  return `headache-diary-platform-${backup.createdAt.replaceAll(':', '').replaceAll('.', '')}.json`
}

function localeSnapshot(): LocaleSnapshot {
  const locale = navigator.language || 'en'
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'
  const formattedNow = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date())

  const localeWithWeekInfo = new Intl.Locale(locale) as Intl.Locale & {
    weekInfo?: { firstDay?: number }
  }
  const firstDay = localeWithWeekInfo.weekInfo?.firstDay
  const weekStart = firstDay === 1 ? 'Monday' : firstDay === 7 ? 'Sunday' : firstDay ? `Day ${firstDay}` : 'Not exposed'

  return { formattedNow, locale, timeZone, weekStart }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The platform check failed.'
}

export function PlatformSpikePage() {
  const now = new Date()
  const [persistenceStatus, setPersistenceStatus] = useState('Not checked yet.')
  const [shareStatus, setShareStatus] = useState('No file generated yet.')
  const [fileStatus, setFileStatus] = useState('Choose a JSON file to validate its filter and parser.')
  const [locale, setLocale] = useState<LocaleSnapshot | null>(null)
  const [nativeDate, setNativeDate] = useState(localDateValue(now))
  const [nativeTime, setNativeTime] = useState(localTimeValue(now))

  const writePersistence = async () => {
    setPersistenceStatus('Writing and committing a synthetic record…')
    try {
      const record = await writeSpikePersistenceCheck()
      setPersistenceStatus(`Committed ${record.marker} at ${record.writtenAt}. Quit and reopen, then read it back.`)
    } catch (error) {
      setPersistenceStatus(errorMessage(error))
    }
  }

  const readPersistence = async () => {
    setPersistenceStatus('Reading the synthetic record…')
    try {
      const record = await readSpikePersistenceCheck()
      setPersistenceStatus(
        record ? `Found the record written at ${record.writtenAt}.` : 'No record found in this browser context.',
      )
    } catch (error) {
      setPersistenceStatus(errorMessage(error))
    }
  }

  const clearPersistence = async () => {
    setPersistenceStatus('Clearing disposable spike data…')
    try {
      await clearSpikePersistenceCheck()
      setPersistenceStatus('Disposable spike data cleared.')
    } catch (error) {
      setPersistenceStatus(errorMessage(error))
    }
  }

  const generateBackup = async () => {
    const backup = createSyntheticBackup()
    const fileName = backupFileName(backup)
    const json = JSON.stringify(backup, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const file = typeof File === 'undefined' ? null : new File([blob], fileName, { type: 'application/json' })

    if (file && typeof navigator.share === 'function') {
      const canShare = typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] })
      if (canShare) {
        try {
          await navigator.share({
            files: [file],
            text: 'Synthetic platform-check data only.',
            title: 'Headache diary platform check',
          })
          setShareStatus(`Share completed for ${fileName}. This is not a diary backup.`)
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            setShareStatus('Share cancelled; nothing was recorded as saved.')
          } else {
            setShareStatus(errorMessage(error))
          }
        }
        return
      }
    }

    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = fileName
    link.click()
    URL.revokeObjectURL(link.href)
    setShareStatus(`Download fallback started for ${fileName}. Verify where the browser puts it.`)
  }

  const validateFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
      setFileStatus('Rejected: choose a .json file.')
      return
    }

    try {
      const parsed = JSON.parse(await file.text()) as Partial<SyntheticBackup>
      const valid = parsed.format === 'headache-diary-platform-spike' && parsed.version === 1
      setFileStatus(valid ? `Accepted ${file.name}: synthetic spike payload is valid.` : `Rejected ${file.name}: unsupported payload.`)
    } catch {
      setFileStatus(`Rejected ${file.name}: the file is not valid JSON.`)
    } finally {
      event.target.value = ''
    }
  }

  return (
    <div className="app-shell spike-page">
      <header className="app-header">
        <p className="eyebrow">Synthetic data only</p>
        <h1>iPhone platform check</h1>
        <p className="spike-intro">
          Temporary checks for Safari and the installed web app. Nothing here belongs to the real diary.
        </p>
        <a className="spike-back-link" href={import.meta.env.BASE_URL}>
          Return to the empty diary
        </a>
      </header>

      <main className="app-main">
        <section className="spike-card" aria-labelledby="persistence-title">
          <h2 id="persistence-title">IndexedDB persistence</h2>
          <p>Write, quit or background this app, reopen it, then read the disposable record.</p>
          <div className="spike-actions">
            <button className="spike-button" type="button" onClick={writePersistence}>
              Write test record
            </button>
            <button className="spike-button spike-button--secondary" type="button" onClick={readPersistence}>
              Read test record
            </button>
            <button className="spike-button spike-button--quiet" type="button" onClick={clearPersistence}>
              Clear spike data
            </button>
          </div>
          <p className="spike-status" role="status">{persistenceStatus}</p>
        </section>

        <section className="spike-card" aria-labelledby="backup-title">
          <h2 id="backup-title">JSON share and picker</h2>
          <p>Generate a synthetic JSON file, test Share or download fallback, then choose a JSON file again.</p>
          <div className="spike-actions">
            <button className="spike-button" type="button" onClick={generateBackup}>
              Share or download JSON
            </button>
            <label className="spike-file-label">
              Choose JSON file
              <input type="file" accept="application/json,.json" onChange={validateFile} />
            </label>
          </div>
          <p className="spike-status" role="status">{shareStatus}</p>
          <p className="spike-status" role="status">{fileStatus}</p>
        </section>

        <section className="spike-card" aria-labelledby="native-input-title">
          <h2 id="native-input-title">Native date and time controls</h2>
          <p>These controls deliberately use the platform picker instead of a custom calendar.</p>
          <div className="spike-input-grid">
            <label>
              Date
              <input type="date" value={nativeDate} onChange={(event) => setNativeDate(event.target.value)} />
            </label>
            <label>
              Time
              <input type="time" value={nativeTime} onChange={(event) => setNativeTime(event.target.value)} />
            </label>
          </div>
          <p className="spike-status" role="status">Selected {nativeDate} at {nativeTime}.</p>
        </section>

        <section className="spike-card" aria-labelledby="locale-title">
          <h2 id="locale-title">Locale and clock facts</h2>
          <p>Record what JavaScript can actually observe on this device; do not infer it from the model name.</p>
          <button className="spike-button" type="button" onClick={() => setLocale(localeSnapshot())}>
            Read locale and clock
          </button>
          {locale ? (
            <dl className="spike-facts">
              <div><dt>Locale</dt><dd>{locale.locale}</dd></div>
              <div><dt>Time zone</dt><dd>{locale.timeZone}</dd></div>
              <div><dt>Week starts</dt><dd>{locale.weekStart}</dd></div>
              <div><dt>Formatted now</dt><dd>{locale.formattedNow}</dd></div>
            </dl>
          ) : (
            <p className="spike-status" role="status">Not read yet.</p>
          )}
        </section>

        <aside className="spike-note">
          <strong>Device sequence</strong>
          <p>Open this page in Safari, add it to the Home Screen, and repeat the checks in both contexts. Keep the synthetic database separate from any future diary data.</p>
        </aside>
      </main>
    </div>
  )
}
