import { afterEach, describe, expect, it } from 'vitest'

import { beginCriticalOperation, getUpdateBlockers, registerUpdateBlocker } from './updateSafety'

const releases: Array<() => void> = []

afterEach(() => {
  while (releases.length) releases.pop()?.()
})

describe('update activation safety', () => {
  it('keeps an open form and an active write visible as blockers until each ends', () => {
    releases.push(registerUpdateBlocker('An entry form is open'))
    const finishWrite = beginCriticalOperation('Saving diary changes')
    releases.push(finishWrite)

    expect(getUpdateBlockers()).toEqual(['An entry form is open', 'Saving diary changes'])
    finishWrite()
    expect(getUpdateBlockers()).toEqual(['An entry form is open'])
    releases.pop()?.()
    releases.pop()?.()
    expect(getUpdateBlockers()).toEqual([])
  })

  it('allows restore to use the same critical-operation hook', () => {
    const finishRestore = beginCriticalOperation('Replacing diary from backup')
    expect(getUpdateBlockers()).toContain('Replacing diary from backup')
    finishRestore()
    expect(getUpdateBlockers()).toEqual([])
  })
})
