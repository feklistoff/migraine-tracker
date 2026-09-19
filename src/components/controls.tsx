import type { Impact, Pain } from '../domain/types'

export interface PainSelectorProps {
  mode: 'numeric' | 'verbal'
  value: Pain | null
  onChange: (value: Pain) => void
}

const verbalOptions = [
  { value: 'none', label: 'No pain', range: '0' },
  { value: 'mild', label: 'Mild', range: '1 to 3' },
  { value: 'moderate', label: 'Moderate', range: '4 to 6' },
  { value: 'severe', label: 'Severe', range: '7 to 10' },
] as const

export function PainSelector({ mode, value, onChange }: PainSelectorProps) {
  if (mode === 'verbal') {
    return (
      <div className="pain-selector pain-selector--words" role="group" aria-label="Pain scale">
        {verbalOptions.map((option) => {
          const selected = value?.kind === 'verbal' && value.value === option.value
          return (
            <button
              key={option.value}
              className={`choice-card${selected ? ' choice-card--selected' : ''}`}
              type="button"
              aria-label={`${option.label}, ${option.range}`}
              aria-pressed={selected}
              onClick={() => onChange({ kind: 'verbal', value: option.value })}
            >
              <span>{option.label}</span>
              <small>{option.range}</small>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="pain-selector pain-selector--numbers" role="group" aria-label="Pain scale">
      {Array.from({ length: 11 }, (_, number) => {
        const selected = value?.kind === 'numeric' && value.value === number
        return (
          <button
            key={number}
            className={`choice-card${selected ? ' choice-card--selected' : ''}`}
            type="button"
            aria-label={`Pain ${number} of 10`}
            aria-pressed={selected}
            onClick={() => onChange({ kind: 'numeric', value: number })}
          >
            {number}
          </button>
        )
      })}
    </div>
  )
}

const impactOptions: { value: Impact; label: string; description: string }[] = [
  { value: 'normal', label: 'Normal activities', description: 'Carrying on as usual' },
  { value: 'slowed', label: 'Slowed down', description: 'Doing less, or more slowly' },
  { value: 'stopped', label: 'Had to stop', description: 'Needed to rest or lie down' },
]

export interface ActivitySelectorProps {
  value: Impact | null
  onChange: (value: Impact | null) => void
}

export function ActivitySelector({ value, onChange }: ActivitySelectorProps) {
  return (
    <div className="activity-selector" role="group" aria-label="Activity impact">
      {impactOptions.map((option) => {
        const selected = value === option.value
        return (
            <button
              key={option.value}
              className={`activity-option${selected ? ' activity-option--selected' : ''}`}
              type="button"
              aria-label={option.label}
              aria-pressed={selected}
            onClick={() => onChange(selected ? null : option.value)}
          >
            <span className="activity-option__radio" aria-hidden="true">
              <span />
            </span>
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </button>
        )
      })}
    </div>
  )
}
