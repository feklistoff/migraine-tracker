import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from './App'

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

describe('app shell', () => {
  it('starts with the private empty-diary state', () => {
    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: 'Headache diary' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing recorded yet.' })).toBeInTheDocument()
    expect(screen.getByText(/Your diary stays on this iPhone/)).toBeInTheDocument()
  })

  it('keeps the disposable platform spike behind an explicit query flag', () => {
    window.history.replaceState({}, '', '/?spike=1')

    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: 'iPhone platform check' })).toBeInTheDocument()
    expect(screen.getByText('Synthetic data only')).toBeInTheDocument()
  })
})
