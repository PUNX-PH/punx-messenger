// GIF favorites: one list per account, not one per browser.
//
//   node --test tests/gif-favorites.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getFavorites, toggleFavorite, isFavorited } from '../src/lib/gifFavorites.js'

const memory = (initial = {}) => {
  const m = new Map(Object.entries(initial))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    keys: () => [...m.keys()],
  }
}
const gif = (id) => ({ id, title: `gif ${id}` })
const LEGACY = 'punx.gifFavorites'

test('a new account starts with none', () => {
  assert.deepEqual(getFavorites('ana', memory()), [])
})

test('favorites are kept per account: one person cannot see or change another\'s', () => {
  const s = memory()
  toggleFavorite('ana', gif(1), s)
  toggleFavorite('ben', gif(2), s)
  assert.deepEqual(getFavorites('ana', s).map(f => f.id), [1])
  assert.deepEqual(getFavorites('ben', s).map(f => f.id), [2])
  toggleFavorite('ben', gif(1), s)
  toggleFavorite('ben', gif(1), s)
  assert.deepEqual(getFavorites('ana', s).map(f => f.id), [1])
})

test('toggling adds to the front, and again removes', () => {
  const s = memory()
  toggleFavorite('ana', gif(1), s)
  const two = toggleFavorite('ana', gif(2), s)
  assert.deepEqual(two.map(f => f.id), [2, 1])
  const back = toggleFavorite('ana', gif(1), s)
  assert.deepEqual(back.map(f => f.id), [2])
  assert.equal(isFavorited(back, 1), false)
  assert.equal(isFavorited(back, 2), true)
})

test('only the newest 50 are kept', () => {
  const s = memory()
  for (let i = 1; i <= 60; i++) toggleFavorite('ana', gif(i), s)
  const list = getFavorites('ana', s)
  assert.equal(list.length, 50)
  assert.equal(list[0].id, 60)
  assert.equal(list[49].id, 11)
})

test('the old shared list goes to the first account that looks, and only that one', () => {
  const s = memory({ [LEGACY]: JSON.stringify([gif(7), gif(8)]) })
  assert.deepEqual(getFavorites('ana', s).map(f => f.id), [7, 8])
  assert.equal(s.getItem(LEGACY), null, 'the shared copy is removed')
  assert.deepEqual(getFavorites('ben', s), [])
  assert.deepEqual(getFavorites('ana', s).map(f => f.id), [7, 8], 'and it stays with ana')
})

test('an account that already has its own list does not take the old one', () => {
  const s = memory({ [LEGACY]: JSON.stringify([gif(7)]), 'punx.gifFavorites.ana': JSON.stringify([gif(1)]) })
  assert.deepEqual(getFavorites('ana', s).map(f => f.id), [1])
})

test('an account that cleared all of its favorites does not get the old list back', () => {
  const s = memory({ [LEGACY]: JSON.stringify([gif(7)]) })
  getFavorites('ana', s)            // adopts
  toggleFavorite('ana', gif(7), s)  // removes the last one
  assert.deepEqual(getFavorites('ana', s), [])
})

test('toggling right after the upgrade keeps the adopted favorites', () => {
  const s = memory({ [LEGACY]: JSON.stringify([gif(7)]) })
  const next = toggleFavorite('ana', gif(9), s)
  assert.deepEqual(next.map(f => f.id), [9, 7])
})

test('damaged storage gives an empty list, not a crash', () => {
  for (const raw of ['not json', '{"a":1}', '123', 'null', '[1,2,3]', '[{"title":"no id"}]']) {
    const s = memory({ 'punx.gifFavorites.ana': raw })
    assert.deepEqual(getFavorites('ana', s), [], raw)
  }
})

test('entries without an id are dropped but the rest are kept', () => {
  const s = memory({ 'punx.gifFavorites.ana': JSON.stringify([gif(1), { title: 'x' }, null, gif(2)]) })
  assert.deepEqual(getFavorites('ana', s).map(f => f.id), [1, 2])
})

test('no account (or no storage) means no favorites and nothing written', () => {
  const s = memory()
  assert.deepEqual(getFavorites(undefined, s), [])
  assert.deepEqual(toggleFavorite(undefined, gif(1), s), [])
  assert.deepEqual(s.keys(), [])
  assert.deepEqual(getFavorites('ana', null), [])
})

test('storage that throws (private mode, full) never breaks the panel', () => {
  const broken = {
    getItem() { throw new Error('denied') }, setItem() { throw new Error('full') }, removeItem() { throw new Error('denied') },
  }
  assert.deepEqual(getFavorites('ana', broken), [])
  assert.doesNotThrow(() => toggleFavorite('ana', gif(1), broken))
  const full = { ...memory(), setItem() { throw new Error('quota') } }
  assert.deepEqual(toggleFavorite('ana', gif(1), full).map(f => f.id), [1], 'still shows it for this session')
})

test('with no account signed in, the old shared list is left for a real account to adopt', () => {
  const s = memory({ [LEGACY]: JSON.stringify([gif(7)]) })
  assert.deepEqual(getFavorites(undefined, s), [])
  assert.deepEqual(getFavorites('', s), [])
  assert.notEqual(s.getItem(LEGACY), null)
  assert.deepEqual(s.keys(), [LEGACY])
  assert.deepEqual(getFavorites('ana', s).map(f => f.id), [7])
})
