import { useSyncExternalStore } from 'react'

export type TabId = 'today' | 'history' | 'statistics'
export type EntryPageId = 'start' | 'past' | 'checkin' | 'follow-up' | 'dose'

export type AppRoute =
  | { kind: 'tab'; tab: TabId; selectedDay?: string }
  | { kind: 'page'; page: 'settings' | 'timeline'; tab: TabId; selectedDay?: string }
  | { kind: 'entry'; page: EntryPageId; tab: TabId; selectedDay?: string }

const defaultRoute: AppRoute = { kind: 'tab', tab: 'today' }

export function routeHref(route: AppRoute): string {
  const path = route.kind === 'tab' ? route.tab : route.page
  const query = route.selectedDay ? `?day=${encodeURIComponent(route.selectedDay)}` : ''
  return `#${path}${query}`
}

export function parseRoute(hash: string): AppRoute {
  const [rawRoute, rawQuery = ''] = hash.replace(/^#/, '').replace(/^\/+/, '').split('?')
  const route = rawRoute ?? ''
  const query = new URLSearchParams(rawQuery)
  const selectedDay = /^\d{4}-\d{2}-\d{2}$/.test(query.get('day') ?? '') ? query.get('day') ?? undefined : undefined

  if (route === 'history' || route === 'statistics') {
    return { kind: 'tab', tab: route, ...(selectedDay ? { selectedDay } : {}) }
  }
  if (route === 'settings' || route === 'timeline') {
    return { kind: 'page', page: route, tab: 'today', ...(selectedDay ? { selectedDay } : {}) }
  }
  if (route === 'start' || route === 'past' || route === 'checkin' || route === 'follow-up' || route === 'dose') {
    return { kind: 'entry', page: route, tab: 'today', ...(selectedDay ? { selectedDay } : {}) }
  }

  return defaultRoute
}

export function routeTab(route: AppRoute): TabId {
  return route.kind === 'tab' ? route.tab : route.tab
}

function subscribeToHash(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

function currentHash(): string {
  return window.location.hash
}

export function useAppRoute(): AppRoute {
  const hash = useSyncExternalStore(subscribeToHash, currentHash, () => '')
  return parseRoute(hash)
}
