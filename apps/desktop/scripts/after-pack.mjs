/**
 * electron-builder afterPack hook.
 *
 * Every Windows package is stamped with the PhantomBot icon and executable
 * identity. Product identity is a release invariant: a build that falls back
 * to the stock Electron icon must fail here instead of reaching users.
 */

import path from 'node:path'

import { stampExeIdentity } from './set-exe-identity.mjs'

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return
  }

  const productName = context.packager?.appInfo?.productFilename || 'PhantomBot'
  const exe = path.join(context.appOutDir, `${productName}.exe`)
  const desktopRoot = path.resolve(import.meta.dirname, '..')

  await stampExeIdentity(exe, desktopRoot)
}
