import { PlatformSpikePage } from '../features/platform/PlatformSpikePage'
import { StartHeadachePage } from '../features/episodes/StartHeadachePage'
import { PastHeadachePage } from '../features/episodes/PastHeadachePage'
import { ReadingPage } from '../features/episodes/ReadingPage'
import { DosePage } from '../features/episodes/DosePage'
import { TimelinePage } from '../features/episodes/TimelinePage'
import { CheckinPage } from '../features/checkins/CheckinPage'
import { HistoryPage } from '../features/history/HistoryPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { TodayPage } from '../features/today/TodayPage'
import { AppShell, PageHeader } from './AppShell'
import { defaultDiaryRepository, useDiaryRepository } from './useDiary'
import { useAppRoute, type AppRoute } from './Router'
import type { DiaryRepository } from '../data/repository'
import type { DiaryFacts } from '../domain/types'

function PlaceholderPage({ route, title, description }: { route: AppRoute; title: string; description: string }) {
  return (
    <AppShell route={route}>
      <PageHeader title={title} backHref="#today" />
      <section className="empty-card page-placeholder" aria-labelledby="placeholder-title">
        <p className="empty-card__mark" aria-hidden="true">·</p>
        <h2 id="placeholder-title">Nothing recorded yet.</h2>
        <p>{description}</p>
      </section>
    </AppShell>
  )
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

function RoutedApp({ route, repository, facts }: { route: AppRoute; repository: DiaryRepository; facts: DiaryFacts }) {
  if (route.kind === 'tab' && route.tab === 'today') {
    return <TodayPage route={route} facts={facts} repository={repository} />
  }
  if (route.kind === 'tab' && route.tab === 'history') {
    return <HistoryPage route={route} facts={facts} repository={repository} />
  }
  if (route.kind === 'tab' && route.tab === 'statistics') {
    return <PlaceholderPage route={route} title="Statistics" description="Your recorded days and observations will be summarised here." />
  }
  if (route.kind === 'page' && route.page === 'settings') {
    return <SettingsPage route={route} facts={facts} repository={repository} />
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

  return <TodayPage route={{ kind: 'tab', tab: 'today' }} facts={facts} repository={repository} />
}

export interface AppProps {
  repository?: DiaryRepository
}

export function App({ repository = defaultDiaryRepository }: AppProps = {}) {
  const route = useAppRoute()
  const snapshot = useDiaryRepository(repository)
  const spikeEnabled = new URLSearchParams(window.location.search).get('spike') === '1'

  if (spikeEnabled) return <PlatformSpikePage />
  if (snapshot.status === 'loading' || snapshot.status === 'idle') return <DiaryLoading />
  if (snapshot.status === 'error' || !snapshot.facts) return <DiaryError repository={repository} error={snapshot.error} />

  return <RoutedApp route={route} repository={repository} facts={snapshot.facts} />
}
