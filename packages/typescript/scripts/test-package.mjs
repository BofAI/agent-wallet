import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pnpmCli = process.env.npm_execpath
if (!pnpmCli) throw new Error('Run this check using pnpm run test:package')
const directory = mkdtempSync(join(tmpdir(), 'agent-wallet-package-consumer-'))

function run(args, cwd = directory) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Command failed: ${args.join(' ')}`)
}

try {
  run([pnpmCli, 'pack', '--pack-destination', directory], packageDir)
  const tarball = readdirSync(directory).find((name) => name.endsWith('.tgz'))
  if (!tarball) throw new Error('Package tarball was not created')
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      private: true,
      dependencies: {
        '@bankofai/agent-wallet': `file:${join(directory, tarball)}`,
        zod: '4.6.6',
      },
      devDependencies: { typescript: '5.9.3', '@types/node': '20.19.35' },
    }),
  )
  writeFileSync(join(directory, '.npmrc'), 'auto-install-peers=false\n')
  const source = readFileSync(join(packageDir, 'tests/consumer/package-consumer.ts'), 'utf8')
  for (const extension of ['mts', 'cts']) {
    writeFileSync(join(directory, `consumer.${extension}`), source)
  }
  writeFileSync(
    join(directory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        skipLibCheck: false,
        outDir: 'out',
      },
      include: ['consumer.mts', 'consumer.cts'],
    }),
  )
  run([pnpmCli, 'install', '--ignore-scripts', '--no-frozen-lockfile'])
  run([pnpmCli, 'audit', '--prod'])
  run([
    join(directory, 'node_modules/typescript/bin/tsc'),
    '-p',
    'tsconfig.json',
    '--module',
    'Node16',
    '--moduleResolution',
    'Node16',
    '--noEmit',
  ])
  run([join(directory, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'])
  run(['out/consumer.mjs'])
  run(['out/consumer.cjs'])
  console.log('Packed ESM/CJS consumers passed with Zod 4.6.6 and skipLibCheck=false')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
