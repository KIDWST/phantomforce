import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { HermesGateway } from '@/hermes'
import { $gateway } from '@/store/gateway'

import { useGatewayRequest } from './use-gateway-request'

const fakeGateway = { connectionState: 'open' } as unknown as HermesGateway
const originalDesktop = window.hermesDesktop

afterEach(() => {
  $gateway.set(null)
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: originalDesktop, writable: true })
  vi.restoreAllMocks()
})

describe('useGatewayRequest', () => {
  // The composer's `/` completions only exist when ChatBar receives a non-null
  // gateway PROP. `gatewayRef` is populated by a subscription effect, so it is
  // still null on the first render — a surface that read the ref while
  // rendering (session tiles / ⌘T tabs) shipped `gateway={null}` and silently
  // lost slash completions. The returned `gateway` value must be live
  // immediately so that never happens again.
  it('exposes the live gateway on the first render, before effects run', () => {
    $gateway.set(fakeGateway)

    const { result } = renderHook(() => useGatewayRequest())

    expect(result.current.gateway).toBe(fakeGateway)
  })

  it('tracks the gateway when the active socket changes', () => {
    const { result } = renderHook(() => useGatewayRequest())

    expect(result.current.gateway).toBeNull()

    act(() => $gateway.set(fakeGateway))

    expect(result.current.gateway).toBe(fakeGateway)
  })

  it('reconnects and safely retries a timed-out session creation once', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('request timed out after 15s: session.create'))
      .mockResolvedValueOnce({ session_id: 'created-on-first-attempt' })

    const close = vi.fn()
    const connect = vi.fn().mockResolvedValue(undefined)
    const staleGateway = { close, connect, connectionState: 'open', request } as unknown as HermesGateway
    const getConnection = vi.fn().mockResolvedValue({ profile: 'default', wsUrl: 'ws://fresh-gateway' })

    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { getConnection },
      writable: true
    })
    $gateway.set(staleGateway)

    const { result } = renderHook(() => useGatewayRequest())
    let response: unknown

    await act(async () => {
      response = await result.current.requestGateway('session.create', { source: 'desktop' })
    })

    expect(response).toEqual({ session_id: 'created-on-first-attempt' })
    expect(close).toHaveBeenCalledOnce()
    expect(connect).toHaveBeenCalledWith('ws://fresh-gateway')
    expect(request).toHaveBeenCalledTimes(2)

    const [firstMethod, firstParams, firstTimeout] = request.mock.calls[0]
    const [secondMethod, secondParams, secondTimeout] = request.mock.calls[1]

    expect(firstMethod).toBe('session.create')
    expect(secondMethod).toBe('session.create')
    expect(firstTimeout).toBe(15_000)
    expect(secondTimeout).toBe(15_000)
    expect(firstParams.client_request_id).toEqual(expect.any(String))
    expect(secondParams.client_request_id).toBe(firstParams.client_request_id)
  })
})
