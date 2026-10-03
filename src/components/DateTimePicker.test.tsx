import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DateTimePicker, formatPickerTime } from './DateTimePicker'

describe('calendar and typed time', () => {
  it('selects a leap-day from the calendar and types time without changing civil fields through a timezone conversion', () => {
    const onDone = vi.fn()
    render(<DateTimePicker label="Started" value="2024-01-31T23:59" onDone={onDone} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Thursday, February 29, 2024' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Time' }), { target: { value: '0930' } })
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onDone).toHaveBeenCalledWith('2024-02-29T09:30')
  })

  it('keeps typed time and selected date as a draft until Done, and cancels without committing', () => {
    const onDone = vi.fn()
    const onCancel = vi.fn()
    render(<DateTimePicker label="Dose time" value="2024-09-18T12:05" onDone={onDone} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tuesday, September 17, 2024' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Time' }), { target: { value: '00:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('prevents confirming invalid or out-of-bounds times, and disables out-of-bounds dates', () => {
    render(<DateTimePicker label="Ended" value="2024-09-18T12:00" min="2024-09-18T11:00" max="2024-09-18T12:00" onDone={vi.fn()} onCancel={vi.fn()} />)
    const time = screen.getByRole('textbox', { name: 'Time' })
    const done = screen.getByRole('button', { name: 'Done' })
    for (const value of ['', '25:00', '12:60', 'noon', '930']) {
      fireEvent.change(time, { target: { value } })
      expect(done).toBeDisabled()
      expect(screen.getByRole('alert')).toHaveTextContent('valid time')
    }
    fireEvent.change(time, { target: { value: '12:01' } })
    expect(done).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('latest allowed time')
    fireEvent.change(time, { target: { value: '10:59' } })
    expect(done).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('earliest allowed time')
    fireEvent.change(time, { target: { value: '11:00' } })
    expect(done).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Tuesday, September 17, 2024' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Thursday, September 19, 2024' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
  })

  it('browses across year boundaries without changing the selected date', () => {
    const onDone = vi.fn()
    render(<DateTimePicker label="Started" value="2024-12-31T23:59" onDone={onDone} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByText('January 2025')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByRole('button', { name: 'Tuesday, December 31, 2024' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onDone).toHaveBeenCalledWith('2024-12-31T23:59')
  })

  it('shows an explicit prompt for empty fields', () => {
    expect(formatPickerTime('')).toBe('Choose date and time')
  })
})
