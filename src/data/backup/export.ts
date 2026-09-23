import type { DiaryFacts } from '../../domain/types'
import { diaryTables, readFactsFromTables, type DiaryRepository } from '../repository'
import { SINGLETON_KEY } from '../migrations'
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, envelopeSchema, type BackupEnvelope } from './schema'
import { MAX_BACKUP_BYTES, validateBackupFacts } from './validate'

export interface GeneratedBackup {
  envelope: BackupEnvelope
  text: string
  bytes: number
  fileName: string
  blob: Blob
}

export async function createBackup(repository: DiaryRepository, appVersion: string): Promise<GeneratedBackup> {
  const database = await repository.getDatabase()
  const tables = diaryTables(database)
  const facts: DiaryFacts = await database.transaction('r', Object.values(tables), () => readFactsFromTables(tables))
  validateBackupFacts(facts)
  const createdAt = repository.clock.now().toString()
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt,
    appVersion,
    timeZonePolicy: 'event-local',
    facts,
  }
  // The same strict schema governs writing and reading. If a persisted field
  // changes later, export cannot silently make a file restore would reject.
  envelopeSchema.parse(envelope)
  const text = JSON.stringify(envelope, null, 2)
  const blob = new Blob([text], { type: 'application/json' })
  const bytes = new TextEncoder().encode(text).byteLength
  if (bytes > MAX_BACKUP_BYTES) throw new Error('This diary exceeds the 20 MiB backup limit. Contact support for a larger-file recovery path.')
  const backup = {
    envelope,
    text,
    bytes,
    fileName: `headache-diary-${createdAt.slice(0, 10)}.json`,
    blob,
  }

  // File generation is complete before the operational marker changes. A
  // canceled share sheet never updates this marker a second time.
  await database.transaction('rw', database.metadata, async () => {
    const row = await database.metadata.get(SINGLETON_KEY)
    if (!row) throw new Error('Diary metadata is missing.')
    await database.metadata.put({ key: SINGLETON_KEY, value: { ...row.value, lastExportGeneratedAt: createdAt, updatedAt: createdAt } })
  })
  await repository.read()
  return backup
}
