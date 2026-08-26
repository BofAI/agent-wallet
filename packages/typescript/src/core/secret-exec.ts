import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { extname, win32 as win32Path } from 'node:path'

import { ExternalSignerConfigError } from './errors.js'

export const DEFAULT_SECRET_EXEC_STDOUT_LIMIT = 64 * 1024
export const DEFAULT_SECRET_EXEC_STDERR_LIMIT = 16 * 1024

export interface SecretExecOptions {
  env?: NodeJS.ProcessEnv
  maxStdoutBytes?: number
  maxStderrBytes?: number
  platform?: NodeJS.Platform
  comspec?: string
  defaultTimeoutMs: number
}

export interface SecretLaunchTarget {
  command: string
  args: string[]
  windowsVerbatimArguments?: boolean
}

const WINDOWS_CMD_UNSAFE_PATH = /[\0\r\n"^%!]/

export function executeSecretSource(
  ref: { exec: string; timeout?: number },
  label: string,
  options: SecretExecOptions,
): Promise<Buffer> {
  const platform = options.platform ?? process.platform
  try {
    accessSync(ref.exec, platform === 'win32' ? constants.F_OK : constants.X_OK)
  } catch {
    throw new ExternalSignerConfigError(
      `${label}: exec script not found or not executable: ${ref.exec}`,
    )
  }

  const launchTarget = resolveSecretLaunchTarget(
    ref.exec,
    platform,
    options.comspec ?? process.env.ComSpec ?? process.env.COMSPEC,
  )
  const timeoutMs = ref.timeout ?? options.defaultTimeoutMs
  const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_SECRET_EXEC_STDOUT_LIMIT
  const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_SECRET_EXEC_STDERR_LIMIT

  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(launchTarget.command, launchTarget.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ?? process.env,
      shell: false,
      windowsVerbatimArguments: launchTarget.windowsVerbatimArguments,
    })
    const stdout: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    let exceeded: 'stdout' | 'stderr' | undefined
    let settled = false
    let terminating = false
    let killTimer: NodeJS.Timeout | undefined

    const finish = (error?: Error, value?: Buffer) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      if (error) {
        for (const chunk of stdout) chunk.fill(0)
        reject(error)
      } else {
        resolve(value!)
      }
    }
    const terminate = () => {
      if (terminating) return
      terminating = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 3_000)
      killTimer.unref?.()
    }
    const timer = setTimeout(() => {
      if (terminating) return
      timedOut = true
      terminate()
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      if (exceeded) return
      stdoutBytes += chunk.length
      if (stdoutBytes > maxStdoutBytes) {
        exceeded = 'stdout'
        clearTimeout(timer)
        terminate()
        return
      }
      stdout.push(Buffer.from(chunk))
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (exceeded) return
      stderrBytes += chunk.length
      if (stderrBytes > maxStderrBytes) {
        exceeded = 'stderr'
        clearTimeout(timer)
        terminate()
      }
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(
        new ExternalSignerConfigError(
          `${label}: failed to execute secret source (${error.code ?? 'spawn_error'}): ${ref.exec}`,
        ),
      )
    })
    child.on('close', (code) => {
      if (exceeded) {
        finish(
          new ExternalSignerConfigError(
            `${label}: secret source exceeded ${exceeded} limit: ${ref.exec}`,
          ),
        )
        return
      }
      if (timedOut) {
        finish(
          new ExternalSignerConfigError(
            `${label}: secret source timed out after ${timeoutMs}ms: ${ref.exec}`,
          ),
        )
        return
      }
      if (code !== 0) {
        finish(
          new ExternalSignerConfigError(
            `${label}: secret source exited with code ${code}: ${ref.exec}`,
          ),
        )
        return
      }

      const joined = Buffer.concat(stdout, stdoutBytes)
      for (const chunk of stdout) chunk.fill(0)
      const trimmed = trimBuffer(joined)
      joined.fill(0)
      if (trimmed.length === 0) {
        trimmed.fill(0)
        finish(
          new ExternalSignerConfigError(`${label}: secret source produced no output: ${ref.exec}`),
        )
        return
      }
      finish(undefined, trimmed)
    })
  })
}

export function resolveSecretLaunchTarget(
  path: string,
  platform: NodeJS.Platform = process.platform,
  comspec = 'cmd.exe',
): SecretLaunchTarget {
  if (platform === 'win32' && (path.trim() !== path || path.endsWith('.'))) {
    throw new ExternalSignerConfigError(
      'Windows secret path must not have surrounding whitespace or a trailing dot',
    )
  }
  const extension = (platform === 'win32' ? win32Path.extname(path) : extname(path)).toLowerCase()
  if (platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
    if (WINDOWS_CMD_UNSAFE_PATH.test(path)) {
      throw new ExternalSignerConfigError(
        'Windows .cmd/.bat secret path contains unsafe characters',
      )
    }
    return {
      command: comspec,
      args: ['/d', '/s', '/c', `""${path}""`],
      windowsVerbatimArguments: true,
    }
  }
  return { command: path, args: [] }
}

function trimBuffer(input: Buffer): Buffer {
  let start = 0
  let end = input.length
  while (start < end && isAsciiWhitespace(input[start])) start += 1
  while (end > start && isAsciiWhitespace(input[end - 1])) end -= 1
  return Buffer.from(input.subarray(start, end))
}

function isAsciiWhitespace(byte: number): boolean {
  return byte === 0x20 || (byte >= 0x09 && byte <= 0x0d)
}
