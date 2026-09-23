import { useEffect } from 'react'

import { registerUpdateBlocker } from './updateSafety'

export function useUpdateBlocker(blocked: boolean, reason: string): void {
  useEffect(() => {
    if (blocked) return registerUpdateBlocker(reason)
    return undefined
  }, [blocked, reason])
}
