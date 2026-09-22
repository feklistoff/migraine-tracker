import { useEffect, useMemo, useState } from 'react'

import { ActivitySelector, PainSelector } from '../../components/controls'
import { deleteReading, saveReading } from '../../data/commands'
import { DiaryRepository, ValidationCommandError } from '../../data/repository'
import { compareInstants, dateTimeInputValue, elapsedMilliseconds, eventTimeFromInstant, nowEventTime, resolveCivilDateTime } from '../../domain/time'
import { latestDoseForEpisode } from '../../domain/followUps'
import type { DiaryFacts, Dose, Episode, Impact, Pain, Reading, RecordedTime } from '../../domain/types'
import { formatEventDate, formatEventTime } from '../../app/locale'
import { EntryShell } from '../../app/AppShell'
import { routeHref, type AppRoute } from '../../app/Router'
import { EventTimeField, useEventTimeInput } from './eventTimeInput'

type ReadingMode = 'update' | 'follow-up'

interface ReadingEditorProps {
  facts: DiaryFacts
  repository: DiaryRepository
  episode: Episode
  mode: ReadingMode
  dose?: Dose
  reading?: Reading
  initialMeasuredAt?: RecordedTime
  route: Extract<AppRoute, { kind: 'entry' }>
  inline?: boolean
  onSaved: (reading: Reading | null) => void
  onCancel?: () => void
  onDirtyChange?: (dirty: boolean) => void
}

function errorMessage(error: unknown): string {
  if (error instanceof ValidationCommandError) return error.issues.map((issue) => issue.message).join(' ')
  if (error instanceof Error) return error.message
  return 'The reading could not be saved. Your details are still here; try again.'
}

function normaliseNote(value: string): string | null {
  const note = value.trim()
  return note === '' ? null : note
}

function samePain(one: Pain | null, two: Pain | null): boolean {
  return one?.kind === two?.kind && one?.value === two?.value
}

function durationLabel(milliseconds: number): string {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000))
  if (minutes < 1) return 'Less than a minute'
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours === 0) return `${minutes} min`
  if (remainder === 0) return `${hours} h`
  return `${hours} h ${remainder} min`
}

function previewEventTime(
  initial: Reading['measuredAt'],
  value: string,
  timeZone: string,
  occurrence?: 'first' | 'second',
): Reading['measuredAt'] | undefined {
  if (value === dateTimeInputValue(initial)) return initial
  const [date, time] = value.split('T')
  const resolved = resolveCivilDateTime({ date: date ?? '', time: time ?? '', timeZone, ...(occurrence ? { occurrence } : {}) })
  return resolved.ok ? resolved.time : undefined
}

export function ReadingEditor({
  facts,
  repository,
  episode,
  mode,
  dose,
  reading,
  initialMeasuredAt: requestedMeasuredAt,
  route,
  inline = false,
  onSaved,
  onCancel,
  onDirtyChange,
}: ReadingEditorProps) {
  const [initial] = useState(() => ({
    measuredAt: reading?.measuredAt ?? requestedMeasuredAt ?? nowEventTime(repository.clock),
    painMode: reading?.pain?.kind ?? facts.settings.painEntryDefault,
    pain: reading?.pain ?? null,
    impact: reading?.impact ?? null,
    note: reading?.note ?? '',
  }))
  const [initialRevision] = useState(facts.metadata.revision)
  const initialMeasuredAt = initial.measuredAt
  const initialPainMode = initial.painMode
  const [painMode, setPainMode] = useState<'numeric' | 'verbal'>(initial.painMode)
  const [pain, setPain] = useState<Pain | null>(initial.pain)
  const [impact, setImpact] = useState<Impact | null>(initial.impact)
  const [note, setNote] = useState(initial.note)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eventTime = useEventTimeInput(initialMeasuredAt, initialMeasuredAt.timeZone)
  const initialNote = initial.note
  const dirty =
    eventTime.isDirty ||
    painMode !== initialPainMode ||
    !samePain(pain, initial.pain) ||
    impact !== initial.impact ||
    note !== initialNote
  const hasDetails = pain !== null || impact !== null || normaliseNote(note) !== null

  const changePainMode = (mode: 'numeric' | 'verbal') => {
    if (mode !== painMode && pain && pain.kind !== mode) setPain(null)
    setPainMode(mode)
  }

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

  const save = async () => {
    if (busy || !hasDetails || (mode === 'follow-up' && !dose)) return
    setBusy(true)
    setError(null)
    try {
      const measuredAt = eventTime.resolve()
      if (!measuredAt) return
      if (mode === 'follow-up' && dose && compareInstants(measuredAt, dose.takenAt) < 0) {
        setError('A follow-up cannot be before the dose was taken.')
        return
      }
      const saved = await saveReading(
        repository,
        {
          id: reading?.id,
          episodeId: episode.id,
          measuredAt,
          pain,
          impact,
          note: normaliseNote(note),
          linkedDoseId: mode === 'follow-up' ? dose?.id ?? null : null,
          atOnset: reading?.atOnset ?? false,
        },
        { expectedRevision: initialRevision },
      )
      onSaved(saved)
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!reading || busy) return
    const message = mode === 'follow-up'
      ? 'Delete this follow-up response? The dose will stay, and its check may become available again.'
      : 'Delete this pain and activity reading?'
    if (!window.confirm(message)) return
    setBusy(true)
    setError(null)
    try {
      await deleteReading(repository, reading.id, { expectedRevision: initialRevision })
      onSaved(null)
    } catch (deleteError) {
      setError(errorMessage(deleteError))
    } finally {
      setBusy(false)
    }
  }

  const preview = previewEventTime(initialMeasuredAt, eventTime.value, initialMeasuredAt.timeZone, eventTime.occurrence)
  const responseBeforeDose = mode === 'follow-up' && dose && preview && compareInstants(preview, dose.takenAt) < 0
  const responseDelay = mode === 'follow-up' && dose && preview && !responseBeforeDose
    ? elapsedMilliseconds(dose.takenAt, preview)
    : null
  const title = mode === 'follow-up' ? 'Follow-up check' : 'Update pain'
  const actionLabel = mode === 'follow-up' ? 'Save follow-up' : 'Save update'
  const onsetTimeLocked = Boolean(reading?.atOnset)
  const backHref = routeHref({ kind: 'tab', tab: route.tab, ...(route.selectedDay ? { selectedDay: route.selectedDay } : {}) })

  const fields = (
    <div className="form-stack">
      {mode === 'follow-up' && dose ? (
        <section className="form-card" aria-labelledby="follow-up-dose-heading">
          <p className="section-kicker">The dose this follows</p>
          <h2 id="follow-up-dose-heading">{dose.medicineName} · {dose.doseText}</h2>
          <p className="card-caption">Taken {formatEventDate(dose.takenAt)} at {formatEventTime(dose.takenAt)}.</p>
        </section>
      ) : null}

      <section className="form-card" aria-labelledby="reading-time-heading">
        <div className="form-card__heading">
          <div>
            <p className="section-kicker">Measurement time</p>
            <h2 id="reading-time-heading">When did you check?</h2>
          </div>
          {mode === 'follow-up' && responseDelay !== null ? <span className="saved-pill">{durationLabel(responseDelay)} after dose</span> : null}
        </div>
        <EventTimeField
          id="reading-date-time"
          label="Date and time"
          value={eventTime.value}
          onChange={eventTime.setValue}
          max={dateTimeInputValue(eventTimeFromInstant(repository.clock.now(), initialMeasuredAt.timeZone))}
          disabled={onsetTimeLocked}
          error={eventTime.error}
          occurrence={eventTime.occurrence}
          occurrenceOptions={eventTime.occurrenceOptions}
          onChooseOccurrence={eventTime.chooseOccurrence}
          hint={onsetTimeLocked
            ? 'This initial reading stays at the headache start. Edit the start time to move it.'
            : responseBeforeDose
              ? 'Choose a time at or after the dose.'
              : mode === 'follow-up' && responseDelay !== null
                ? `This time is ${durationLabel(responseDelay)} after the dose.`
                : undefined}
        />
      </section>

      <section className="form-card" aria-labelledby="pain-heading">
        <div className="form-card__heading form-card__heading--wrap">
          <div>
            <p className="section-kicker">Pain</p>
            <h2 id="pain-heading">How much does it hurt now?</h2>
          </div>
          <div className="segmented-control" role="group" aria-label="Pain entry mode">
            <button type="button" aria-pressed={painMode === 'numeric'} onClick={() => changePainMode('numeric')}>0–10</button>
            <button type="button" aria-pressed={painMode === 'verbal'} onClick={() => changePainMode('verbal')}>Words</button>
          </div>
        </div>
        <PainSelector mode={painMode} value={pain} onChange={setPain} />
      </section>

      <section className="form-card" aria-labelledby="activity-heading">
        <p className="section-kicker">Activity</p>
        <h2 id="activity-heading">How is it affecting you?</h2>
        <ActivitySelector value={impact} onChange={setImpact} />
      </section>

      <section className="form-card" aria-labelledby="reading-note-heading">
        <p className="section-kicker">Note</p>
        <label className="field-label" htmlFor="reading-note">
          <span id="reading-note-heading">Add a note (optional)</span>
          <textarea id="reading-note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
        </label>
      </section>

      {!hasDetails ? <p className="field-hint">Choose pain, activity or add a note to save this reading.</p> : null}
      {reading ? (
        <button className="danger-action" type="button" onClick={() => void remove()} disabled={busy}>
          Delete {mode === 'follow-up' ? 'follow-up response' : 'reading'}
        </button>
      ) : null}
    </div>
  )

  if (inline) {
    return (
      <section className="form-card reading-inline" aria-labelledby="reading-inline-heading">
        <p className="section-kicker">Update first</p>
        <h2 id="reading-inline-heading">Record the pain and activity before this dose.</h2>
        {fields}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="inline-actions">
          <button className="primary-action" type="button" onClick={() => void save()} disabled={busy || !hasDetails}>Save update</button>
          <button className="secondary-action" type="button" onClick={onCancel} disabled={busy}>Back to dose</button>
        </div>
      </section>
    )
  }

  return (
    <EntryShell
      title={title}
      backHref={backHref}
      actionLabel={actionLabel}
      footerNote={mode === 'follow-up' && dose ? `Saved with the ${formatEventTime(dose.takenAt)} dose.` : 'Saved with this headache.'}
      dirty={dirty}
      onAction={() => void save()}
      actionDisabled={!hasDetails || (mode === 'follow-up' && !dose)}
      actionBusy={busy}
      actionError={error}
    >
      {fields}
    </EntryShell>
  )
}

interface ReadingPageProps {
  facts: DiaryFacts
  repository: DiaryRepository
  route: Extract<AppRoute, { kind: 'entry' }> & { page: 'update' | 'follow-up' }
}

export function ReadingPage({ facts, repository, route }: ReadingPageProps) {
  const requestedReading = useMemo(
    () => (route.readingId ? facts.readings.find((candidate) => candidate.id === route.readingId) : undefined),
    [facts.readings, route.readingId],
  )
  const requestedDose = useMemo(
    () => (route.doseId ? facts.doses.find((candidate) => candidate.id === route.doseId) : undefined),
    [facts.doses, route.doseId],
  )
  const linkedDose = requestedReading?.linkedDoseId
    ? facts.doses.find((candidate) => candidate.id === requestedReading.linkedDoseId)
    : undefined
  const episodeId = requestedReading?.episodeId ?? requestedDose?.episodeId ?? route.episodeId
  const episode = facts.episodes.find((candidate) => candidate.id === episodeId)
  const mode: ReadingMode = requestedReading?.linkedDoseId || route.page === 'follow-up' ? 'follow-up' : 'update'
  const invalidReadingRoute = Boolean(route.readingId && !requestedReading)
  const invalidDoseRoute = Boolean(route.doseId && !requestedDose)
  const mismatchedReadingDose = Boolean(
    requestedReading?.linkedDoseId && route.doseId && requestedReading.linkedDoseId !== route.doseId,
  )
  const resolvedDose = linkedDose ?? requestedDose ?? (
    mode === 'follow-up' && !route.doseId && !requestedReading && episode
      ? latestDoseForEpisode(facts.doses, episode.id)
      : undefined
  )

  if (!episode || invalidReadingRoute || invalidDoseRoute || mismatchedReadingDose || (mode === 'follow-up' && (!resolvedDose || (!requestedReading && !resolvedDose.followUpEnabled)))) {
    return (
      <EntryShell
        title={mode === 'follow-up' ? 'Follow-up check' : 'Update pain'}
        backHref={routeHref({ kind: 'tab', tab: route.tab })}
        actionLabel={mode === 'follow-up' ? 'Save follow-up' : 'Save update'}
        footerNote="Open this form from a saved headache."
        actionDisabled
      >
        <section className="form-card" aria-label="Reading unavailable">
          <h2>This headache or dose could not be found.</h2>
          <p>Your existing diary records have not changed.</p>
        </section>
      </EntryShell>
    )
  }

  const returnToToday = () => {
    window.location.hash = routeHref({ kind: 'tab', tab: route.tab, ...(route.selectedDay ? { selectedDay: route.selectedDay } : {}) })
  }

  return (
    <ReadingEditor
      key={`${mode}:${episode.id}:${resolvedDose?.id ?? ''}:${requestedReading?.id ?? 'new'}`}
      facts={facts}
      repository={repository}
      episode={episode}
      mode={mode}
      dose={resolvedDose}
      reading={requestedReading}
      route={route}
      onSaved={returnToToday}
    />
  )
}
