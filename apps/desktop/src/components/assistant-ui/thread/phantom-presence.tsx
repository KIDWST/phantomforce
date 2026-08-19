import { useStore } from '@nanostores/react'
import { type FC, useEffect } from 'react'

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

const PHANTOM_POSE_BY_STATE: Record<PetState, string> = {
  failed: 'point.webp',
  idle: 'welcome.webp',
  jump: 'laugh.webp',
  review: 'chin.webp',
  run: 'mode-dark-write.webp',
  waiting: 'mode-dark-ask.webp',
  wave: 'present.webp'
}

export function phantomAssetPath(file: string, base = import.meta.env.BASE_URL): string {
  const normalizedBase = base.endsWith('/') ? base : base + '/'

  return normalizedBase + file.replace(/^\/+/, '')
}

export const PhantomPresence: FC = () => {
  const petState = useStore($petState)
  const phase = phantomPresencePhase(petState)

  useEffect(() => {
    for (const file of Object.values(PHANTOM_POSE_BY_STATE)) {
      const image = new Image()

      image.src = phantomAssetPath(file)
    }
  }, [])

  const pose = PHANTOM_POSE_BY_STATE[petState]

  return (
    <div
      aria-hidden="true"
      className="phantom-presence"
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
