import { useMemo, useRef, useState } from 'react'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { saveHermesConfig } from '@/hermes'
import { useI18n } from '@/i18n'
import { Brain, ImageIcon, MonitorPlay, SlidersHorizontal } from '@/lib/icons'
import { notify, notifyError } from '@/store/notifications'

import { setHermesConfigCache, useHermesConfigRecord } from '../hooks/use-config-record'
import { useOnProfileSwitch } from '../hooks/use-on-profile-switch'

import {
  AUTO_ROUTING_LANES,
  AUTO_ROUTING_OPTIONS,
  type AutoRoutingAccess,
  autoRoutingFromConfig,
  type AutoRoutingLane,
  configWithAutoRoute
} from './auto-routing-config'
import { ListRow, Pill, SettingsContent, SettingsSection, SettingsSkeleton } from './primitives'

const LANE_ICONS = {
  reasoning: Brain,
  image: ImageIcon,
  video: MonitorPlay
} as const

export function AutoRoutingSettings({ onConfigSaved }: { onConfigSaved?: () => void }) {
  const { t } = useI18n()
  const copy = t.settings.providers.autoRouting
  const { data: config, isError, isFetching, isPending } = useHermesConfigRecord()
  const [savingLane, setSavingLane] = useState<AutoRoutingLane | null>(null)
  const profileEpoch = useRef(0)

  useOnProfileSwitch(() => {
    profileEpoch.current += 1
    setSavingLane(null)
  })

  const routing = useMemo(() => autoRoutingFromConfig(config ?? {}), [config])

  const accessLabels: Record<AutoRoutingAccess, string> = {
    api: copy.accessApi,
    model: copy.accessModel,
    subscription: copy.accessSubscription
  }

  async function updateLane(lane: AutoRoutingLane, optionId: string) {
    if (!config || savingLane) {
      return
    }

    const epoch = profileEpoch.current
    const previous = config
    const next = configWithAutoRoute(previous, lane, optionId)
    setSavingLane(lane)
    setHermesConfigCache(next)

    try {
      const result = await saveHermesConfig(next)

      if (!result.ok) {
        throw new Error(copy.saveFailed)
      }

      if (profileEpoch.current !== epoch) {
        return
      }

      onConfigSaved?.()
      notify({
        kind: 'success',
        title: copy.savedTitle,
        message: copy.savedMessage(copy.lanes[lane].title)
      })
    } catch (error) {
      if (profileEpoch.current === epoch) {
        setHermesConfigCache(previous)
        notifyError(error, copy.saveFailed)
      }
    } finally {
      if (profileEpoch.current === epoch) {
        setSavingLane(null)
      }
    }
  }

  if ((isPending && !config) || (isFetching && !config)) {
    return <SettingsSkeleton sections={[{ heading: true, rows: 3 }]} />
  }

  if (isError && !config) {
    return (
      <SettingsContent>
        <p className="py-8 text-center text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
          {copy.loadFailed}
        </p>
      </SettingsContent>
    )
  }

  return (
    <SettingsContent>
      <SettingsSection icon={SlidersHorizontal} title={copy.title}>
        <p className="mb-2 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {copy.description}
        </p>
        <div className="grid gap-1">
          {AUTO_ROUTING_LANES.map(lane => {
            const laneCopy = copy.lanes[lane]
            const LaneIcon = LANE_ICONS[lane]
            const options = AUTO_ROUTING_OPTIONS[lane]

            const grouped = {
              model: options.filter(option => option.access === 'model'),
              api: options.filter(option => option.access === 'api'),
              subscription: options.filter(option => option.access === 'subscription')
            }

            return (
              <ListRow
                action={
                  <Select
                    disabled={Boolean(savingLane) || isFetching}
                    onValueChange={value => void updateLane(lane, value)}
                    value={routing.routes[lane].option_id}
                  >
                    <SelectTrigger aria-label={laneCopy.title} className="w-full @2xl:w-72">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['model', 'api', 'subscription'] as const).map(access =>
                        grouped[access].length > 0 ? (
                          <SelectGroup key={access}>
                            <SelectLabel>{accessLabels[access]}</SelectLabel>
                            {grouped[access].map(option => (
                              <SelectItem key={option.id} value={option.id}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ) : null
                      )}
                    </SelectContent>
                  </Select>
                }
                description={laneCopy.description}
                key={lane}
                title={
                  <span className="inline-flex items-center gap-2">
                    <LaneIcon className="size-4 text-muted-foreground" />
                    {laneCopy.title}
                    {savingLane === lane ? <Pill tone="primary">{copy.saving}</Pill> : null}
                  </span>
                }
              />
            )
          })}
        </div>
        <p className="mt-2 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {copy.subscriptionNote}
        </p>
      </SettingsSection>
    </SettingsContent>
  )
}
