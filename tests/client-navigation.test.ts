import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { apply } from '../src/client/index.js'
import {
  activateAutomationTab,
  findAutomationTab,
  type AutomationTab,
} from '../src/client/navigation.js'

function tab(textContent: string, click: () => void = () => {}): AutomationTab {
  return { textContent, click }
}

test('automation navigation clicks the localized tab and reports opened', () => {
  let clicks = 0
  let unavailable = 0
  const tabs = [tab('Chat'), tab('\n  Automations  ', () => { clicks += 1 })]

  assert.equal(findAutomationTab(tabs, 'Automations'), tabs[1])
  assert.equal(activateAutomationTab(tabs, 'Automations', () => { unavailable += 1 }), 'opened')
  assert.equal(clicks, 1)
  assert.equal(unavailable, 0)
})

test('automation navigation never silently no-ops when hero state has no tabs', () => {
  let unavailable = 0

  assert.equal(activateAutomationTab([], 'Automations', () => { unavailable += 1 }), 'unavailable')
  assert.equal(unavailable, 1)
})

test('client registers the session view and installs the homepage sidebar entry', () => {
  const registrations: Array<{
    readonly options: { readonly name: string; readonly id?: string; readonly inject?: () => unknown }
    readonly component: { readonly name?: string }
  }> = []
  const effects: Array<{ readonly factory: () => unknown; readonly label?: string }> = []
  const ctx = {
    effect: (factory: () => unknown, label?: string) => {
      effects.push({ factory, ...(label === undefined ? {} : { label }) })
    },
    connection: { rpc: { call: async () => ({}) } },
    sessions: { refresh: async () => {}, open: () => {} },
    locale: {
      register: () => () => {},
      bind: () => (key: string) => key,
    },
    slots: {
      inject: (_name: string, register: () => void | (() => void)) => { register() },
      register: (options: { readonly name: string; readonly id?: string; readonly inject?: () => unknown }, component: { readonly name?: string }) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }

  apply(ctx as never)

  assert.deepEqual(registrations.map(({ options }) => [options.name, options.id]), [
    ['conversation.view', 'automation'],
  ])
  assert.equal(registrations[0]?.component.name, 'AutomationView')
  assert.ok(effects.some(effect => effect.label === 'dsh-automation: sidebar entry'))
})

test('homepage sidebar entry carries visible status feedback and namespaced styles', () => {
  const entrySource = readFileSync(new URL('../src/client/sidebar-entry.ts', import.meta.url), 'utf8')
  const styleSource = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')

  assert.match(entrySource, /data-dsh-automation-entry/)
  assert.match(entrySource, /setAttribute\('role', 'status'\)/)
  assert.match(entrySource, /sidebar\.unavailable/)
  assert.match(entrySource, /newSession/)
  assert.match(styleSource, /\.dsh-automation-sidebar-entry\{/)
  assert.match(styleSource, /\.dsh-automation-sidebar-feedback\{/)
})
