import type { HermesConfigRecord } from '@/types/hermes'

import { getNested, setNested } from './helpers'

export const AUTO_ROUTING_LANES = ['reasoning', 'image', 'video'] as const

export type AutoRoutingLane = (typeof AUTO_ROUTING_LANES)[number]

export type AutoRoutingAccess = 'api' | 'model' | 'subscription'

export interface AutoRoutingOption {
  access: AutoRoutingAccess
  id: string
  label: string
}

export interface PhantomBotAutoRouting {
  routes: Record<AutoRoutingLane, { option_id: string }>
  version: 1
}

export const AUTO_ROUTING_OPTIONS: Record<AutoRoutingLane, readonly AutoRoutingOption[]> = {
  reasoning: [
    { access: 'model', id: 'openrouter.glm-5.2', label: 'OpenRouter · GLM 5.2' },
    { access: 'model', id: 'openrouter.kimi-k3', label: 'OpenRouter · Kimi K3' },
    { access: 'api', id: 'openai.gpt-5.1-codex', label: 'OpenAI · GPT-5.1 Codex' },
    { access: 'api', id: 'anthropic.claude-sonnet-5', label: 'Anthropic · Claude Sonnet 5' },
    { access: 'api', id: 'gemini.gemini-2.5-flash', label: 'Gemini · 2.5 Flash' }
  ],
  image: [
    { access: 'api', id: 'openai.gpt-image-1', label: 'OpenAI · GPT Image 1' },
    { access: 'api', id: 'gemini.image', label: 'Gemini · Images' },
    { access: 'subscription', id: 'chatgpt.subscription', label: 'ChatGPT subscription · Images' },
    { access: 'subscription', id: 'gemini.subscription', label: 'Gemini subscription · Images' }
  ],
  video: [
    { access: 'api', id: 'higgsfield.api', label: 'Higgsfield · API video' },
    { access: 'api', id: 'gemini.video', label: 'Gemini · Video API' },
    { access: 'subscription', id: 'higgsfield.subscription', label: 'Higgsfield subscription · Video' },
    { access: 'subscription', id: 'gemini.subscription', label: 'Gemini subscription · Video' }
  ]
}

export const DEFAULT_AUTO_ROUTING: PhantomBotAutoRouting = {
  version: 1,
  routes: {
    reasoning: { option_id: 'openrouter.glm-5.2' },
    image: { option_id: 'openai.gpt-image-1' },
    video: { option_id: 'higgsfield.subscription' }
  }
}

const optionIds = Object.fromEntries(
  AUTO_ROUTING_LANES.map(lane => [lane, new Set(AUTO_ROUTING_OPTIONS[lane].map(option => option.id))])
) as Record<AutoRoutingLane, Set<string>>

function routeOptionId(value: unknown, lane: AutoRoutingLane): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_AUTO_ROUTING.routes[lane].option_id
  }

  const optionId = (value as Record<string, unknown>).option_id

  return typeof optionId === 'string' && optionIds[lane].has(optionId)
    ? optionId
    : DEFAULT_AUTO_ROUTING.routes[lane].option_id
}

/** Parse the profile-scoped config defensively. Unknown future/backend values
 * fall back per lane instead of blanking every selector. */
export function autoRoutingFromConfig(config: HermesConfigRecord): PhantomBotAutoRouting {
  const raw = getNested(config, 'phantombot.autoRouting')

  const routes =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).routes : undefined

  const routeRecord =
    routes && typeof routes === 'object' && !Array.isArray(routes) ? (routes as Record<string, unknown>) : {}

  return {
    version: 1,
    routes: {
      reasoning: { option_id: routeOptionId(routeRecord.reasoning, 'reasoning') },
      image: { option_id: routeOptionId(routeRecord.image, 'image') },
      video: { option_id: routeOptionId(routeRecord.video, 'video') }
    }
  }
}

/** Update one lane while preserving every other profile setting. Credentials
 * never enter this object; provider keys remain in the backend-owned .env. */
export function configWithAutoRoute(
  config: HermesConfigRecord,
  lane: AutoRoutingLane,
  optionId: string
): HermesConfigRecord {
  if (!optionIds[lane].has(optionId)) {
    throw new Error(`Unsupported ${lane} Auto route: ${optionId}`)
  }

  const current = autoRoutingFromConfig(config)

  return setNested(config, 'phantombot.autoRouting', {
    ...current,
    routes: {
      ...current.routes,
      [lane]: { option_id: optionId }
    }
  })
}
