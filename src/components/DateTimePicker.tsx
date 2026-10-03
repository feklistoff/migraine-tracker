import { Temporal } from '@js-temporal/polyfill'
import { useId, useLayoutEffect, useRef, useState } from 'react'

import { deviceLocale, firstDayOfWeek, weekdayLabels } from '../app/locale'

const pad = (number: number) => String(number).padStart(2, '0')

function parse(value: string) {
  try { return Temporal.PlainDateTime.from(value) } catch { return null }
}

function normalizeTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim()) ?? /^(\d{2})(\d{2})$/.exec(value.trim())
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null
  return `${pad(Number(match[1]))}:${pad(Number(match[2]))}`
}

export function formatPickerTime(value: string): string {
  const date = parse(value)
  if (!date) return 'Choose date and time'
  // Format civil fields without converting them through the device timezone.
  return new Intl.DateTimeFormat(deviceLocale(), {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day, date.hour, date.minute)))
}

export function DateTimePicker({ label, value, min, max, onDone, onCancel }: {
  label: string
  value: string
  min?: string
  max?: string
  onDone: (value: string) => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const timeId = useId()
  const [initial] = useState(() => {
    const date = parse(value) ?? parse(max ?? '') ?? Temporal.Now.plainDateTimeISO()
    const minimum = parse(min ?? '')
    const maximum = parse(max ?? '')
    if (minimum && Temporal.PlainDateTime.compare(date, minimum) < 0) return minimum
    if (maximum && Temporal.PlainDateTime.compare(date, maximum) > 0) return maximum
    return date
  })
  const [date, setDate] = useState(initial.toPlainDate().toString())
  const [month, setMonth] = useState(initial.toPlainDate().toPlainYearMonth())
  const [time, setTime] = useState(`${pad(initial.hour)}:${pad(initial.minute)}`)
  const normalizedTime = normalizeTime(time)
  const serialized = normalizedTime ? `${date}T${normalizedTime}` : ''
  const error = !normalizedTime ? 'Enter a valid time, for example 09:30 or 0930.'
    : min && serialized < min ? 'Choose a time on or after the earliest allowed time.'
    : max && serialized > max ? 'Choose a time on or before the latest allowed time.' : null
  const locale = deviceLocale()
  const first = month.toPlainDate({ day: 1 })
  const leading = (first.dayOfWeek - firstDayOfWeek(locale) + 7) % 7
  const days = Array.from({ length: month.daysInMonth }, (_, index) => first.with({ day: index + 1 }))
  const utcDate = (day: Temporal.PlainDate) => new Date(Date.UTC(day.year, day.month - 1, day.day, 12))
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(utcDate(first))
  const dayFormatter = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  const previous = month.subtract({ months: 1 })
  const next = month.add({ months: 1 })
  const minimumDate = min?.slice(0, 10)
  const maximumDate = max?.slice(0, 10)

  useLayoutEffect(() => {
    const dialog = dialogRef.current!
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true })
    return () => dialog.close()
  }, [])

  const cancel = () => {
    // Close while attached so the native dialog restores trigger focus.
    dialogRef.current?.close()
    onCancel()
  }
  const done = () => {
    if (error) return
    dialogRef.current?.close()
    onDone(serialized)
  }

  return (
    <dialog ref={dialogRef} className="date-time-dialog" aria-label={label} onCancel={(event) => { event.preventDefault(); cancel() }}>
      <div className="date-time-dialog-header">
        <button className="text-action" type="button" onClick={cancel}>Cancel</button>
        <h2>{label}</h2>
        <button className="text-action" type="button" onClick={done} disabled={!!error}>Done</button>
      </div>
      <p className="date-time-preview" aria-live="polite">{normalizedTime ? formatPickerTime(serialized) : 'Choose date and time'}</p>
      <div className="date-calendar-header">
        <button className="text-action" type="button" aria-label="Previous month" disabled={!!minimumDate && previous.toPlainDate({ day: previous.daysInMonth }).toString() < minimumDate} onClick={() => setMonth(previous)}>‹</button>
        <h3 aria-live="polite">{monthLabel}</h3>
        <button className="text-action" type="button" aria-label="Next month" disabled={!!maximumDate && next.toPlainDate({ day: 1 }).toString() > maximumDate} onClick={() => setMonth(next)}>›</button>
      </div>
      <div className="date-calendar" role="group" aria-label="Calendar days" data-month={month.toString()}>
        {weekdayLabels(locale).map((weekday) => <span className="date-calendar-weekday" key={weekday} title={weekday} aria-hidden="true">{weekday.slice(0, 2)}</span>)}
        {Array.from({ length: leading }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
        {days.map((day) => {
          const civilDate = day.toString()
          return <button
            key={civilDate}
            type="button"
            className="date-calendar-day"
            aria-label={dayFormatter.format(utcDate(day))}
            aria-pressed={civilDate === date}
            disabled={(!!minimumDate && civilDate < minimumDate) || (!!maximumDate && civilDate > maximumDate)}
            onClick={() => setDate(civilDate)}
          >{day.day}</button>
        })}
      </div>
      <label className="field-label date-time-input" htmlFor={timeId}>
        <span>Time</span>
        <input id={timeId} type="text" inputMode="numeric" autoComplete="off" spellCheck={false} placeholder="HH:mm" value={time} aria-invalid={!!error} aria-describedby={`${timeId}-hint${error ? ` ${timeId}-error` : ''}`} onChange={(event) => setTime(event.target.value)} onBlur={() => { if (normalizedTime) setTime(normalizedTime) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); done() } }} />
      </label>
      <p id={`${timeId}-hint`} className="field-hint">24-hour time, e.g. 09:30 or 0930.</p>
      {error ? <p id={`${timeId}-error`} className="form-error" role="alert">{error}</p> : null}
    </dialog>
  )
}
