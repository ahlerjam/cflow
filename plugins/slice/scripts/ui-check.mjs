#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const USAGE = 'Usage: ui-check.mjs --url <base url> --states \'[{"name":"empty","path":"/?state=empty"}]\' [--design DESIGN.md] [--out dir]'
const arg = n => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : undefined)
const gitDir = () => { try { return execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim() } catch { return '.git' } }
const [url, states, designPath, out] = [arg('url'), arg('states'), arg('design') ?? 'DESIGN.md', arg('out') ?? `${gitDir()}/slice/shots`]
if (!url || !states) fail(`missing arguments. ${USAGE}`)
const list = (() => { try { return JSON.parse(states) } catch { fail(`--states is not valid JSON. ${USAGE}`) } })()

function fail(msg) {
  console.error(`ui-check: ${msg}`)
  process.exit(1)
}

const design = existsSync(designPath) ? readFileSync(designPath, 'utf8') : ''
const line = key => (new RegExp(`^[\\s>*-]*\\*{0,2}\`?${key}\`?\\*{0,2}:\\*{0,2}\\s*(.+)$`, 'mi').exec(design)?.[1] ?? '').split(',').map(s => s.trim().replace(/^`|`$/g, '')).filter(Boolean)
const widths = line('widths').map(w => parseInt(w, 10)).filter(Boolean)
const scrollAllow = line('scroll-allow')
if (!widths.length) widths.push(360, 768, 1280)

let chromium
try {
  const roots = [process.cwd(), execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()]
  chromium = createRequire(import.meta.url)(createRequire(import.meta.url).resolve('playwright', { paths: roots })).chromium
} catch {
  fail('playwright is not installed. Fix: npm install -g playwright && npx playwright install chromium')
}

mkdirSync(out, { recursive: true })
const problems = []
const browser = await chromium.launch()
try {
for (const state of list) {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => m.type() === 'error' && errors.push(m.text()))
    try {
      await page.goto(new URL(state.path, url).href, { waitUntil: 'load' })
    } catch (e) {
      problems.push(`${state.name} @${width}px did not load: ${e.message.split('\n')[0]}. Fix: start the app and check --url.`)
      await page.close()
      continue
    }
    await page.waitForTimeout(300)
    const overflow = await page.evaluate(allow => {
      const cut = el => allow.some(sel => { try { return el.closest(sel) } catch { return false } })
      const wide = [...document.querySelectorAll('body *')].filter(el => (el.getBoundingClientRect().right > innerWidth + 1 || el.getBoundingClientRect().left < -1) && !cut(el))
      return wide.slice(0, 3).map(el => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : ''))
    }, scrollAllow)
    await page.screenshot({ path: join(out, `${String(state.name).replace(/[^\w.-]/g, '_')}-${width}.png`), fullPage: true })
    if (overflow.length) problems.push(`${state.name} @${width}px overflows horizontally (${overflow.join(', ')}). Fix: constrain the element or list its selector under scroll-allow in DESIGN.md.`)
    for (const e of errors) problems.push(`${state.name} @${width}px console error: ${e}. Fix: remove the cause of the error.`)
    await page.close()
  }
}
} finally {
  await browser.close()
}
if (problems.length) fail(`${problems.length} problem(s)\n${problems.join('\n')}`)
console.log(`ui-check: ok, ${list.length} states x ${widths.length} widths, screenshots in ${out}`)
