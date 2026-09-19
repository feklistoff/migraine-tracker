import { Temporal } from '@js-temporal/polyfill'

import {
  endEpisode as domainEndEpisode,
  startEpisode as domainStartEpisode,
  type StartEpisodeInput,
} from '../domain/episodes'
import {
  civilDay,
  civilDaysForInterval,
  compareInstants,
  elapsedMilliseconds,
  eventTimeFromInstant,
  instantFromEventTime,
} from '../domain/time'
import {
  validateDoseBounds,
  validateEpisode,
  validateReadingBounds,
  type ValidationIssue,
} from '../domain/validation'
import type {
  DailyRecord,
  DiaryFacts,
  Dose,
  Episode,
  Reading,
  RecordedTime,
  SavedMedicine,
  Settings,
} from '../domain/types'
import { SINGLETON_KEY } from './migrations'
import {
  DiaryRepository,
  MissingRecordError,
  StaleRevisionError,
  UndoExpiredError,
  ValidationCommandError,
  type DiaryTables,
} from './repository'
import { readFactsFromTables } from './repository'

export interface CommandOptions {
  expectedRevision?: number
  /** Explicitly move the onset-anchored reading when a start time is edited. */
  moveOnsetReading?: boolean
}

export type EpisodeChanges = Partial<Pick<Episode, 'start' | 'state' | 'end' | 'note'>>

export type ReadingInput = Omit<Reading, 'id' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<Reading, 'id' | 'createdAt' | 'updatedAt'>>

export type DoseInput = Omit<Dose, 'id' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<Dose, 'id' | 'createdAt' | 'updatedAt'>>

export type DailyRecordInput = Omit<DailyRecord, 'createdAt' | 'updatedAt'> &
  Partial<Pick<DailyRecord, 'createdAt' | 'updatedAt'>>

export type SavedMedicineInput = Omit<SavedMedicine, 'id' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<SavedMedicine, 'id' | 'createdAt' | 'updatedAt'>>

export type SettingsChanges = Partial<
  Pick<Settings, 'painEntryDefault' | 'followUpEnabled' | 'followUpIntervalMinutes' | 'defaultMedicineId'>
>

interface WriteOperation<T> {
  value: T
  changed?: boolean
}

interface CommandContext {
  facts: DiaryFacts
  tables: DiaryTables
}

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000

function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  throw new Error('A UUID-capable crypto source is required to create a diary record.')
}

function now(repository: DiaryRepository): string {
  return repository.clock.now().toString()
}

function auditRecord<T extends { createdAt: string; updatedAt: string }>(
  input: T,
  repository: DiaryRepository,
  existing?: T,
): T {
  return {
    ...input,
    createdAt: existing?.createdAt ?? input.createdAt ?? now(repository),
    updatedAt: now(repository),
  }
}

function validationFailure(issues: readonly ValidationIssue[]): ValidationCommandError {
  return new ValidationCommandError(issues)
}

function assertExpectedRevision(facts: DiaryFacts, options: CommandOptions): void {
  if (options.expectedRevision === undefined) return
  if (options.expectedRevision !== facts.metadata.revision) {
    throw new StaleRevisionError(options.expectedRevision, facts.metadata.revision)
  }
}

async function runAtomicWrite<T>(
  repository: DiaryRepository,
  operation: string,
  options: CommandOptions,
  write: (context: CommandContext) => Promise<WriteOperation<T>>,
): Promise<T> {
  try {
    const database = await repository.getDatabase()
    const expectedRevision = options.expectedRevision ?? repository.snapshot().facts?.metadata.revision
    const revisionOptions = { ...options, expectedRevision }
    const tables = {
      metadata: database.metadata,
      settings: database.settings,
      episodes: database.episodes,
      readings: database.readings,
      doses: database.doses,
      medicines: database.medicines,
      dailyRecords: database.dailyRecords,
    }

    const operationResult = await database.transaction(
      'rw',
      Object.values(tables),
      async () => {
        const facts = await readFactsFromTables(tables)
        assertExpectedRevision(facts, revisionOptions)
        const result = await write({ facts, tables })

        if (result.changed !== false) {
          repository.invokeWriteFault({ operation, step: 'before-revision' })
          const metadata = {
            ...facts.metadata,
            revision: facts.metadata.revision + 1,
            updatedAt: now(repository),
          }
          await tables.metadata.put({ key: SINGLETON_KEY, value: metadata })
          repository.invokeWriteFault({ operation, step: 'after-revision' })
        }

        return result.value
      },
    )

    // Re-read after commit so subscribers get a snapshot from the committed
    // transaction, including writes made in another tab/context.
    await repository.read()
    return operationResult
  } catch (error) {
    repository.notifyWriteFailure(error)
    throw error
  }
}

export async function startEpisode(
  repository: DiaryRepository,
  input: StartEpisodeInput,
  options: CommandOptions = {},
): Promise<Episode> {
  return runAtomicWrite(repository, 'start-episode', options, async ({ facts, tables }) => {
    const result = domainStartEpisode(input, {
      clock: repository.clock,
      existingEpisodes: facts.episodes,
    })
    if (!result.valid) throw validationFailure(result.issues)

    await tables.episodes.add(result.value)
    await clearConflictingConfirmations(tables, [result.value], repository)
    return { value: result.value }
  })
}

export async function finishEpisode(
  repository: DiaryRepository,
  episodeId: string,
  end: RecordedTime,
  options: CommandOptions = {},
): Promise<Episode> {
  return runAtomicWrite(repository, 'finish-episode', options, async ({ facts, tables }) => {
    const episode = requireEpisode(facts, episodeId)
    const result = domainEndEpisode(episode, end, {
      clock: repository.clock,
      existingEpisodes: facts.episodes.filter((candidate) => candidate.id !== episodeId),
    })
    if (!result.valid) throw validationFailure(result.issues)
    await validateEpisodeChildren(result.value, facts, repository)

    await tables.episodes.put(result.value)
    await clearConflictingConfirmations(tables, [result.value], repository)
    return { value: result.value }
  })
}

export async function editEpisode(
  repository: DiaryRepository,
  episodeId: string,
  changes: EpisodeChanges,
  options: CommandOptions = {},
): Promise<Episode> {
  return runAtomicWrite(repository, 'edit-episode', options, async ({ facts, tables }) => {
    const episode = requireEpisode(facts, episodeId)
    const candidate: Episode = {
      ...episode,
      ...changes,
      updatedAt: now(repository),
    }
    const result = validateEpisode(candidate, {
      clock: repository.clock,
      existingEpisodes: facts.episodes.filter((item) => item.id !== episodeId),
    })
    if (!result.valid) throw validationFailure(result.issues)

    const movedOnsetReadings = options.moveOnsetReading
      ? facts.readings
          .filter((reading) => reading.episodeId === episodeId && reading.atOnset)
          .map((reading) => ({ ...reading, measuredAt: result.value.start, updatedAt: now(repository) }))
      : []
    const factsForValidation = movedOnsetReadings.length
      ? { ...facts, readings: facts.readings.map((reading) => movedOnsetReadings.find((moved) => moved.id === reading.id) ?? reading) }
      : facts
    await validateEpisodeChildren(result.value, factsForValidation, repository)

    await tables.episodes.put(result.value)
    if (movedOnsetReadings.length > 0) await tables.readings.bulkPut(movedOnsetReadings)
    await clearConflictingConfirmations(tables, [result.value], repository)
    return { value: result.value }
  })
}

export async function undoEpisodeEnd(
  repository: DiaryRepository,
  episodeId: string,
  options: CommandOptions = {},
): Promise<Episode> {
  return runAtomicWrite(repository, 'undo-episode-end', options, async ({ facts, tables }) => {
    const episode = requireEpisode(facts, episodeId)
    if (episode.state !== 'ended' || episode.end === null) {
      throw new ValidationCommandError([
        { code: 'invalid-state', path: 'state', message: 'Only a known-ended headache can be undone.' },
      ])
    }
    if (elapsedMilliseconds(episode.end, repository.clock.now()) > UNDO_WINDOW_MS) {
      throw new UndoExpiredError()
    }

    const candidate: Episode = {
      ...episode,
      state: 'ongoing',
      end: null,
      updatedAt: now(repository),
    }
    const result = validateEpisode(candidate, {
      clock: repository.clock,
      existingEpisodes: facts.episodes.filter((item) => item.id !== episodeId),
    })
    if (!result.valid) throw validationFailure(result.issues)
    await tables.episodes.put(result.value)
    return { value: result.value }
  })
}

export async function deleteEpisode(
  repository: DiaryRepository,
  episodeId: string,
  options: CommandOptions = {},
): Promise<void> {
  await runAtomicWrite(repository, 'delete-episode', options, async ({ facts, tables }) => {
    requireEpisode(facts, episodeId)
    const [readingIds, doseIds] = await Promise.all([
      tables.readings.where('episodeId').equals(episodeId).primaryKeys(),
      tables.doses.where('episodeId').equals(episodeId).primaryKeys(),
    ])
    await Promise.all([
      tables.episodes.delete(episodeId),
      tables.readings.bulkDelete(readingIds),
      tables.doses.bulkDelete(doseIds),
    ])
    return { value: undefined }
  })
}

export async function saveReading(
  repository: DiaryRepository,
  input: ReadingInput | Reading,
  options: CommandOptions = {},
): Promise<Reading> {
  return runAtomicWrite(repository, 'save-reading', options, async ({ facts, tables }) => {
    const episode = requireEpisode(facts, input.episodeId)
    const existing = input.id ? facts.readings.find((reading) => reading.id === input.id) : undefined
    const record = auditRecord(
      { ...input, id: input.id ?? newId() } as Reading,
      repository,
      existing,
    )
    const result = validateReadingBounds(record, episode, { clock: repository.clock })
    if (!result.valid) throw validationFailure(result.issues)

    await tables.readings.put(record)
    if (isPositivePain(record.pain)) await clearConflictingConfirmations(tables, [record], repository)
    return { value: record }
  })
}

export async function deleteReading(
  repository: DiaryRepository,
  readingId: string,
  options: CommandOptions = {},
): Promise<void> {
  await runAtomicWrite(repository, 'delete-reading', options, async ({ facts, tables }) => {
    const reading = facts.readings.find((candidate) => candidate.id === readingId)
    if (!reading) throw new MissingRecordError('reading', readingId)
    await tables.readings.delete(reading.id)
    return { value: undefined }
  })
}

export async function saveDose(
  repository: DiaryRepository,
  input: DoseInput | Dose,
  options: CommandOptions = {},
): Promise<Dose> {
  return runAtomicWrite(repository, 'save-dose', options, async ({ facts, tables }) => {
    const episode = requireEpisode(facts, input.episodeId)
    const existing = input.id ? facts.doses.find((dose) => dose.id === input.id) : undefined
    const record = auditRecord({ ...input, id: input.id ?? newId() } as Dose, repository, existing)
    const result = validateDoseBounds(record, episode, { clock: repository.clock })
    if (!result.valid) throw validationFailure(result.issues)

    if (record.savedMedicineId && !facts.medicines.some((medicine) => medicine.id === record.savedMedicineId)) {
      throw validationFailure([
        {
          code: 'missing-medicine',
          path: 'savedMedicineId',
          message: 'The selected saved medicine no longer exists.',
        },
      ])
    }

    await tables.doses.put(record)
    await clearConflictingConfirmations(tables, [record], repository)
    return { value: record }
  })
}

export async function saveDailyRecord(
  repository: DiaryRepository,
  input: DailyRecordInput | DailyRecord,
  options: CommandOptions = {},
): Promise<DailyRecord | null> {
  return runAtomicWrite(repository, 'save-daily-record', options, async ({ facts, tables }) => {
    const issues = validateDailyRecordInput(input, repository)
    if (issues.length > 0) throw validationFailure(issues)

    const existing = facts.dailyRecords.find((record) => record.day === input.day)
    const record = auditRecord({ ...input } as DailyRecord, repository, existing)
    if (record.headacheFreeAt && evidenceDays(facts, repository).has(record.day)) record.headacheFreeAt = null

    const isBlank =
      record.headacheFreeAt === null &&
      record.alcohol === null &&
      record.sleep === null &&
      record.stress === null
    if (isBlank) {
      if (existing) await tables.dailyRecords.delete(existing.day)
      return { value: null, changed: Boolean(existing) }
    }

    await tables.dailyRecords.put(record)
    return { value: record }
  })
}

export async function saveMedicine(
  repository: DiaryRepository,
  input: SavedMedicineInput | SavedMedicine,
  options: CommandOptions = {},
): Promise<SavedMedicine> {
  return runAtomicWrite(repository, 'save-medicine', options, async ({ facts, tables }) => {
    const existing = input.id ? facts.medicines.find((medicine) => medicine.id === input.id) : undefined
    const record = auditRecord({ ...input, id: input.id ?? newId() } as SavedMedicine, repository, existing)
    if (record.name.trim() === '' || record.doseText.trim() === '') {
      throw validationFailure([
        { code: 'invalid-medicine', path: 'name', message: 'Medicine name and dose are required.' },
      ])
    }
    await tables.medicines.put(record)

    // An archived medicine must never remain selected as the convenience
    // default. Keep that cleanup in the same transaction as the archive so a
    // settings read can never observe a dangling default.
    if (record.archived && facts.settings.defaultMedicineId === record.id) {
      await tables.settings.put({
        key: SINGLETON_KEY,
        value: {
          ...facts.settings,
          defaultMedicineId: null,
          updatedAt: now(repository),
        },
      })
    }
    return { value: record }
  })
}

export async function saveSettings(
  repository: DiaryRepository,
  changes: SettingsChanges,
  options: CommandOptions = {},
): Promise<Settings> {
  return runAtomicWrite(repository, 'save-settings', options, async ({ facts, tables }) => {
    const candidate: Settings = {
      ...facts.settings,
      ...changes,
      updatedAt: now(repository),
    }
    if (candidate.painEntryDefault !== 'numeric' && candidate.painEntryDefault !== 'verbal') {
      throw validationFailure([
        {
          code: 'invalid-pain-entry-default',
          path: 'painEntryDefault',
          message: 'Pain entry default must be 0 to 10 or Words.',
        },
      ])
    }
    if (typeof candidate.followUpEnabled !== 'boolean') {
      throw validationFailure([
        {
          code: 'invalid-follow-up-enabled',
          path: 'followUpEnabled',
          message: 'Follow-up checks must be enabled or disabled.',
        },
      ])
    }
    if (
      candidate.defaultMedicineId &&
      !facts.medicines.some(
        (medicine) => medicine.id === candidate.defaultMedicineId && !medicine.archived,
      )
    ) {
      throw validationFailure([
        {
          code: 'missing-medicine',
          path: 'defaultMedicineId',
          message: 'The default medicine must be an active saved medicine.',
        },
      ])
    }
    if (![30, 60, 90, 120].includes(candidate.followUpIntervalMinutes)) {
      throw validationFailure([
        {
          code: 'invalid-follow-up-interval',
          path: 'followUpIntervalMinutes',
          message: 'Follow-up interval must be 30, 60, 90 or 120 minutes.',
        },
      ])
    }
    await tables.settings.put({ key: SINGLETON_KEY, value: candidate })
    return { value: candidate }
  })
}

async function validateEpisodeChildren(
  episode: Episode,
  facts: DiaryFacts,
  repository: DiaryRepository,
): Promise<void> {
  const readings = facts.readings.filter((reading) => reading.episodeId === episode.id)
  for (const reading of readings) {
    const result = validateReadingBounds(reading, episode, { clock: repository.clock })
    if (!result.valid) throw validationFailure(result.issues)
  }

  const doses = facts.doses.filter((dose) => dose.episodeId === episode.id)
  for (const dose of doses) {
    const result = validateDoseBounds(dose, episode, { clock: repository.clock })
    if (!result.valid) throw validationFailure(result.issues)
  }
}

function requireEpisode(facts: DiaryFacts, episodeId: string): Episode {
  const episode = facts.episodes.find((candidate) => candidate.id === episodeId)
  if (!episode) throw new MissingRecordError('episode', episodeId)
  return episode
}

function isPositivePain(pain: Reading['pain']): boolean {
  return pain !== null && (pain.kind === 'numeric' ? pain.value > 0 : pain.value !== 'none')
}

function evidenceDays(facts: DiaryFacts, repository: DiaryRepository): Set<string> {
  const days = new Set<string>()
  for (const episode of facts.episodes) {
    for (const day of episodeEvidenceDays(episode, repository)) days.add(day)
  }
  for (const reading of facts.readings) {
    if (isPositivePain(reading.pain)) days.add(civilDay(reading.measuredAt))
  }
  for (const dose of facts.doses) days.add(civilDay(dose.takenAt))
  return days
}

async function clearConflictingConfirmations(
  tables: DiaryTables,
  records: readonly (Episode | Reading | Dose)[],
  repository: DiaryRepository,
): Promise<void> {
  const days = new Set<string>()
  for (const record of records) {
    if ('start' in record) {
      for (const day of episodeEvidenceDays(record, repository)) days.add(day)
    } else if ('measuredAt' in record) {
      if (isPositivePain(record.pain)) days.add(civilDay(record.measuredAt))
    } else {
      days.add(civilDay(record.takenAt))
    }
  }

  for (const day of days) {
    const existing = await tables.dailyRecords.get(day)
    if (existing?.headacheFreeAt) {
      const cleared = {
        ...existing,
        headacheFreeAt: null,
        updatedAt: now(repository),
      }
      const isBlank = cleared.alcohol === null && cleared.sleep === null && cleared.stress === null
      if (isBlank) await tables.dailyRecords.delete(day)
      else await tables.dailyRecords.put(cleared)
    }
  }
}

function episodeEvidenceDays(episode: Episode, repository: DiaryRepository): string[] {
  if (episode.state === 'end_unknown') return [civilDay(episode.start)]

  const end = episode.end ?? eventTimeFromInstant(repository.clock.now(), repository.clock.timeZone())
  return civilDaysForInterval(episode.start, end, { endExclusive: episode.end !== null })
}

function validateDailyRecordInput(input: DailyRecordInput | DailyRecord, repository: DiaryRepository): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  let date: Temporal.PlainDate
  try {
    date = Temporal.PlainDate.from(input.day)
  } catch {
    return [{ code: 'invalid-day', path: 'day', message: 'The day must use YYYY-MM-DD.' }]
  }

  const today = repository.clock.now().toZonedDateTimeISO(repository.clock.timeZone()).toPlainDate()
  if (Temporal.PlainDate.compare(date, today) > 0) {
    issues.push({ code: 'future', path: 'day', message: 'A daily record cannot be saved for a future day.' })
  }

  if (input.headacheFreeAt) {
    try {
      const eventTime = input.headacheFreeAt
      const resolved = instantFromEventTime(eventTime).toZonedDateTimeISO(eventTime.timeZone)
      if (resolved.offset !== eventTime.offset) {
        issues.push({ code: 'invalid-time', path: 'headacheFreeAt', message: 'The confirmation time is not valid.' })
      }
      if (compareInstants(eventTime, repository.clock.now()) > 0) {
        issues.push({ code: 'future', path: 'headacheFreeAt', message: 'This confirmation time cannot be in the future.' })
      }
    } catch {
      issues.push({ code: 'invalid-time', path: 'headacheFreeAt', message: 'The confirmation time is not valid.' })
    }
  }

  return issues
}
