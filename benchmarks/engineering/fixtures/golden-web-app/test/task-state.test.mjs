import assert from 'node:assert/strict'
import test from 'node:test'

import { completionPercent, nextTaskId } from '../src/task-state.mjs'

test('reports completion for the API task vocabulary', () => {
  assert.equal(completionPercent([
    { id: 1, status: 'completed' },
    { id: 2, status: 'in-progress' },
    { id: 3, status: 'completed' },
    { id: 4, status: 'queued' }
  ]), 50)
})

test('allocates an id after the highest existing task', () => {
  assert.equal(nextTaskId([{ id: 4 }, { id: 9 }]), 10)
})
