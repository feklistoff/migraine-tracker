import { useState } from 'react'

import { dateTimeInputValue, resolveCivilDateTime, type CivilTimeOccurrence } from '../../domain/time'
import type { RecordedTime } from '../../domain/types'
import { DateTimeWheel, formatPickerTime } from '../../components/DateTimeWheel'

interface OccurrenceOption {
  occurrence: CivilTimeOccurrence
  offset: string
}

export function useEventTimeInput(initial: RecordedTime | null, timeZone: string) {
  const initialValue = initial ? dateTimeInputValue(initial) : ''
  const [value, setValue] = useState(initialValue)
  const [occurrence, setOccurrence] = useState<CivilTimeOccurrence | undefined>()
  const [occurrenceOptions, setOccurrenceOptions] = useState<OccurrenceOption[]>([])
  const [error, setError] = useState<string | null>(null)

  const updateValue = (nextValue: string) => {
    setValue(nextValue)
    setOccurrence(undefined)
    setOccurrenceOptions([])
    setError(null)
  }

  const resolve = (): RecordedTime | null => {
    if (initial && value === initialValue) {
      setError(null)
      return initial
    }
    if (value.trim() === '') {
      setError('Choose a date and time.')
      setOccurrenceOptions([])
      return null
    }

    const [date, time] = value.split('T')
    const input = { date: date ?? '', time: time ?? '', timeZone }
    const result = resolveCivilDateTime({ ...input, ...(occurrence ? { occurrence } : {}) })
    if (!result.ok) {
      setError(result.message)
      if (result.code === 'ambiguous') {
        setOccurrenceOptions(
          (['first', 'second'] as const).flatMap((choice) => {
            const resolved = resolveCivilDateTime({ ...input, occurrence: choice })
            return resolved.ok ? [{ occurrence: choice, offset: resolved.time.offset }] : []
          }),
        )
      } else {
        setOccurrenceOptions([])
      }
      return null
    }

    setError(null)
    return result.time
  }

  return {
    value,
    setValue: updateValue,
    occurrence,
    occurrenceOptions,
    chooseOccurrence: (choice: CivilTimeOccurrence) => {
      setOccurrence(choice)
      setError(null)
    },
    resolve,
    error,
    isDirty: value !== initialValue,
  }
}

export function EventTimeField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  disabled,
  error,
  occurrence,
  occurrenceOptions,
  onChooseOccurrence,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  disabled?: boolean
  error?: string | null
  occurrence?: CivilTimeOccurrence
  occurrenceOptions?: readonly OccurrenceOption[]
  onChooseOccurrence?: (choice: CivilTimeOccurrence) => void
  hint?: string
}) {
  const [picking, setPicking] = useState(false)
  return (
    <>
      <div className="field-label">
        <span id={`${id}-label`}>{label}</span>
        <button id={id} className="date-time-field" type="button" aria-labelledby={`${id}-label`} aria-haspopup="dialog" disabled={disabled} onClick={() => setPicking(true)}>
          {formatPickerTime(value)}
        </button>
      </div>
      {picking ? <DateTimeWheel label={label} value={value} min={min} max={max} onDone={(next) => { onChange(next); setPicking(false) }} onCancel={() => setPicking(false)} /> : null}
      {hint ? <p className="field-hint">{hint}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {occurrenceOptions && occurrenceOptions.length > 0 ? (
        <div className="time-occurrence" role="group" aria-label="Repeated local time occurrence">
          <p className="field-hint">This local time occurs twice. Choose the time that matches your clock.</p>
          {occurrenceOptions.map((option) => (
            <button
              key={option.occurrence}
              className={`activity-option${occurrence === option.occurrence ? ' activity-option--selected' : ''}`}
              type="button"
              aria-pressed={occurrence === option.occurrence}
              onClick={() => onChooseOccurrence?.(option.occurrence)}
            >
              <span className="activity-option__radio" aria-hidden="true"><span /></span>
              <span><strong>{option.occurrence === 'first' ? 'First occurrence' : 'Second occurrence'}</strong><small>UTC{option.offset}</small></span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  )
}
