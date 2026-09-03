import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

interface PackageManifest {
  name?: string
  exports?: Record<string, { default?: string } | string>
  files?: string[]
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  scripts?: Record<string, string>
  dsh?: {
    bundle?: { patch?: string }
    client?: { platform?: string; inject?: string[] }
  }
}

const root = new URL('../', import.meta.url)

test('package keeps the installable DSH bundle and Web client contract', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('package.json', root), 'utf8'),
  ) as PackageManifest

  assert.equal(manifest.name, '@dsh-external/dsh-automation')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.deepEqual(manifest.dsh?.client?.inject, [
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-sidebar',
  ])
  assert.deepEqual(manifest.exports?.['./client'], {
    types: './lib/types/client/index.d.ts',
    default: './lib/client.js',
  })
  assert.ok(manifest.files?.includes('lib'))
  assert.ok(manifest.files?.includes('cordis.patch.yml'))
  assert.equal(manifest.scripts?.prepare, undefined)
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}).sort(), ['luxon', 'zod'])
  assert.equal(manifest.peerDependencies?.react, '^18.2.0')
  assert.equal(manifest.peerDependencies?.['react-dom'], '^18.2.0')
  assert.deepEqual(manifest.peerDependenciesMeta?.react, { optional: true })
  assert.deepEqual(manifest.peerDependenciesMeta?.['react-dom'], { optional: true })

  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  assert.match(patch, /^\s*- insert:\s*$/m)
  assert.match(patch, /^\s*- id: dsh-automation\s*$/m)
  assert.match(patch, /^\s*name: ['"]@dsh-external\/dsh-automation['"]\s*$/m)
  assert.match(patch, /^\s*archiveRunSessions: false\s*$/m)

  await Promise.all([
    access(new URL('lib/index.js', root)),
    access(new URL('lib/client.js', root)),
    access(new URL('lib/types/index.d.ts', root)),
    access(new URL('lib/types/client/index.d.ts', root)),
  ])
  const clientBundle = await readFile(new URL('lib/client.js', root), 'utf8')
  assert.match(clientBundle, /window\.__ModuleLoader__\.load\(/)
  assert.match(clientBundle, /@dsh-external\/dsh-automation/)
  assert.match(clientBundle, /sessionArchived/)
  assert.match(clientBundle, /require\("react-dom"\)/)
  const hostBundle = await readFile(new URL('lib/index.js', root), 'utf8')
  assert.match(hostBundle, /archiveRunSessions: .*\.boolean\(\)\.default\(false\)/)
})
