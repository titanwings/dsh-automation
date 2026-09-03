import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const viewSource = readFileSync(new URL('../src/client/AutomationView.tsx', import.meta.url), 'utf8')
const styleSource = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')

test('every Automation view state opts into the fixed-height composer-overlay host', () => {
  const roots = viewSource.match(/data-conversation-composer-overlay=""/g) ?? []
  assert.equal(roots.length, 4, 'loading, unavailable, error, and ready roots must all declare the host overlay contract')

  const shellRule = styleSource.match(/\.dsh-automation-shell\{([^}]+)\}/)?.[1]
  assert.ok(shellRule, 'the Automation shell rule must exist')
  assert.match(shellRule, /(?:^|;)height:100%(?:;|$)/)
  assert.match(shellRule, /(?:^|;)min-height:0(?:;|$)/)
  assert.match(shellRule, /(?:^|;)overflow:auto(?:;|$)/)
  assert.match(shellRule, /(?:^|;)overscroll-behavior:contain(?:;|$)/)
})

test('floating editor escapes the clipped conversation view and focuses without scrolling', () => {
  assert.match(viewSource, /createPortal\(dialog, document\.body\)/)
  assert.doesNotMatch(viewSource, /\sautoFocus(?:\s|>)/)
  assert.match(viewSource, /focus\(\{ preventScroll: true \}\)/)
  assert.match(viewSource, /addEventListener\('mouseup', stopDrag\)/)
  assert.match(viewSource, /addEventListener\('blur', stopDrag\)/)
  assert.match(viewSource, /viewport\?\.addEventListener\('scroll', reclamp\)/)
  assert.match(styleSource, /\.dsh-automation-float,\.dsh-automation-float \*\{box-sizing:border-box\}/)
  assert.match(styleSource, /\.dsh-automation-float button:focus-visible/)
})
