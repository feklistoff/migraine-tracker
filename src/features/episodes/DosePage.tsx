import { useCallback, useMemo, useRef, useState } from 'react'

import { deleteDose, saveDose } from '../../data/commands'
import { DiaryRepository, ValidationCommandError } from '../../data/repository'
import { compareInstants, dateTimeInputValue, elapsedMilliseconds, eventTimeFromInstant, nowEventTime, resolveCivilDateTime } from '../../domain/time'
import { deriveDoseFollowUps, followUpDueTime, latestDoseForEpisode } from '../../domain/followUps'
import type { DiaryFacts, Dose, Reading, SavedMedicine } from '../../domain/types'
import { formatEventDate, formatEventTime } from '../../app/locale'
import { EntryShell } from '../../app/AppShell'
import { routeHref, type AppRoute } from '../../app/Router'
import { EventTimeField, useEventTimeInput } from './eventTimeInput'
import { ReadingEditor } from './ReadingPage'

const CUSTOM_MEDICINE = 'custom'

interface DosePageProps {
  facts: DiaryFacts
  repository: DiaryRepository
  route: Extract<AppRoute, { kind: 'entry' }> & { page: 'dose' }
}

function errorMessage(error: unknown): string {
  if (error instanceof ValidationCommandError) return error.issues.map((issue) => issue.message).join(' ')
  if (error instanceof Error) return error.message
  return 'The dose could not be saved. Your details are still here; try again.'
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

function latestPainBefore(readings: readonly Reading[], episodeId: string, takenAt: Reading['measuredAt']): Reading | undefined {
  return readings
    .filter((reading) => reading.episodeId === episodeId && reading.pain !== null && compareInstants(reading.measuredAt, takenAt) <= 0)
    .sort((one, two) => compareInstants(one.measuredAt, two.measuredAt))
    .at(-1)
}

function previewEventTime(
  initial: Dose['takenAt'],
  value: string,
  timeZone: string,
  occurrence?: 'first' | 'second',
): Dose['takenAt'] | undefined {
  if (value === dateTimeInputValue(initial)) return initial
  const [date, time] = value.split('T')
  const resolved = resolveCivilDateTime({ date: date ?? '', time: time ?? '', timeZone, ...(occurrence ? { occurrence } : {}) })
  return resolved.ok ? resolved.time : undefined
}

function painLabel(reading: Reading): string {
  if (!reading.pain) return 'Pain not recorded'
  if (reading.pain.kind === 'numeric') return `${reading.pain.value} of 10`
  return reading.pain.value === 'none' ? 'No pain' : reading.pain.value[0]?.toUpperCase() + reading.pain.value.slice(1)
}

export function DosePage({ facts, repository, route }: DosePageProps) {
  const existingDose = useMemo(
    () => (route.doseId ? facts.doses.find((candidate) => candidate.id === route.doseId) : undefined),
    [facts.doses, route.doseId],
  )
  const episodeId = existingDose?.episodeId ?? route.episodeId
  const episode = facts.episodes.find((candidate) => candidate.id === episodeId)
  const defaultTakenAt = episode?.state === 'ended' && episode.end
    ? episode.end
    : nowEventTime(repository.clock)
  const defaultMedicine = !existingDose && facts.settings.defaultMedicineId
    ? facts.medicines.find((medicine) => medicine.id === facts.settings.defaultMedicineId && !medicine.archived)
    : undefined
  const availableMedicines = facts.medicines.filter((medicine) => !medicine.archived || medicine.id === existingDose?.savedMedicineId)
  const [initialForm] = useState(() => ({
    selection: existingDose?.savedMedicineId ?? defaultMedicine?.id ?? CUSTOM_MEDICINE,
    medicineName: existingDose?.medicineName ?? defaultMedicine?.name ?? '',
    doseText: existingDose?.doseText ?? defaultMedicine?.doseText ?? '',
    custom: {
      name: existingDose?.savedMedicineId ? '' : existingDose?.medicineName ?? '',
      doseText: existingDose?.savedMedicineId ? '' : existingDose?.doseText ?? '',
    },
    takenAt: existingDose?.takenAt ?? defaultTakenAt,
    followUpEnabled: existingDose?.followUpEnabled ?? facts.settings.followUpEnabled,
    followUpInterval: existingDose?.followUpIntervalMinutes ?? facts.settings.followUpIntervalMinutes,
  }))
  const [expectedRevision, setExpectedRevision] = useState(facts.metadata.revision)
  const [selection, setSelection] = useState(initialForm.selection)
  const [medicineName, setMedicineName] = useState(initialForm.medicineName)
  const [doseText, setDoseText] = useState(initialForm.doseText)
  const initialCustom = useRef(initialForm.custom)
  const [saveToList, setSaveToList] = useState(false)
  const [showReadingEditor, setShowReadingEditor] = useState(false)
  const [readingDirty, setReadingDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [baselineSaved, setBaselineSaved] = useState(false)
  const initialTakenAt = initialForm.takenAt
  const eventTime = useEventTimeInput(initialTakenAt, initialTakenAt.timeZone)
  const followUpEnabled = initialForm.followUpEnabled
  const followUpInterval = initialForm.followUpInterval
  const selectedMedicine = selection === CUSTOM_MEDICINE ? undefined : availableMedicines.find((medicine) => medicine.id === selection)
  const selectedSnapshotChanged = Boolean(
    existingDose && selectedMedicine &&
      (existingDose.medicineName !== selectedMedicine.name || existingDose.doseText !== selectedMedicine.doseText),
  )
  const previewTakenAt = previewEventTime(initialTakenAt, eventTime.value, initialTakenAt.timeZone, eventTime.occurrence) ?? initialTakenAt
  const baseline = episode ? latestPainBefore(facts.readings, episode.id, previewTakenAt) : undefined
  const pendingCheck = episode
    ? deriveDoseFollowUps(facts.doses, facts.readings, nowEventTime(repository.clock))
        .find((check) => check.dose.episodeId === episode.id && (check.status === 'pending' || check.status === 'overdue'))
    : undefined
  const priorLatestDose = episode ? latestDoseForEpisode(facts.doses, episode.id) : undefined
  const replacingCheck =
    !existingDose && followUpEnabled && pendingCheck && compareInstants(previewTakenAt, pendingCheck.dose.takenAt) > 0
  const medicineIsValid = medicineName.trim() !== '' && doseText.trim() !== ''
  const dirty =
    eventTime.isDirty || selection !== initialForm.selection || medicineName !== initialForm.medicineName ||
    doseText !== initialForm.doseText || saveToList || readingDirty
  const backHref = routeHref({ kind: 'tab', tab: route.tab, ...(route.selectedDay ? { selectedDay: route.selectedDay } : {}) })

  const save = async () => {
    if (!episode || busy || !medicineIsValid || showReadingEditor) return
    setBusy(true)
    setError(null)
    try {
      const takenAt = eventTime.resolve()
      if (!takenAt) return
      const saved = await saveDose(
        repository,
        {
          id: existingDose?.id,
          episodeId: episode.id,
          takenAt,
          savedMedicineId: selection === CUSTOM_MEDICINE ? null : selection,
          medicineName: medicineName.trim(),
          doseText: doseText.trim(),
          followUpEnabled,
          followUpIntervalMinutes: followUpInterval,
        },
        { expectedRevision, saveToMedicineList: selection === CUSTOM_MEDICINE && saveToList },
      )
      void saved
      window.location.hash = backHref
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!existingDose || busy) return
    const linkedCount = facts.readings.filter((reading) => reading.linkedDoseId === existingDose.id).length
    const detail = linkedCount > 0
      ? ` Its ${linkedCount === 1 ? 'follow-up response will' : `${linkedCount} follow-up responses will`} stay as ordinary readings.`
      : ''
    if (!window.confirm(`Delete this dose? Its follow-up check will be removed.${detail}`)) return
    setBusy(true)
    setError(null)
    try {
      await deleteDose(repository, existingDose.id, { expectedRevision })
      window.location.hash = backHref
    } catch (deleteError) {
      setError(errorMessage(deleteError))
    } finally {
      setBusy(false)
    }
  }

  const handleSelection = (medicine: SavedMedicine | typeof CUSTOM_MEDICINE) => {
    if (medicine === CUSTOM_MEDICINE) {
      setSelection(CUSTOM_MEDICINE)
      setMedicineName(initialCustom.current.name)
      setDoseText(initialCustom.current.doseText)
      return
    }
    setSelection(medicine.id)
    setMedicineName(medicine.name)
    setDoseText(medicine.doseText)
    setSaveToList(false)
  }

  const onMedicineNameChange = (value: string) => {
    setMedicineName(value)
    if (selection === CUSTOM_MEDICINE) initialCustom.current = { ...initialCustom.current, name: value }
  }
  const onMedicineDoseChange = (value: string) => {
    setDoseText(value)
    if (selection === CUSTOM_MEDICINE) initialCustom.current = { ...initialCustom.current, doseText: value }
  }

  const onReadingSaved = useCallback(() => {
    setExpectedRevision((revision) => revision + 1)
    setShowReadingEditor(false)
    setReadingDirty(false)
    setBaselineSaved(true)
  }, [])
  const onReadingDirtyChange = useCallback((nextDirty: boolean) => setReadingDirty(nextDirty), [])
  const onReadingCancel = useCallback(() => {
    if (readingDirty && !window.confirm('Discard this unfinished pain update?')) return
    setShowReadingEditor(false)
    setReadingDirty(false)
  }, [readingDirty])

  if (!episode || (route.doseId && !existingDose)) {
    return (
      <EntryShell title={existingDose ? 'Edit dose' : 'Log dose'} backHref={backHref} actionLabel="Log dose" footerNote="Open this form from a saved headache timeline." actionDisabled>
        <section className="form-card" aria-label="Dose unavailable">
          <h2>{route.doseId && !existingDose ? 'This dose could not be found.' : 'This headache could not be found.'}</h2>
          <p>Your diary has not changed.</p>
        </section>
      </EntryShell>
    )
  }

  const dueAt = followUpEnabled ? followUpDueTime(previewTakenAt, followUpInterval) : undefined
  const hasLinkedResponse = existingDose && facts.readings.some((reading) => reading.linkedDoseId === existingDose.id)
  const currentDelay = baseline ? elapsedMilliseconds(baseline.measuredAt, repository.clock.now()) : null

  return (
    <EntryShell
      title={existingDose ? 'Edit dose' : 'Log dose'}
      backHref={backHref}
      actionLabel={existingDose ? 'Save changes' : 'Log dose'}
      footerNote={existingDose ? 'The original dose stays until these changes are saved.' : 'Nothing is saved until you tap Log dose.'}
      dirty={dirty}
      onAction={() => void save()}
      actionDisabled={!medicineIsValid || showReadingEditor}
      actionBusy={busy}
      actionError={error}
    >
      <div className="form-stack">
        <section className="form-card" aria-labelledby="medicine-choice-heading">
          <p className="section-kicker">Medicine</p>
          <h2 id="medicine-choice-heading">Which medicine?</h2>
          <div className="medicine-choices" role="group" aria-label="Saved medicines">
            {availableMedicines.map((medicine) => (
              <button
                key={medicine.id}
                className={`medicine-choice${selection === medicine.id ? ' medicine-choice--selected' : ''}`}
                type="button"
                aria-pressed={selection === medicine.id}
                onClick={() => handleSelection(medicine)}
              >
                <span className="activity-option__radio" aria-hidden="true"><span /></span>
                <span className="medicine-choice__label"><strong>{medicine.name} · {medicine.doseText}</strong><small>{medicine.archived ? 'Archived medicine' : medicine.id === facts.settings.defaultMedicineId ? 'Default' : 'Saved medicine'}</small></span>
                {selection === medicine.id ? <span className="medicine-choice__check" aria-hidden="true">✓</span> : null}
              </button>
            ))}
            <button
              className={`medicine-choice medicine-choice--custom${selection === CUSTOM_MEDICINE ? ' medicine-choice--selected' : ''}`}
              type="button"
              aria-pressed={selection === CUSTOM_MEDICINE}
              onClick={() => handleSelection(CUSTOM_MEDICINE)}
            >
              <span className="activity-option__radio" aria-hidden="true"><span /></span>
              <span className="medicine-choice__label"><strong>Another medicine or dose</strong><small>Use once, or save it for next time</small></span>
              {selection === CUSTOM_MEDICINE ? <span className="medicine-choice__check" aria-hidden="true">✓</span> : null}
            </button>
          </div>
          <label className="field-label" htmlFor="dose-medicine-name">
            Medicine name
            <input id="dose-medicine-name" value={medicineName} onChange={(event) => onMedicineNameChange(event.target.value)} />
          </label>
          <label className="field-label" htmlFor="dose-text">
            Dose
            <input id="dose-text" value={doseText} onChange={(event) => onMedicineDoseChange(event.target.value)} />
          </label>
          <p className="field-hint">These details are saved with this dose. They don’t change the saved medicine.</p>
          {selection === CUSTOM_MEDICINE ? (
            <label className="save-medicine-choice">
              <input type="checkbox" checked={saveToList} onChange={(event) => setSaveToList(event.target.checked)} />
              <span>Save this medicine to the list for next time</span>
            </label>
          ) : null}
          {!medicineIsValid ? <p className="field-hint">Enter a medicine name and dose before saving.</p> : null}
          {selection !== CUSTOM_MEDICINE && selectedMedicine?.archived ? <p className="field-hint">This archived medicine stays attached to this existing dose only.</p> : null}
          {existingDose && selectedSnapshotChanged ? (
            <p className="follow-up-note">This dose was recorded as {existingDose.medicineName} · {existingDose.doseText}. The saved medicine now says {selectedMedicine?.name} · {selectedMedicine?.doseText}; its newer label won’t replace this dose unless you choose it again.</p>
          ) : null}
        </section>

        <section className="form-card" aria-labelledby="dose-time-heading">
          <p className="section-kicker">Taken</p>
          <h2 id="dose-time-heading">When did you take it?</h2>
          <EventTimeField
            id="dose-date-time"
            label="Date and time"
            value={eventTime.value}
            onChange={eventTime.setValue}
            max={dateTimeInputValue(eventTimeFromInstant(repository.clock.now(), initialTakenAt.timeZone))}
            error={eventTime.error}
            occurrence={eventTime.occurrence}
            occurrenceOptions={eventTime.occurrenceOptions}
            onChooseOccurrence={eventTime.chooseOccurrence}
          />
        </section>

        {baseline ? (
          <section className="baseline-card" aria-labelledby="dose-baseline-heading">
            <p className="section-kicker">Latest pain reading before this dose</p>
            <h2 id="dose-baseline-heading">{painLabel(baseline)} at {formatEventTime(baseline.measuredAt)}</h2>
            <p>{currentDelay === null ? '' : `${durationLabel(currentDelay)} ago.`} Its recorded time stays separate from the dose time.</p>
            <button className="text-action" type="button" onClick={() => { setBaselineSaved(false); setShowReadingEditor(true) }}>Update first</button>
          </section>
        ) : (
          <section className="baseline-card" aria-labelledby="dose-baseline-heading">
            <p className="section-kicker">Before this dose</p>
            <h2 id="dose-baseline-heading">No pain reading recorded.</h2>
            <p>A dose will not fill in a pain score for you.</p>
            <button className="text-action" type="button" onClick={() => { setBaselineSaved(false); setShowReadingEditor(true) }}>Update first</button>
          </section>
        )}

        {showReadingEditor ? (
          <ReadingEditor
            facts={facts}
            repository={repository}
            episode={episode}
            mode="update"
            initialMeasuredAt={previewTakenAt}
            route={route}
            inline
            onSaved={onReadingSaved}
            onCancel={onReadingCancel}
            onDirtyChange={onReadingDirtyChange}
          />
        ) : null}

        <section className="form-card" aria-labelledby="dose-follow-up-heading">
          <p className="section-kicker">Follow-up</p>
          <h2 id="dose-follow-up-heading">
            {followUpEnabled ? `Check after ${followUpInterval} minutes` : 'No follow-up check for this dose'}
          </h2>
          {followUpEnabled && dueAt ? <p className="card-caption">The check is due {formatEventDate(dueAt)} at {formatEventTime(dueAt)}. It will appear in the app only; it won’t send an alert.</p> : <p className="card-caption">This dose keeps the follow-up setting that was active when the form opened.</p>}
          {!existingDose && replacingCheck && pendingCheck ? (
            <p className="follow-up-note">This dose will replace the pending check for {pendingCheck.dose.medicineName} · {pendingCheck.dose.doseText}. Both doses stay in the diary.</p>
          ) : null}
          {!existingDose && followUpEnabled && pendingCheck && !replacingCheck && priorLatestDose && compareInstants(previewTakenAt, priorLatestDose.takenAt) <= 0 ? (
            <p className="follow-up-note">This earlier dose won’t replace the check for {priorLatestDose.medicineName} · {priorLatestDose.doseText}.</p>
          ) : null}
          {existingDose && hasLinkedResponse ? <p className="follow-up-note">This dose has a saved follow-up. Its time can’t move past that measurement.</p> : null}
          {baselineSaved && !baseline ? <p className="field-hint">The pain update was saved. Its time remains separate from this dose.</p> : null}
        </section>

        {existingDose ? (
          <button className="danger-action" type="button" onClick={() => void remove()} disabled={busy}>Delete this dose</button>
        ) : null}
      </div>
    </EntryShell>
  )
}
