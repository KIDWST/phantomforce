import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { $currentCwd } from '@/store/session'

import { EngineeringRunsPanel } from './engineering-runs'

const gateway = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@/app/gateway/hooks/use-gateway-request', () => ({
  useGatewayRequest: () => ({ requestGateway: gateway.request })
}))

describe('EngineeringRunsPanel', () => {
  beforeEach(() => {
    $currentCwd.set('C:\\work\\app')
    gateway.request.mockReset()
    gateway.request.mockImplementation(async (method: string) => {
      if (method === 'engineering.runs') {
        return {
          runs: [
            {
              created_at: 1_700_000_000,
              cwd: 'C:\\work\\app',
              id: 'run-1',
              status: 'running',
              title: 'Repair app',
              updated_at: 1_700_000_100
            }
          ]
        }
      }

      if (method === 'engineering.run') {
        return {
          run: {
            changesets: [{ checkpoint_hash: 'abcdef123456', id: 'change-1', status: 'applied' }],
            created_at: 1_700_000_000,
            cwd: 'C:\\work\\app',
            evidence: [{ id: 'evidence-1', kind: 'test', label: 'Unit tests', status: 'passed' }],
            goal: 'Fix the observed failure',
            id: 'run-1',
            status: 'running',
            tasks: [
              { id: 'task-1', status: 'succeeded', title: 'Inspect failure' },
              { id: 'task-2', parent_id: 'task-1', status: 'running', title: 'Fix root cause' }
            ],
            title: 'Repair app',
            tool_results: [{ duration_ms: 42, id: 'tool-1', status: 'ok', tool_name: 'terminal' }],
            updated_at: 1_700_000_100
          }
        }
      }

      if (method === 'engineering.repo_status') {
        return { index: null }
      }

      if (method === 'engineering.repo_index') {
        return { index: { file_count: 12, status: 'ready', symbol_count: 34 } }
      }

      throw new Error(`Unexpected method: ${method}`)
    })
  })

  it('shows a live run with nested tasks, tool results, evidence, and indexing', async () => {
    render(<EngineeringRunsPanel />)

    expect(await screen.findByRole('heading', { name: 'Repair app' })).toBeTruthy()
    expect(screen.getByText('Inspect failure')).toBeTruthy()
    expect(screen.getByText('Fix root cause')).toBeTruthy()
    expect(screen.getByText('Unit tests')).toBeTruthy()
    expect(screen.getByText('terminal')).toBeTruthy()
    expect(screen.getByText('abcdef1234')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Build index' }))

    await waitFor(() => expect(screen.getByText('12 files · 34 symbols · ready')).toBeTruthy())
  })
})
