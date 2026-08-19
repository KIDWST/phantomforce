export type BootRecoveryResult = { ok: boolean }

/**
 * Complete a destructive boot recovery only after the main process confirms
 * that teardown/reset finished. Reloading on a rejected or missing IPC result
 * can race the still-running gateway and recreate the same boot failure.
 */
export async function runBootRecovery(
  action: () => Promise<BootRecoveryResult | undefined>,
  reload: () => void
) {
  const result = await action()

  if (result?.ok !== true) {
    throw new Error('PhantomBot recovery was not confirmed by the background service.')
  }

  reload()
}
