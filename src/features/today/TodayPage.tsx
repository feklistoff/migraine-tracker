import { useEffect, useMemo, useState } from 'react'

import { Icon } from '../../components/Icon'
import { deleteDose, deleteEpisode, editEpisode, finishEpisode, saveDailyRecord, startEpisode, undoEpisodeEnd } from '../../data/commands'
import { DiaryRepository, ValidationCommandError } from '../../data/repository'
import { classifyDay, dailyRecordForDay, dayBeforeSummary } from '../../domain/calendar'
import { civilDay, compareInstants, dateTimeInputValue, elapsedMilliseconds, eventTimeFromInstant, nowEventTime } from '../../domain/time'
import { latestDoseForEpisode, todayFollowUps, type DoseFollowUp } from '../../domain/followUps'
import type { DiaryFacts, Dose, Episode, Impact, Pain, Reading, RecordedTime } from '../../domain/types'
import { formatEventDate, formatEventTime } from '../../app/locale'
import { AppShell } from '../../app/AppShell'
import { routeHref, type AppRoute } from '../../app/Router'
import { EventTimeField, useEventTimeInput } from '../episodes/eventTimeInput'
import { TodayMonthSummary } from '../statistics/StatisticsPage'
import { useUpdateBlocker } from '../../pwa/useUpdateBlocker'

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

function readingRouteHref(episode: Episode, reading: Reading, tab: 'today' | 'history' | 'statistics' = 'today'): string {
  const page = reading.linkedDoseId ? 'follow-up' : 'update'
  return routeHref({
    kind: 'entry',
    page,
    tab,
    episodeId: episode.id,
    readingId: reading.id,
    ...(reading.linkedDoseId ? { doseId: reading.linkedDoseId } : {}),
  })
}

function LatestTile({
  label,
  value,
  reading,
  now,
  editHref,
}: {
  label: string
  value: string
  reading?: Reading
  now: ReturnType<DiaryRepository['clock']['now']>
  editHref?: string
}) {
  return (
    <div className="latest-tile">
      <p>{label}</p>
      <strong>{value}</strong>
      {reading ? <small>{formatEventTime(reading.measuredAt)} · {readingAge(reading, now)}</small> : <small>No reading yet</small>}
      {editHref ? <a className="text-action latest-tile__edit" href={editHref}>Edit reading</a> : null}
    </div>
  )
}

function FollowUpCard({ check, now, tab }: { check: DoseFollowUp; now: RecordedTime; tab: 'today' | 'history' | 'statistics' }) {
  if (!check.dueAt || (check.status !== 'pending' && check.status !== 'overdue')) return null
  const delay = check.status === 'pending'
    ? elapsedMilliseconds(now, check.dueAt)
    : elapsedMilliseconds(check.dueAt, now)
  const duration = formatDuration(delay)
  const timing = check.status === 'pending' ? `Due in ${duration}` : `Overdue by ${duration}`
  return (
    <section className={`follow-up-card follow-up-card--${check.status}`} aria-label={`${check.status} follow-up`}>
      <div>
        <p className="section-kicker">{check.status === 'pending' ? 'Follow-up due' : 'Follow-up overdue'}</p>
        <h3>After this dose · {check.dose.medicineName} · {check.dose.doseText}</h3>
        <p>{formatEventDate(check.dueAt)} at {formatEventTime(check.dueAt)} · {timing}</p>
        <small>Shown here only. The app won’t send an alert.</small>
      </div>
      <a
        className="secondary-action"
        href={routeHref({ kind: 'entry', page: 'follow-up', tab, episodeId: check.dose.episodeId, doseId: check.dose.id })}
      >
        Record now
      </a>
    </section>
  )
}

function hasDayBeforeAnswers(record: DiaryFacts['dailyRecords'][number] | undefined): boolean {
  return Boolean(record && (record.alcohol !== null || record.sleep !== null || record.stress !== null))
}

function DailyStatusCard({
  facts,
  day,
  now,
  checkinHref,
  busy,
  onConfirm,
  onUndo,
}: {
  facts: DiaryFacts
  day: string
  now: RecordedTime
  checkinHref: string
  busy: boolean
  onConfirm: () => void
  onUndo: () => void
}) {
  const record = dailyRecordForDay(facts, day)
  const status = classifyDay(facts, day, now)
  const dayBeforeLabel = dayBeforeSummary(record)
  const notesPresent = hasDayBeforeAnswers(record)

  return (
    <section className="daily-status-card" aria-label="Today's status">
      {status === 'unknown' ? (
        <>
          <p className="daily-status-card__title">Nothing recorded yet today.</p>
          <button className="sage-action" type="button" onClick={onConfirm} disabled={busy}>
            <span aria-hidden="true">✓</span>
            No headache so far
          </button>
          <p className="daily-status-card__hint">If one starts later, it will replace this.</p>
        </>
      ) : status === 'headache-free' ? (
        <div className="daily-status-card__confirmed">
          <span className="daily-status-card__check" aria-hidden="true">✓</span>
          <div>
            <strong>No headache so far today</strong>
            <small>Noted at {record?.headacheFreeAt ? formatEventTime(record.headacheFreeAt) : 'an earlier time'}</small>
          </div>
          <button className="text-action" type="button" onClick={onUndo} disabled={busy}>Undo</button>
        </div>
      ) : (
        <div className="daily-status-card__evidence">
          <strong>Headache recorded today</strong>
          <small>A headache entry keeps this day recorded.</small>
        </div>
      )}

      <div className="daily-status-card__divider" />
      <a className="day-before-link" href={checkinHref}>
        <span>
          <strong>Yesterday &amp; last night</strong>
          <small>{dayBeforeLabel}</small>
        </span>
        <span className="day-before-link__pill">{notesPresent ? 'Edit' : 'Add'}</span>
      </a>
    </section>
  )
}

function MedicineSection({
  episode,
  facts,
  repository,
  busy,
  onDeleteDose,
  followUp,
}: {
  episode: Episode
  facts: DiaryFacts
  repository: DiaryRepository
  busy: boolean
  onDeleteDose: (dose: Dose) => void
  followUp?: DoseFollowUp
}) {
  const dose = latestDoseForEpisode(facts.doses, episode.id)
  return (
    <section className="medicine-card" aria-labelledby={`medicine-heading-${episode.id}`}>
      <p className="section-kicker">Medicine</p>
      {dose ? (
        <>
          <h3 id={`medicine-heading-${episode.id}`}>{dose.medicineName} · {dose.doseText}</h3>
          <p>Taken at {formatEventTime(dose.takenAt)}.</p>
          <div className="medicine-card__actions">
            <a className="text-action" href={routeHref({ kind: 'entry', page: 'dose', tab: 'today', episodeId: episode.id, doseId: dose.id })}>Edit dose</a>
            <button className="text-action" type="button" disabled={busy} onClick={() => onDeleteDose(dose)}>Delete dose</button>
          </div>
        </>
      ) : (
        <>
          <h3 id={`medicine-heading-${episode.id}`}>No medicine recorded yet.</h3>
          <p>Any dose you log will stay with this headache.</p>
        </>
      )}
      <a className="text-action medicine-card__timeline-link" href={routeHref({ kind: 'page', page: 'timeline', tab: 'today', episodeId: episode.id })}>View headache timeline</a>
      {followUp ? <FollowUpCard check={followUp} now={nowEventTime(repository.clock)} tab="today" /> : null}
    </section>
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
  useUpdateBlocker(true, 'An end-time form is open')
  const endTimeZone = episode.end?.timeZone ?? episode.start.timeZone
  const initialEnd = episode.end ?? eventTimeFromInstant(repository.clock.now(), endTimeZone)
  const endTime = useEventTimeInput(initialEnd, endTimeZone)
  const [busy, setBusy] = useState(false)

  const saveEnd = async () => {
    if (busy) return
    setBusy(true)
    onError('')
    try {
      const resolvedEnd = endTime.resolve()
      if (!resolvedEnd) return
      await editEpisode(
        repository,
        episode.id,
        { state: 'ended', end: resolvedEnd },
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
      <EventTimeField
        id="end-date-time"
        label="Date and time"
        value={endTime.value}
        onChange={endTime.setValue}
        max={dateTimeInputValue(eventTimeFromInstant(repository.clock.now(), endTimeZone))}
        error={endTime.error}
        occurrence={endTime.occurrence}
        occurrenceOptions={endTime.occurrenceOptions}
        onChooseOccurrence={endTime.chooseOccurrence}
      />
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
  const [dismissedCueEpisodeId, setDismissedCueEpisodeId] = useState<string | undefined>()
  const [, setClockTick] = useState(0)

  useEffect(() => {
    const refresh = () => setClockTick((tick) => tick + 1)
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
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
  const nowRecorded = nowEventTime(repository.clock)
  const todayDay = civilDay(nowRecorded)
  const todayRecord = dailyRecordForDay(facts, todayDay)
  const visibleFollowUps = useMemo(() => todayFollowUps(facts, nowRecorded), [facts, nowRecorded])
  const primaryEpisode = ongoing ?? latestEnded
  const otherFollowUps = visibleFollowUps.filter((check) => check.dose.episodeId !== primaryEpisode?.id)
  const recentEpisodes = sortByInstant(
    facts.episodes.filter((episode) => episode.id !== primaryEpisode?.id),
    (episode) => episode.end ?? episode.start,
  ).reverse().slice(0, 3)
  const pastEntryHref = routeHref({
    kind: 'entry',
    page: 'past',
    tab: 'today',
    ...(route.selectedDay ? { selectedDay: route.selectedDay } : {}),
  })
  const title = ongoing ? 'Headache diary' : latestEnded?.state === 'ended' ? 'Glad it’s over.' : 'Headache diary'

  const handleDailyConfirmation = async (headacheFreeAt: RecordedTime | null) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await saveDailyRecord(
        repository,
        {
          day: todayDay,
          headacheFreeAt,
          alcohol: todayRecord?.alcohol ?? null,
          sleep: todayRecord?.sleep ?? null,
          stress: todayRecord?.stress ?? null,
        },
        { expectedRevision: facts.metadata.revision },
      )
    } catch (confirmationError) {
      setError(errorMessage(confirmationError))
    } finally {
      setBusy(false)
    }
  }

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

  const handleDeleteDose = async (dose: Dose) => {
    if (busy) return
    const linkedCount = facts.readings.filter((reading) => reading.linkedDoseId === dose.id).length
    const responseText = linkedCount > 0
      ? ` Its ${linkedCount === 1 ? 'follow-up response' : `${linkedCount} follow-up responses`} will stay as ordinary readings.`
      : ''
    if (!window.confirm(`Delete this dose and its pending check?${responseText}`)) return
    setBusy(true)
    setError(null)
    try {
      await deleteDose(repository, dose.id, { expectedRevision: facts.metadata.revision })
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
                  <LatestTile
                    label="Latest pain"
                    value={painLabel(painReading?.pain ?? null)}
                    reading={painReading}
                    now={now}
                    editHref={painReading && !painReading.atOnset ? readingRouteHref(ongoing, painReading) : undefined}
                  />
                  <LatestTile
                    label="Latest activity"
                    value={impactLabel(impactReading?.impact ?? null)}
                    reading={impactReading}
                    now={now}
                    editHref={impactReading && !impactReading.atOnset ? readingRouteHref(ongoing, impactReading) : undefined}
                  />
                </>
              )
            })()}
          </div>
          <MedicineSection
            episode={ongoing}
            facts={facts}
            repository={repository}
            busy={busy}
            onDeleteDose={handleDeleteDose}
            followUp={visibleFollowUps.find((check) => check.dose.episodeId === ongoing.id)}
          />
          <div className="card-actions card-actions--two">
            <a className="secondary-action" href={routeHref({ kind: 'entry', page: 'update', tab: 'today', episodeId: ongoing.id })}>Update pain</a>
            <a className="primary-action" href={routeHref({ kind: 'entry', page: 'dose', tab: 'today', episodeId: ongoing.id })}>Log dose</a>
          </div>
          <div className="card-actions card-actions--full">
            <button className="secondary-action" type="button" onClick={() => void handleEnd(ongoing)} disabled={busy}>End headache now</button>
          </div>
          <a className="text-action" href={pastEntryHref}>Log a past headache</a>
          {elapsedMilliseconds(ongoing.start, now) >= 24 * 60 * 60 * 1000 && dismissedCueEpisodeId !== ongoing.id ? (
            <div className="cue-card" role="note">
              <strong>Still recording this headache?</strong>
              <button className="text-action" type="button" onClick={() => setEditingEnd(true)}>Edit the end time</button>
              <button className="text-action" type="button" onClick={() => setDismissedCueEpisodeId(ongoing.id)}>Dismiss</button>
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
              <a className="text-action" href={routeHref({ kind: 'entry', page: 'past', tab: 'today', episodeId: latestEnded.id })}>Edit details</a>
            </div>
            <h2 id="ended-heading">Headache ended</h2>
            <p className="elapsed-heading elapsed-heading--small">{formatDuration(elapsedMilliseconds(latestEnded.start, latestEnded.end ?? latestEnded.start))}</p>
            <p className="card-caption">{formatEventTime(latestEnded.start)} – {latestEnded.end ? formatEventTime(latestEnded.end) : 'unknown'}</p>
            <MedicineSection
              episode={latestEnded}
              facts={facts}
              repository={repository}
              busy={busy}
              onDeleteDose={handleDeleteDose}
              followUp={visibleFollowUps.find((check) => check.dose.episodeId === latestEnded.id)}
            />
            <div className="card-actions card-actions--stacked">
              <a className="secondary-action" href={routeHref({ kind: 'entry', page: 'update', tab: 'today', episodeId: latestEnded.id })}>How I feel now</a>
              <button className="secondary-action" type="button" onClick={() => setEditingEnd(true)} disabled={busy}>Edit end time</button>
              <a className="secondary-action" href={pastEntryHref}>Log another past headache</a>
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
          <MedicineSection
            episode={latestEnded}
            facts={facts}
            repository={repository}
            busy={busy}
            onDeleteDose={handleDeleteDose}
            followUp={visibleFollowUps.find((check) => check.dose.episodeId === latestEnded.id)}
          />
          <div className="card-actions">
            <button className="primary-action" type="button" onClick={() => setEditingEnd(true)} disabled={busy}>Add end time</button>
            <a className="secondary-action" href={routeHref({ kind: 'entry', page: 'update', tab: 'today', episodeId: latestEnded.id })}>How I feel now</a>
            <a className="secondary-action" href={routeHref({ kind: 'entry', page: 'past', tab: 'today', episodeId: latestEnded.id })}>Edit details</a>
            <a className="secondary-action" href={pastEntryHref}>Log another past headache</a>
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
      {!ongoing ? (
        <DailyStatusCard
          facts={facts}
          day={todayDay}
          now={nowRecorded}
          checkinHref={routeHref({ kind: 'entry', page: 'checkin', tab: 'today' })}
          busy={busy}
          onConfirm={() => void handleDailyConfirmation(nowRecorded)}
          onUndo={() => void handleDailyConfirmation(null)}
        />
      ) : null}
      {otherFollowUps.map((check) => <FollowUpCard key={check.dose.id} check={check} now={nowRecorded} tab="today" />)}
      <TodayMonthSummary facts={facts} now={nowRecorded} />
      {recentEpisodes.length > 0 ? (
        <section className="recent-episodes" aria-labelledby="recent-episodes-heading">
          <div>
            <p className="section-kicker">Recent records</p>
            <h2 id="recent-episodes-heading">Earlier headaches</h2>
          </div>
          {recentEpisodes.map((episode) => (
            <a
              key={episode.id}
              className="recent-episode-link"
              href={routeHref({ kind: 'page', page: 'timeline', tab: 'today', episodeId: episode.id })}
            >
              <span><strong>{formatEventDate(episode.start)}</strong><small>{episode.state === 'ended' ? 'Ended' : 'End time not recorded'}</small></span>
              <span aria-hidden="true">›</span>
            </a>
          ))}
        </section>
      ) : null}
    </AppShell>
  )
}
