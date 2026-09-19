import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { deleteDiaryDatabase } from './db'
import { finishEpisode, saveDose, saveMedicine, saveSettings, startEpisode } from './commands'
import { DiaryRepository } from './repository'
import { fixtureClock, fixtureEventTime } from '../test/fixtures'

const databaseName = 'headache-diary-settings-tests'
let repositories: DiaryRepository[] = []

function createRepository() {
  const repository = new DiaryRepository({ databaseName, clock: fixtureClock })
  repositories.push(repository)
  return repository
}

beforeEach(async () => {
  await deleteDiaryDatabase(databaseName)
  repositories = []
})

afterEach(async () => {
  for (const repository of repositories) await repository.close()
  await deleteDiaryDatabase(databaseName)
})

describe('settings and saved medicines', () => {
  it('persists each setting across a fresh repository', async () => {
    const first = createRepository()
    await first.open()

    await saveSettings(first, {
      painEntryDefault: 'verbal',
      followUpEnabled: false,
      followUpIntervalMinutes: 60,
    })
    await first.close()

    const second = createRepository()
    const facts = await second.open()

    expect(facts.settings).toMatchObject({
      painEntryDefault: 'verbal',
      followUpEnabled: false,
      followUpIntervalMinutes: 60,
      defaultMedicineId: null,
    })
  })

  it('keeps settings-only changes from creating medicines or doses', async () => {
    const repository = createRepository()
    await repository.open()

    await saveSettings(repository, { painEntryDefault: 'verbal', followUpIntervalMinutes: 90 })

    const facts = await repository.read()
    expect(facts.medicines).toEqual([])
    expect(facts.doses).toEqual([])
  })

  it('archives the default without rewriting an existing dose and restores it as a non-default', async () => {
    const repository = createRepository()
    await repository.open()
    await startEpisode(repository, {
      id: 'episode-settings',
      start: fixtureEventTime('2024-09-18T12:00'),
      note: null,
    })
    await finishEpisode(repository, 'episode-settings', fixtureEventTime('2024-09-18T13:00'))

    await saveMedicine(repository, {
      id: 'medicine-ibuprofen',
      name: 'Ibuprofen',
      doseText: '400 mg',
      archived: false,
    })
    await saveSettings(repository, { defaultMedicineId: 'medicine-ibuprofen' })
    await saveDose(repository, {
      id: 'dose-before-rename',
      episodeId: 'episode-settings',
      takenAt: fixtureEventTime('2024-09-18T12:30'),
      savedMedicineId: 'medicine-ibuprofen',
      medicineName: 'Ibuprofen',
      doseText: '400 mg',
      followUpEnabled: true,
      followUpIntervalMinutes: 120,
    })

    await saveMedicine(repository, {
      id: 'medicine-ibuprofen',
      name: 'Ibuprofen lysine',
      doseText: '600 mg',
      archived: false,
    })
    await saveMedicine(repository, {
      id: 'medicine-ibuprofen',
      name: 'Ibuprofen lysine',
      doseText: '600 mg',
      archived: true,
    })

    await expect(saveSettings(repository, { defaultMedicineId: 'medicine-ibuprofen' })).rejects.toMatchObject({
      code: 'validation-failed',
    })

    let facts = await repository.read()
    expect(facts.settings.defaultMedicineId).toBeNull()
    expect(facts.medicines[0]).toMatchObject({ archived: true, name: 'Ibuprofen lysine', doseText: '600 mg' })
    expect(facts.doses[0]).toMatchObject({
      medicineName: 'Ibuprofen',
      doseText: '400 mg',
      savedMedicineId: 'medicine-ibuprofen',
    })

    await saveMedicine(repository, {
      id: 'medicine-ibuprofen',
      name: 'Ibuprofen lysine',
      doseText: '600 mg',
      archived: false,
    })
    facts = await repository.read()
    expect(facts.medicines[0].archived).toBe(false)
    expect(facts.settings.defaultMedicineId).toBeNull()
    expect(facts.doses).toHaveLength(1)
  })
})
