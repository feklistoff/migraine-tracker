import type { Transaction } from 'dexie'

import type { Clock } from '../domain/time'
import type { DiaryMetadata, Settings } from '../domain/types'

export const DIARY_SCHEMA_VERSION = 2
export const SINGLETON_KEY = 'singleton'

export interface SingletonRow<T> {
  key: typeof SINGLETON_KEY
  value: T
}

export type MetadataRow = SingletonRow<DiaryMetadata>
export type SettingsRow = SingletonRow<Settings>

export const DIARY_STORE_SCHEMAS = {
  metadata: '&key',
  settings: '&key',
  episodes: 'id,state,start.instant,end.instant',
  readings: 'id,episodeId,measuredAt.instant,linkedDoseId',
  doses: 'id,episodeId,takenAt.instant,savedMedicineId',
  medicines: 'id,archived,name',
  dailyRecords: 'day,headacheFreeAt.instant,sleep',
} as const

export interface MigrationContext {
  version: number
}

export interface MigrationOptions {
  onMigration?: (context: MigrationContext) => void
}

function auditFields(clock: Clock) {
  const timestamp = clock.now().toString()
  return { createdAt: timestamp, updatedAt: timestamp }
}

export function initialMetadata(clock: Clock): DiaryMetadata {
  return {
    ...auditFields(clock),
    schemaVersion: DIARY_SCHEMA_VERSION,
    revision: 0,
    timeZonePolicy: 'event-local',
    lastExportGeneratedAt: null,
  }
}

export function initialSettings(clock: Clock): Settings {
  return {
    ...auditFields(clock),
    painEntryDefault: 'numeric',
    followUpEnabled: true,
    followUpIntervalMinutes: 120,
    defaultMedicineId: null,
  }
}

/**
 * Populate the two singleton stores in the same transaction that opens the
 * database. Using put rather than add also makes this safe for a future
 * migration that needs to backfill one missing singleton.
 */
export async function migrateCurrentSchema(
  transaction: Transaction,
  clock: Clock,
  options: MigrationOptions = {},
): Promise<void> {
  const metadata = transaction.table<MetadataRow>('metadata')
  const settings = transaction.table<SettingsRow>('settings')
  const [existingMetadata, existingSettings] = await Promise.all([
    metadata.get(SINGLETON_KEY),
    settings.get(SINGLETON_KEY),
  ])

  const needsMigration =
    !existingMetadata ||
    !existingSettings ||
    existingMetadata.value.schemaVersion < DIARY_SCHEMA_VERSION
  if (needsMigration) options.onMigration?.({ version: DIARY_SCHEMA_VERSION })

  if (!existingMetadata) {
    await metadata.put({ key: SINGLETON_KEY, value: initialMetadata(clock) })
  } else if (existingMetadata.value.schemaVersion < DIARY_SCHEMA_VERSION) {
    await metadata.put({
      key: SINGLETON_KEY,
      value: {
        ...existingMetadata.value,
        schemaVersion: DIARY_SCHEMA_VERSION,
        updatedAt: clock.now().toString(),
      },
    })
  }
  if (!existingSettings) {
    await settings.put({ key: SINGLETON_KEY, value: initialSettings(clock) })
  }
}
