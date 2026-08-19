import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $petActivity } from '@/store/pet'
import { $busy } from '@/store/session'

import { phantomAssetPath, PhantomPresence, phantomPresencePhase } from './phantom-presence'

describe('PhantomPresence', () => {
  afterEach(() => {
    cleanup()
    $busy.set(false)
    $petActivity.set({})
  })

  it('maps product activity to deliberate visual states', () => {
    expect(phantomPresencePhase('idle')).toBe('idle')
    expect(phantomPresencePhase('review')).toBe('reasoning')
    expect(phantomPresencePhase('run')).toBe('working')
    expect(phantomPresencePhase('waiting')).toBe('listening')
    expect(phantomPresencePhase('jump')).toBe('celebrate')
    expect(phantomPresencePhase('failed')).toBe('error')
  })

  it('builds packaged-safe relative asset paths', () => {
    expect(phantomAssetPath('/welcome.webp', './')).toBe('./welcome.webp')
    expect(phantomAssetPath('chin.webp', './assets')).toBe('./assets/chin.webp')
  })

  it('reacts to the live reasoning signal', () => {
    $petActivity.set({ busy: true, reasoning: true })
    render(<PhantomPresence />)

    const presence = screen.getByTestId('phantom-presence')

    expect(presence.getAttribute('data-phase')).toBe('reasoning')
    expect(presence.getAttribute('data-pose')).toBe('chin.webp')
    expect(presence.querySelector('img')?.getAttribute('src')).toContain('chin.webp')
    expect(presence.getAttribute('data-slot')).toBe('phantom-presence')
    expect(presence.querySelector('.phantom-presence__glow')).not.toBeNull()
    expect(presence.querySelectorAll('.phantom-presence__front-wisp')).toHaveLength(2)
  })

  it('keeps the idle pose fixed instead of cycling it', () => {
    vi.useFakeTimers()

    try {
      render(<PhantomPresence />)

      const presence = screen.getByTestId('phantom-presence')

      expect(presence.getAttribute('data-pose')).toBe('welcome.webp')

      act(() => vi.advanceTimersByTime(30_000))

      expect(presence.getAttribute('data-pose')).toBe('welcome.webp')
      expect(presence.querySelector('.phantom-presence__status')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
