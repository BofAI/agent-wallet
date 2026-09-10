import { spawn } from 'node:child_process'

interface ManagedChildProcess {
  pid?: number
  kill(signal?: NodeJS.Signals | number): boolean
  stdin?: { destroy(): void } | null
  stdout?: { destroy(): void } | null
  stderr?: { destroy(): void } | null
}

export function shouldDetachProcess(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'win32'
}

export function signalProcessTree(
  child: ManagedChildProcess,
  signal: NodeJS.Signals,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === 'win32' && child.pid !== undefined) {
    if (startWindowsTreeKill(child.pid, signal === 'SIGKILL')) return
  }
  if (platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // The child may have exited before its process group was signalled.
    }
  }
  try {
    child.kill(signal)
  } catch {
    // Termination is best-effort; the bounded settlement timer still completes.
  }
}

export function forceKillProcessTree(
  child: ManagedChildProcess,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === 'win32' && child.pid !== undefined) {
    if (startWindowsTreeKill(child.pid, true)) return
  }
  signalProcessTree(child, 'SIGKILL', platform)
}

export function destroyProcessPipes(child: ManagedChildProcess): void {
  child.stdin?.destroy()
  child.stdout?.destroy()
  child.stderr?.destroy()
}

function startWindowsTreeKill(pid: number, force: boolean): boolean {
  try {
    const args = ['/pid', String(pid), '/T']
    if (force) args.push('/F')
    const cleanup = spawn('taskkill.exe', args, {
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    })
    cleanup.once('error', () => undefined)
    cleanup.unref()
    return true
  } catch {
    return false
  }
}
