import type { MouseEvent, ReactNode } from 'react'

import { Icon } from '../components/Icon'
import type { AppRoute, TabId } from './Router'
import { routeHref, routeTab } from './Router'

const tabs: { id: TabId; label: string; icon: 'today' | 'history' | 'statistics' }[] = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'statistics', label: 'Statistics', icon: 'statistics' },
]

export interface AppShellProps {
  children: ReactNode
  route: AppRoute
  className?: string
  showTabs?: boolean
}

export function AppShell({ children, route, className, showTabs = true }: AppShellProps) {
  return (
    <div className={`diary-shell${className ? ` ${className}` : ''}`}>
      <main className="diary-main">
        <div className="diary-content">{children}</div>
      </main>
      {showTabs ? <TabBar activeTab={routeTab(route)} /> : null}
    </div>
  )
}

export function TabBar({ activeTab }: { activeTab: TabId }) {
  return (
    <nav className="tab-bar" aria-label="Sections">
      {tabs.map((tab) => (
        <a
          key={tab.id}
          className={`tab-bar__link${activeTab === tab.id ? ' tab-bar__link--active' : ''}`}
          href={routeHref({ kind: 'tab', tab: tab.id })}
          aria-current={activeTab === tab.id ? 'page' : undefined}
        >
          <Icon name={tab.icon} size={24} />
          <span>{tab.label}</span>
        </a>
      ))}
    </nav>
  )
}

export interface PageHeaderProps {
  title: string
  backHref: string
  backLabel?: string
  dirty?: boolean
  onDiscard?: () => void
}

export function PageHeader({ title, backHref, backLabel = 'Back to Today', dirty = false, onDiscard }: PageHeaderProps) {
  const handleBack = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!dirty) return
    if (!window.confirm('Discard this unfinished form?')) {
      event.preventDefault()
      return
    }
    onDiscard?.()
  }

  return (
    <header className="entry-header">
      <a className="icon-button" href={backHref} aria-label={backLabel} onClick={handleBack}>
        <Icon name="back" />
      </a>
      <h1>{title}</h1>
      <span className="entry-header__balance" aria-hidden="true" />
    </header>
  )
}

export interface EntryShellProps {
  title: string
  children: ReactNode
  footerNote: string
  actionLabel: string
  backHref?: string
  dirty?: boolean
  onDiscard?: () => void
  onAction?: () => void
  actionDisabled?: boolean
  actionBusy?: boolean
  actionError?: string | null
}

export function EntryShell({
  title,
  children,
  footerNote,
  actionLabel,
  backHref = '#today',
  dirty = false,
  onDiscard,
  onAction,
  actionDisabled = false,
  actionBusy = false,
  actionError = null,
}: EntryShellProps) {
  return (
    <div className="diary-shell diary-shell--entry">
      <main className="diary-main">
        <div className="diary-content diary-content--entry">
          <PageHeader title={title} backHref={backHref} dirty={dirty} onDiscard={onDiscard} />
          {children}
        </div>
      </main>
      <footer className="entry-footer">
        <button
          className="primary-action"
          type="button"
          disabled={actionDisabled || actionBusy}
          aria-busy={actionBusy || undefined}
          onClick={onAction}
        >
          {actionLabel}
        </button>
        {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
        <p>{footerNote}</p>
      </footer>
    </div>
  )
}
