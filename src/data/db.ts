import Dexie, { type Table } from 'dexie'

import type { Clock } from '../domain/time'
import { systemClock } from '../domain/time'
import type {
  DailyRecord,
  Dose,
  Episode,
  Reading,
  SavedMedicine,
} from '../domain/types'
import {
  DIARY_SCHEMA_VERSION,
  DIARY_STORE_SCHEMAS,
  migrateCurrentSchema,
  SINGLETON_KEY,
  type MetadataRow,
  type MigrationOptions,
  type SettingsRow,
} from './migrations'

export const DIARY_DATABASE_NAME = 'headache-diary'

export interface DiaryDatabaseOptions extends MigrationOptions {
  name?: string
  clock?: Clock
}

export class DiaryDatabase extends Dexie {
  metadata!: Table<MetadataRow, string>
  settings!: Table<SettingsRow, string>
  episodes!: Table<Episode, string>
  readings!: Table<Reading, string>
  doses!: Table<Dose, string>
  medicines!: Table<SavedMedicine, string>
  dailyRecords!: Table<DailyRecord, string>

  readonly clock: Clock
  readonly migrationOptions: MigrationOptions

  constructor(options: DiaryDatabaseOptions = {}) {
    super(options.name ?? DIARY_DATABASE_NAME)
    this.clock = options.clock ?? systemClock()
    this.migrationOptions = { onMigration: options.onMigration }

    this.version(DIARY_SCHEMA_VERSION).stores(DIARY_STORE_SCHEMAS)
  }
}

export function createDiaryDatabase(options: DiaryDatabaseOptions = {}): DiaryDatabase {
  return new DiaryDatabase(options)
}

export async function openDiaryDatabase(options: DiaryDatabaseOptions = {}): Promise<DiaryDatabase> {
  const database = createDiaryDatabase(options)
  const blocked = new Promise<never>((_, reject) => {
    database.on('blocked', () => reject(new Error('A diary database upgrade is blocked. Close other diary tabs or app windows, then try again. Your records have not been reset.')))
  })

  try {
    await Promise.race([database.open(), blocked])
    // Dexie stores its decimal version API as a native IndexedDB integer ten
    // times larger than the declared version.
    const nativeVersion = database.backendDB().version / 10
    if (nativeVersion > DIARY_SCHEMA_VERSION) {
      throw new Error(
        `This diary was created by a newer app version (schema ${nativeVersion}). Update the app before opening it.`,
      )
    }
    await database.transaction(
      'rw',
      [database.metadata, database.settings],
      (transaction) => migrateCurrentSchema(transaction, database.clock, database.migrationOptions),
    )
    return database
  } catch (error) {
    database.close()
    throw error instanceof Error ? error : new Error('The diary database could not be opened.')
  }
}

export async function deleteDiaryDatabase(name = DIARY_DATABASE_NAME): Promise<void> {
  await Dexie.delete(name)
}

export { DIARY_SCHEMA_VERSION, SINGLETON_KEY }
