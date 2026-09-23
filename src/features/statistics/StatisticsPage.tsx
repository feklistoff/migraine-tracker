import { useState } from 'react'
import { Temporal } from '@js-temporal/polyfill'

import { Icon } from '../../components/Icon'
import { AppShell } from '../../app/AppShell'
import { deviceLocale, formatEventDate, formatEventTime } from '../../app/locale'
import { routeHref, type AppRoute } from '../../app/Router'
import { civilDay } from '../../domain/time'
import { selectStatisticsMonth, type StatisticsMonth, type TreatmentDose } from '../../domain/statistics'
import type { DiaryFacts, Pain, RecordedTime } from '../../domain/types'
import './statistics.css'

type StatisticsRoute = Extract<AppRoute, { kind: 'tab'; tab: 'statistics' }>

export interface StatisticsPageProps {
  route: StatisticsRoute
  facts: DiaryFacts
  now: RecordedTime
}

function monthLabel(month: string, locale = deviceLocale()): string {
  const value = Temporal.PlainYearMonth.from(month)
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(value.year, value.month - 1, 1, 12)))
}

function durationLabel(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000)
  if (minutes < 1) return 'Less than a minute'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${minutes} min`
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

function painLabel(pain: Pain | null): string {
  if (!pain) return 'No pain value'
  return pain.kind === 'numeric' ? `${pain.value} of 10` : pain.value[0].toUpperCase() + pain.value.slice(1)
}

function missingDaysHref(month: string, todayMonth: string): string {
  return month === todayMonth ? '#history?missing=1' : `#history?day=${month}-01&missing=1`
}

function CoverageCard({ statistics, todayMonth }: { statistics: StatisticsMonth; todayMonth: string }) {
  const { eligibleDays, recordedDays, missingDays } = statistics.coverage
  const label = `${recordedDays} of ${eligibleDays} days recorded`
  const percent = eligibleDays > 0 ? Math.round((recordedDays / eligibleDays) * 100) : 0
  return (
    <section className="statistics-coverage" aria-label="Recording coverage">
      {eligibleDays === 0 ? (
        <p>Nothing to count for this month yet.</p>
      ) : (
        <>
          <div className="statistics-coverage__row">
            <strong>{label}</strong>
            {missingDays.length > 0 ? <a href={missingDaysHref(statistics.month, todayMonth)}>{missingDays.length} with no entry</a> : null}
          </div>
          <div className="statistics-coverage__track" role="img" aria-label={label}>
            <span style={{ width: `${percent}%` }} />
          </div>
        </>
      )}
    </section>
  )
}

function StatTile({ value, label, caption }: { value: string | number; label: string; caption: string }) {
  return (
    <div className="statistics-tile">
      <strong className="statistics-tile__value">{value}</strong>
      <span>{label}</span>
      <small>{caption}</small>
    </div>
  )
}

function DoseObservation({ item }: { item: TreatmentDose }) {
  return (
    <li className="statistics-dose">
      <div className="statistics-dose__head">
        <strong>{formatEventDate(item.dose.takenAt)} · {formatEventTime(item.dose.takenAt)}</strong>
        <span>{item.dose.medicineName} {item.dose.doseText}</span>
      </div>
      <div className="statistics-dose__observation">
        <span>
          <b>Before:</b> {item.baseline ? painLabel(item.baseline.pain) : 'No pain recorded before this dose'}
        </span>
        {item.baseline ? (
          <small>{item.baselineAmbiguous ? 'Same recorded time or order unclear' : `${durationLabel(item.baselineAgeMilliseconds ?? 0)} before dose`}</small>
        ) : null}
        <span>
          <b>After:</b> {item.response ? painLabel(item.response.pain) : 'No linked follow-up recorded'}
        </span>
        {item.response ? <small>{durationLabel(item.responseDelayMilliseconds ?? 0)} after dose · {formatEventTime(item.response.measuredAt)}</small> : null}
      </div>
    </li>
  )
}

export function StatisticsPage({ route, facts, now }: StatisticsPageProps) {
  const todayMonth = civilDay(now).slice(0, 7)
  const [month, setMonth] = useState(() => {
    try {
      const requested = route.selectedDay ? Temporal.PlainYearMonth.from(route.selectedDay.slice(0, 7)).toString() : todayMonth
      return requested <= todayMonth ? requested : todayMonth
    } catch {
      return todayMonth
    }
  })
  const statistics = selectStatisticsMonth(facts, month, now)
  const selectedMonth = Temporal.PlainYearMonth.from(month)
  const isCurrentMonth = month === todayMonth
  const missing = statistics.coverage.missingDays.length
  const typical = statistics.typicalLength

  return (
    <AppShell route={route} className="statistics-shell">
      <div className="statistics-page">
        <header className="statistics-month-header">
          <button type="button" aria-label="Previous month" onClick={() => setMonth(selectedMonth.subtract({ months: 1 }).toString())}>
            <Icon name="back" />
          </button>
          <h1>{monthLabel(month)}{isCurrentMonth ? <span> so far</span> : null}</h1>
          <button type="button" aria-label="Next month" disabled={month >= todayMonth} onClick={() => setMonth(selectedMonth.add({ months: 1 }).toString())}>
            <span aria-hidden="true">›</span>
          </button>
        </header>

        <CoverageCard statistics={statistics} todayMonth={todayMonth} />
        <div className="statistics-tiles" aria-label="Monthly summary">
          <StatTile value={statistics.coverage.headacheDays} label="headache days" caption={`of ${statistics.coverage.recordedDays} recorded days`} />
          <StatTile value={statistics.headachesStarted} label="headaches started" caption={`${statistics.ranPastMidnight} ran past midnight`} />
          <StatTile value={statistics.medicationDays} label="medication days" caption={`${statistics.doses} doses in total`} />
          <StatTile
            value={typical.medianMilliseconds === null ? '—' : durationLabel(typical.medianMilliseconds)}
            label="typical length"
            caption={typical.sampleCount === 0 ? 'Not enough entries yet.' : `median of ${typical.sampleCount} finished`}
          />
        </div>
        {typical.excludedOngoing + typical.excludedUnknownEnd > 0 ? (
          <p className="statistics-note">
            Length leaves out {typical.excludedOngoing} ongoing and {typical.excludedUnknownEnd} without an end time.
          </p>
        ) : null}
        {statistics.hasUnknownEnds ? <p className="statistics-note">Dates after an unknown end may still be missing from headache days.</p> : null}

        <section className="statistics-treatment" aria-labelledby="statistics-treatment-heading">
          <h2 id="statistics-treatment-heading">Pain before and after medicine</h2>
          <p>What you recorded, and how long after the dose. It shows what happened, not why.</p>
          {statistics.treatmentRows.length === 0 ? (
            <p className="statistics-treatment__empty">Not enough entries yet. Log a dose to see observations here.</p>
          ) : (
            statistics.treatmentRows.map((row) => (
              <article className="statistics-treatment__row" key={row.episode.id}>
                <div className="statistics-treatment__row-head">
                  <strong>{row.doses.length} {row.doses.length === 1 ? 'dose' : 'doses'} · {civilDay(row.episode.start).slice(0, 7) === month ? 'headache began' : 'carried in from'} {formatEventDate(row.episode.start)}</strong>
                  <a href={routeHref({ kind: 'page', page: 'timeline', tab: 'statistics', episodeId: row.episode.id })} aria-label="View headache timeline">View timeline</a>
                </div>
                <ol>{row.doses.map((item) => <DoseObservation key={item.dose.id} item={item} />)}</ol>
              </article>
            ))
          )}
        </section>
        {missing === 0 && statistics.coverage.eligibleDays > 0 ? <p className="statistics-note">Every eligible day has an entry.</p> : null}
      </div>
    </AppShell>
  )
}

export function TodayMonthSummary({ facts, now }: { facts: DiaryFacts; now: RecordedTime }) {
  const month = civilDay(now).slice(0, 7)
  const summary = selectStatisticsMonth(facts, month, now)
  if (summary.coverage.eligibleDays === 0) return null
  return (
    <section className="today-month-summary" aria-label="This month">
      <h2>This month</h2>
      <div>
        <span><strong>{summary.coverage.headacheDays}</strong> headache days</span>
        <span><strong>{summary.medicationDays}</strong> medication days</span>
      </div>
      <p>
        {summary.coverage.recordedDays} of {summary.coverage.eligibleDays} days recorded
        {summary.coverage.missingDays.length > 0 ? <> · <a href="#history?missing=1">{summary.coverage.missingDays.length} days have no entry</a></> : null}
      </p>
    </section>
  )
}
