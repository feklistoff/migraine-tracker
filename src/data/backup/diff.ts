import type { DiaryFacts } from '../../domain/types'
import { dateTimeInputValue } from '../../domain/time'

export type BackupCollection = 'headaches' | 'readings' | 'doses' | 'medicines' | 'days'
export interface ChangedRecord { collection: BackupCollection; id: string; label: string }
export interface CollectionDifference {
  added: ChangedRecord[]
  removed: ChangedRecord[]
  changed: ChangedRecord[]
}
export interface BackupDifference {
  records: CollectionDifference
  settingsChanged: boolean
  identical: boolean
}

export interface BackupCounts {
  headaches: number
  readings: number
  doses: number
  medicines: number
  days: number
}

export function backupCounts(facts: DiaryFacts): BackupCounts {
  return {
    headaches: facts.episodes.length,
    readings: facts.readings.length,
    doses: facts.doses.length,
    medicines: facts.medicines.length,
    days: facts.dailyRecords.length,
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([one], [two]) => one.localeCompare(two)))
      : item,
  )
}

function recordLabel(collection: BackupCollection, id: string, record: Record<string, unknown>): string {
  if (collection === 'days') return `day ${id}`
  if (collection === 'medicines') return `medicine “${record.name}”`
  const time = record[collection === 'headaches' ? 'start' : collection === 'readings' ? 'measuredAt' : 'takenAt']
  if (typeof time !== 'object' || time === null) return `${collection.slice(0, -1)} ${id}`
  const local = dateTimeInputValue(time as { instant: string; timeZone: string; offset: string }).replace('T', ' ')
  if (collection === 'doses') return `dose “${record.medicineName}” on ${local}`
  return `${collection.slice(0, -1)} ${local}`
}

export function compareBackupFacts(current: DiaryFacts, incoming: DiaryFacts): BackupDifference {
  const records: CollectionDifference = { added: [], removed: [], changed: [] }
  const collections = [
    { name: 'headaches', items: current.episodes, next: incoming.episodes, key: 'id' },
    { name: 'readings', items: current.readings, next: incoming.readings, key: 'id' },
    { name: 'doses', items: current.doses, next: incoming.doses, key: 'id' },
    { name: 'medicines', items: current.medicines, next: incoming.medicines, key: 'id' },
    { name: 'days', items: current.dailyRecords, next: incoming.dailyRecords, key: 'day' },
  ] as const

  for (const collection of collections) {
    const oldRecords = collection.items as unknown as readonly Record<string, unknown>[]
    const newRecords = collection.next as unknown as readonly Record<string, unknown>[]
    const oldById = new Map(oldRecords.map((record) => [String(record[collection.key]), record]))
    const newById = new Map(newRecords.map((record) => [String(record[collection.key]), record]))
    const identify = (id: string, record: Record<string, unknown>): ChangedRecord => ({
      collection: collection.name,
      id,
      label: recordLabel(collection.name, id, record),
    })
    for (const [id, record] of oldById) {
      const other = newById.get(id)
      if (!other) records.removed.push(identify(id, record))
      else if (stableJson(record) !== stableJson(other)) records.changed.push(identify(id, record))
    }
    for (const [id, record] of newById) {
      if (!oldById.has(id)) records.added.push(identify(id, record))
    }
  }
  const settingsChanged = stableJson({ ...current.settings, createdAt: undefined, updatedAt: undefined }) !==
    stableJson({ ...incoming.settings, createdAt: undefined, updatedAt: undefined })
  return {
    records,
    settingsChanged,
    identical: records.added.length === 0 && records.removed.length === 0 && records.changed.length === 0 && !settingsChanged,
  }
}
