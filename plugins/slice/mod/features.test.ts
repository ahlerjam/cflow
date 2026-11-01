import { expect, test } from 'claude-code/testing'
import { goalText, onlyPassesChanged, parseFeatures, type Feature } from './features'

const feature = (over: Partial<Feature> = {}): Feature =>
  ({ id: 'f1', title: 'Login', steps: ['open /', 'sign in'], passes: false, ...over })
const json = (...features: unknown[]) => JSON.stringify({ features })

test('parseFeatures accepts a valid list with optional ui and issue', async () => {
  const list = parseFeatures(json(feature({ ui: true, issue: 7 }), feature({ id: 'f2' })))
  expect(list).toEqual({ features: [feature({ ui: true, issue: 7 }), feature({ id: 'f2' })] })
})
test('parseFeatures rejects text that is not JSON', async () => {
  expect(parseFeatures('{')).toContain('not valid JSON')
})
test('parseFeatures rejects an empty list', async () => {
  expect(parseFeatures(json())).toContain('non-empty "features"')
})
test('parseFeatures rejects a duplicate id', async () => {
  expect(parseFeatures(json(feature(), feature()))).toBe('duplicate feature id "f1"')
})
test('parseFeatures rejects an empty id', async () => {
  expect(parseFeatures(json(feature({ id: ' ' })))).toContain('id must be')
})
test('parseFeatures rejects a missing title', async () => {
  expect(parseFeatures(json(feature({ title: '' })))).toContain('title must be')
})
test('parseFeatures rejects empty steps', async () => {
  expect(parseFeatures(json(feature({ steps: [] })))).toContain('steps must be')
})
test('parseFeatures rejects a non-string step', async () => {
  expect(parseFeatures(json({ ...feature(), steps: ['ok', 3] }))).toContain('steps must be')
})
test('parseFeatures rejects a non-boolean passes', async () => {
  expect(parseFeatures(json({ ...feature(), passes: 'yes' }))).toContain('passes must be')
})
test('parseFeatures rejects a non-boolean ui', async () => {
  expect(parseFeatures(json({ ...feature(), ui: 1 }))).toContain('ui must be')
})
test('parseFeatures rejects a non-numeric issue', async () => {
  expect(parseFeatures(json({ ...feature(), issue: '12' }))).toContain('issue must be')
})

test('onlyPassesChanged allows flipping passes', async () => {
  const base = json(feature(), feature({ id: 'f2' }))
  expect(onlyPassesChanged(base, json(feature({ passes: true }), feature({ id: 'f2' })))).toBe(true)
})
test('onlyPassesChanged blocks a changed step', async () => {
  expect(onlyPassesChanged(json(feature()), json(feature({ steps: ['open /'] })))).toBe(false)
})
test('onlyPassesChanged blocks a changed title', async () => {
  expect(onlyPassesChanged(json(feature()), json(feature({ title: 'Logout' })))).toBe(false)
})
test('onlyPassesChanged blocks a changed ui flag', async () => {
  expect(onlyPassesChanged(json(feature()), json(feature({ ui: true })))).toBe(false)
})
test('onlyPassesChanged blocks a changed issue number', async () => {
  expect(onlyPassesChanged(json(feature({ issue: 1 })), json(feature({ issue: 2 })))).toBe(false)
})
test('onlyPassesChanged blocks a removed feature', async () => {
  expect(onlyPassesChanged(json(feature(), feature({ id: 'f2' })), json(feature()))).toBe(false)
})
test('onlyPassesChanged blocks reordered features', async () => {
  const [a, b] = [feature(), feature({ id: 'f2' })]
  expect(onlyPassesChanged(json(a, b), json(b, a))).toBe(false)
})
test('onlyPassesChanged blocks a list that no longer parses', async () => {
  expect(onlyPassesChanged(json(feature()), '{')).toBe(false)
})

test('goalText starts with /goal and names the feature file', async () => {
  const text = goalText()
  expect(text.startsWith('/goal ')).toBe(true)
  expect(text).toContain('.slice/features.json')
})
test('goalText stays within 4000 characters', async () => {
  expect(goalText({ maxTurns: 400 }).length).toBeLessThanOrEqual(4000)
})
