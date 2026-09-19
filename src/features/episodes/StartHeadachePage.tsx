import { useMemo, useState } from 'react'

import { ActivitySelector, PainSelector } from '../../components/controls'
import { editEpisode, deleteReading, saveReading } from '../../data/commands'
import { DiaryRepository, ValidationCommandError } from '../../data/repository'
import { dateTimeInputValue, nowEventTime, resolveCivilDateTime } from '../../domain/time'
import type { DiaryFacts, Impact, Pain } from '../../domain/types'
import { EntryShell } from '../../app/AppShell'
import { routeHref, type AppRoute } from '../../app/Router'

interface StartHeadachePageProps {
  facts: DiaryFacts
  repository: DiaryRepository
  route: Extract<AppRoute, { kind: 'entry' }> & { page: 'start' }
}

function errorMessage(error: unknown): string {
  if (error instanceof ValidationCommandError) return error.issues.map((issue) => issue.message).join(' ')
  if (error instanceof Error) return error.message
  return 'The diary could not be saved. Your details are still here; try again.'
}

function normaliseNote(value: string): string | null {
  const note = value.trim()
  return note === '' ? null : note
}

export function StartHeadachePage({ facts, repository, route }: StartHeadachePageProps) {
  const episode = useMemo(
    () => (route.episodeId ? facts.episodes.find((candidate) => candidate.id === route.episodeId) : undefined),
    [facts.episodes, route.episodeId],
  )
  const initialReading = useMemo(
    () => (episode ? facts.readings.find((reading) => reading.episodeId === episode.id && reading.atOnset) : undefined),
    [episode, facts.readings],
  )
  const initialStartInput = episode ? dateTimeInputValue(episode.start) : ''
  const [startInput, setStartInput] = useState(initialStartInput)
  const [painMode, setPainMode] = useState<'numeric' | 'verbal'>(facts.settings.painEntryDefault)
  const [pain, setPain] = useState<Pain | null>(initialReading?.pain ?? null)
  const [impact, setImpact] = useState<Impact | null>(initialReading?.impact ?? null)
  const [note, setNote] = useState(episode?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!episode) {
    return (
      <EntryShell
        title="New headache"
        actionLabel="Save headache"
        footerNote="Start this form from Today so the start time is kept first."
        actionDisabled
      >
        <section className="form-card" aria-label="New headache">
          <h2>Start from Today</h2>
          <p>That saved start could not be found. Go back and try again.</p>
        </section>
      </EntryShell>
    )
  }

  const hasOnsetDetails = pain !== null || impact !== null
  const isDirty =
    startInput !== initialStartInput || normaliseNote(note) !== episode.note || pain !== (initialReading?.pain ?? null) || impact !== (initialReading?.impact ?? null)

  const handleSave = async () => {
    if (busy) return
    setBusy(true)
    setError(null)

    try {
      let revision = facts.metadata.revision
      let nextStart = episode.start
      const startChanged = startInput !== initialStartInput

      if (startChanged) {
        const [date, time] = startInput.split('T')
        const resolution = resolveCivilDateTime({ date, time, timeZone: episode.start.timeZone })
        if (!resolution.ok) throw new Error(resolution.message)
        nextStart = resolution.time

        if (initialReading && !window.confirm('Move the initial reading to the new start time?')) {
          return
        }
      }

      const nextNote = normaliseNote(note)
      if (startChanged || nextNote !== episode.note) {
        await editEpisode(
          repository,
          episode.id,
          { start: nextStart, note: nextNote },
          { expectedRevision: revision, moveOnsetReading: startChanged && Boolean(initialReading) },
        )
        revision = repository.snapshot().facts?.metadata.revision ?? revision + 1
      }

      if (hasOnsetDetails) {
        await saveReading(
          repository,
          {
            id: initialReading?.id,
            episodeId: episode.id,
            measuredAt: nextStart,
            pain,
            impact,
            note: null,
            linkedDoseId: null,
            atOnset: true,
          },
          { expectedRevision: revision },
        )
      } else if (initialReading) {
        await deleteReading(repository, initialReading.id, { expectedRevision: revision })
      }

      window.location.hash = routeHref({ kind: 'tab', tab: 'today' })
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <EntryShell
      title="New headache"
      actionLabel="Save headache"
      footerNote="The start time is already kept. Add the rest whenever you can."
      dirty={isDirty}
      onAction={handleSave}
      actionBusy={busy}
      actionError={error}
    >
      <div className="form-stack" aria-label="New headache">
        <section className="form-card" aria-labelledby="start-time-heading">
          <div className="form-card__heading">
            <div>
              <p className="section-kicker">Start time</p>
              <h2 id="start-time-heading">When did you first notice it?</h2>
            </div>
            <span className="saved-pill">Saved</span>
          </div>
          <label className="field-label" htmlFor="start-date-time">
            Date and time
            <input
              id="start-date-time"
              type="datetime-local"
              value={startInput}
              onChange={(event) => setStartInput(event.target.value)}
              max={dateTimeInputValue(nowEventTime(repository.clock))}
            />
          </label>
          <p className="field-hint">Began earlier? Set it to when you first noticed the pain.</p>
        </section>

        <section className="form-card" aria-labelledby="pain-heading">
          <div className="form-card__heading form-card__heading--wrap">
            <div>
              <p className="section-kicker">Pain</p>
              <h2 id="pain-heading">How much did it hurt?</h2>
            </div>
            <div className="segmented-control" role="group" aria-label="Pain entry mode">
              <button type="button" aria-pressed={painMode === 'numeric'} onClick={() => setPainMode('numeric')}>
                0–10
              </button>
              <button type="button" aria-pressed={painMode === 'verbal'} onClick={() => setPainMode('verbal')}>
                Words
              </button>
            </div>
          </div>
          <PainSelector mode={painMode} value={pain} onChange={setPain} />
          <p className="field-hint">Nothing is selected unless you choose it.</p>
        </section>

        <section className="form-card" aria-labelledby="activity-heading">
          <p className="section-kicker">Activity</p>
          <h2 id="activity-heading">How did it affect you?</h2>
          <ActivitySelector value={impact} onChange={setImpact} />
        </section>

        <section className="form-card" aria-labelledby="note-heading">
          <p className="section-kicker">Note</p>
          <h2 id="note-heading">Anything else? <span className="muted-inline">(optional)</span></h2>
          <label className="field-label" htmlFor="start-note">
            <span className="visually-hidden">Optional note</span>
            <textarea id="start-note" aria-label="Optional note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
          </label>
        </section>
      </div>
    </EntryShell>
  )
}
