import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $petActivity } from '@/store/pet'
import { $busy } from '@/store/session'

import {
  PHANTOM_GESTURES_BY_STATE,
  PHANTOM_POSE_CANVAS_SIZE,
  phantomAssetPath,
  phantomGesturePose,
  PhantomPresence,
  phantomPresencePhase
} from './phantom-presence'

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

  it('uses a deterministic gesture sequence for every live state', () => {
    expect(phantomGesturePose('idle', 0)).toBe('welcome.webp')
    expect(phantomGesturePose('idle', 1)).toBe('present.webp')
    expect(phantomGesturePose('idle', 4)).toBe('welcome.webp')
    expect(phantomGesturePose('review', 1)).toBe('conjure.webp')
    expect(phantomGesturePose('run', 2)).toBe('point.webp')
    expect(new Set(Object.values(PHANTOM_GESTURES_BY_STATE).flat()).size).toBe(8)
  })

  it('reacts to the live reasoning signal', () => {
    $petActivity.set({ busy: true, reasoning: true })
    render(<PhantomPresence />)

    const presence = screen.getByTestId('phantom-presence')

    expect(presence.getAttribute('data-phase')).toBe('reasoning')
    expect(presence.getAttribute('data-pose')).toBe('chin.webp')
    expect(presence.querySelector('img')?.getAttribute('src')).toContain('chin.webp')
    expect(presence.querySelector('img')?.getAttribute('height')).toBe(String(PHANTOM_POSE_CANVAS_SIZE))
    expect(presence.querySelector('img')?.getAttribute('width')).toBe(String(PHANTOM_POSE_CANVAS_SIZE))
    expect(presence.getAttribute('data-pose-canvas')).toBe(String(PHANTOM_POSE_CANVAS_SIZE))
    expect(presence.getAttribute('data-slot')).toBe('phantom-presence')
    expect(presence.querySelector('.phantom-presence__glow')).not.toBeNull()
    expect(presence.querySelectorAll('.phantom-presence__front-wisp')).toHaveLength(2)
  })

  it('cycles the idle Phantom through visible gestures', () => {
    vi.useFakeTimers()

    try {
      render(<PhantomPresence />)

      const presence = screen.getByTestId('phantom-presence')

      expect(presence.getAttribute('data-pose')).toBe('welcome.webp')

      act(() => vi.advanceTimersByTime(4_200))

      expect(presence.getAttribute('data-pose')).toBe('present.webp')
      expect(presence.getAttribute('data-gesture-step')).toBe('1')
      expect(presence.querySelector('.phantom-presence__status')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
