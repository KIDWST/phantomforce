import { useStore } from '@nanostores/react'
import { type FC, useEffect, useState } from 'react'

import { $petState, type PetState } from '@/store/pet'

export type PhantomPresencePhase = 'celebrate' | 'error' | 'idle' | 'listening' | 'reasoning' | 'working'

export function phantomPresencePhase(state: PetState): PhantomPresencePhase {
  switch (state) {
    case 'failed':
      return 'error'

    case 'jump':

    case 'wave':
      return 'celebrate'

    case 'waiting':
      return 'listening'

    case 'review':
      return 'reasoning'

    case 'run':
      return 'working'

    default:
      return 'idle'
  }
}

export const PHANTOM_GESTURES_BY_STATE: Record<PetState, readonly string[]> = {
  failed: ['point.webp', 'mode-dark-ask.webp'],
  idle: ['welcome.webp', 'present.webp', 'point.webp', 'conjure.webp'],
  jump: ['laugh.webp', 'present.webp'],
  review: ['chin.webp', 'conjure.webp', 'point.webp'],
  run: ['mode-dark-write.webp', 'conjure.webp', 'point.webp'],
  waiting: ['mode-dark-ask.webp', 'present.webp'],
  wave: ['present.webp', 'welcome.webp']
}

const PHANTOM_GESTURE_INTERVAL_BY_PHASE: Record<PhantomPresencePhase, number> = {
  celebrate: 1_100,
  error: 1_300,
  idle: 4_200,
  listening: 2_600,
  reasoning: 2_800,
  working: 2_400
}

export function phantomGesturePose(state: PetState, step: number): string {
  const sequence = PHANTOM_GESTURES_BY_STATE[state]
  const index = Math.abs(step) % sequence.length

  return sequence[index] ?? sequence[0] ?? 'welcome.webp'
}

export function phantomAssetPath(file: string, base = import.meta.env.BASE_URL): string {
  const normalizedBase = base.endsWith('/') ? base : base + '/'

  return normalizedBase + file.replace(/^\/+/, '')
}

export const PhantomPresence: FC = () => {
  const petState = useStore($petState)
  const phase = phantomPresencePhase(petState)
  const [gestureStep, setGestureStep] = useState(0)

  useEffect(() => {
    for (const file of new Set(Object.values(PHANTOM_GESTURES_BY_STATE).flat())) {
      const image = new Image()

      image.src = phantomAssetPath(file)
    }
  }, [])

  useEffect(() => {
    setGestureStep(0)

    const timer = window.setInterval(() => setGestureStep(step => step + 1), PHANTOM_GESTURE_INTERVAL_BY_PHASE[phase])

    return () => window.clearInterval(timer)
  }, [phase])

  const pose = phantomGesturePose(petState, gestureStep)

  return (
    <div
      aria-hidden="true"
      className="phantom-presence"
      data-gesture-step={gestureStep}
      data-phase={phase}
      data-pose={pose}
      data-slot="phantom-presence"
      data-testid="phantom-presence"
    >
      <div className="phantom-presence__glow" />
      <div className="phantom-presence__stage">
        <img alt="" className="phantom-presence__figure" draggable={false} key={pose} src={phantomAssetPath(pose)} />
      </div>
      <div className="phantom-presence__front-wisp phantom-presence__front-wisp--one" />
      <div className="phantom-presence__front-wisp phantom-presence__front-wisp--two" />
    </div>
  )
}
