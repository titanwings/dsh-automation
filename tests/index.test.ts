import assert from 'node:assert/strict'
import test from 'node:test'
import { automationApprovalDecision, humanApprovalReason, needsHumanApproval } from '../src/index.ts'

test('approval is scoped to mounted Agents, includes delete, and ignores cancelled calls', () => {
  const signal = new AbortController().signal
  assert.equal(needsHumanApproval({ name: 'automation_create', signal }, true), true)
  assert.equal(needsHumanApproval({ name: 'automation_delete', signal }, true), true)
  assert.equal(needsHumanApproval({
    name: 'automation_update',
    arguments: { id: 'automation-1', status: 'paused' },
    signal,
  }, true), false)
  assert.equal(needsHumanApproval({ name: 'automation_create', signal }, false), false)

  const cancelled = new AbortController()
  cancelled.abort()
  assert.equal(needsHumanApproval({ name: 'automation_run_now', signal: cancelled.signal }, true), false)
  assert.match(humanApprovalReason('automation_delete'), /permanently deletes/)
})


test('never policy reports automatic rejection without impersonating a human decision', () => {
  const exec = { name: 'automation_create', signal: new AbortController().signal }
  const decision = automationApprovalDecision(exec, true, { kind: 'allow' }, () => 'never')
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason!, /approval prompts are disabled/)
  assert.match(decision.reason!, /not rejected by the user/)
  assert.match(decision.reason!, /"ask"/)
  assert.match(decision.reason!, /Automations view/)
})

test('interactive and older hosts retain the normal approval path, never automatic allow', () => {
  for (const policy of ['ask', undefined]) {
    const decision = automationApprovalDecision({ name: 'automation_create', signal: new AbortController().signal }, true, { kind: 'allow' }, () => policy)
    assert.equal(decision.kind, 'ask')
  }
})

test('prior rejection, cancellation, unmounted agents and pure pause keep their decisions', () => {
  const signal = new AbortController().signal
  const unread = () => { throw new Error('policy must not be read') }
  for (const kind of ['deny', 'ask']) {
    const prior = { kind, reason: 'existing gate' }
    assert.equal(automationApprovalDecision({ name: 'automation_create', signal }, true, prior, unread), prior)
  }
  const allow = { kind: 'allow' }
  assert.equal(automationApprovalDecision({ name: 'automation_create', signal: AbortSignal.abort() }, true, allow, unread), allow)
  assert.equal(automationApprovalDecision({ name: 'automation_create', signal }, false, allow, unread), allow)
  assert.equal(automationApprovalDecision({ name: 'automation_update', arguments: { id: 'a', status: 'paused' }, signal }, true, allow, unread), allow)
  assert.equal(automationApprovalDecision({ name: 'automation_list', signal }, true, allow, unread), allow)
})

test('policy read failure fails closed with a diagnostic instead of silently allowing', () => {
  const result = automationApprovalDecision({ name: 'automation_create', signal: new AbortController().signal }, true, { kind: 'allow' }, () => { throw new Error('Host unavailable') })
  assert.equal(result.kind, 'deny')
  assert.match(result.reason!, /Cannot read/)
})
