import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConfigField } from './config-field'

const schema = {
  description: 'Context window override',
  type: 'number'
} as const

describe('ConfigField context window guidance', () => {
  it('recommends automatic context sizing', () => {
    render(<ConfigField onChange={vi.fn()} schema={schema} schemaKey="model_context_length" value={0} />)

    expect(screen.getByRole('combobox', { name: 'Context Window' }).textContent).toContain('Auto — Recommended')
  })

  it('warns when an explicit very-large context is preserved', () => {
    render(<ConfigField onChange={vi.fn()} schema={schema} schemaKey="model_context_length" value={262_144} />)

    expect(screen.getByRole('combobox', { name: 'Context Window' }).textContent).toContain(
      '262K — Very large / slow'
    )
    expect(screen.getByText(/substantially more memory/i)).not.toBeNull()
  })

  it('keeps a custom explicit value visible instead of silently replacing it', () => {
    render(<ConfigField onChange={vi.fn()} schema={schema} schemaKey="model_context_length" value={200_000} />)

    expect(screen.getByRole('combobox', { name: 'Context Window' }).textContent).toContain('Custom — 200,000')
  })
})
