import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { test } from 'vitest'

import { installProcessOutputGuards, isBrokenPipeError, type OutputConsole } from './process-output-guard'

function pipeError(): NodeJS.ErrnoException {
  return Object.assign(new Error('broken pipe'), { code: 'EPIPE' })
}

test('recognizes EPIPE without matching unrelated errors', () => {
  assert.equal(isBrokenPipeError(pipeError()), true)
  assert.equal(isBrokenPipeError(Object.assign(new Error('closed'), { code: 'EBADF' })), false)
  assert.equal(isBrokenPipeError(null), false)
})

test('closed diagnostic streams cannot crash the Electron main process', () => {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()

  installProcessOutputGuards({ console: {}, stderr, stdout })

  assert.doesNotThrow(() => stdout.emit('error', pipeError()))
  assert.doesNotThrow(() => stderr.emit('error', pipeError()))
})

test('console wrappers swallow synchronous EPIPE and preserve other exceptions', () => {
  const epipeConsole: OutputConsole = {
    error: () => {
      throw pipeError()
    }
  }

  const realError = new Error('real logging failure')

  const failingConsole: OutputConsole = {
    error: () => {
      throw realError
    }
  }

  installProcessOutputGuards({ console: epipeConsole, stderr: null, stdout: null })
  installProcessOutputGuards({ console: failingConsole, stderr: null, stdout: null })

  assert.doesNotThrow(() => epipeConsole.error?.('ignored'))
  assert.throws(() => failingConsole.error?.('reported'), realError)
})

test('guard installation is idempotent', () => {
  const stdout = new EventEmitter()
  const outputConsole: OutputConsole = { log: () => undefined }

  installProcessOutputGuards({ console: outputConsole, stderr: null, stdout })
  const wrapped = outputConsole.log
  installProcessOutputGuards({ console: outputConsole, stderr: null, stdout })

  assert.equal(stdout.listenerCount('error'), 1)
  assert.equal(outputConsole.log, wrapped)
})
