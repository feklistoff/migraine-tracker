import { Temporal } from '@js-temporal/polyfill'
import { z } from 'zod'

import { DIARY_SCHEMA_VERSION } from '../migrations'
import type { DiaryFacts } from '../../domain/types'

export const BACKUP_FORMAT = 'headache-diary'
export const BACKUP_FORMAT_VERSION = 1

const instant = z.string().refine((value) => {
  try { Temporal.Instant.from(value); return true } catch { return false }
}, 'Invalid instant')
const id = z.uuid()
const audit = { createdAt: instant, updatedAt: instant }
const recordedTime = z.strictObject({
  instant,
  timeZone: z.string().min(1),
  offset: z.string().regex(/^[+-]\d{2}:\d{2}(?::\d{2})?$/),
}).superRefine((value, context) => {
  try {
    if (Temporal.Instant.from(value.instant).toZonedDateTimeISO(value.timeZone).offset !== value.offset) {
      context.addIssue({ code: 'custom', message: 'Offset does not match the event time zone.' })
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'Invalid event time zone.' })
  }
})

const pain = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('numeric'), value: z.int().min(0).max(10) }),
  z.strictObject({ kind: z.literal('verbal'), value: z.enum(['none', 'mild', 'moderate', 'severe']) }),
])
const interval = z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(120)])
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  try { return Temporal.PlainDate.from(value).toString() === value } catch { return false }
}, 'Invalid civil day')

export const factsSchema = z.strictObject({
  metadata: z.strictObject({ ...audit, schemaVersion: z.int(), revision: z.int().nonnegative(), timeZonePolicy: z.literal('event-local'), lastExportGeneratedAt: instant.nullable() }),
  settings: z.strictObject({ ...audit, painEntryDefault: z.enum(['numeric', 'verbal']), followUpEnabled: z.boolean(), followUpIntervalMinutes: interval, defaultMedicineId: id.nullable() }),
  episodes: z.array(z.strictObject({ ...audit, id, start: recordedTime, state: z.enum(['ongoing', 'ended', 'end_unknown']), end: recordedTime.nullable(), note: z.string().nullable() })),
  readings: z.array(z.strictObject({ ...audit, id, episodeId: id, measuredAt: recordedTime, pain: pain.nullable(), impact: z.enum(['normal', 'slowed', 'stopped']).nullable(), note: z.string().nullable(), linkedDoseId: id.nullable(), atOnset: z.boolean() })),
  doses: z.array(z.strictObject({ ...audit, id, episodeId: id, takenAt: recordedTime, savedMedicineId: id.nullable(), medicineName: z.string().min(1), doseText: z.string().min(1), followUpEnabled: z.boolean(), followUpIntervalMinutes: interval })),
  medicines: z.array(z.strictObject({ ...audit, id, name: z.string().min(1), doseText: z.string().min(1), archived: z.boolean() })),
  dailyRecords: z.array(z.strictObject({ ...audit, day, headacheFreeAt: recordedTime.nullable(), alcohol: z.boolean().nullable(), sleep: z.enum(['not_enough', 'fair_amount', 'too_much']).nullable(), stress: z.boolean().nullable() })),
}) satisfies z.ZodType<DiaryFacts>

export const envelopeSchema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  createdAt: instant,
  appVersion: z.string().min(1),
  timeZonePolicy: z.literal('event-local'),
  facts: factsSchema,
})

export type BackupEnvelope = z.infer<typeof envelopeSchema>

export function assertSupportedSchema(version: number): void {
  if (version > DIARY_SCHEMA_VERSION) throw new Error('This backup needs a newer app version.')
  if (version !== DIARY_SCHEMA_VERSION) throw new Error('This backup uses an unsupported diary schema version.')
}
