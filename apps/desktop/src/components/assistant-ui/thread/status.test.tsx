import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetElapsedTimerRegistryForTests } from '@/components/chat/activity-timer'
import { I18nProvider } from '@/i18n'
import { $activeSessionId, $phantomRoute, $thinkingStatus, $turnStartedAt } from '@/store/session'

import { ResponseLoadingIndicator } from './status'

function renderIndicator() {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <ResponseLoadingIndicator />
    </I18nProvider>
  )
}

describe('ResponseLoadingIndicator timer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    __resetElapsedTimerRegistryForTests()
  })

  afterEach(() => {
    cleanup()
    $activeSessionId.set(null)
    $turnStartedAt.set(null)
    $thinkingStatus.set('')
    $phantomRoute.set(null)
    __resetElapsedTimerRegistryForTests()
    vi.useRealTimers()
  })

  it('preserves each running session timer while switching between sessions', () => {
    $activeSessionId.set('session-a')
    $turnStartedAt.set(Date.now())
    const sessionA = renderIndicator()

    act(() => vi.advanceTimersByTime(5_000))
    expect(screen.getAllByText((_, node) => node?.textContent === '5s').length).toBeGreaterThan(0)
    sessionA.unmount()

    $activeSessionId.set('session-b')
    $turnStartedAt.set(Date.now())
    const sessionB = renderIndicator()

    act(() => vi.advanceTimersByTime(3_000))
    expect(screen.getAllByText((_, node) => node?.textContent === '3s').length).toBeGreaterThan(0)
    sessionB.unmount()

    $activeSessionId.set('session-a')
    $turnStartedAt.set(new Date('2026-01-01T00:00:00.000Z').getTime())
    renderIndicator()

    expect(screen.getAllByText((_, node) => node?.textContent === '8s').length).toBeGreaterThan(0)
  })

  it('shows backend personality status then rotates to a local quip', () => {
    $thinkingStatus.set('(¬‿¬) *phoning home*...')
    renderIndicator()

    expect(screen.getByText('(¬‿¬) *phoning home*...')).toBeTruthy()
    act(() => vi.advanceTimersByTime(3_200))
    expect(screen.getByText('*byting chips*')).toBeTruthy()
  })

  it('shows a public adaptive lane without exposing provider internals', () => {
    $phantomRoute.set('focus')
    renderIndicator()

    expect(screen.getByText('Focus')).toBeTruthy()
    expect(screen.queryByText(/chatgpt|high/i)).toBeNull()
  })
})
