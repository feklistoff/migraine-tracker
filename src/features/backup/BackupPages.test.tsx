import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from '../../app/App'
import { deleteDiaryDatabase } from '../../data/db'
import { DiaryRepository } from '../../data/repository'
import { fixtureClock } from '../../test/fixtures'

const databaseName = 'backup-pages-test'
let repository: DiaryRepository

afterEach(async () => {
  await repository?.close()
  await deleteDiaryDatabase(databaseName)
  window.history.replaceState({}, '', '/')
  window.location.hash = ''
  vi.restoreAllMocks()
})

describe('backup and restore pages', () => {
  it('generates a file before sharing and never calls a canceled share a saved backup', async () => {
    repository = new DiaryRepository({ databaseName, clock: fixtureClock })
    const share = vi.fn().mockRejectedValue(new DOMException('Canceled', 'AbortError'))
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    window.location.hash = '#backup'
    render(<App repository={repository} />)

    await waitFor(() => expect(screen.getByText('File ready')).toBeInTheDocument())
    expect((await repository.read()).metadata.lastExportGeneratedAt).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save to Files' }))
    await waitFor(() => expect(screen.getByText('Sharing was canceled. The file is still ready here.')).toBeInTheDocument())
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.any(File)] }))
    expect(screen.getByText(/The app can’t confirm where — or whether — it was saved/)).toBeInTheDocument()
  })

  it('previews a chosen file and asks for final confirmation before replacement', async () => {
    repository = new DiaryRepository({ databaseName, clock: fixtureClock })
    await repository.open()
    const { createBackup } = await import('../../data/backup/export')
    const backup = await createBackup(repository, '0.1.0')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    window.location.hash = '#restore'
    render(<App repository={repository} />)

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Restore' })).toBeInTheDocument())
    const file = new File([backup.text], backup.fileName, { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(backup.text) })
    fireEvent.change(screen.getByLabelText('Choose backup file'), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByText('Complete diary backup')).toBeInTheDocument())
    expect(screen.getByText('Days count stored daily records, not elapsed calendar days.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Replace with this backup' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(screen.getByText('Complete diary backup')).toBeInTheDocument()
  })
})
