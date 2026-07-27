import { describe, expect, it } from 'vitest'

import type { ModelOptionProvider } from '@/types/hermes'

import { splitModelProviders } from './model-settings'

const provider = (slug: string, auth_type?: string): ModelOptionProvider => ({
  auth_type,
  models: [],
  name: slug,
  slug
})

describe('model provider access groups', () => {
  it('separates API/model providers from subscription connections', () => {
    const grouped = splitModelProviders([
      provider('openrouter', 'api_key'),
      provider('google', 'api_key'),
      provider('openai-codex', 'oauth_device_code'),
      provider('qwen-oauth', 'external'),
      provider('custom', 'custom')
    ])

    expect(grouped.modelProviders.map(item => item.slug)).toEqual(['openrouter', 'google', 'custom'])
    expect(grouped.subscriptions.map(item => item.slug)).toEqual(['openai-codex', 'qwen-oauth'])
  })

  it('uses provider metadata rather than treating every named model route as a subscription', () => {
    const grouped = splitModelProviders([
      provider('gemini', 'api_key'),
      provider('anthropic', 'api_key'),
      provider('some-future-account', 'subscription')
    ])

    expect(grouped.modelProviders.map(item => item.slug)).toEqual(['gemini', 'anthropic'])
    expect(grouped.subscriptions.map(item => item.slug)).toEqual(['some-future-account'])
  })
})
