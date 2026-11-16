import { existsSync, renameSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const projectRoot = dirname(fileURLToPath(import.meta.url))
const apiDirectory = join(projectRoot, 'app', 'api')
const backupDirectory = join(projectRoot, 'app-api.mobile-build-backup')
const proxyFile = join(projectRoot, 'proxy.ts')
const proxyBackup = join(projectRoot, 'proxy.mobile-build-backup.ts')

if (!existsSync(apiDirectory)) throw new Error('Expected app/api to exist before the mobile build.')
if (existsSync(backupDirectory) || existsSync(proxyBackup)) throw new Error('A mobile-build backup already exists; restore it before building again.')

const filesToMove = [[apiDirectory, backupDirectory]]
if (existsSync(proxyFile)) filesToMove.push([proxyFile, proxyBackup])
const movedFiles = []
let buildError
try {
  for (const [source, backup] of filesToMove) {
    renameSync(source, backup)
    movedFiles.push([source, backup])
  }
  const result = spawnSync('npx.cmd', ['next', 'build'], { shell: true,
    cwd: projectRoot,
    env: { ...process.env, STAYFIT_MOBILE_EXPORT: '1' },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) buildError = new Error(`Static mobile build failed with exit code ${result.status ?? 'unknown'}.`)
} catch (error) {
  buildError = error
} finally {
  for (const [source, backup] of [...movedFiles].reverse()) {
    if (existsSync(backup)) renameSync(backup, source)
  }
}

if (buildError) throw buildError
