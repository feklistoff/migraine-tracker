import { useMemo, useRef, useState } from 'react'

import { ActivitySelector, PainSelector } from '../../components/controls'
import {
  editEpisodeWithOnsetReading,
  saveRetrospectiveEpisode,
  type RetrospectiveDoseInput,
} from '../../data/commands'
import { DiaryRepository, ValidationCommandError } from '../../data/repository'
import {
  compareInstants,
  dateTimeInputValue,
  elapsedMilliseconds,
  eventTimeFromInstant,
  nowEventTime,
  resolveCivilDateTime,
  type CivilTimeOccurrence,
} from '../../domain/time'
import type { DiaryFacts, Dose, Episode, Impact, Pain, RecordedTime, SavedMedicine } from '../../domain/types'
import { EntryShell } from '../../app/AppShell'
import { formatCivilDay } from '../../app/locale'
import { routeHref, type AppRoute } from '../../app/Router'
import { isValidCivilDay } from '../../domain/calendar'
import { EventTimeField, useEventTimeInput } from './eventTimeInput'

const CUSTOM_MEDICINE = 'custom'
const FOLLOW_UP_INTERVALS = [30, 60, 90, 120] as const

interface PastHeadachePageProps {
  facts: DiaryFacts
  repository: DiaryRepository
  route: Extract<AppRoute, { kind: 'entry' }> & { page: 'past' }
}

interface OccurrenceOption {
  occurrence: CivilTimeOccurrence
  offset: string
}

interface DoseDraft {
  id: number
  selection: string
  medicineName: string
  doseText: string
  takenAt: string
  occurrence?: CivilTimeOccurrence
  occurrenceOptions: OccurrenceOption[]
  medicineError?: string
  doseError?: string
  timeError?: string
  followUpEnabled: boolean
  followUpIntervalMinutes: Dose['followUpIntervalMinutes']
  saveToMedicineList: boolean
}

function errorMessage(error: unknown): string {
  if (error instanceof ValidationCommandError) {
    return error.issues.map((issue) => {
      const doseIndex = /^doses\[(\d+)\]/.exec(issue.path)?.[1]
      return `${doseIndex === undefined ? '' : `Dose ${Number(doseIndex) + 1}: `}${issue.message}`
    }).join(' ')
  }
  if (error instanceof Error) return error.message
  return 'The headache could not be saved. Your details are still here; try again.'
}

function normaliseNote(value: string): string | null {
  const note = value.trim()
  return note === '' ? null : note
}

function samePain(one: Pain | null, two: Pain | null): boolean {
  return one?.kind === two?.kind && one?.value === two?.value
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000))
  if (minutes < 1) return 'Less than a minute'
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours === 0) return `${minutes} min`
  if (remainder === 0) return `${hours} h`
  return `${hours} h ${remainder} min`
}

function previewEventTime(
  initial: RecordedTime | null,
  value: string,
  timeZone: string,
  occurrence?: CivilTimeOccurrence,
): RecordedTime | undefined {
  if (initial && value === dateTimeInputValue(initial)) return initial
  if (value === '') return undefined
  const [date, time] = value.split('T')
  const result = resolveCivilDateTime({ date: date ?? '', time: time ?? '', timeZone, ...(occurrence ? { occurrence } : {}) })
  return result.ok ? result.time : undefined
}

function makeDoseDraft(id: number, facts: DiaryFacts): DoseDraft {
  const defaultMedicine = facts.settings.defaultMedicineId
    ? facts.medicines.find((medicine) => medicine.id === facts.settings.defaultMedicineId && !medicine.archived)
    : undefined
  return {
    id,
    selection: defaultMedicine?.id ?? CUSTOM_MEDICINE,
    medicineName: defaultMedicine?.name ?? '',
    doseText: defaultMedicine?.doseText ?? '',
    takenAt: '',
    occurrenceOptions: [],
    followUpEnabled: facts.settings.followUpEnabled,
    followUpIntervalMinutes: facts.settings.followUpIntervalMinutes,
    saveToMedicineList: false,
  }
}

function makeOccurrenceOptions(date: string, time: string, timeZone: string): OccurrenceOption[] {
  return (['first', 'second'] as const).flatMap((occurrence) => {
    const result = resolveCivilDateTime({ date, time, timeZone, occurrence })
    return result.ok ? [{ occurrence, offset: result.time.offset }] : []
  })
}

export function PastHeadachePage({ facts, repository, route }: PastHeadachePageProps) {
  const currentTime = nowEventTime(repository.clock)
  const deviceTimeZone = currentTime.timeZone
  const existingEpisode = useMemo(
    () => (route.episodeId ? facts.episodes.find((candidate) => candidate.id === route.episodeId) : undefined),
    [facts.episodes, route.episodeId],
  )
  const [episode] = useState<Episode | undefined>(existingEpisode)
  const existingOnsetReading = useMemo(
    () => (episode ? facts.readings.find((reading) => reading.episodeId === episode.id && reading.atOnset) : undefined),
    [episode, facts.readings],
  )
  const [onsetReading] = useState(() => existingOnsetReading)
  const [initialStart] = useState(() => episode?.start ?? null)
  const [initialEnd] = useState(() => episode?.end ?? null)
  const startTimeZone = initialStart?.timeZone ?? deviceTimeZone
  const endTimeZone = initialEnd?.timeZone ?? startTimeZone
  const startTime = useEventTimeInput(initialStart, startTimeZone)
  const endTime = useEventTimeInput(initialEnd, endTimeZone)
  const [unknownEnd, setUnknownEnd] = useState(episode?.state === 'end_unknown')
  const [painMode, setPainMode] = useState<'numeric' | 'verbal'>(onsetReading?.pain?.kind ?? facts.settings.painEntryDefault)
  const [pain, setPain] = useState<Pain | null>(onsetReading?.pain ?? null)
  const [impact, setImpact] = useState<Impact | null>(onsetReading?.impact ?? null)
  const [note, setNote] = useState(episode?.note ?? '')
  const [doseDrafts, setDoseDrafts] = useState<DoseDraft[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const draftSequence = useRef(0)

  const activeMedicines = facts.medicines.filter((medicine) => !medicine.archived)
  const maximumForStart = dateTimeInputValue(eventTimeFromInstant(repository.clock.now(), startTimeZone))
  const maximumForEnd = dateTimeInputValue(eventTimeFromInstant(repository.clock.now(), endTimeZone))
  const maximumForDose = dateTimeInputValue(currentTime)
  const startPreview = previewEventTime(initialStart, startTime.value, startTimeZone, startTime.occurrence)
  const endPreview = unknownEnd ? undefined : previewEventTime(initialEnd, endTime.value, endTimeZone, endTime.occurrence)

  let durationHint = 'Choose the start and end date and time.'
  if (unknownEnd) {
    durationHint = 'Length unknown — left out of duration statistics.'
  } else if (startPreview && endPreview) {
    durationHint = compareInstants(endPreview, startPreview) < 0
      ? 'The end date and time must be on or after the start.'
      : `Lasted ${formatDuration(elapsedMilliseconds(startPreview, endPreview))}.`
  }

  const tabHref = routeHref({ kind: 'tab', tab: route.tab, ...(route.selectedDay ? { selectedDay: route.selectedDay } : {}) })
  const timelineHref = episode
    ? routeHref({
        kind: 'page',
        page: 'timeline',
        tab: route.tab,
        episodeId: episode.id,
        ...(route.selectedDay ? { selectedDay: route.selectedDay } : {}),
      })
    : tabHref
  const backHref = episode && route.tab !== 'history' ? timelineHref : tabHref
  const backLabel = route.tab === 'history' ? 'Back to History' : 'Back to Today'
  const dirty =
    startTime.isDirty || endTime.isDirty || unknownEnd !== (episode?.state === 'end_unknown') ||
    !samePain(pain, onsetReading?.pain ?? null) || impact !== (onsetReading?.impact ?? null) ||
    normaliseNote(note) !== (episode?.note ?? null) || doseDrafts.length > 0

  const changePainMode = (mode: 'numeric' | 'verbal') => {
    if (mode !== painMode && pain && pain.kind !== mode) setPain(null)
    setPainMode(mode)
  }

  const updateDoseDraft = (id: number, changes: Partial<DoseDraft>) => {
    setDoseDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...changes } : draft))
  }

  const addDoseDraft = () => {
    draftSequence.current += 1
    setDoseDrafts((current) => [...current, makeDoseDraft(draftSequence.current, facts)])
  }

  const selectMedicine = (draft: DoseDraft, value: string): Partial<DoseDraft> => {
    if (value === CUSTOM_MEDICINE) {
      return {
        selection: CUSTOM_MEDICINE,
        medicineName: '',
        doseText: '',
        saveToMedicineList: false,
        medicineError: undefined,
        doseError: undefined,
      }
    }
    const medicine = activeMedicines.find((candidate) => candidate.id === value)
    if (!medicine) return {}
    return {
      selection: medicine.id,
      medicineName: medicine.name,
      doseText: medicine.doseText,
      saveToMedicineList: false,
      medicineError: undefined,
      doseError: undefined,
    }
  }

  const resolveDraftDoses = (start: RecordedTime, end: RecordedTime | null): RetrospectiveDoseInput[] | null => {
    let invalidDraft = false
    const resolved: RetrospectiveDoseInput[] = []
    const nextDrafts = doseDrafts.map((draft) => {
      const medicineError = draft.medicineName.trim() === '' ? 'Enter a medicine name.' : undefined
      const doseError = draft.doseText.trim() === '' ? 'Enter the dose.' : undefined
      let timeError: string | undefined
      let occurrenceOptions: OccurrenceOption[] = []
      let takenAt: RecordedTime | undefined

      if (draft.takenAt === '') {
        timeError = 'Choose when you took this dose.'
      } else {
        const [date, time] = draft.takenAt.split('T')
        const result = resolveCivilDateTime({
          date: date ?? '',
          time: time ?? '',
          timeZone: deviceTimeZone,
          ...(draft.occurrence ? { occurrence: draft.occurrence } : {}),
        })
        if (result.ok) {
          takenAt = result.time
          if (compareInstants(takenAt, start) < 0) timeError = 'A dose cannot be before the headache started.'
          if (!timeError && end && compareInstants(takenAt, end) > 0) timeError = 'A dose cannot be after the headache ended.'
        } else {
          timeError = result.message
          if (result.code === 'ambiguous') occurrenceOptions = makeOccurrenceOptions(date ?? '', time ?? '', deviceTimeZone)
        }
      }

      if (medicineError || doseError || timeError || !takenAt) {
        invalidDraft = true
        return { ...draft, medicineError, doseError, timeError, occurrenceOptions }
      }

      resolved.push({
        takenAt,
        savedMedicineId: draft.selection === CUSTOM_MEDICINE ? null : draft.selection,
        medicineName: draft.medicineName.trim(),
        doseText: draft.doseText.trim(),
        followUpEnabled: draft.followUpEnabled,
        followUpIntervalMinutes: draft.followUpIntervalMinutes,
        saveToMedicineList: draft.selection === CUSTOM_MEDICINE && draft.saveToMedicineList,
      })
      return { ...draft, medicineError: undefined, doseError: undefined, timeError: undefined, occurrenceOptions: [] }
    })
    setDoseDrafts(nextDrafts)
    return invalidDraft ? null : resolved
  }

  const handleSave = async () => {
    if (busy) return
    setBusy(true)
    setError(null)

    try {
      const start = startTime.resolve()
      if (!start) return
      const end = unknownEnd ? null : endTime.resolve()
      if (!unknownEnd && !end) return
      if (end && compareInstants(end, start) < 0) {
        setError('The end date and time must be on or after the start.')
        return
      }

      const noteValue = normaliseNote(note)
      if (!episode) {
        const doses = resolveDraftDoses(start, end)
        if (!doses) return
        const saved = await saveRetrospectiveEpisode(
          repository,
          {
            start,
            end,
            note: noteValue,
            initialReading: { pain, impact },
            doses,
          },
          { expectedRevision: facts.metadata.revision },
        )
        window.location.hash = routeHref({
          kind: 'page',
          page: 'timeline',
          tab: route.tab,
          episodeId: saved.id,
          ...(route.selectedDay ? { selectedDay: route.selectedDay } : {}),
        })
        return
      }

      const nextState = unknownEnd ? 'end_unknown' : 'ended'
      const startChanged = compareInstants(start, episode.start) !== 0
      if (startChanged && onsetReading && !window.confirm('Move the initial reading to the new start time?')) return

      const episodeChanges: Partial<Pick<Episode, 'start' | 'end' | 'state' | 'note'>> = {}
      if (startChanged) episodeChanges.start = start
      if (episode.state !== nextState || (nextState === 'ended' && end && (!episode.end || compareInstants(end, episode.end) !== 0))) {
        episodeChanges.state = nextState
        episodeChanges.end = end
      }
      if (noteValue !== episode.note) episodeChanges.note = noteValue

      const hasOnsetDetails = pain !== null || impact !== null || Boolean(onsetReading?.note?.trim())
      const onsetChanged =
        !samePain(pain, onsetReading?.pain ?? null) || impact !== (onsetReading?.impact ?? null)
      if (Object.keys(episodeChanges).length > 0 || onsetChanged) {
        await editEpisodeWithOnsetReading(
          repository,
          episode.id,
          episodeChanges,
          hasOnsetDetails ? { pain, impact, note: onsetReading?.note ?? null } : null,
          { expectedRevision: facts.metadata.revision },
        )
      }

      window.location.hash = route.tab === 'history' ? tabHref : timelineHref
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  if ((route.episodeId && !episode) || episode?.state === 'ongoing') {
    return (
      <EntryShell title="Past headache" backHref={backHref} backLabel={backLabel} actionLabel="Save headache" footerNote="Open this form from Today or a saved timeline." actionDisabled>
        <section className="form-card" aria-label="Past headache unavailable">
          <h2>{route.episodeId && !episode ? 'This headache could not be found.' : 'This headache is still ongoing.'}</h2>
          <p>Your diary records have not changed.</p>
        </section>
      </EntryShell>
    )
  }

  return (
    <EntryShell
      title={episode ? 'Edit headache' : 'Past headache'}
      backHref={backHref}
      backLabel={backLabel}
      actionLabel={episode ? 'Save changes' : 'Save headache'}
      footerNote={episode ? 'Your saved record stays in place until these changes are saved.' : 'The headache and every staged dose save together.'}
      dirty={dirty}
      onAction={() => void handleSave()}
      actionBusy={busy}
      actionError={error}
    >
      <div className="form-stack">
        <section className="form-card" aria-labelledby="past-times-heading">
          <p className="section-kicker">When</p>
          <h2 id="past-times-heading">When did it happen?</h2>
          {!episode && route.tab === 'history' && route.selectedDay && isValidCivilDay(route.selectedDay) ? (
            <p className="card-caption">From History: {formatCivilDay(route.selectedDay)}. Choose the actual start and end times.</p>
          ) : null}
          <EventTimeField
            id="past-start-time"
            label="Started · date and time"
            value={startTime.value}
            onChange={startTime.setValue}
            max={maximumForStart}
            error={startTime.error}
            occurrence={startTime.occurrence}
            occurrenceOptions={startTime.occurrenceOptions}
            onChooseOccurrence={startTime.chooseOccurrence}
            hint="Use when you first noticed the headache."
          />
          {!unknownEnd ? (
            <EventTimeField
              id="past-end-time"
              label="Ended · date and time"
              value={endTime.value}
              onChange={endTime.setValue}
              max={maximumForEnd}
              error={endTime.error}
              occurrence={endTime.occurrence}
              occurrenceOptions={endTime.occurrenceOptions}
              onChooseOccurrence={endTime.chooseOccurrence}
              hint="Choose the actual end date as well as the time for an overnight or multi-day headache."
            />
          ) : null}
          <label className="unknown-end-toggle">
            <span>I don’t know when it ended</span>
            <input
              type="checkbox"
              role="switch"
              checked={unknownEnd}
              onChange={(event) => setUnknownEnd(event.target.checked)}
            />
          </label>
          <p className="field-hint" aria-live="polite">{durationHint}</p>
        </section>

        <section className="form-card" aria-labelledby="past-pain-heading">
          <div className="form-card__heading form-card__heading--wrap">
            <div>
              <p className="section-kicker">At the start</p>
              <h2 id="past-pain-heading">How much did it hurt?</h2>
            </div>
            <div className="segmented-control" role="group" aria-label="Pain entry mode">
              <button type="button" aria-pressed={painMode === 'numeric'} onClick={() => changePainMode('numeric')}>0–10</button>
              <button type="button" aria-pressed={painMode === 'verbal'} onClick={() => changePainMode('verbal')}>Words</button>
            </div>
          </div>
          <PainSelector mode={painMode} value={pain} onChange={setPain} />
          {pain ? <button className="text-action" type="button" onClick={() => setPain(null)}>Clear pain selection</button> : null}
          <p className="field-hint">Saved as a reading at the start time. You can add more readings later.</p>
        </section>

        <section className="form-card" aria-labelledby="past-impact-heading">
          <p className="section-kicker">At the start</p>
          <h2 id="past-impact-heading">How did it affect you?</h2>
          <ActivitySelector value={impact} onChange={setImpact} />
        </section>

        {!episode ? (
          <section className="form-card" aria-labelledby="past-medicine-heading">
            <p className="section-kicker">Medicine</p>
            <h2 id="past-medicine-heading">Doses taken</h2>
            {doseDrafts.length === 0 ? <p className="field-hint">Add each dose you took, with its time.</p> : null}
            <div className="retrospective-dose-list">
              {doseDrafts.map((draft, index) => (
                <section className="retrospective-dose" aria-labelledby={`retrospective-dose-${draft.id}`} key={draft.id}>
                  <div className="retrospective-dose__heading">
                    <h3 id={`retrospective-dose-${draft.id}`}>Dose {index + 1}</h3>
                    <button className="text-action" type="button" onClick={() => setDoseDrafts((current) => current.filter((item) => item.id !== draft.id))}>
                      Remove dose
                    </button>
                  </div>
                  <label className="field-label" htmlFor={`past-medicine-choice-${draft.id}`}>
                    Saved medicine
                    <select
                      id={`past-medicine-choice-${draft.id}`}
                      aria-label={`Saved medicine for dose ${index + 1}`}
                      value={draft.selection}
                      onChange={(event) => updateDoseDraft(draft.id, selectMedicine(draft, event.target.value))}
                    >
                      {activeMedicines.map((medicine: SavedMedicine) => (
                        <option key={medicine.id} value={medicine.id}>
                          {medicine.name} · {medicine.doseText}{medicine.id === facts.settings.defaultMedicineId ? ' · Default' : ''}
                        </option>
                      ))}
                      <option value={CUSTOM_MEDICINE}>Another medicine or dose</option>
                    </select>
                  </label>
                  <label className="field-label" htmlFor={`past-medicine-name-${draft.id}`}>
                    Medicine name for dose {index + 1}
                    <input
                      id={`past-medicine-name-${draft.id}`}
                      value={draft.medicineName}
                      onChange={(event) => updateDoseDraft(draft.id, { medicineName: event.target.value, medicineError: undefined })}
                    />
                  </label>
                  {draft.medicineError ? <p className="form-error">{draft.medicineError}</p> : null}
                  <label className="field-label" htmlFor={`past-dose-text-${draft.id}`}>
                    Dose for dose {index + 1}
                    <input
                      id={`past-dose-text-${draft.id}`}
                      value={draft.doseText}
                      onChange={(event) => updateDoseDraft(draft.id, { doseText: event.target.value, doseError: undefined })}
                    />
                  </label>
                  {draft.doseError ? <p className="form-error">{draft.doseError}</p> : null}
                  <EventTimeField
                    id={`past-dose-time-${draft.id}`}
                    label={`Dose time ${index + 1}`}
                    value={draft.takenAt}
                    onChange={(value) => updateDoseDraft(draft.id, {
                      takenAt: value,
                      occurrence: undefined,
                      occurrenceOptions: [],
                      timeError: undefined,
                    })}
                    max={maximumForDose}
                    error={draft.timeError}
                    occurrence={draft.occurrence}
                    occurrenceOptions={draft.occurrenceOptions}
                    onChooseOccurrence={(occurrence) => updateDoseDraft(draft.id, { occurrence, timeError: undefined })}
                    hint="Choose when you took this dose."
                  />
                  <label className="retrospective-dose__toggle">
                    <input
                      type="checkbox"
                      checked={draft.followUpEnabled}
                      aria-label={`Follow-up check for dose ${index + 1}`}
                      onChange={(event) => updateDoseDraft(draft.id, { followUpEnabled: event.target.checked })}
                    />
                    <span>Check how this dose worked</span>
                  </label>
                  {draft.followUpEnabled ? (
                    <label className="field-label" htmlFor={`past-dose-interval-${draft.id}`}>
                      Follow-up after
                      <select
                        id={`past-dose-interval-${draft.id}`}
                        aria-label={`Follow-up interval for dose ${index + 1}`}
                        value={draft.followUpIntervalMinutes}
                        onChange={(event) => updateDoseDraft(draft.id, { followUpIntervalMinutes: Number(event.target.value) as Dose['followUpIntervalMinutes'] })}
                      >
                        {FOLLOW_UP_INTERVALS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
                      </select>
                    </label>
                  ) : null}
                  {draft.selection === CUSTOM_MEDICINE ? (
                    <label className="retrospective-dose__toggle">
                      <input
                        type="checkbox"
                        checked={draft.saveToMedicineList}
                        aria-label={`Save ${draft.medicineName || 'this medicine'} to saved medicines`}
                        onChange={(event) => updateDoseDraft(draft.id, { saveToMedicineList: event.target.checked })}
                      />
                      <span>Save this medicine to the list for next time</span>
                    </label>
                  ) : null}
                </section>
              ))}
            </div>
            <button className="retrospective-dose-add" type="button" onClick={addDoseDraft}>Add a dose</button>
          </section>
        ) : null}

        <section className="form-card" aria-labelledby="past-note-heading">
          <p className="section-kicker">Note</p>
          <label className="field-label" htmlFor="past-note">
            <span id="past-note-heading">Anything worth remembering? (optional)</span>
            <textarea id="past-note" aria-label="Optional note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
          </label>
        </section>
      </div>
    </EntryShell>
  )
}
