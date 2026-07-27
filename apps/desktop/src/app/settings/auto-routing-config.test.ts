import { describe, expect, it } from 'vitest'

import {
  AUTO_ROUTING_LANES,
  AUTO_ROUTING_OPTIONS,
  autoRoutingFromConfig,
  configWithAutoRoute,
  DEFAULT_AUTO_ROUTING
} from './auto-routing-config'

describe('PhantomBot Auto routing config', () => {
  it('normalizes malformed and unknown lane values independently', () => {
    const parsed = autoRoutingFromConfig({
      phantombot: {
        autoRouting: {
          version: 99,
          routes: {
            reasoning: { option_id: 'openrouter.kimi-k3' },
            image: { option_id: 'unknown.image' },
            video: 'broken'
          }
        }
      }
    })

    expect(parsed).toEqual({
      version: 1,
      routes: {
        reasoning: { option_id: 'openrouter.kimi-k3' },
        image: DEFAULT_AUTO_ROUTING.routes.image,
        video: DEFAULT_AUTO_ROUTING.routes.video
      }
    })
  })

  it('updates one route while preserving unrelated profile config', () => {
    const original = {
      agent: { max_turns: 45 },
      display: { language: 'ja' },
      phantombot: {
        autoRouting: DEFAULT_AUTO_ROUTING
      }
    }

    const next = configWithAutoRoute(original, 'video', 'gemini.video')

    expect(next).not.toBe(original)
    expect(next.agent).toEqual(original.agent)
    expect(next.display).toEqual(original.display)
    expect(autoRoutingFromConfig(next).routes).toEqual({
      ...DEFAULT_AUTO_ROUTING.routes,
      video: { option_id: 'gemini.video' }
    })
    expect(autoRoutingFromConfig(original)).toEqual(DEFAULT_AUTO_ROUTING)
  })

  it('keeps credentials out of every persisted route option', () => {
    for (const lane of AUTO_ROUTING_LANES) {
      for (const option of AUTO_ROUTING_OPTIONS[lane]) {
        expect(option.id).not.toMatch(/key|token|secret|password/i)
      }
    }
  })

  it('rejects an option that does not belong to the selected lane', () => {
    expect(() => configWithAutoRoute({}, 'reasoning', 'higgsfield.subscription')).toThrow(
      /Unsupported reasoning Auto route/
    )
  })
})
