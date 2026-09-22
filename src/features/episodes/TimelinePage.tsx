import { useEffect, useMemo, useState } from 'react'

import { deleteEpisode } from '../../data/commands'
import { DiaryRepository } from '../../data/repository'
import { compareInstants, elapsedMilliseconds, nowEventTime } from '../../domain/time'
import { deriveDoseFollowUps, responseDelayMilliseconds } from '../../domain/followUps'
import type { DiaryFacts, Episode, Reading, RecordedTime } from '../../domain/types'
import { formatEventDate, formatEventTime } from '../../app/locale'
import { AppShell, PageHeader } from '../../app/AppShell'
import { routeHref, type AppRoute } from '../../app/Router'

interface TimelinePageProps {
  facts: DiaryFacts
  repository: DiaryRepository
  route: Extract<AppRoute, { kind: 'page' }> & { page: 'timeline' }
}

type TimelineEvent =
  | { id: 'start'; kind: 'start'; at: RecordedTime; order: number }
  | { id: 'end'; kind: 'end'; at: RecordedTime; order: number }
  | { id: string; kind: 'reading'; at: RecordedTime; order: number; reading: Reading }
  | { id: string; kind: 'dose'; at: RecordedTime; order: number; dose: DiaryFacts['doses'][number] }

function painLabel(reading: Reading): string {
  if (!reading.pain) return 'Pain not recorded'
  if (reading.pain.kind === 'numeric') return `${reading.pain.value} of 10`
  return reading.pain.value === 'none' ? 'No pain' : reading.pain.value[0]?.toUpperCase() + reading.pain.value.slice(1)
}

function impactLabel(impact: Reading['impact']): string | undefined {
  if (!impact) return undefined
  if (impact === 'normal') return 'Normal activities'
  if (impact === 'slowed') return 'Slowed down'
  return 'Had to stop'
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

function describeReading(reading: Reading): string {
  const details = [painLabel(reading), impactLabel(reading.impact)].filter(Boolean)
  if (reading.note?.trim()) details.push(reading.note.trim())
  return details.join(' · ')
}

function readingEditHref(
  episode: Episode,
  reading: Reading,
  route: Extract<AppRoute, { kind: 'page' }>,
): string {
  return routeHref({
    kind: 'entry',
    page: reading.linkedDoseId ? 'follow-up' : 'update',
    tab: route.tab,
    episodeId: episode.id,
    readingId: reading.id,
    ...(route.selectedDay ? { selectedDay: route.selectedDay } : {}),
    ...(reading.linkedDoseId ? { doseId: reading.linkedDoseId } : {}),
  })
}

function episodeDetailsHref(
  episode: Episode,
  route: Extract<AppRoute, { kind: 'page' }>,
): string {
  return routeHref({
    kind: 'entry',
    page: episode.state === 'ongoing' ? 'start' : 'past',
    tab: route.tab,
    episodeId: episode.id,
    ...(route.selectedDay ? { selectedDay: route.selectedDay } : {}),
  })
}

function DoseFollowUpStatus({
  check,
  episode,
  tab,
  selectedDay,
}: {
  check: ReturnType<typeof deriveDoseFollowUps>[number] | undefined
  episode: Episode
  tab: 'today' | 'history' | 'statistics'
  selectedDay?: string
}) {
  if (!check || !check.dueAt || check.status === 'disabled' || check.status === 'answered') return null
  if (check.status === 'pending') {
    return <p className="timeline-event__follow-up">Follow-up due {formatEventDate(check.dueAt)} at {formatEventTime(check.dueAt)}.</p>
  }
  if (check.status === 'overdue') {
    return <p className="timeline-event__follow-up">Follow-up overdue. It stays available on Today for 24 hours after it was due.</p>
  }
  if (check.status === 'expired') {
    return (
      <div className="timeline-event__follow-up">
        <strong>No follow-up recorded.</strong>
        <p>A late response keeps the time you measured it.</p>
        <a className="text-action" href={routeHref({ kind: 'entry', page: 'follow-up', tab, episodeId: episode.id, doseId: check.dose.id, ...(selectedDay ? { selectedDay } : {}) })}>Record late follow-up</a>
      </div>
    )
  }
  return <p className="timeline-event__follow-up">This pending check was replaced by a later dose.</p>
}

export function TimelinePage({ facts, repository, route }: TimelinePageProps) {
  const [, setClockTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const episode = facts.episodes.find((candidate) => candidate.id === route.episodeId)
  const now = nowEventTime(repository.clock)
  const checks = useMemo(() => deriveDoseFollowUps(facts.doses, facts.readings, now), [facts.doses, facts.readings, now])
  const followUpByDose = new Map(checks.map((check) => [check.dose.id, check]))
  const backHref = routeHref({ kind: 'tab', tab: route.tab, ...(route.selectedDay ? { selectedDay: route.selectedDay } : {}) })

  if (!episode) {
    return (
      <AppShell route={route}>
        <PageHeader title="Headache" backHref={backHref} backLabel={route.tab === 'history' ? 'Back to History' : 'Back to Today'} />
        <section className="empty-card">
          <h2>This headache could not be found.</h2>
          <p>Your diary records have not changed.</p>
        </section>
      </AppShell>
    )
  }

  const events: TimelineEvent[] = [
    { id: 'start', kind: 'start', at: episode.start, order: 0 },
    ...facts.readings
      .filter((reading) => reading.episodeId === episode.id)
      .map((reading): TimelineEvent => ({ id: reading.id, kind: 'reading', at: reading.measuredAt, order: 2, reading })),
    ...facts.doses
      .filter((dose) => dose.episodeId === episode.id)
      .map((dose): TimelineEvent => ({ id: dose.id, kind: 'dose', at: dose.takenAt, order: 1, dose })),
  ]
  if (episode.state === 'ended' && episode.end) events.push({ id: 'end', kind: 'end', at: episode.end, order: 3 })
  events.sort((one, two) => compareInstants(one.at, two.at) || one.order - two.order || one.id.localeCompare(two.id))

  const duration = episode.state === 'ended' && episode.end
    ? formatDuration(elapsedMilliseconds(episode.start, episode.end))
      : episode.state === 'end_unknown'
        ? 'Length unknown'
        : `${formatDuration(elapsedMilliseconds(episode.start, repository.clock.now()))} so far`
  const doseCount = facts.doses.filter((dose) => dose.episodeId === episode.id).length

  const handleDelete = async () => {
    if (busy) return
    if (!window.confirm('Delete this headache and all its readings and doses? Day-before notes will stay.')) return
    setBusy(true)
    setError(null)
    try {
      await deleteEpisode(repository, episode.id, { expectedRevision: facts.metadata.revision })
      window.location.hash = backHref
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'The headache could not be deleted. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell route={route}>
      <PageHeader title="Headache" backHref={backHref} backLabel={route.tab === 'history' ? 'Back to History' : 'Back to Today'} />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <section className="timeline-summary" aria-label="Headache summary">
        <p className="section-kicker">{episode.state === 'ongoing' ? 'Ongoing' : episode.state === 'ended' ? 'Ended' : 'End time not recorded'}</p>
        <h2>{duration}</h2>
        <p>{formatEventDate(episode.start)} · started at {formatEventTime(episode.start)}{episode.end ? ` · ended ${formatEventDate(episode.end)} at ${formatEventTime(episode.end)}` : ''}</p>
        <p className="timeline-summary__count">{doseCount} {doseCount === 1 ? 'dose' : 'doses'}</p>
      </section>

      <section className="timeline-section" aria-labelledby="timeline-heading">
        <div className="form-card__heading">
          <div>
            <h2 id="timeline-heading">Timeline</h2>
          </div>
          <span className="card-caption">Tap an entry to change it</span>
        </div>
        <ol className="timeline-list">
          {events.map((event) => {
            const timeLabel = `${formatEventDate(event.at)} · ${formatEventTime(event.at)}`
            if (event.kind === 'start') {
              return (
                <li className="timeline-event timeline-event--start" key={event.id}>
                  <time>{timeLabel}</time>
                  <div>
                    <strong>Headache started</strong>
                    <p>Onset time</p>
                    <a className="text-action" href={episodeDetailsHref(episode, route)}>Edit start</a>
                  </div>
                </li>
              )
            }
            if (event.kind === 'end') {
              return (
                <li className="timeline-event timeline-event--end" key={event.id}>
                  <time>{timeLabel}</time>
                  <div>
                    <strong>Headache ended</strong>
                    <p>Known end time</p>
                    <a className="text-action" href={episodeDetailsHref(episode, route)}>Edit end time</a>
                  </div>
                </li>
              )
            }
            if (event.kind === 'dose') {
              const check = followUpByDose.get(event.dose.id)
              return (
                <li className="timeline-event timeline-event--dose" key={event.id}>
                  <time>{timeLabel}</time>
                  <div>
                    <strong>{event.dose.medicineName} · {event.dose.doseText}</strong>
                    <p>Dose taken</p>
                    <DoseFollowUpStatus check={check} episode={episode} tab={route.tab} selectedDay={route.selectedDay} />
                    <a className="text-action" href={routeHref({ kind: 'entry', page: 'dose', tab: route.tab, episodeId: episode.id, doseId: event.dose.id, ...(route.selectedDay ? { selectedDay: route.selectedDay } : {}) })}>Edit dose</a>
                  </div>
                </li>
              )
            }

            const linkedDose = event.reading.linkedDoseId
              ? facts.doses.find((dose) => dose.id === event.reading.linkedDoseId)
              : undefined
            const delay = linkedDose ? responseDelayMilliseconds(linkedDose, event.reading) : undefined
            const afterKnownEnd = episode.state === 'ended' && episode.end && compareInstants(event.reading.measuredAt, episode.end) > 0
            return (
              <li className="timeline-event timeline-event--reading" key={event.id}>
                <time>{timeLabel}</time>
                <div>
                  <strong>{linkedDose ? 'Follow-up response' : event.reading.atOnset ? 'At headache start' : 'Pain update'}</strong>
                  <p>{describeReading(event.reading)}{delay === undefined ? '' : ` · ${formatDuration(delay)} after dose`}</p>
                  {afterKnownEnd ? <small>Measured after the headache ended.</small> : null}
                  <a className="text-action" href={readingEditHref(episode, event.reading, route)}>{linkedDose ? 'Edit follow-up' : 'Edit reading'}</a>
                </div>
              </li>
            )
          })}
          {episode.state === 'end_unknown' ? (
            <li className="timeline-event timeline-event--unknown-end">
              <span aria-hidden="true" />
              <div>
                <strong>End time unknown</strong>
                <p>No end time or duration is inferred.</p>
                <a className="text-action" href={episodeDetailsHref(episode, route)}>Add end time</a>
              </div>
            </li>
          ) : null}
        </ol>
      </section>

      {episode.note ? (
        <section className="timeline-note" aria-label="Headache note">
          <div><p className="section-kicker">Note</p><p>{episode.note}</p></div>
          <a className="text-action" href={episodeDetailsHref(episode, route)}>Edit note</a>
        </section>
      ) : (
        <a className="text-action timeline-note-add" href={episodeDetailsHref(episode, route)}>Add a note</a>
      )}

      <div className="timeline-actions">
        <a className="secondary-action" href={routeHref({ kind: 'entry', page: 'update', tab: route.tab, episodeId: episode.id, ...(route.selectedDay ? { selectedDay: route.selectedDay } : {}) })}>Add a reading</a>
        <a className="primary-action" href={routeHref({ kind: 'entry', page: 'dose', tab: route.tab, episodeId: episode.id, ...(route.selectedDay ? { selectedDay: route.selectedDay } : {}) })}>Add a dose</a>
      </div>
      <div className="timeline-delete">
        <button className="danger-action" type="button" onClick={() => void handleDelete()} disabled={busy}>Delete this headache</button>
        <small>All readings and doses will be removed. Independent day-before notes stay in the diary.</small>
      </div>
    </AppShell>
  )
}
