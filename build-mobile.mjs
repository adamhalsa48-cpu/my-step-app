import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const projectRoot = dirname(fileURLToPath(import.meta.url))
const apiDirectory = join(projectRoot, 'app', 'api')
const backupDirectory = join(projectRoot, 'app-api.mobile-build-backup')
const proxyFile = join(projectRoot, 'proxy.ts')
const proxyBackup = join(projectRoot, 'proxy.mobile-build-backup.ts')
const devTypesDirectory = join(projectRoot, '.next', 'dev', 'types')
const devTypesBackup = join(projectRoot, '.next-dev-types.mobile-build-backup')

if (!existsSync(apiDirectory)) throw new Error('Expected app/api to exist before the mobile build.')
if (existsSync(backupDirectory) || existsSync(proxyBackup) || existsSync(devTypesBackup)) throw new Error('A mobile-build backup already exists; restore it before building again.')

const filesToMove = [[apiDirectory, backupDirectory]]
if (existsSync(proxyFile)) filesToMove.push([proxyFile, proxyBackup])
if (existsSync(devTypesDirectory)) filesToMove.push([devTypesDirectory, devTypesBackup])
const movedFiles = []
let buildError
try {
  for (const [source, backup] of filesToMove) {
    renameSync(source, backup)
    movedFiles.push([source, backup])
  }
  const result = spawnSync('pnpm', ['exec', 'next', 'build'], {
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
    if (existsSync(backup)) {
      mkdirSync(dirname(source), { recursive: true })
      renameSync(backup, source)
    }
  }
}

if (buildError) throw buildError
