import { useEffect, useState } from 'react'

import { DiaryRepository, type RepositorySnapshot } from '../data/repository'

export const defaultDiaryRepository = new DiaryRepository()

export function useDiaryRepository(repository: DiaryRepository = defaultDiaryRepository): RepositorySnapshot {
  const [snapshot, setSnapshot] = useState<RepositorySnapshot>(() => repository.snapshot())

  useEffect(() => {
    const unsubscribe = repository.subscribe(setSnapshot)
    void repository.open().catch(() => undefined)
    return unsubscribe
  }, [repository])

  return snapshot
}
