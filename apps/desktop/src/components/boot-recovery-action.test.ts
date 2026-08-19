import { describe, expect, it, vi } from 'vitest'

import { runBootRecovery } from './boot-recovery-action'

describe('runBootRecovery', () => {
  it('reloads only after the background reset is confirmed', async () => {
    const reload = vi.fn()

    await runBootRecovery(async () => ({ ok: true }), reload)

    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not reload when recovery fails', async () => {
    const reload = vi.fn()

    await expect(runBootRecovery(async () => Promise.reject(new Error('teardown failed')), reload)).rejects.toThrow(
      'teardown failed'
    )
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not reload when the main process does not confirm recovery', async () => {
    const reload = vi.fn()

    await expect(runBootRecovery(async () => undefined, reload)).rejects.toThrow(/not confirmed/i)
    expect(reload).not.toHaveBeenCalled()
  })
})
