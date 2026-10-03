import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DateTimeWheel, formatPickerTime } from './DateTimeWheel'

describe('date/time wheels', () => {
  it('constrains the day on month/year changes and confirms civil fields without a timezone conversion', () => {
    const onDone = vi.fn()
    render(<DateTimeWheel label="Started" value="2024-01-31T23:59" onDone={onDone} onCancel={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Month' }), { key: 'ArrowDown' })
    expect(screen.getByRole('spinbutton', { name: 'Day' })).toHaveAttribute('aria-valuenow', '29')
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Year' }), { key: 'ArrowDown' })
    expect(screen.getByRole('spinbutton', { name: 'Day' })).toHaveAttribute('aria-valuenow', '28')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onDone).toHaveBeenCalledWith('2025-02-28T23:59')
  })

  it('reads wheel scroll position and retains a draft until Done', () => {
    const onDone = vi.fn()
    const onCancel = vi.fn()
    render(<DateTimeWheel label="Dose time" value="2024-09-18T12:05" onDone={onDone} onCancel={onCancel} />)
    const minute = screen.getByRole('spinbutton', { name: 'Minute' })
    fireEvent.scroll(minute, { target: { scrollTop: 44 * 30 } })
    expect(minute).toHaveAttribute('aria-valuenow', '30')
    expect(onDone).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('prevents confirming times outside the caller bounds', () => {
    render(<DateTimeWheel label="Ended" value="2024-09-18T12:00" min="2024-09-18T11:00" max="2024-09-18T12:00" onDone={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Minute' }), { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('latest allowed time')
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Minute' }), { key: 'Home' })
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Hour' }), { key: 'ArrowUp' })
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled()
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Hour' }), { key: 'ArrowUp' })
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('earliest allowed time')
  })

  it('shows an explicit prompt for empty fields', () => {
    expect(formatPickerTime('')).toBe('Choose date and time')
  })
})
