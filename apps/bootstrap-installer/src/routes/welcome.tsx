import { type CSSProperties } from 'react'

import { BrandMark } from '../components/brand-mark'
import { HackeryButton } from '../components/hackery-button'
import { startInstall } from '../store'

/*
 * Welcome screen.
 *
 * Mirrors the PhantomBot desktop's chat intro:
 *   - PHANTOMBOT wordmark rendered in Collapse Bold, uppercase, tracked
 *   - mix-blend-plus-lighter so the type "glows" on the canvas
 *   - fit-text utility so the wordmark sizes itself to the column
 *
 * No install-path footer. The default install location is correct for
 * 99% of users; the rest will use the CLI installer with a -HermesHome
 * flag. Showing %LOCALAPPDATA% to grandma is developer-brain.
 */
export default function Welcome() {
  return (
    <div className="phantombot-fade-in flex h-full flex-col items-center justify-center gap-8 px-12 py-10">
      <div className="w-full max-w-2xl min-w-0 text-center">
        <BrandMark aria-hidden="true" className="phantombot-hero-mark mx-auto mb-6 size-28" />
        <p
          className="phantombot-wordmark fit-text mx-auto mb-4 w-full font-['Collapse'] font-bold uppercase leading-[0.9] tracking-[0.08em] mix-blend-plus-lighter"
          style={
            {
              '--fit-text-line-height': '0.9',
              '--fit-text-max': '6rem',
              '--fit-text-min': '2.5rem'
            } as CSSProperties
          }
        >
          <span>
            <span>PHANTOMBOT</span>
          </span>
          <span aria-hidden="true">PHANTOMBOT</span>
        </p>

        <p className="m-0 text-center text-base leading-normal tracking-tight text-muted-foreground">
          Your private local operator. We&rsquo;ll prepare the engine and desktop in the background &mdash; this takes a
          few minutes.
        </p>
      </div>

      <HackeryButton label="Install PhantomBot" onClick={() => void startInstall()} />
    </div>
  )
}
