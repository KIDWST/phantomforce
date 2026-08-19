import type { EventEmitter } from 'node:events'

type ConsoleMethod = (...args: unknown[]) => unknown

export interface OutputConsole {
  debug?: ConsoleMethod
  error?: ConsoleMethod
  info?: ConsoleMethod
  log?: ConsoleMethod
  warn?: ConsoleMethod
}

export interface ProcessOutputGuardOptions {
  console?: OutputConsole
  stderr?: EventEmitter | null
  stdout?: EventEmitter | null
}

const guardedStreams = new WeakSet<object>()
const guardedConsoles = new WeakSet<object>()
const CONSOLE_METHODS = ['debug', 'error', 'info', 'log', 'warn'] as const

export function isBrokenPipeError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EPIPE')
}

function guardOutputStream(stream: EventEmitter | null | undefined): void {
  if (!stream || guardedStreams.has(stream)) {
    return
  }

  // A desktop GUI must not depend on the lifetime of the shell or launcher
  // that happened to provide stdout/stderr. Once that diagnostic pipe closes,
  // Node emits EPIPE on the stream; without a listener Electron treats it as
  // an uncaught main-process exception.
  stream.on('error', () => undefined)
  guardedStreams.add(stream)
}

function guardConsole(consoleLike: OutputConsole | undefined): void {
  if (!consoleLike || guardedConsoles.has(consoleLike)) {
    return
  }

  for (const method of CONSOLE_METHODS) {
    const original = consoleLike[method]

    if (typeof original !== 'function') {
      continue
    }

    consoleLike[method] = (...args: unknown[]) => {
      try {
        return Reflect.apply(original, consoleLike, args)
      } catch (error) {
        if (!isBrokenPipeError(error)) {
          throw error
        }

        return undefined
      }
    }
  }

  guardedConsoles.add(consoleLike)
}

export function installProcessOutputGuards(options: ProcessOutputGuardOptions = {}): void {
  guardOutputStream(options.stdout === undefined ? process.stdout : options.stdout)
  guardOutputStream(options.stderr === undefined ? process.stderr : options.stderr)
  guardConsole(options.console ?? console)
}
