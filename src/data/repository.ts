import type { Table } from 'dexie'

import type { Clock } from '../domain/time'
import { systemClock } from '../domain/time'
import type {
  DailyRecord,
  DiaryFacts,
  Dose,
  Episode,
  Reading,
  SavedMedicine,
} from '../domain/types'
import {
  createDiaryDatabase,
  openDiaryDatabase,
  type DiaryDatabase,
  type DiaryDatabaseOptions,
} from './db'
import { SINGLETON_KEY, type MetadataRow, type SettingsRow } from './migrations'

export type RepositoryStatus = 'idle' | 'loading' | 'ready' | 'error' | 'closed'

export interface RepositorySnapshot {
  status: RepositoryStatus
  facts?: DiaryFacts
  error?: Error
}

export type RepositoryListener = (snapshot: RepositorySnapshot) => void

export interface WriteFaultInfo {
  operation: string
  step: 'before-revision' | 'after-revision'
}

export interface DiaryRepositoryOptions {
  database?: DiaryDatabase
  databaseName?: string
  clock?: Clock
  onMigration?: DiaryDatabaseOptions['onMigration']
  readFault?: () => void
  writeFault?: (info: WriteFaultInfo) => void
}

export class PersistenceError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PersistenceError'
    this.code = code
  }
}

export class StaleRevisionError extends PersistenceError {
  readonly expectedRevision: number
  readonly actualRevision: number

  constructor(expectedRevision: number, actualRevision: number) {
    super(
      'stale-revision',
      `This diary changed from revision ${expectedRevision} to ${actualRevision}; review the latest data before saving.`,
    )
    this.name = 'StaleRevisionError'
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
  }
}

export class ValidationCommandError extends PersistenceError {
  readonly issues: readonly { code: string; path: string; message: string }[]

  constructor(issues: readonly { code: string; path: string; message: string }[]) {
    super('validation-failed', issues.map((item) => item.message).join(' '))
    this.name = 'ValidationCommandError'
    this.issues = issues
  }
}

export class MissingRecordError extends PersistenceError {
  constructor(kind: string, id: string) {
    super('missing-record', `The ${kind} ${id} no longer exists.`)
    this.name = 'MissingRecordError'
  }
}

export class UndoExpiredError extends PersistenceError {
  constructor() {
    super('undo-expired', 'Undo is no longer available for this ended headache.')
    this.name = 'UndoExpiredError'
  }
}

export interface DiaryTables {
  metadata: Table<MetadataRow, string>
  settings: Table<SettingsRow, string>
  episodes: Table<Episode, string>
  readings: Table<Reading, string>
  doses: Table<Dose, string>
  medicines: Table<SavedMedicine, string>
  dailyRecords: Table<DailyRecord, string>
}

export function diaryTables(database: DiaryDatabase): DiaryTables {
  return {
    metadata: database.metadata,
    settings: database.settings,
    episodes: database.episodes,
    readings: database.readings,
    doses: database.doses,
    medicines: database.medicines,
    dailyRecords: database.dailyRecords,
  }
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function sortFacts(facts: DiaryFacts): DiaryFacts {
  return {
    ...facts,
    episodes: [...facts.episodes].sort((one, two) => one.id.localeCompare(two.id)),
    readings: [...facts.readings].sort((one, two) => one.id.localeCompare(two.id)),
    doses: [...facts.doses].sort((one, two) => one.id.localeCompare(two.id)),
    medicines: [...facts.medicines].sort((one, two) => one.id.localeCompare(two.id)),
    dailyRecords: [...facts.dailyRecords].sort((one, two) => one.day.localeCompare(two.day)),
  }
}

export async function readFactsFromTables(tables: DiaryTables): Promise<DiaryFacts> {
  const [metadataRow, settingsRow, episodes, readings, doses, medicines, dailyRecords] = await Promise.all([
    tables.metadata.get(SINGLETON_KEY),
    tables.settings.get(SINGLETON_KEY),
    tables.episodes.toArray(),
    tables.readings.toArray(),
    tables.doses.toArray(),
    tables.medicines.toArray(),
    tables.dailyRecords.toArray(),
  ])

  if (!metadataRow || !settingsRow) {
    throw new PersistenceError(
      'database-corrupt',
      'The diary database is missing required metadata. It was not treated as an empty diary.',
    )
  }

  return sortFacts({
    metadata: metadataRow.value,
    settings: settingsRow.value,
    episodes,
    readings,
    doses,
    medicines,
    dailyRecords,
  })
}

async function readFactsFromDatabase(database: DiaryDatabase): Promise<DiaryFacts> {
  const tables = diaryTables(database)
  return database.transaction('r', Object.values(tables), () => readFactsFromTables(tables))
}

export class DiaryRepository {
  readonly clock: Clock
  readonly databaseName: string

  private readonly suppliedDatabase?: DiaryDatabase
  private readonly onMigration?: DiaryDatabaseOptions['onMigration']
  private readonly readFault?: () => void
  private readonly writeFault?: (info: WriteFaultInfo) => void
  private database?: DiaryDatabase
  private facts?: DiaryFacts
  private currentStatus: RepositoryStatus = 'idle'
  private currentError?: Error
  private readonly listeners = new Set<RepositoryListener>()

  constructor(options: DiaryRepositoryOptions = {}) {
    this.suppliedDatabase = options.database
    this.databaseName = options.databaseName ?? options.database?.name ?? 'headache-diary'
    this.clock = options.clock ?? options.database?.clock ?? systemClock()
    this.onMigration = options.onMigration
    this.readFault = options.readFault
    this.writeFault = options.writeFault
  }

  snapshot(): RepositorySnapshot {
    return {
      status: this.currentStatus,
      facts: this.facts ? clone(this.facts) : undefined,
      error: this.currentError,
    }
  }

  subscribe(listener: RepositoryListener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  async open(): Promise<DiaryFacts> {
    if (this.currentStatus === 'ready' && this.facts && this.database) {
      return clone(this.facts)
    }

    this.currentStatus = 'loading'
    this.currentError = undefined
    this.emit()

    try {
      this.database =
        this.suppliedDatabase ??
        (await openDiaryDatabase({
          name: this.databaseName,
          clock: this.clock,
          onMigration: this.onMigration,
        }))
      const facts = await this.readFromDatabase()
      this.facts = facts
      this.currentStatus = 'ready'
      this.currentError = undefined
      this.emit()
      return clone(facts)
    } catch (error) {
      this.database?.close()
      this.database = undefined
      this.facts = undefined
      this.currentStatus = 'error'
      this.currentError = toError(error, 'The diary could not be opened.')
      this.emit()
      throw this.currentError
    }
  }

  async read(): Promise<DiaryFacts> {
    if (!this.database) await this.open()

    try {
      const facts = await this.readFromDatabase()
      this.facts = facts
      this.currentStatus = 'ready'
      this.currentError = undefined
      this.emit()
      return clone(facts)
    } catch (error) {
      this.facts = undefined
      this.currentStatus = 'error'
      this.currentError = toError(error, 'The diary could not be read.')
      this.emit()
      throw this.currentError
    }
  }

  async close(): Promise<void> {
    this.database?.close()
    this.database = undefined
    this.facts = undefined
    this.currentStatus = 'closed'
    this.currentError = undefined
    this.emit()
  }

  async getDatabase(): Promise<DiaryDatabase> {
    if (!this.database || this.currentStatus === 'closed') {
      await this.open()
    }
    if (!this.database) throw new PersistenceError('database-unavailable', 'The diary database is unavailable.')
    return this.database
  }

  notifyWriteFailure(error: unknown): void {
    this.currentStatus = 'error'
    this.currentError = toError(error, 'The diary could not be saved.')
    this.emit()
  }

  invokeWriteFault(info: WriteFaultInfo): void {
    this.writeFault?.(info)
  }

  private async readFromDatabase(): Promise<DiaryFacts> {
    this.readFault?.()
    if (!this.database) throw new PersistenceError('database-unavailable', 'The diary database is unavailable.')
    return readFactsFromDatabase(this.database)
  }

  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

function toError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback)
}

export { createDiaryDatabase }
