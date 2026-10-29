#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const USAGE = 'Usage: ui-check.mjs --url <base url> --states \'[{"name":"empty","path":"/?state=empty"}]\' [--design DESIGN.md] [--out dir]'
const arg = n => process.argv[process.argv.indexOf(`--${n}`) + 1]
const [url, states, designPath, out] = [arg('url'), arg('states'), arg('design') ?? 'DESIGN.md', arg('out') ?? '.git/slice/shots']
if (!url || !states) fail(`missing arguments. ${USAGE}`)

function fail(msg) {
  console.error(`ui-check: ${msg}`)
  process.exit(1)
}

const design = existsSync(designPath) ? readFileSync(designPath, 'utf8') : ''
const line = key => (new RegExp(`^\\s*${key}:\\s*(.+)$`, 'mi').exec(design)?.[1] ?? '').split(',').map(s => s.trim()).filter(Boolean)
const widths = line('widths').map(Number).filter(Boolean)
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
for (const state of JSON.parse(states)) {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => m.type() === 'error' && errors.push(m.text()))
    await page.goto(new URL(state.path, url).href, { waitUntil: 'networkidle' })
    const overflow = await page.evaluate(allow => {
      const cut = el => allow.some(sel => el.closest(sel))
      const wide = [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1 && !cut(el))
      return wide.slice(0, 3).map(el => el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(' ')[0]}` : ''))
    }, scrollAllow)
    await page.screenshot({ path: join(out, `${state.name}-${width}.png`), fullPage: true })
    if (overflow.length) problems.push(`${state.name} @${width}px overflows horizontally (${overflow.join(', ')}). Fix: constrain the element or list its selector under scroll-allow in DESIGN.md.`)
    for (const e of errors) problems.push(`${state.name} @${width}px console error: ${e}. Fix: remove the cause of the error.`)
    await page.close()
  }
}
await browser.close()
if (problems.length) fail(`${problems.length} problem(s)\n${problems.join('\n')}`)
console.log(`ui-check: ok, ${JSON.parse(states).length} states x ${widths.length} widths, screenshots in ${out}`)
