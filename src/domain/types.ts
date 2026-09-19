/**
 * Canonical persisted domain shapes.
 *
 * User-facing event times keep the instant and the context that resolved it.
 * Audit timestamps are operational instants; they are not used for civil-day
 * attribution.
 */

export type InstantString = string
export type CivilDay = string

export interface RecordedTime {
  instant: InstantString
  timeZone: string
  offset: string
}

export interface AuditFields {
  createdAt: InstantString
  updatedAt: InstantString
}

export type EpisodeState = 'ongoing' | 'ended' | 'end_unknown'

export type NumericPain = {
  kind: 'numeric'
  value: number
}

export type VerbalPain = {
  kind: 'verbal'
  value: 'none' | 'mild' | 'moderate' | 'severe'
}

export type Pain = NumericPain | VerbalPain
export type Impact = 'normal' | 'slowed' | 'stopped'

export interface Episode extends AuditFields {
  id: string
  start: RecordedTime
  state: EpisodeState
  end: RecordedTime | null
  note: string | null
}

export interface Reading extends AuditFields {
  id: string
  episodeId: string
  measuredAt: RecordedTime
  pain: Pain | null
  impact: Impact | null
  note: string | null
  linkedDoseId: string | null
  /** True only for the explicit initial reading that is anchored to onset. */
  atOnset: boolean
}

export interface Dose extends AuditFields {
  id: string
  episodeId: string
  takenAt: RecordedTime
  savedMedicineId: string | null
  medicineName: string
  doseText: string
  followUpEnabled: boolean
  followUpIntervalMinutes: 30 | 60 | 90 | 120
}

export interface SavedMedicine extends AuditFields {
  id: string
  name: string
  doseText: string
  archived: boolean
}

export type SleepBand = 'not_enough' | 'fair_amount' | 'too_much'

export interface DailyRecord extends AuditFields {
  day: CivilDay
  headacheFreeAt: RecordedTime | null
  alcohol: boolean | null
  sleep: SleepBand | null
  stress: boolean | null
}

export interface Settings extends AuditFields {
  painEntryDefault: 'numeric' | 'verbal'
  followUpEnabled: boolean
  followUpIntervalMinutes: 30 | 60 | 90 | 120
  defaultMedicineId: string | null
}

export interface DiaryMetadata extends AuditFields {
  schemaVersion: number
  revision: number
  timeZonePolicy: 'event-local'
  lastExportGeneratedAt: InstantString | null
}

export interface DiaryFacts {
  metadata: DiaryMetadata
  settings: Settings
  episodes: Episode[]
  readings: Reading[]
  doses: Dose[]
  medicines: SavedMedicine[]
  dailyRecords: DailyRecord[]
}
