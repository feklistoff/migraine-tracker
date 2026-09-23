import { useEffect, useState } from 'react'
import { Temporal } from '@js-temporal/polyfill'

import { firstDayOfWeek, deviceLocale, formatCivilDay, formatEventDate, formatEventTime, weekdayLabels } from '../../app/locale'
import { AppShell } from '../../app/AppShell'
import { routeHref, type AppRoute } from '../../app/Router'
import { saveDailyRecord } from '../../data/commands'
import { DiaryRepository, ValidationCommandError } from '../../data/repository'
import { dailyRecordForDay, dayBeforeSummary, episodesForDay, isValidCivilDay, selectCalendarMonth, type CalendarDay, type EpisodeDayRelation } from '../../domain/calendar'
import { civilDay, compareInstants, elapsedMilliseconds, nowEventTime } from '../../domain/time'
import type { DiaryFacts, Dose, Episode, Pain, Reading } from '../../domain/types'
import './history.css'

interface HistoryPageProps {
  route: Extract<AppRoute, { kind: 'tab' }> & { tab: 'history' }
  facts: DiaryFacts
  repository: DiaryRepository
}

function dateAsUtc(day: string): Date {
  const date = Temporal.PlainDate.from(day)
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12))
}

function monthLabel(month: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dateAsUtc(`${month}-01`))
}

function shortDayLabel(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(dateAsUtc(day))
}

function statusLabel(day: CalendarDay): string {
  if (day.status === 'headache') return 'headache recorded'
  if (day.status === 'headache-free') return 'no headache'
  if (day.isFuture) return 'upcoming'
  if (day.isToday) return 'today, nothing recorded yet'
  return 'no entry'
}

function relationLabel(relation: EpisodeDayRelation, episode: Episode): string {
  if (relation === 'began') return 'Began on this day'
  if (relation === 'recorded') return episode.state === 'end_unknown' ? 'Recorded on this day; end time unknown' : 'Recorded after this headache ended'
  return `Continued from ${formatEventDate(episode.start)}`
}

function durationLabel(episode: Episode, now: ReturnType<typeof nowEventTime>): string {
  if (episode.state === 'end_unknown') return 'Length unknown'
  const duration = elapsedMilliseconds(episode.start, episode.end ?? now)
  const minutes = Math.floor(duration / 60_000)
  if (minutes < 1) return 'Less than a minute'
  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  const length = hours === 0 ? `${minutes} min` : remaining === 0 ? `${hours} h` : `${hours} h ${remaining} min`
  return episode.state === 'ongoing' ? `${length} so far` : length
}

function painLabel(pain: Pain): string {
  if (pain.kind === 'numeric') return String(pain.value)
  return pain.value === 'none' ? 'No pain' : pain.value[0].toUpperCase() + pain.value.slice(1)
}

function EpisodeCard({
  episode,
  relation,
  readings,
  doses,
  now,
  selectedDay,
}: {
  episode: Episode
  relation: EpisodeDayRelation
  readings: Reading[]
  doses: Dose[]
  now: ReturnType<typeof nowEventTime>
  selectedDay: string
}) {
  const painSequence = readings
    .filter((reading) => reading.pain !== null)
    .sort((one, two) => compareInstants(one.measuredAt, two.measuredAt) || one.id.localeCompare(two.id))
    .map((reading) => painLabel(reading.pain!))
  const medicineSequence = [...doses]
    .sort((one, two) => compareInstants(one.takenAt, two.takenAt) || one.id.localeCompare(two.id))
    .map((dose) => `${dose.medicineName}${dose.doseText ? ` ${dose.doseText}` : ''} at ${formatEventTime(dose.takenAt)}`)

  return (
    <article className="history-episode">
      <div className="history-episode__heading">
        <div>
          <strong>Headache · {durationLabel(episode, now)}</strong>
          <small>{relationLabel(relation, episode)}</small>
        </div>
        <a
          className="history-episode__timeline"
          href={routeHref({ kind: 'page', page: 'timeline', tab: 'history', selectedDay, episodeId: episode.id })}
          aria-label={`Open timeline for headache begun ${formatEventDate(episode.start)}`}
        >›</a>
      </div>
      <p className="history-episode__time">{formatEventDate(episode.start)} at {formatEventTime(episode.start)}{episode.end ? ` – ${formatEventDate(episode.end)} at ${formatEventTime(episode.end)}` : episode.state === 'ongoing' ? ' – ongoing' : ' – end unknown'}</p>
      <dl className="history-episode__details">
        <dt>Pain</dt><dd>{painSequence.length ? painSequence.join(' → ') : 'Not recorded'}</dd>
        <dt>Medicine</dt><dd>{medicineSequence.length ? medicineSequence.join(' · ') : 'None recorded'}</dd>
        <dt>Note</dt><dd>{episode.note || 'No note'}</dd>
      </dl>
    </article>
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof ValidationCommandError) return error.issues.map((issue) => issue.message).join(' ')
  if (error instanceof Error) return error.message
  return 'The day could not be saved. Try again.'
}

export function HistoryPage({ route, facts, repository }: HistoryPageProps) {
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

  const locale = deviceLocale()
  const now = nowEventTime(repository.clock)
  const today = civilDay(now)
  const selectedDay = route.selectedDay && isValidCivilDay(route.selectedDay) ? route.selectedDay : today
  const month = selectedDay.slice(0, 7)
  const calendar = selectCalendarMonth(facts, month, now, firstDayOfWeek(locale))
  const showMissing = Boolean(route.missing)
  const selected = calendar.days.find((day) => day.day === selectedDay)!
  const dayRecord = dailyRecordForDay(facts, selectedDay)
  const selectedEpisodes = episodesForDay(facts, selectedDay, now)

  const selectDay = (day: string) => {
    setError(null)
    window.location.hash = routeHref({ kind: 'tab', tab: 'history', selectedDay: day })
  }
  const changeMonth = (offset: number) => {
    const destination = Temporal.PlainYearMonth.from(month).add({ months: offset })
    const dayNumber = Math.min(Temporal.PlainDate.from(selectedDay).day, destination.daysInMonth)
    selectDay(destination.toPlainDate({ day: dayNumber }).toString())
  }
  const confirmNoHeadache = async () => {
    if (busy || selected.isFuture || selected.status !== 'unknown') return
    setBusy(true)
    setError(null)
    try {
      await saveDailyRecord(repository, {
        day: selectedDay,
        headacheFreeAt: now,
        alcohol: dayRecord?.alcohol ?? null,
        sleep: dayRecord?.sleep ?? null,
        stress: dayRecord?.stress ?? null,
      }, { expectedRevision: facts.metadata.revision })
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  const pastHref = routeHref({ kind: 'entry', page: 'past', tab: 'history', selectedDay })
  const checkinHref = routeHref({ kind: 'entry', page: 'checkin', tab: 'history', selectedDay })

  return (
    <AppShell route={route} className="history-page">
      <header className="history-month-header">
        <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}>‹</button>
        <h1>{monthLabel(month, locale)}</h1>
        <button type="button" aria-label="Next month" onClick={() => changeMonth(1)}>›</button>
      </header>

      <div className="history-key" aria-label="Key">
        <span><i className="history-key__dot" aria-hidden="true" />Headache</span>
        <span><i aria-hidden="true">✓</i>No headache</span>
        <span><i className="history-key__empty" aria-hidden="true" />No entry</span>
      </div>

      <section className="history-calendar" aria-label={`${monthLabel(month, locale)} calendar`}>
        <div className="history-calendar__weekdays" aria-hidden="true">
          {weekdayLabels(locale).map((weekday) => <span key={weekday}>{weekday.slice(0, 3)}</span>)}
        </div>
        <div className="history-calendar__days">
          {Array.from({ length: calendar.leadingBlankCount }, (_, index) => <span key={`blank-${index}`} />)}
          {calendar.days.map((day) => (
            <button
              key={day.day}
              type="button"
              className={`history-day history-day--${day.isFuture ? 'future' : day.status}${day.isToday ? ' history-day--today' : ''}${day.day === selectedDay ? ' history-day--selected' : ''}`}
              aria-label={`${formatCivilDay(day.day, locale)}, ${statusLabel(day)}`}
              aria-pressed={day.day === selectedDay}
              onClick={() => selectDay(day.day)}
            >
              <span>{Temporal.PlainDate.from(day.day).day}</span>
              <small aria-hidden="true">{day.status === 'headache' ? '●' : day.status === 'headache-free' ? '✓' : ' '}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="history-coverage" aria-label="Recording coverage">
        {calendar.coverage.eligibleDays === 0 ? <p>No days eligible yet.</p> : (
          <p><strong>{calendar.coverage.recordedDays} of {calendar.coverage.eligibleDays} days recorded</strong><small>{calendar.coverage.missingDays.length} days with no entry</small></p>
        )}
        {calendar.coverage.missingDays.length > 0 ? (
          <button type="button" className="text-action" aria-expanded={showMissing} onClick={() => { window.location.hash = routeHref({ kind: 'tab', tab: 'history', selectedDay, ...(!showMissing ? { missing: true } : {}) }) }}>{showMissing ? 'Hide missing days' : 'Show missing days'}</button>
        ) : null}
      </section>

      {showMissing ? (
        <section className="history-missing" aria-label="Missing days">
          <h2>Missing days</h2>
          <p>These dates have no headache status. Day-before notes alone do not count as a status.</p>
          <div className="history-missing__list">
            {calendar.coverage.missingDays.map((day) => <button type="button" key={day} onClick={() => selectDay(day)}>{shortDayLabel(day, locale)}</button>)}
          </div>
        </section>
      ) : null}

      <section className="history-selected" aria-labelledby="history-selected-title">
        <h2 id="history-selected-title">{formatCivilDay(selectedDay, locale)}</h2>
        {!selected.isFuture ? (
          <a className="history-day-before" href={checkinHref}>
            <span><strong>Day before</strong><small>{dayBeforeSummary(dayRecord)}</small></span><span aria-hidden="true">›</span>
          </a>
        ) : null}

        {selectedEpisodes.map(({ episode, relation }) => (
          <EpisodeCard
            key={episode.id}
            episode={episode}
            relation={relation}
            readings={facts.readings.filter((reading) => reading.episodeId === episode.id)}
            doses={facts.doses.filter((dose) => dose.episodeId === episode.id)}
            now={now}
            selectedDay={selectedDay}
          />
        ))}

        {selected.status === 'headache-free' ? (
          <div className="history-free"><strong>No headache</strong><span>You marked this day headache-free.</span></div>
        ) : null}
        {selected.status === 'unknown' && !selected.isToday && !selected.isFuture ? (
          <div className="history-unknown"><strong>No entry for this day</strong><span>Missing days aren’t counted as headache-free.</span></div>
        ) : null}
        {selected.status === 'unknown' && selected.isToday ? (
          <div className="history-today"><strong>Nothing recorded yet today</strong><span>You can mark “No headache so far” on Today.</span><a href="#today">Go to Today</a></div>
        ) : null}
        {selected.isFuture ? <p className="history-future">This day hasn’t happened yet.</p> : null}

        {selected.status === 'unknown' && !selected.isFuture && !selected.isToday ? (
          <div className="history-actions history-actions--two">
            <button type="button" className="sage-action" onClick={() => void confirmNoHeadache()} disabled={busy}>No headache</button>
            <a className="secondary-action" href={pastHref}>Add a headache</a>
          </div>
        ) : !selected.isFuture ? (
          <a className="secondary-action history-add" href={pastHref}>{selected.status === 'headache' ? 'Add another headache on this day' : 'Add a headache on this day'}</a>
        ) : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </section>
    </AppShell>
  )
}
