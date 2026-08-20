import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { ChatGptPlusBridgeStatus } from '@/global'
import { openExternalLink } from '@/lib/external-link'
import { Brain, ImageIcon, Loader2, RefreshCw, Terminal } from '@/lib/icons'

import { ListRow, Pill, SettingsContent, SettingsSection } from './primitives'

const CHATGPT_URL = 'https://chatgpt.com/'

export function ChatGptPlusSettings() {
  const [status, setStatus] = useState<ChatGptPlusBridgeStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async (start = false) => {
    const bridge = window.hermesDesktop?.chatgptPlus

    if (!bridge) {
      setStatus({
        available: false,
        baseUrl: 'http://127.0.0.1:8792',
        browserUp: false,
        error: 'This desktop build does not expose the ChatGPT Plus bridge.',
        loggedIn: false,
        pid: null,
        running: false,
        service: 'phantom-chatgpt-plus-backend',
        version: null
      })

      return
    }

    setBusy(true)

    try {
      setStatus(start ? await bridge.start() : await bridge.health())
    } catch (error) {
      setStatus({
        available: false,
        baseUrl: 'http://127.0.0.1:8792',
        browserUp: false,
        error: error instanceof Error ? error.message : String(error),
        loggedIn: false,
        pid: null,
        running: false,
        service: 'phantom-chatgpt-plus-backend',
        version: null
      })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const ready = status?.available && status.browserUp
  const statusTone = ready ? 'primary' : status?.running ? 'warn' : 'muted'
  const statusLabel = ready ? (status.loggedIn ? 'ready' : 'login needed') : status?.running ? 'starting' : 'offline'

  return (
    <SettingsContent>
      <div className="grid gap-6">
        <SettingsSection
          aside={<Pill tone={statusTone}>{statusLabel}</Pill>}
          icon={Brain}
          meta="Local bridge"
          title="ChatGPT Plus"
        >
          <ListRow
            action={
              <div className="flex flex-wrap justify-end gap-2">
                <Button disabled={busy} onClick={() => void refresh(true)} size="sm" type="button">
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  {ready ? 'Check bridge' : 'Start bridge'}
                </Button>
                <Button onClick={() => openExternalLink(CHATGPT_URL)} size="sm" type="button" variant="outline">
                  Open ChatGPT
                </Button>
              </div>
            }
            description={
              status?.error
                ? `PhantomBot sends normal messages through the local-only ChatGPT backend. Last bridge status: ${status.error}`
                : 'PhantomBot sends normal messages through the local-only ChatGPT backend using your signed-in Plus session. No OpenAI API key or Codex route is used.'
            }
            hint={status?.baseUrl}
            title="Subscription-backed chat"
          />
          <ListRow
            action={
              <Button onClick={() => openExternalLink(CHATGPT_URL)} size="sm" type="button" variant="outline">
                Open image tools
              </Button>
            }
            description="Image requests are generated through the same Plus session, saved to the Hermes media cache, and returned directly in PhantomBot."
            title="Subscription-backed image generation"
          />
        </SettingsSection>

        <SettingsSection icon={Terminal} meta="Local execution" title="Coding route">
          <ListRow
            description="Phantom performs implementation, terminal work, debugging, tests, and verification locally through the consolidated model."
            hint="phantom local execution"
            title={
              <span className="inline-flex items-center gap-2">
                Phantom
                <Pill tone="primary">active</Pill>
              </span>
            }
          />
          <ListRow
            description="The browser runs in a dedicated persistent profile on 127.0.0.1 only. PhantomBot never stores your password and the provider does not use Codex OAuth."
            title="Separation boundary"
          />
        </SettingsSection>

        <SettingsSection icon={ImageIcon} title="Workflow">
          <ListRow
            description="General answers and images can use the signed-in Plus bridge. Action requests execute through Phantom with governed local tools and verification."
            title="Plan first, execute locally"
          />
        </SettingsSection>
      </div>
    </SettingsContent>
  )
}
