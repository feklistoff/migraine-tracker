import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { deleteDiaryDatabase } from '../data/db'
import { DiaryRepository } from '../data/repository'
import { fixedClock } from '../domain/time'
import { App } from './App'

const databaseName = 'headache-diary-app-tests'
let repository: DiaryRepository

beforeEach(() => {
  repository = new DiaryRepository({ databaseName, clock: fixedClock('2024-09-18T14:05:00Z', 'Europe/Helsinki') })
})

afterEach(async () => {
  await repository.close()
  await deleteDiaryDatabase(databaseName)
  window.history.replaceState({}, '', '/')
})

describe('app shell', () => {
  it('starts with the private empty-diary state', async () => {
    render(<App repository={repository} />)

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Headache diary' })).toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing recorded yet.' })).toBeInTheDocument()
    expect(screen.getByText(/Your diary stays on this iPhone/)).toBeInTheDocument()
  })
})
