import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { deleteDiaryDatabase } from '../db'
import { saveSettings } from '../commands'
import { DiaryRepository } from '../repository'
import { fixtureClock, fixtureEventTime } from '../../test/fixtures'
import { createBackup } from './export'
import { prepareRestore, restoreBackup } from './restore'
import { validateBackupText, MAX_BACKUP_BYTES } from './validate'

const name = 'backup-tests'
const ids = {
  episode: '11111111-1111-4111-8111-111111111111',
  reading: '22222222-2222-4222-8222-222222222222',
  dose: '33333333-3333-4333-8333-333333333333',
  medicine: '44444444-4444-4444-8444-444444444444',
  archivedMedicine: '55555555-5555-4555-8555-555555555555',
}
const audit = { createdAt: '2024-09-17T09:00:00Z', updatedAt: '2024-09-18T09:00:00Z' }
let source: DiaryRepository
let target: DiaryRepository

async function seed(repository: DiaryRepository) {
  const db = await repository.getDatabase()
  await db.transaction('rw', [db.episodes, db.readings, db.doses, db.medicines, db.dailyRecords, db.settings], async () => {
    await db.episodes.put({ ...audit, id: ids.episode, start: fixtureEventTime('2024-09-17T22:00'), state: 'ended', end: fixtureEventTime('2024-09-18T02:00'), note: null })
    await db.medicines.put({ ...audit, id: ids.medicine, name: 'Example', doseText: '400 mg', archived: false })
    await db.medicines.put({ ...audit, id: ids.archivedMedicine, name: 'Older name', doseText: '1 tablet', archived: true })
    await db.doses.put({ ...audit, id: ids.dose, episodeId: ids.episode, takenAt: fixtureEventTime('2024-09-17T23:00'), savedMedicineId: ids.medicine, medicineName: 'Old label', doseText: 'one tablet', followUpEnabled: true, followUpIntervalMinutes: 90 })
    await db.readings.put({ ...audit, id: ids.reading, episodeId: ids.episode, measuredAt: fixtureEventTime('2024-09-18T01:00'), pain: { kind: 'verbal', value: 'mild' }, impact: null, note: null, linkedDoseId: ids.dose, atOnset: false })
    await db.dailyRecords.put({ ...audit, day: '2024-09-18', headacheFreeAt: null, alcohol: false, sleep: null, stress: true })
    const row = await db.settings.get('singleton')
    if (!row) throw new Error('missing settings')
    await db.settings.put({ key: 'singleton', value: { ...row.value, painEntryDefault: 'verbal', defaultMedicineId: ids.medicine } })
  })
  return repository.read()
}

beforeEach(async () => {
  await deleteDiaryDatabase(name + '-source')
  await deleteDiaryDatabase(name + '-target')
  source = new DiaryRepository({ databaseName: name + '-source', clock: fixtureClock })
  target = new DiaryRepository({ databaseName: name + '-target', clock: fixtureClock })
  await source.open()
  await target.open()
})

afterEach(async () => {
  await source.close()
  await target.close()
})

describe('complete diary backups', () => {
  it('exports a coherent, versioned snapshot and restores every meaningful field including nulls and event zones', async () => {
    const original = await seed(source)
    const file = await createBackup(source, '0.1.0')
    expect(file.bytes).toBe(new TextEncoder().encode(file.text).byteLength)
    expect(file.envelope.format).toBe('headache-diary')
    expect(file.envelope.formatVersion).toBe(1)
    expect((await source.read()).metadata.lastExportGeneratedAt).toBe(file.envelope.createdAt)
    const preview = await prepareRestore(target, file.text)
    await restoreBackup(target, preview)
    const restored = await target.read()
    expect({ ...restored, metadata: { ...restored.metadata, revision: original.metadata.revision, lastExportGeneratedAt: original.metadata.lastExportGeneratedAt, updatedAt: original.metadata.updatedAt } }).toEqual(original)
  })

  it('rejects corrupt, future, duplicate, orphaned, bad-time and oversized files before replacing anything', async () => {
    const original = await seed(target)
    await seed(source)
    const file = await createBackup(source, '0.1.0')
    const valid = JSON.parse(file.text)
    const candidates: unknown[] = [
      '',
      '{bad',
      { ...valid, formatVersion: 2 },
      { ...valid, formatVersion: 0 },
      { ...valid, facts: { ...valid.facts, episodes: [valid.facts.episodes[0], valid.facts.episodes[0]] } },
      { ...valid, facts: { ...valid.facts, readings: [{ ...valid.facts.readings[0], episodeId: ids.archivedMedicine }] } },
      { ...valid, facts: { ...valid.facts, settings: { ...valid.facts.settings, defaultMedicineId: ids.archivedMedicine } } },
      { ...valid, facts: { ...valid.facts, dailyRecords: [{ ...audit, day: '2024-09-18', headacheFreeAt: { instant: '2024-09-18T09:00:00Z', timeZone: 'Europe/Helsinki', offset: '+99:00' }, alcohol: null, sleep: null, stress: null }] } },
    ]
    for (const candidate of candidates) {
      await expect(prepareRestore(target, typeof candidate === 'string' ? candidate : JSON.stringify(candidate))).rejects.toThrow()
      expect(await target.read()).toEqual(original)
    }
    expect(() => validateBackupText('x'.repeat(MAX_BACKUP_BYTES + 1))).toThrow('20 MiB')
  })

  it('guards a stale preview and rolls back an injected mid-replacement failure', async () => {
    const original = await seed(target)
    const file = await createBackup(source, '0.1.0')
    const preview = await prepareRestore(target, file.text)
    expect(preview.difference.records.removed.map((item) => item.label)).toContain('day 2024-09-18')
    await saveSettings(target, { painEntryDefault: 'numeric' })
    await expect(restoreBackup(target, preview)).rejects.toMatchObject({ code: 'stale-revision' })
    const current = await target.read()
    expect(current.episodes).toEqual(original.episodes)
    const refreshed = await prepareRestore(target, file.text)
    let criticalOperationActive = false
    await expect(restoreBackup(target, refreshed, {
      beginCriticalOperation: () => {
        criticalOperationActive = true
        return () => { criticalOperationActive = false }
      },
      beforeCommit: () => {
        expect(criticalOperationActive).toBe(true)
        throw new Error('simulated disk failure')
      },
    })).rejects.toThrow('simulated disk failure')
    expect(criticalOperationActive).toBe(false)
    expect(await target.read()).toEqual(current)
  })

  it('reports changed records with the same ID rather than hiding them behind equal totals', async () => {
    await seed(source)
    await seed(target)
    const db = await source.getDatabase()
    const dose = await db.doses.get(ids.dose)
    if (!dose) throw new Error('missing fixture dose')
    await db.doses.put({ ...dose, doseText: 'changed dose' })
    const file = await createBackup(source, '0.1.0')
    const preview = await prepareRestore(target, file.text)
    expect(preview.currentCounts).toEqual(preview.backupCounts)
    expect(preview.difference.records.removed).toEqual([])
    expect(preview.difference.records.added).toEqual([])
    expect(preview.difference.records.changed).toEqual([expect.objectContaining({ collection: 'doses', id: ids.dose })])
  })

  it('captures one coherent revision when another context writes during export', async () => {
    await seed(source)
    const writer = new DiaryRepository({ databaseName: name + '-source', clock: fixtureClock })
    await writer.open()
    try {
      const [backup] = await Promise.all([
        createBackup(source, '0.1.0'),
        saveSettings(writer, { painEntryDefault: 'numeric' }),
      ])
      const { metadata, settings } = backup.envelope.facts
      expect(
        (metadata.revision === 0 && settings.painEntryDefault === 'verbal') ||
        (metadata.revision === 1 && settings.painEntryDefault === 'numeric'),
      ).toBe(true)
    } finally {
      await writer.close()
    }
  })
})
