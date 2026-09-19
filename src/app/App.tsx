import { PlatformSpikePage } from '../features/platform/PlatformSpikePage'
import { Icon } from '../components/Icon'
import { AppShell, EntryShell, PageHeader } from './AppShell'
import { routeHref, useAppRoute, type AppRoute } from './Router'

function TodayPage({ route }: { route: AppRoute }) {
  return (
    <AppShell route={route}>
      <header className="app-header app-header--diary">
        <div>
          <p className="eyebrow">Private diary</p>
          <h1>Headache diary</h1>
        </div>
        <a className="icon-button" href={routeHref({ kind: 'page', page: 'settings', tab: 'today' })} aria-label="Settings">
          <Icon name="settings" />
        </a>
      </header>

      <section className="empty-card" aria-labelledby="empty-card-title">
        <p className="empty-card__mark" aria-hidden="true">
          ·
        </p>
        <h2 id="empty-card-title">Nothing recorded yet.</h2>
        <p>Your diary stays on this iPhone. We’ll keep the details ready for the next step.</p>
        <div className="diary-actions" aria-label="Diary actions">
          <a className="primary-action" href={routeHref({ kind: 'entry', page: 'start', tab: 'today' })}>
            Start a headache
          </a>
          <a className="secondary-action" href={routeHref({ kind: 'entry', page: 'past', tab: 'today' })}>
            Log a past headache
          </a>
        </div>
      </section>
    </AppShell>
  )
}

function PlaceholderPage({ route, title, description }: { route: AppRoute; title: string; description: string }) {
  return (
    <AppShell route={route}>
      <PageHeader title={title} backHref="#today" />
      <section className="empty-card page-placeholder" aria-labelledby="placeholder-title">
        <p className="empty-card__mark" aria-hidden="true">
          ·
        </p>
        <h2 id="placeholder-title">Nothing recorded yet.</h2>
        <p>{description}</p>
      </section>
    </AppShell>
  )
}

function EntryPage({ title, description, actionLabel }: { title: string; description: string; actionLabel: string }) {
  return (
    <EntryShell title={title} actionLabel={actionLabel} footerNote="The diary controls will be added in the next step.">
      <section className="form-placeholder" aria-label={title}>
        <h2>{description}</h2>
        <p>Your time and details will stay editable when this form is connected to the diary.</p>
      </section>
    </EntryShell>
  )
}

function RoutedApp({ route }: { route: AppRoute }) {
  if (route.kind === 'tab' && route.tab === 'history') {
    return <PlaceholderPage route={route} title="History" description="Recorded headaches will appear here once diary entries are available." />
  }
  if (route.kind === 'tab' && route.tab === 'statistics') {
    return <PlaceholderPage route={route} title="Statistics" description="Your recorded days and observations will be summarised here." />
  }
  if (route.kind === 'page' && route.page === 'settings') {
    return <PlaceholderPage route={route} title="Settings" description="Preferences and saved medicines will be available here." />
  }
  if (route.kind === 'page' && route.page === 'timeline') {
    return <PlaceholderPage route={route} title="Headache" description="A saved headache timeline will be available here." />
  }
  if (route.kind === 'entry' && route.page === 'start') {
    return <EntryPage title="New headache" description="Start time" actionLabel="Save headache" />
  }
  if (route.kind === 'entry' && route.page === 'past') {
    return <EntryPage title="Past headache" description="When did it happen?" actionLabel="Save headache" />
  }
  if (route.kind === 'entry' && route.page === 'checkin') {
    return <EntryPage title="Yesterday & last night" description="What was yesterday like?" actionLabel="Save" />
  }
  if (route.kind === 'entry' && route.page === 'follow-up') {
    return <EntryPage title="Follow-up check" description="How much does it hurt now?" actionLabel="Save follow-up" />
  }
  if (route.kind === 'entry' && route.page === 'dose') {
    return <EntryPage title="Log dose" description="Which medicine?" actionLabel="Log dose" />
  }

  return <TodayPage route={route} />
}

export function App() {
  const spikeEnabled = new URLSearchParams(window.location.search).get('spike') === '1'

  if (spikeEnabled) {
    return <PlatformSpikePage />
  }

  return <RoutedApp route={useAppRoute()} />
}
