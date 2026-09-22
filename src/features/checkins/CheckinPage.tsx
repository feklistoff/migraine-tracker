import { useMemo, useState, type ReactNode } from 'react'
import { Temporal } from '@js-temporal/polyfill'

import { saveDailyRecord } from '../../data/commands'
import { DiaryRepository, ValidationCommandError } from '../../data/repository'
import { classifyDay, dailyRecordForDay, isValidCivilDay } from '../../domain/calendar'
import { civilDay, nowEventTime } from '../../domain/time'
import type { DailyRecord, DiaryFacts, SleepBand } from '../../domain/types'
import { formatCivilDay, formatCivilWeekday } from '../../app/locale'
import { EntryShell } from '../../app/AppShell'
import { routeHref, type AppRoute } from '../../app/Router'

interface CheckinPageProps {
  facts: DiaryFacts
  repository: DiaryRepository
  route: Extract<AppRoute, { kind: 'entry' }> & { page: 'checkin' }
}

interface DayBeforeAnswers {
  alcohol: DailyRecord['alcohol']
  sleep: SleepBand | null
  stress: DailyRecord['stress']
}

const sleepOptions: { value: SleepBand; label: string; range: string }[] = [
  { value: 'not_enough', label: 'Not enough', range: 'less than 7 h' },
  { value: 'fair_amount', label: 'Fair amount', range: '7 to 9 h' },
  { value: 'too_much', label: 'Too much', range: 'more than 9 h' },
]

function errorMessage(error: unknown): string {
  if (error instanceof ValidationCommandError) return error.issues.map((issue) => issue.message).join(' ')
  if (error instanceof Error) return error.message
  return 'The daily record could not be saved. Your answers are still here; try again.'
}

function answersFromRecord(record: DailyRecord | undefined): DayBeforeAnswers {
  return {
    alcohol: record?.alcohol ?? null,
    sleep: record?.sleep ?? null,
    stress: record?.stress ?? null,
  }
}

function answersEqual(one: DayBeforeAnswers, two: DayBeforeAnswers): boolean {
  return one.alcohol === two.alcohol && one.sleep === two.sleep && one.stress === two.stress
}

function dayBeforeContext(day: string): string {
  const previous = Temporal.PlainDate.from(day).subtract({ days: 1 }).toString()
  return `${formatCivilDay(previous)}, and the night into ${formatCivilWeekday(day)}`
}

function ChoiceButton({
  label,
  selected,
  onClick,
  className = '',
  children,
}: {
  label: string
  selected: boolean
  onClick: () => void
  className?: string
  children?: ReactNode
}) {
  return (
    <button
      className={`checkin-choice${selected ? ' checkin-choice--selected' : ''}${className ? ` ${className}` : ''}`}
      type="button"
      aria-pressed={selected}
      onClick={onClick}
    >
      <span>{label}</span>
      {children}
    </button>
  )
}

function BackdatedStatus({
  status,
  day,
  disabled,
  onConfirm,
  onUndo,
}: {
  status: ReturnType<typeof classifyDay>
  day: string
  disabled: boolean
  onConfirm: () => void
  onUndo: () => void
}) {
  if (status === 'headache') {
    return (
      <section className="checkin-status" aria-label="Day status">
        <strong>Headache recorded for {formatCivilDay(day)}.</strong>
        <p>This day cannot also be marked headache-free.</p>
      </section>
    )
  }

  if (status === 'headache-free') {
    return (
      <section className="checkin-status checkin-status--confirmed" aria-label="Day status">
        <strong>No headache recorded for {formatCivilDay(day)}.</strong>
        <button className="text-action" type="button" disabled={disabled} onClick={onUndo}>Undo</button>
      </section>
    )
  }

  return (
    <section className="checkin-status" aria-label="Day status">
      <strong>No entry for {formatCivilDay(day)}.</strong>
      <button className="sage-action" type="button" disabled={disabled} onClick={onConfirm}>No headache</button>
    </section>
  )
}

export function CheckinPage({ facts, repository, route }: CheckinPageProps) {
  const now = nowEventTime(repository.clock)
  const today = civilDay(now)
  const selectedDay = route.selectedDay && isValidCivilDay(route.selectedDay) ? route.selectedDay : undefined
  const targetDay = selectedDay ?? today
  const existingRecord = useMemo(() => dailyRecordForDay(facts, targetDay), [facts, targetDay])
  const initialAnswers = useMemo(() => answersFromRecord(existingRecord), [existingRecord])
  const [answers, setAnswers] = useState<DayBeforeAnswers>(initialAnswers)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const backHref = routeHref({
    kind: 'tab',
    tab: route.tab,
    ...(selectedDay ? { selectedDay } : {}),
  })
  const backLabel = route.tab === 'history' ? 'Back to History' : 'Back to Today'
  const isToday = targetDay === today
  const isFuture = Temporal.PlainDate.compare(Temporal.PlainDate.from(targetDay), Temporal.PlainDate.from(today)) > 0
  const status = classifyDay(facts, targetDay, now)
  const dirty = !answersEqual(answers, initialAnswers)

  const writeRecord = async (headacheFreeAt: DailyRecord['headacheFreeAt'], returnAfterSave: boolean) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await saveDailyRecord(
        repository,
        {
          day: targetDay,
          headacheFreeAt,
          ...answers,
        },
        { expectedRevision: facts.metadata.revision },
      )
      if (returnAfterSave) window.location.hash = backHref
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  const saveAnswers = () => writeRecord(existingRecord?.headacheFreeAt ?? null, true)
  const confirmBackdated = () => writeRecord(now, false)
  const undoBackdated = () => writeRecord(null, false)

  return (
    <EntryShell
      title="Yesterday & last night"
      backHref={backHref}
      backLabel={backLabel}
      actionLabel="Save"
      footerNote={`Kept with ${formatCivilDay(targetDay)} for later statistics.`}
      dirty={dirty}
      onAction={saveAnswers}
      actionBusy={busy}
      actionError={error}
    >
      <div className="form-stack checkin-page">
        <p className="checkin-context">{dayBeforeContext(targetDay)}</p>

        {!isToday ? (
          <BackdatedStatus
            status={status}
            day={targetDay}
            disabled={busy || isFuture}
            onConfirm={confirmBackdated}
            onUndo={undoBackdated}
          />
        ) : null}

        <section className="checkin-question" aria-labelledby="alcohol-heading">
          <h2 id="alcohol-heading">Did you drink alcohol yesterday?</h2>
          <div className="checkin-options checkin-options--two">
            <ChoiceButton label="Yes" selected={answers.alcohol === true} onClick={() => setAnswers((current) => ({ ...current, alcohol: current.alcohol === true ? null : true }))} />
            <ChoiceButton label="No" selected={answers.alcohol === false} onClick={() => setAnswers((current) => ({ ...current, alcohol: current.alcohol === false ? null : false }))} />
          </div>
        </section>

        <section className="checkin-question" aria-labelledby="sleep-heading">
          <h2 id="sleep-heading">How much did you sleep last night?</h2>
          <div className="checkin-options checkin-options--three">
            {sleepOptions.map((option) => (
              <ChoiceButton
                key={option.value}
                label={option.label}
                selected={answers.sleep === option.value}
                className="checkin-choice--stacked"
                onClick={() => setAnswers((current) => ({ ...current, sleep: current.sleep === option.value ? null : option.value }))}
              >
                <small>{option.range}</small>
              </ChoiceButton>
            ))}
          </div>
        </section>

        <section className="checkin-question" aria-labelledby="stress-heading">
          <div>
            <h2 id="stress-heading">Was yesterday stressful?</h2>
            <p>For example, overwork.</p>
          </div>
          <div className="checkin-options checkin-options--two">
            <ChoiceButton label="Yes" selected={answers.stress === true} onClick={() => setAnswers((current) => ({ ...current, stress: current.stress === true ? null : true }))} />
            <ChoiceButton label="No" selected={answers.stress === false} onClick={() => setAnswers((current) => ({ ...current, stress: current.stress === false ? null : false }))} />
          </div>
        </section>

        <p className="checkin-hint">Skip anything you’re unsure of. It stays unrecorded — never counted as a no. Tap a chosen answer again to clear it.</p>
        {isFuture ? <p className="form-error" role="alert">Future days cannot be recorded yet.</p> : null}
      </div>
    </EntryShell>
  )
}
