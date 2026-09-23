import { useSyncExternalStore } from 'react'

export type TabId = 'today' | 'history' | 'statistics'
export type EntryPageId = 'start' | 'past' | 'checkin' | 'update' | 'follow-up' | 'dose'

type RouteContext = { selectedDay?: string; episodeId?: string; doseId?: string; readingId?: string; missing?: boolean }
type TabRoute = { [T in TabId]: { kind: 'tab'; tab: T } & RouteContext }[TabId]
type PageRoute = {
  [P in 'settings' | 'timeline' | 'backup' | 'restore']: { kind: 'page'; page: P; tab: TabId } & RouteContext
}['settings' | 'timeline' | 'backup' | 'restore']
type EntryRoute = { [P in EntryPageId]: { kind: 'entry'; page: P; tab: TabId } & RouteContext }[EntryPageId]

export type AppRoute = TabRoute | PageRoute | EntryRoute

const defaultRoute: AppRoute = { kind: 'tab', tab: 'today' }

export function routeHref(route: AppRoute): string {
  const path = route.kind === 'tab' ? route.tab : route.page
  const query = new URLSearchParams()
  if (route.kind !== 'tab' && route.tab !== 'today') query.set('tab', route.tab)
  if (route.selectedDay) query.set('day', route.selectedDay)
  if (route.episodeId) query.set('episode', route.episodeId)
  if (route.doseId) query.set('dose', route.doseId)
  if (route.readingId) query.set('reading', route.readingId)
  if (route.kind === 'tab' && route.tab === 'history' && route.missing) query.set('missing', '1')
  const queryString = query.toString()
  return `#${path}${queryString ? `?${queryString}` : ''}`
}

function isTabId(value: string | null): value is TabId {
  return value === 'today' || value === 'history' || value === 'statistics'
}

export function parseRoute(hash: string): AppRoute {
  const [rawRoute, rawQuery = ''] = hash.replace(/^#/, '').replace(/^\/+/, '').split('?')
  const route = rawRoute ?? ''
  const query = new URLSearchParams(rawQuery)
  const selectedDay = /^\d{4}-\d{2}-\d{2}$/.test(query.get('day') ?? '') ? query.get('day') ?? undefined : undefined
  const episodeId = query.get('episode')?.trim() || undefined
  const doseId = query.get('dose')?.trim() || undefined
  const readingId = query.get('reading')?.trim() || undefined
  const tabQuery = query.get('tab')

  if (route === 'history' || route === 'statistics') {
    return { kind: 'tab', tab: route, ...(selectedDay ? { selectedDay } : {}), ...(episodeId ? { episodeId } : {}), ...(route === 'history' && query.get('missing') === '1' ? { missing: true } : {}) }
  }
  if (route === 'settings' || route === 'timeline' || route === 'backup' || route === 'restore') {
    return {
      kind: 'page',
      page: route,
      tab: isTabId(tabQuery) ? tabQuery : 'today',
      ...(selectedDay ? { selectedDay } : {}),
      ...(episodeId ? { episodeId } : {}),
      ...(doseId ? { doseId } : {}),
      ...(readingId ? { readingId } : {}),
    }
  }
  if (route === 'start' || route === 'past' || route === 'checkin' || route === 'update' || route === 'follow-up' || route === 'dose') {
    return {
      kind: 'entry',
      page: route,
      tab: isTabId(tabQuery) ? tabQuery : 'today',
      ...(selectedDay ? { selectedDay } : {}),
      ...(episodeId ? { episodeId } : {}),
      ...(doseId ? { doseId } : {}),
      ...(readingId ? { readingId } : {}),
    }
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
