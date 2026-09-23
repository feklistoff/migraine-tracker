import type { DiaryFacts } from '../../domain/types'
import { diaryTables, StaleRevisionError, type DiaryRepository } from '../repository'
import { SINGLETON_KEY } from '../migrations'
import { backupCounts, compareBackupFacts, type BackupCounts, type BackupDifference } from './diff'
import type { BackupEnvelope } from './schema'
import { validateBackupText } from './validate'

export interface RestorePreview {
  envelope: BackupEnvelope
  expectedRevision: number
  currentCounts: BackupCounts
  backupCounts: BackupCounts
  difference: BackupDifference
}

export async function prepareRestore(repository: DiaryRepository, text: string): Promise<RestorePreview> {
  const envelope = validateBackupText(text)
  const current = await repository.read()
  return {
    envelope,
    expectedRevision: current.metadata.revision,
    currentCounts: backupCounts(current),
    backupCounts: backupCounts(envelope.facts),
    difference: compareBackupFacts(current, envelope.facts),
  }
}

export interface RestoreOptions {
  /** Fault-injection seam for proving that all stores roll back together. */
  beforeCommit?: () => void
  /** Keeps application updates deferred for the entire replacement and refresh. */
  beginCriticalOperation?: () => () => void
}

export async function restoreBackup(repository: DiaryRepository, preview: RestorePreview, options: RestoreOptions = {}): Promise<DiaryFacts> {
  // Revalidate the exact payload immediately before opening the transaction.
  const incoming = validateBackupText(JSON.stringify(preview.envelope)).facts
  const database = await repository.getDatabase()
  const tables = diaryTables(database)
  const endCriticalOperation = options.beginCriticalOperation?.() ?? (() => undefined)
  try {
    await database.transaction('rw', Object.values(tables), async () => {
      const row = await tables.metadata.get(SINGLETON_KEY)
      if (!row) throw new Error('Diary metadata is missing.')
      if (row.value.revision !== preview.expectedRevision) {
        throw new StaleRevisionError(preview.expectedRevision, row.value.revision)
      }
      const now = repository.clock.now().toString()
      await Promise.all([
        tables.episodes.clear(), tables.readings.clear(), tables.doses.clear(),
        tables.medicines.clear(), tables.dailyRecords.clear(),
      ])
      await tables.episodes.bulkAdd(incoming.episodes)
      await tables.readings.bulkAdd(incoming.readings)
      await tables.doses.bulkAdd(incoming.doses)
      await tables.medicines.bulkAdd(incoming.medicines)
      await tables.dailyRecords.bulkAdd(incoming.dailyRecords)
      await tables.settings.put({ key: SINGLETON_KEY, value: incoming.settings })
      await tables.metadata.put({
        key: SINGLETON_KEY,
        value: {
          ...incoming.metadata,
          revision: row.value.revision + 1,
          updatedAt: now,
          // This device's marker says only when it generated a file. Importing
          // another device's marker would falsely imply a local file was made.
          lastExportGeneratedAt: row.value.lastExportGeneratedAt,
        },
      })
      options.beforeCommit?.()
    })
    return await repository.read()
  } finally {
    endCriticalOperation()
  }
}
