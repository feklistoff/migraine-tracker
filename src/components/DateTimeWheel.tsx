import { Temporal } from '@js-temporal/polyfill'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

import { deviceLocale } from '../app/locale'

const ROW_HEIGHT = 44
const pad = (number: number) => String(number).padStart(2, '0')

function parse(value: string) {
  try { return Temporal.PlainDateTime.from(value) } catch { return null }
}

export function formatPickerTime(value: string): string {
  const date = parse(value)
  if (!date) return 'Choose date and time'
  // Format civil fields without converting them through the device timezone.
  return new Intl.DateTimeFormat(deviceLocale(), {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day, date.hour, date.minute)))
}

function Wheel({ label, values, value, onChange, format = String }: {
  label: string
  values: readonly number[]
  value: number
  onChange: (value: number) => void
  format?: (value: number) => string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const index = values.indexOf(value)
  useEffect(() => {
    const element = ref.current
    // Do not interrupt touch momentum when a scroll just updated the value.
    if (element && Math.round(element.scrollTop / ROW_HEIGHT) !== index) {
      element.scrollTop = index * ROW_HEIGHT
    }
  }, [index])

  const keyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }
    let next = index
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = values.length - 1
    else if (event.key in moves) next += moves[event.key]!
    else return
    event.preventDefault()
    onChange(values[Math.max(0, Math.min(values.length - 1, next))]!)
  }

  return (
    <div className="date-wheel-column">
      <span className="date-wheel-label" aria-hidden="true">{label}</span>
      <div
        ref={ref}
        className="date-wheel"
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={values[0]}
        aria-valuemax={values.at(-1)}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        onKeyDown={keyDown}
        onScroll={(event) => {
          const next = Math.max(0, Math.min(values.length - 1, Math.round(event.currentTarget.scrollTop / ROW_HEIGHT)))
          if (values[next] !== value) onChange(values[next]!)
        }}
      >
        {values.map((option) => (
          <div
            className={`date-wheel-option${option === value ? ' date-wheel-option--selected' : ''}`}
            key={option}
            data-value={option}
            aria-hidden="true"
            onClick={() => onChange(option)}
          >{format(option)}</div>
        ))}
      </div>
    </div>
  )
}

const range = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, i) => start + i)
const months = range(1, 12)
const hours = range(0, 23)
const minutes = range(0, 59)

export function DateTimeWheel({ label, value, min, max, onDone, onCancel }: {
  label: string
  value: string
  min?: string
  max?: string
  onDone: (value: string) => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(() => {
    const initial = parse(value) ?? parse(max ?? '') ?? Temporal.Now.plainDateTimeISO()
    const minimum = parse(min ?? '')
    const maximum = parse(max ?? '')
    if (minimum && Temporal.PlainDateTime.compare(initial, minimum) < 0) return minimum
    if (maximum && Temporal.PlainDateTime.compare(initial, maximum) > 0) return maximum
    return initial
  })
  const monthFormatter = new Intl.DateTimeFormat(deviceLocale(), { month: 'short', timeZone: 'UTC' })
  const formatMonth = (month: number) => monthFormatter.format(new Date(Date.UTC(2000, month - 1, 1)))
  const years = range(Math.min(1900, draft.year, parse(value)?.year ?? 1900), Math.max(new Date().getFullYear() + 1, draft.year, parse(max ?? '')?.year ?? 0))
  const serialized = `${draft.toPlainDate().toString()}T${pad(draft.hour)}:${pad(draft.minute)}`
  const boundsError = min && serialized < min ? 'Choose a time on or after the earliest allowed time.'
    : max && serialized > max ? 'Choose a time on or before the latest allowed time.' : null

  useLayoutEffect(() => {
    const dialog = dialogRef.current!
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[role="spinbutton"]')?.focus({ preventScroll: true })
    return () => dialog.close()
  }, [])

  const update = (field: 'year' | 'month' | 'day' | 'hour' | 'minute', next: number) => {
    setDraft((current) => current.with({ [field]: next }, { overflow: 'constrain' }))
  }
  const cancel = () => {
    // Close while still attached so the native dialog restores trigger focus.
    dialogRef.current?.close()
    onCancel()
  }
  const done = () => {
    dialogRef.current?.close()
    onDone(serialized)
  }

  return (
    <dialog ref={dialogRef} className="date-time-dialog" aria-label={label} onCancel={(event) => { event.preventDefault(); cancel() }}>
      <div className="date-time-dialog-header">
        <button className="text-action" type="button" onClick={cancel}>Cancel</button>
        <h2>{label}</h2>
        <button className="text-action" type="button" onClick={done} disabled={!!boundsError}>Done</button>
      </div>
      <p className="date-time-preview" aria-live="polite">{formatPickerTime(serialized)}</p>
      <p className="field-hint date-time-help">Scroll each wheel to choose. Hours use a 24-hour clock.</p>
      <div className="date-time-wheels">
        <Wheel label="Day" values={range(1, draft.daysInMonth)} value={draft.day} onChange={(next) => update('day', next)} />
        <Wheel label="Month" values={months} value={draft.month} onChange={(next) => update('month', next)} format={formatMonth} />
        <Wheel label="Year" values={years} value={draft.year} onChange={(next) => update('year', next)} />
        <Wheel label="Hour" values={hours} value={draft.hour} onChange={(next) => update('hour', next)} format={pad} />
        <Wheel label="Minute" values={minutes} value={draft.minute} onChange={(next) => update('minute', next)} format={pad} />
      </div>
      {boundsError ? <p className="form-error" role="alert">{boundsError}</p> : null}
    </dialog>
  )
}
