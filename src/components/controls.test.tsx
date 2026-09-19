import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ActivitySelector, PainSelector } from './controls'

afterEach(cleanup)

describe('semantic diary selectors', () => {
  it('exposes numeric pain choices with selected state beyond colour', () => {
    const onChange = vi.fn()

    render(<PainSelector mode="numeric" value={null} onChange={onChange} />)

    const painSix = screen.getByRole('button', { name: 'Pain 6 of 10' })
    expect(painSix).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(painSix)

    expect(onChange).toHaveBeenCalledWith({ kind: 'numeric', value: 6 })
  })

  it('preserves verbal pain as words and offers the four supported choices', () => {
    render(<PainSelector mode="verbal" value={{ kind: 'verbal', value: 'moderate' }} onChange={() => undefined} />)

    expect(screen.getAllByRole('button')).toHaveLength(4)
    expect(screen.getByRole('button', { name: /Moderate, 4 to 6/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('uses pressed semantics for activity choices and permits clearing a choice', () => {
    const onChange = vi.fn()

    render(<ActivitySelector value="slowed" onChange={onChange} />)

    const slowed = screen.getByRole('button', { name: /Slowed down/ })
    expect(slowed).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(slowed)

    expect(onChange).toHaveBeenCalledWith(null)
  })
})
