import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from '../../app/App'
import { deleteDiaryDatabase } from '../../data/db'
import { DiaryRepository } from '../../data/repository'
import { fixedClock } from '../../domain/time'

const databaseName = 'headache-diary-settings-page-tests'
const clock = fixedClock('2024-09-18T14:05:00Z', 'Europe/Helsinki')
let repository: DiaryRepository

afterEach(async () => {
  await repository?.close()
  await deleteDiaryDatabase(databaseName)
  window.history.replaceState({}, '', '/')
  window.location.hash = ''
})

describe('Settings page', () => {
  it('shows honest empty medicine state and persists settings and medicine actions', async () => {
    repository = new DiaryRepository({ databaseName, clock })
    window.location.hash = '#settings'
    render(<App repository={repository} />)

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument())
    expect(screen.getByText('No saved medicines yet.')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Check how a dose worked' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Words' }))
    fireEvent.click(screen.getByRole('button', { name: '60 min' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Check how a dose worked' }))

    await waitFor(async () => {
      expect((await repository.read()).settings).toMatchObject({
        painEntryDefault: 'verbal',
        followUpEnabled: false,
        followUpIntervalMinutes: 60,
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add a medicine' }))
    fireEvent.change(screen.getByLabelText('Medicine name'), { target: { value: 'Ibuprofen' } })
    fireEvent.change(screen.getByLabelText('Dose'), { target: { value: '400 mg' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save medicine' }))

    await waitFor(() => expect(screen.getByText('Ibuprofen')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Make Ibuprofen the default' }))
    await waitFor(async () => expect((await repository.read()).settings.defaultMedicineId).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Archive Ibuprofen' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore Ibuprofen' })).toBeInTheDocument())
    expect((await repository.read()).settings.defaultMedicineId).toBeNull()
    expect((await repository.read()).doses).toEqual([])
  })
})
