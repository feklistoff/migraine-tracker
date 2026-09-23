import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

import { StartHeadachePage } from '../features/episodes/StartHeadachePage'
import { PastHeadachePage } from '../features/episodes/PastHeadachePage'
import { ReadingPage } from '../features/episodes/ReadingPage'
import { DosePage } from '../features/episodes/DosePage'
import { TimelinePage } from '../features/episodes/TimelinePage'
import { CheckinPage } from '../features/checkins/CheckinPage'
import { HistoryPage } from '../features/history/HistoryPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { MakeBackupPage } from '../features/backup/MakeBackupPage'
import { RestorePage } from '../features/backup/RestorePage'
import { TodayPage } from '../features/today/TodayPage'
import { StatisticsPage } from '../features/statistics/StatisticsPage'
import { nowEventTime } from '../domain/time'
import { defaultDiaryRepository, useDiaryRepository } from './useDiary'
import { useAppRoute, type AppRoute } from './Router'
import type { DiaryRepository } from '../data/repository'
import type { DiaryFacts } from '../domain/types'
import { subscribeToOtherTabRestores } from '../data/tabSync'
import type { AppearancePreference } from './appearance'
import { readAppearancePreference, writeAppearancePreference } from './appearance'
import { isUndoStateAvailable, readUndoState, writeUndoState, type UndoState } from './undoState'

function applyAppearance(preference: AppearancePreference): () => void {
  const colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)')
  const apply = () => {
    const resolved = preference === 'system' ? (colorScheme?.matches ? 'dark' : 'light') : preference
    document.documentElement.dataset.theme = resolved
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
      'content',
      resolved === 'dark' ? '#1c1916' : '#f5efe7',
    )
  }
  apply()
  colorScheme?.addEventListener?.('change', apply)
  return () => colorScheme?.removeEventListener?.('change', apply)
}

function DiaryLoading() {
  return (
    <div className="diary-shell">
      <main className="diary-main">
        <div className="diary-content">
          <section className="form-card" aria-live="polite">
            <p className="section-kicker">Private diary</p>
            <h1>Loading your diary…</h1>
            <p className="card-caption">Your records stay on this iPhone.</p>
          </section>
        </div>
      </main>
    </div>
  )
}

function DiaryError({ repository, error }: { repository: DiaryRepository; error?: Error }) {
  return (
    <div className="diary-shell">
      <main className="diary-main">
        <div className="diary-content">
          <section className="form-card" aria-labelledby="diary-error-heading">
            <p className="section-kicker">Private diary</p>
            <h1 id="diary-error-heading">Your diary could not be opened.</h1>
            <p className="card-caption" role="alert">{error?.message ?? 'Try again without deleting your local records.'}</p>
            <button className="primary-action" type="button" onClick={() => void repository.open().catch(() => undefined)}>Try again</button>
          </section>
        </div>
      </main>
    </div>
  )
}

function RoutedApp({
  route,
  repository,
  facts,
  appearance,
  onAppearanceChange,
  undoState,
  onUndoChange,
}: {
  route: AppRoute
  repository: DiaryRepository
  facts: DiaryFacts
  appearance: AppearancePreference
  onAppearanceChange: (preference: AppearancePreference) => void
  undoState?: UndoState
  onUndoChange: (state: UndoState | undefined) => void
}) {
  if (route.kind === 'tab' && route.tab === 'today') {
    return <TodayPage route={route} facts={facts} repository={repository} undoState={undoState} onUndoChange={onUndoChange} />
  }
  if (route.kind === 'tab' && route.tab === 'history') {
    return <HistoryPage route={route} facts={facts} repository={repository} />
  }
  if (route.kind === 'tab' && route.tab === 'statistics') {
    return <StatisticsPage route={route} facts={facts} now={nowEventTime(repository.clock)} />
  }
  if (route.kind === 'page' && route.page === 'settings') {
    return <SettingsPage route={route} facts={facts} repository={repository} appearance={appearance} onAppearanceChange={onAppearanceChange} />
  }
  if (route.kind === 'page' && route.page === 'backup') {
    return <MakeBackupPage route={route} repository={repository} />
  }
  if (route.kind === 'page' && route.page === 'restore') {
    return <RestorePage route={route} repository={repository} />
  }
  if (route.kind === 'page' && route.page === 'timeline') {
    return <TimelinePage route={route} facts={facts} repository={repository} />
  }
  if (route.kind === 'entry' && route.page === 'start') {
    return <StartHeadachePage route={route} facts={facts} repository={repository} />
  }
  if (route.kind === 'entry' && route.page === 'past') {
    return <PastHeadachePage key={route.episodeId ?? 'new-past-headache'} route={route} facts={facts} repository={repository} />
  }
  if (route.kind === 'entry' && route.page === 'checkin') {
    return <CheckinPage key={route.selectedDay ?? 'today'} route={route} facts={facts} repository={repository} />
  }
  if (route.kind === 'entry' && (route.page === 'update' || route.page === 'follow-up')) {
    return <ReadingPage route={route} facts={facts} repository={repository} />
  }
  if (route.kind === 'entry' && route.page === 'dose') {
    return <DosePage route={route} facts={facts} repository={repository} />
  }

  return (
    <TodayPage
      route={{ kind: 'tab', tab: 'today' }}
      facts={facts}
      repository={repository}
      undoState={undoState}
      onUndoChange={onUndoChange}
    />
  )
}

export interface AppProps {
  repository?: DiaryRepository
}

export function App({ repository = defaultDiaryRepository }: AppProps = {}) {
  const route = useAppRoute()
  const snapshot = useDiaryRepository(repository)
  const [appearance, setAppearance] = useState(readAppearancePreference)
  const [undoState, setUndoState] = useState(readUndoState)
  const handleUndoChange = useCallback((state: UndoState | undefined) => {
    setUndoState(state)
    writeUndoState(state)
  }, [])

  useEffect(() => subscribeToOtherTabRestores(() => window.location.reload()), [])
  useLayoutEffect(() => applyAppearance(appearance), [appearance])
  useEffect(() => {
    if (snapshot.facts && undoState && !isUndoStateAvailable(undoState, snapshot.facts, repository.clock.now().epochMilliseconds)) {
      handleUndoChange(undefined)
    }
  }, [handleUndoChange, repository, snapshot.facts, undoState])

  if (snapshot.status === 'loading' || snapshot.status === 'idle') return <DiaryLoading />
  if (snapshot.status === 'error' || !snapshot.facts) return <DiaryError repository={repository} error={snapshot.error} />

  return (
    <RoutedApp
      route={route}
      repository={repository}
      facts={snapshot.facts}
      appearance={appearance}
      onAppearanceChange={(preference) => {
        setAppearance(preference)
        writeAppearancePreference(preference)
      }}
      undoState={isUndoStateAvailable(undoState, snapshot.facts, repository.clock.now().epochMilliseconds) ? undoState : undefined}
      onUndoChange={handleUndoChange}
    />
  )
}
