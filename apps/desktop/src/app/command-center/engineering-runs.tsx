import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import { Button } from '@/components/ui/button'
import { AlertCircle, CheckCircle2, Clock, GitBranch, RefreshCw } from '@/lib/icons'
import { relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { $currentCwd } from '@/store/session'

interface RunTask {
  assigned_agent?: string
  id: string
  parent_id?: null | string
  result?: string
  status: string
  title: string
}

interface ToolResultRecord {
  duration_ms: number
  error_code?: null | string
  id: string
  status: string
  tool_name: string
}

interface ChangeSetRecord {
  checkpoint_hash?: null | string
  diff_stat?: null | string
  id: string
  status: string
}

interface EvidenceRecord {
  command?: null | string
  id: string
  kind: string
  label: string
  path?: null | string
  status: string
}

interface EngineeringRun {
  changesets?: ChangeSetRecord[]
  created_at: number
  cwd?: string
  evidence?: EvidenceRecord[]
  goal?: string
  id: string
  project_key?: string
  status: string
  summary?: string
  tasks?: RunTask[]
  title: string
  tool_results?: ToolResultRecord[]
  updated_at: number
}

interface RepoIndex {
  file_count?: number
  indexed_at?: number
  repo_root?: string
  skipped_count?: number
  status?: string
  symbol_count?: number
}

const TERMINAL_STATUSES = new Set(['cancelled', 'failed', 'succeeded'])

function StatusBadge({ status }: { status: string }) {
  const healthy =
    status === 'applied' ||
    status === 'ok' ||
    status === 'passed' ||
    status === 'ready' ||
    status === 'succeeded' ||
    status === 'verified'

  const failed = status === 'error' || status === 'failed'
  const Icon = healthy ? CheckCircle2 : failed ? AlertCircle : Clock

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[length:var(--conversation-caption-font-size)] font-medium',
        healthy
          ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
          : failed
            ? 'bg-red-500/12 text-red-600 dark:text-red-400'
            : 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
      )}
    >
      <Icon className="size-3" />
      {status.replaceAll('_', ' ')}
    </span>
  )
}

function TaskTree({ tasks }: { tasks: RunTask[] }) {
  const byParent = useMemo(() => {
    const grouped = new Map<string, RunTask[]>()

    for (const task of tasks) {
      const key = task.parent_id || ''
      grouped.set(key, [...(grouped.get(key) || []), task])
    }

    return grouped
  }, [tasks])

  const renderLevel = (parentId = '', depth = 0) =>
    (byParent.get(parentId) || []).map(task => (
      <li className="py-1" key={task.id}>
        <div className="flex items-start justify-between gap-2" style={{ paddingLeft: `${depth * 14}px` }}>
          <div className="min-w-0">
            <div className="truncate text-[length:var(--conversation-caption-font-size)] font-medium text-foreground">
              {task.title}
            </div>
            {(task.assigned_agent || task.result) && (
              <div className="truncate text-xs text-(--ui-text-tertiary)">{task.result || task.assigned_agent}</div>
            )}
          </div>
          <StatusBadge status={task.status} />
        </div>
        {(byParent.get(task.id)?.length || 0) > 0 && <ul>{renderLevel(task.id, depth + 1)}</ul>}
      </li>
    ))

  return <ul>{renderLevel()}</ul>
}

function EvidenceGrid({ run }: { run: EngineeringRun }) {
  const tools = run.tool_results || []
  const evidence = run.evidence || []
  const changes = run.changesets || []

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <section className="rounded-lg border border-border/70 p-3">
        <h4 className="mb-2 text-sm font-semibold text-foreground">Tool results · {tools.length}</h4>
        {tools.length ? (
          <ul className="space-y-1.5">
            {tools.slice(-12).map(tool => (
              <li className="flex items-center justify-between gap-2 text-xs" key={tool.id}>
                <span className="min-w-0 truncate text-(--ui-text-secondary)">{tool.tool_name}</span>
                <span className={tool.status === 'ok' ? 'text-emerald-500' : 'text-red-500'}>
                  {tool.status} · {tool.duration_ms}ms
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-(--ui-text-tertiary)">No tool results yet.</p>
        )}
      </section>

      <section className="rounded-lg border border-border/70 p-3">
        <h4 className="mb-2 text-sm font-semibold text-foreground">Verification evidence · {evidence.length}</h4>
        {evidence.length ? (
          <ul className="space-y-2">
            {evidence.slice(-10).map(item => (
              <li className="text-xs" key={item.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-(--ui-text-secondary)">{item.label}</span>
                  <StatusBadge status={item.status} />
                </div>
                {(item.command || item.path) && (
                  <div className="mt-0.5 truncate font-mono text-[11px] text-(--ui-text-tertiary)">
                    {item.command || item.path}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-(--ui-text-tertiary)">No evidence captured yet.</p>
        )}
      </section>

      <section className="rounded-lg border border-border/70 p-3">
        <h4 className="mb-2 text-sm font-semibold text-foreground">ChangeSets · {changes.length}</h4>
        {changes.length ? (
          <ul className="space-y-2">
            {changes.slice(-10).map(change => (
              <li className="text-xs" key={change.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-(--ui-text-secondary)">
                    {change.checkpoint_hash?.slice(0, 10) || change.id.slice(0, 10)}
                  </span>
                  <StatusBadge status={change.status} />
                </div>
                {change.diff_stat && <div className="mt-0.5 truncate text-(--ui-text-tertiary)">{change.diff_stat}</div>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-(--ui-text-tertiary)">No checkpointed changes yet.</p>
        )}
      </section>
    </div>
  )
}

export function EngineeringRunsPanel() {
  const { requestGateway } = useGatewayRequest()
  const currentCwd = useStore($currentCwd).trim()
  const [runs, setRuns] = useState<EngineeringRun[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [selectedRun, setSelectedRun] = useState<EngineeringRun | null>(null)
  const [repoIndex, setRepoIndex] = useState<null | RepoIndex>(null)
  const [loading, setLoading] = useState(true)
  const [indexing, setIndexing] = useState(false)
  const [error, setError] = useState('')

  const loadRuns = useCallback(async () => {
    try {
      const response = await requestGateway<{ runs?: EngineeringRun[] }>('engineering.runs', { limit: 100 })
      const next = response.runs || []
      setRuns(next)
      setSelectedId(previous => previous || next[0]?.id || '')
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [requestGateway])

  const loadDetail = useCallback(
    async (runId: string) => {
      if (!runId) {
        setSelectedRun(null)

        return
      }

      try {
        const response = await requestGateway<{ run?: EngineeringRun | null }>('engineering.run', { run_id: runId })
        setSelectedRun(response.run || null)
        const cwd = response.run?.cwd || currentCwd

        if (cwd) {
          const status = await requestGateway<{ index?: null | RepoIndex }>('engineering.repo_status', { cwd })
          setRepoIndex(status.index || null)
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    },
    [currentCwd, requestGateway]
  )

  useEffect(() => {
    void loadRuns()
    const interval = window.setInterval(() => void loadRuns(), 4000)

    return () => window.clearInterval(interval)
  }, [loadRuns])

  useEffect(() => {
    void loadDetail(selectedId)
  }, [loadDetail, selectedId, runs])

  const indexRepository = useCallback(async () => {
    const cwd = selectedRun?.cwd || currentCwd

    if (!cwd) {
      return
    }

    setIndexing(true)
    setError('')

    try {
      const response = await requestGateway<{ index?: RepoIndex }>('engineering.repo_index', { cwd })
      setRepoIndex(response.index || null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setIndexing(false)
    }
  }, [currentCwd, requestGateway, selectedRun?.cwd])

  if (loading) {
    return <div className="grid min-h-48 place-items-center text-sm text-(--ui-text-tertiary)">Loading runs…</div>
  }

  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-y-auto border-r border-border/60 pr-3 max-lg:max-h-52 max-lg:border-b max-lg:border-r-0 max-lg:pb-3 max-lg:pr-0">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs text-(--ui-text-tertiary)">{runs.length} durable runs</span>
          <Button aria-label="Refresh runs" onClick={() => void loadRuns()} size="icon-xs" variant="ghost">
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        {runs.length ? (
          <ul className="space-y-1">
            {runs.map(run => (
              <li key={run.id}>
                <button
                  className={cn(
                    'w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-(--chrome-action-hover)',
                    selectedId === run.id && 'bg-(--chrome-action-hover)'
                  )}
                  onClick={() => setSelectedId(run.id)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{run.title}</span>
                    {!TERMINAL_STATUSES.has(run.status) && <span className="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-500" />}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-(--ui-text-tertiary)">
                    <span className="truncate">{run.status.replaceAll('_', ' ')}</span>
                    <span className="shrink-0">{relativeTime(run.updated_at * 1000)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-(--ui-text-tertiary)">
            Runs appear here automatically as engineering tools execute.
          </div>
        )}
      </aside>

      <main className="min-h-0 overflow-y-auto pr-1">
        {error && (
          <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/8 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
        {selectedRun ? (
          <div className="space-y-4">
            <header>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-foreground">{selectedRun.title}</h3>
                <StatusBadge status={selectedRun.status} />
              </div>
              {selectedRun.goal && <p className="mt-1 text-sm text-(--ui-text-secondary)">{selectedRun.goal}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-(--ui-text-tertiary)">
                {selectedRun.cwd && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <GitBranch className="size-3" />
                    <span className="max-w-96 truncate font-mono">{selectedRun.cwd}</span>
                  </span>
                )}
                <span>Updated {relativeTime(selectedRun.updated_at * 1000)}</span>
              </div>
            </header>

            <section className="rounded-lg border border-border/70 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">Repository intelligence</h4>
                  <p className="text-xs text-(--ui-text-tertiary)">
                    {repoIndex
                      ? `${repoIndex.file_count || 0} files · ${repoIndex.symbol_count || 0} symbols · ${repoIndex.status || 'ready'}`
                      : 'No durable index for this repository yet.'}
                  </p>
                </div>
                {(selectedRun.cwd || currentCwd) && (
                  <Button disabled={indexing} onClick={() => void indexRepository()} size="xs" variant="secondary">
                    {indexing ? 'Indexing…' : repoIndex ? 'Re-index' : 'Build index'}
                  </Button>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-border/70 p-3">
              <h4 className="mb-2 text-sm font-semibold text-foreground">Plan and subtasks · {selectedRun.tasks?.length || 0}</h4>
              {selectedRun.tasks?.length ? (
                <TaskTree tasks={selectedRun.tasks} />
              ) : (
                <p className="text-xs text-(--ui-text-tertiary)">No explicit tasks recorded yet.</p>
              )}
            </section>

            <EvidenceGrid run={selectedRun} />

            {selectedRun.summary && (
              <section className="rounded-lg border border-border/70 p-3">
                <h4 className="mb-1 text-sm font-semibold text-foreground">Run summary</h4>
                <p className="whitespace-pre-wrap text-sm text-(--ui-text-secondary)">{selectedRun.summary}</p>
              </section>
            )}
          </div>
        ) : (
          <div className="grid min-h-48 place-items-center text-sm text-(--ui-text-tertiary)">Select a run to inspect it.</div>
        )}
      </main>
    </div>
  )
}
