// Switching between conversations: nothing of the previous one is shown or marked read.
//
//   node --test tests/chat-switch.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const lf = (s) => s.replace(/\r\n/g, '\n')
const surface = lf(fs.readFileSync('src/components/ChatSurface.jsx', 'utf8'))
const list = lf(fs.readFileSync('src/components/MessageList.jsx', 'utf8'))

test('messages are kept with the conversation they belong to, and read back through the current one', () => {
  assert.ok(surface.includes('const [batch, setBatch] = useState({ path: null, docs: NO_MESSAGES })'))
  assert.ok(surface.includes('const loaded = batch.path === path'))
  assert.ok(surface.includes('const messages = loaded ? batch.docs : NO_MESSAGES'), 'another conversation\'s messages read back as none')
  assert.ok(!surface.includes('setMessages('), 'no plain list left that could carry over')
})

test('each batch from the listener is tagged with its own path, and an unchanged one keeps the same object', () => {
  assert.ok(surface.includes('setBatch(prev => (prev.path === path && sameMessages(prev.docs, docs) ? prev : { path, docs }))'))
})

test('a failed listener leaves this conversation with no messages, not the previous one\'s', () => {
  assert.ok(surface.includes('setBatch({ path, docs: NO_MESSAGES })'))
})

test('a conversation is not marked read before its own messages are in', () => {
  assert.ok(surface.includes('if (!profile?.uid || !path || readOnly || !looking || !loaded) return'))
  assert.ok(surface.includes('[profile?.uid, path, newestId, readOnly, looking, loaded])'), 'and it runs again once they arrive')
})

test('while they load the list shows a blank pane, never "start of the conversation"', () => {
  assert.ok(surface.includes('loading={!loaded}'))
  const empty = list.indexOf('if (!messages?.length) {')
  const loading = list.indexOf('if (loading) return <div className="chat-pattern flex-1" role="status" aria-busy="true"')
  const title = list.indexOf('{emptyTitle}')
  assert.ok(empty > 0 && loading > empty && title > loading, 'the loading check comes first, inside the empty branch')
  assert.ok(list.includes('loading = false,'), 'a list that is not told it is loading behaves as before')
})
