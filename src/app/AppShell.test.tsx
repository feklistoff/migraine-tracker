import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EntryShell } from './AppShell'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('entry shell navigation', () => {
  it('asks before leaving a dirty form and reports an accepted discard', () => {
    const onDiscard = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <EntryShell
        title="New headache"
        actionLabel="Save headache"
        footerNote="Draft"
        dirty
        onDiscard={onDiscard}
      >
        <p>Draft details</p>
      </EntryShell>,
    )

    fireEvent.click(screen.getByRole('link', { name: 'Back to Today' }))

    expect(window.confirm).toHaveBeenCalledWith('Discard this unfinished form?')
    expect(onDiscard).toHaveBeenCalledOnce()
  })

  it('keeps a dirty form open when discard is declined', () => {
    const onDiscard = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(
      <EntryShell title="New headache" actionLabel="Save headache" footerNote="Draft" dirty onDiscard={onDiscard}>
        <p>Draft details</p>
      </EntryShell>,
    )

    expect(fireEvent.click(screen.getByRole('link', { name: 'Back to Today' }))).toBe(false)

    expect(window.confirm).toHaveBeenCalledOnce()
    expect(onDiscard).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'New headache' })).toBeInTheDocument()
  })
})
