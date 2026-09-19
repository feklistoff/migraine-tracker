import { useEffect, useMemo, useState } from 'react'

import { Icon } from '../../components/Icon'
import { deleteEpisode, editEpisode, finishEpisode, startEpisode, undoEpisodeEnd } from '../../data/commands'
import { DiaryRepository, ValidationCommandError } from '../../data/repository'
import { compareInstants, dateTimeInputValue, elapsedMilliseconds, nowEventTime, resolveCivilDateTime } from '../../domain/time'
import type { DiaryFacts, Episode, Impact, Pain, Reading } from '../../domain/types'
import { formatEventDate, formatEventTime } from '../../app/locale'
import { AppShell } from '../../app/AppShell'
import { routeHref, type AppRoute } from '../../app/Router'

interface TodayPageProps {
  route: Extract<AppRoute, { kind: 'tab' }> & { tab: 'today' }
  facts: DiaryFacts
  repository: DiaryRepository
}

interface UndoState {
  episodeId: string
  revision: number
}

function errorMessage(error: unknown): string {
  if (error instanceof ValidationCommandError) return error.issues.map((issue) => issue.message).join(' ')
  if (error instanceof Error) return error.message
  return 'The diary could not be saved. Your details are still here; try again.'
}

function sortByInstant<T>(records: readonly T[], getTime: (record: T) => Episode['start']): T[] {
  return [...records].sort((one, two) => compareInstants(getTime(one), getTime(two)))
}

function latestReading(readings: readonly Reading[], predicate: (reading: Reading) => boolean): Reading | undefined {
  return sortByInstant(readings.filter(predicate), (reading) => reading.measuredAt).at(-1)
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return 'Length unknown'
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000))
  if (minutes < 1) return 'Less than a minute'
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours === 0) return `${minutes} min`
  if (remainder === 0) return `${hours} h`
  return `${hours} h ${remainder} min`
}

function painLabel(pain: Pain | null): string {
  if (!pain) return 'Not recorded'
  if (pain.kind === 'numeric') return `${pain.value} of 10`
  return pain.value === 'none' ? 'No pain' : pain.value[0].toUpperCase() + pain.value.slice(1)
}

function impactLabel(impact: Impact | null): string {
  if (!impact) return 'Not recorded'
  if (impact === 'normal') return 'Normal activities'
  if (impact === 'slowed') return 'Slowed down'
  return 'Had to stop'
}

function readingAge(reading: Reading | undefined, now: ReturnType<DiaryRepository['clock']['now']>): string {
  if (!reading) return ''
  return `${formatDuration(elapsedMilliseconds(reading.measuredAt, now))} ago`
}

function AppHeader({ title, ended }: { title: string; ended: boolean }) {
  return (
    <header className="app-header app-header--diary">
      <div>
        <p className="eyebrow">Private diary</p>
        <h1>{title}</h1>
      </div>
      {!ended ? (
        <a className="icon-button" href={routeHref({ kind: 'page', page: 'settings', tab: 'today' })} aria-label="Settings">
          <Icon name="settings" />
        </a>
      ) : null}
    </header>
  )
}

function LatestTile({ label, value, reading, now }: { label: string; value: string; reading?: Reading; now: ReturnType<DiaryRepository['clock']['now']> }) {
  return (
    <div className="latest-tile">
      <p>{label}</p>
      <strong>{value}</strong>
      {reading ? <small>{formatEventTime(reading.measuredAt)} · {readingAge(reading, now)}</small> : <small>No reading yet</small>}
    </div>
  )
}

interface EndEditorProps {
  episode: Episode
  repository: DiaryRepository
  facts: DiaryFacts
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
}

function EndEditor({ episode, repository, facts, onClose, onSaved, onError }: EndEditorProps) {
  const [endInput, setEndInput] = useState(dateTimeInputValue(episode.end ?? nowEventTime(repository.clock)))
  const [busy, setBusy] = useState(false)

  const saveEnd = async () => {
    if (busy) return
    setBusy(true)
    onError('')
    try {
      const [date, time] = endInput.split('T')
      const resolution = resolveCivilDateTime({
        date,
        time,
        timeZone: episode.end?.timeZone ?? episode.start.timeZone,
      })
      if (!resolution.ok) throw new Error(resolution.message)
      await editEpisode(
        repository,
        episode.id,
        { state: 'ended', end: resolution.time },
        { expectedRevision: facts.metadata.revision },
      )
      onSaved()
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const markUnknown = async () => {
    if (busy) return
    setBusy(true)
    onError('')
    try {
      await editEpisode(
        repository,
        episode.id,
        { state: 'end_unknown', end: null },
        { expectedRevision: facts.metadata.revision },
      )
      onSaved()
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="form-card end-editor" aria-labelledby="end-editor-heading">
      <p className="section-kicker">End time</p>
      <h2 id="end-editor-heading">When did it end?</h2>
      <label className="field-label" htmlFor="end-date-time">
        Date and time
        <input
          id="end-date-time"
          type="datetime-local"
          value={endInput}
          onChange={(event) => setEndInput(event.target.value)}
          max={dateTimeInputValue(nowEventTime(repository.clock))}
        />
      </label>
      <div className="inline-actions">
        <button className="primary-action" type="button" onClick={saveEnd} disabled={busy}>Save end time</button>
        <button className="secondary-action" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="text-action" type="button" onClick={markUnknown} disabled={busy}>I don’t know when it ended</button>
      </div>
    </section>
  )
}

export function TodayPage({ route, facts, repository }: TodayPageProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<UndoState | undefined>()
  const [editingEnd, setEditingEnd] = useState(false)
  const [, setClockTick] = useState(0)

  useEffect(() => {
    const refresh = () => setClockTick((tick) => tick + 1)
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  const ongoing = useMemo(() => facts.episodes.find((episode) => episode.state === 'ongoing'), [facts.episodes])
  const latestEnded = useMemo(
    () =>
      sortByInstant(
        facts.episodes.filter((episode) => episode.state !== 'ongoing'),
        (episode) => episode.end ?? episode.start,
      ).at(-1),
    [facts.episodes],
  )
  const now = repository.clock.now()
  const title = ongoing ? 'Headache diary' : latestEnded?.state === 'ended' ? 'Glad it’s over.' : 'Headache diary'

  const handleStart = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const episode = await startEpisode(
        repository,
        { start: nowEventTime(repository.clock), note: null },
        { expectedRevision: facts.metadata.revision },
      )
      window.location.hash = routeHref({ kind: 'entry', page: 'start', tab: 'today', episodeId: episode.id })
    } catch (startError) {
      setError(errorMessage(startError))
    } finally {
      setBusy(false)
    }
  }

  const handleEnd = async (episode: Episode) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const ended = await finishEpisode(repository, episode.id, nowEventTime(repository.clock), {
        expectedRevision: facts.metadata.revision,
      })
      setUndo({
        episodeId: ended.id,
        revision: repository.snapshot().facts?.metadata.revision ?? facts.metadata.revision + 1,
      })
    } catch (endError) {
      setError(errorMessage(endError))
    } finally {
      setBusy(false)
    }
  }

  const handleUndo = async () => {
    if (!undo || busy) return
    setBusy(true)
    setError(null)
    try {
      await undoEpisodeEnd(repository, undo.episodeId, { expectedRevision: undo.revision })
      setUndo(undefined)
    } catch (undoError) {
      setError(errorMessage(undoError))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (episode: Episode) => {
    if (busy || !window.confirm('Delete this headache and its saved details?')) return
    setBusy(true)
    setError(null)
    try {
      await deleteEpisode(repository, episode.id, { expectedRevision: facts.metadata.revision })
      setUndo(undefined)
    } catch (deleteError) {
      setError(errorMessage(deleteError))
    } finally {
      setBusy(false)
    }
  }

  const renderError = error ? <p className="form-error" role="alert">{error}</p> : null

  return (
    <AppShell route={route}>
      <AppHeader title={title} ended={Boolean(latestEnded && !ongoing)} />
      {renderError}

      {ongoing ? (
        <section className="headache-card headache-card--ongoing" aria-labelledby="ongoing-heading">
          <div className="card-heading-row">
            <span className="accent-pill">Headache ongoing</span>
            <a className="text-action" href={routeHref({ kind: 'entry', page: 'start', tab: 'today', episodeId: ongoing.id })}>Edit start</a>
          </div>
          <h2 id="ongoing-heading">Headache ongoing</h2>
          <p className="elapsed-heading">{formatDuration(elapsedMilliseconds(ongoing.start, now))}</p>
          <p className="card-caption">so far · started {formatEventDate(ongoing.start)} at {formatEventTime(ongoing.start)}</p>
          <div className="latest-grid">
            {(() => {
              const painReading = latestReading(facts.readings.filter((reading) => reading.episodeId === ongoing.id), (reading) => reading.pain !== null)
              const impactReading = latestReading(facts.readings.filter((reading) => reading.episodeId === ongoing.id), (reading) => reading.impact !== null)
              return (
                <>
                  <LatestTile label="Latest pain" value={painLabel(painReading?.pain ?? null)} reading={painReading} now={now} />
                  <LatestTile label="Latest activity" value={impactLabel(impactReading?.impact ?? null)} reading={impactReading} now={now} />
                </>
              )
            })()}
          </div>
          <section className="medicine-card" aria-labelledby="medicine-heading">
            <p className="section-kicker">Medicine</p>
            <h3 id="medicine-heading">No medicine recorded yet.</h3>
            <p>Any dose you log will stay with this headache.</p>
          </section>
          <div className="card-actions">
            <a className="secondary-action" href={routeHref({ kind: 'entry', page: 'start', tab: 'today', episodeId: ongoing.id })}>Add details</a>
            <button className="primary-action" type="button" onClick={() => void handleEnd(ongoing)} disabled={busy}>End headache now</button>
          </div>
          {elapsedMilliseconds(ongoing.start, now) >= 24 * 60 * 60 * 1000 ? (
            <div className="cue-card" role="note">
              <strong>Still recording this headache?</strong>
              <button className="text-action" type="button" onClick={() => setEditingEnd(true)}>Edit the end time</button>
            </div>
          ) : null}
          <button className="danger-action" type="button" onClick={() => void handleDelete(ongoing)} disabled={busy}>Delete this headache</button>
          {editingEnd ? (
            <EndEditor
              episode={ongoing}
              repository={repository}
              facts={facts}
              onClose={() => setEditingEnd(false)}
              onSaved={() => setEditingEnd(false)}
              onError={(message) => setError(message || null)}
            />
          ) : null}
        </section>
      ) : latestEnded?.state === 'ended' ? (
        <>
          <section className="headache-card headache-card--ended" aria-labelledby="ended-heading">
            <div className="card-heading-row">
              <span className="sage-pill">Ended</span>
              <a className="text-action" href={routeHref({ kind: 'entry', page: 'start', tab: 'today', episodeId: latestEnded.id })}>Edit details</a>
            </div>
            <h2 id="ended-heading">Headache ended</h2>
            <p className="elapsed-heading elapsed-heading--small">{formatDuration(elapsedMilliseconds(latestEnded.start, latestEnded.end ?? latestEnded.start))}</p>
            <p className="card-caption">{formatEventTime(latestEnded.start)} – {latestEnded.end ? formatEventTime(latestEnded.end) : 'unknown'}</p>
            <div className="card-actions card-actions--stacked">
              <button className="secondary-action" type="button" onClick={() => setEditingEnd(true)} disabled={busy}>Edit end time</button>
              <button className="danger-action" type="button" onClick={() => void handleDelete(latestEnded)} disabled={busy}>Delete this headache</button>
            </div>
            {editingEnd ? (
              <EndEditor
                episode={latestEnded}
                repository={repository}
                facts={facts}
                onClose={() => setEditingEnd(false)}
                onSaved={() => {
                  setEditingEnd(false)
                  setUndo(undefined)
                }}
                onError={(message) => setError(message || null)}
              />
            ) : null}
          </section>
          {undo ? (
            <aside className="undo-bar" aria-label="Undo ended headache">
              Headache ended at {latestEnded.end ? formatEventTime(latestEnded.end) : 'the recorded time'}
              <button type="button" onClick={() => void handleUndo()} disabled={busy}>Undo</button>
            </aside>
          ) : null}
        </>
      ) : latestEnded?.state === 'end_unknown' ? (
        <section className="headache-card headache-card--unknown" aria-labelledby="unknown-heading">
          <span className="accent-pill">End time not recorded</span>
          <h2 id="unknown-heading">This headache is saved without an end time.</h2>
          <p className="card-caption">It stays out of duration statistics until you add an end time.</p>
          <div className="card-actions">
            <button className="primary-action" type="button" onClick={() => setEditingEnd(true)} disabled={busy}>Add end time</button>
            <a className="secondary-action" href={routeHref({ kind: 'entry', page: 'start', tab: 'today', episodeId: latestEnded.id })}>Edit details</a>
          </div>
          {editingEnd ? (
            <EndEditor
              episode={latestEnded}
              repository={repository}
              facts={facts}
              onClose={() => setEditingEnd(false)}
              onSaved={() => setEditingEnd(false)}
              onError={(message) => setError(message || null)}
            />
          ) : null}
        </section>
      ) : (
        <section className="empty-card" aria-labelledby="empty-card-title">
          <p className="empty-card__mark" aria-hidden="true">·</p>
          <h2 id="empty-card-title">Nothing recorded yet.</h2>
          <p>Your diary stays on this iPhone. We’ll keep the details ready for the next step.</p>
          <div className="diary-actions" aria-label="Diary actions">
            <a className="primary-action" href="#start" onClick={(event) => { event.preventDefault(); void handleStart() }} aria-disabled={busy || undefined}>
              Start a headache
            </a>
            <a className="secondary-action" href={routeHref({ kind: 'entry', page: 'past', tab: 'today' })}>Log a past headache</a>
          </div>
        </section>
      )}
    </AppShell>
  )
}
