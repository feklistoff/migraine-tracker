import { Temporal } from '@js-temporal/polyfill'

import { headacheEvidenceDays } from '../../domain/calendar'
import { nowEventTime, systemClock } from '../../domain/time'
import type { DiaryFacts } from '../../domain/types'
import { assertSupportedSchema, envelopeSchema, type BackupEnvelope } from './schema'

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} in backup.`)
}

function instant(value: string): Temporal.Instant {
  return Temporal.Instant.from(value)
}

export function validateBackupFacts(facts: DiaryFacts): void {
  assertSupportedSchema(facts.metadata.schemaVersion)
  unique(facts.episodes.map((record) => record.id), 'headache ID')
  unique(facts.readings.map((record) => record.id), 'reading ID')
  unique(facts.doses.map((record) => record.id), 'dose ID')
  unique(facts.medicines.map((record) => record.id), 'medicine ID')
  unique(facts.dailyRecords.map((record) => record.day), 'day')

  const episodes = new Map(facts.episodes.map((record) => [record.id, record]))
  const doses = new Map(facts.doses.map((record) => [record.id, record]))
  const medicines = new Map(facts.medicines.map((record) => [record.id, record]))
  const currentInstant = Temporal.Now.instant()
  for (const medicine of facts.medicines) {
    if (!medicine.name.trim() || !medicine.doseText.trim()) throw new Error('A saved medicine has an empty name or dose.')
  }
  if (facts.settings.defaultMedicineId && (!medicines.has(facts.settings.defaultMedicineId) || medicines.get(facts.settings.defaultMedicineId)?.archived)) {
    throw new Error('The default medicine is missing or archived in this backup.')
  }
  if (facts.episodes.filter((record) => record.state === 'ongoing').length > 1) {
    throw new Error('A backup can contain only one ongoing headache.')
  }

  const knownIntervals: { start: Temporal.Instant; end: Temporal.Instant }[] = []
  for (const episode of facts.episodes) {
    const start = instant(episode.start.instant)
    if (Temporal.Instant.compare(start, currentInstant) > 0 || (episode.end && Temporal.Instant.compare(instant(episode.end.instant), currentInstant) > 0)) {
      throw new Error('A headache time is in the future.')
    }
    if ((episode.state === 'ended') !== (episode.end !== null)) {
      throw new Error('A headache end does not match its state.')
    }
    if (episode.end && Temporal.Instant.compare(instant(episode.end.instant), start) < 0) {
      throw new Error('A headache ends before it starts.')
    }
    if (episode.state !== 'end_unknown') {
      knownIntervals.push({ start, end: episode.end ? instant(episode.end.instant) : Temporal.Now.instant() })
    }
  }
  knownIntervals.sort((one, two) => Temporal.Instant.compare(one.start, two.start))
  for (let index = 1; index < knownIntervals.length; index += 1) {
    if (Temporal.Instant.compare(knownIntervals[index].start, knownIntervals[index - 1].end) < 0) {
      throw new Error('Known headaches overlap in this backup.')
    }
  }

  for (const dose of facts.doses) {
    const episode = episodes.get(dose.episodeId)
    if (!episode) throw new Error('A dose refers to a missing headache.')
    if (!dose.medicineName.trim() || !dose.doseText.trim()) throw new Error('A dose has an empty medicine or amount.')
    if (Temporal.Instant.compare(instant(dose.takenAt.instant), currentInstant) > 0) throw new Error('A dose time is in the future.')
    if (dose.savedMedicineId && !medicines.has(dose.savedMedicineId)) throw new Error('A dose refers to a missing medicine.')
    if (Temporal.Instant.compare(instant(dose.takenAt.instant), instant(episode.start.instant)) < 0) throw new Error('A dose predates its headache.')
    if (episode.end && Temporal.Instant.compare(instant(dose.takenAt.instant), instant(episode.end.instant)) > 0) throw new Error('A dose follows its headache end.')
  }
  for (const reading of facts.readings) {
    const episode = episodes.get(reading.episodeId)
    if (!episode) throw new Error('A reading refers to a missing headache.')
    if (Temporal.Instant.compare(instant(reading.measuredAt.instant), currentInstant) > 0) throw new Error('A reading time is in the future.')
    if (Temporal.Instant.compare(instant(reading.measuredAt.instant), instant(episode.start.instant)) < 0) throw new Error('A reading predates its headache.')
    if (reading.linkedDoseId) {
      const dose = doses.get(reading.linkedDoseId)
      if (!dose || dose.episodeId !== reading.episodeId || !dose.followUpEnabled) throw new Error('A follow-up refers to an invalid dose.')
      if (Temporal.Instant.compare(instant(reading.measuredAt.instant), instant(dose.takenAt.instant)) < 0) throw new Error('A follow-up predates its dose.')
    }
  }
  if (facts.dailyRecords.some((record) => record.headacheFreeAt !== null)) {
    const headacheDays = headacheEvidenceDays(facts, nowEventTime(systemClock()))
    for (const record of facts.dailyRecords) {
      if (record.headacheFreeAt && Temporal.Instant.compare(instant(record.headacheFreeAt.instant), currentInstant) > 0) throw new Error('A confirmation time is in the future.')
      if (record.headacheFreeAt && headacheDays.has(record.day)) {
        throw new Error('A headache-free confirmation conflicts with headache evidence.')
      }
    }
  }
}

export function validateBackupText(text: string): BackupEnvelope {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('The backup exceeds 20 MiB. Contact support before attempting a larger restore.')
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('This is not a readable JSON backup.') }
  if (typeof parsed === 'object' && parsed !== null && 'formatVersion' in parsed) {
    const version = parsed.formatVersion
    if (typeof version === 'number' && version > 1) throw new Error('This backup needs a newer app version.')
    if (version !== 1) throw new Error('This backup format is not supported.')
  }
  const result = envelopeSchema.safeParse(parsed)
  if (!result.success) throw new Error(`The backup is incomplete or invalid: ${result.error.issues[0]?.path.join('.') ?? 'file'}.`)
  validateBackupFacts(result.data.facts)
  return result.data
}
