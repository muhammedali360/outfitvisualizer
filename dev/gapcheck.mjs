/**
 * Combinatorics check for the closet-gap analysis.
 *
 * The claims this screen makes are countable, so they're worth counting: that
 * a pairing only lands if it clears the wearable bar, that shoes never
 * multiply the total, that a piece close to something already hanging up is
 * never recommended, and that clustering "close enough" colours can't walk a
 * cluster across the wheel.
 *
 *   npm run gapcheck
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5182
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const shutdown = () => vite.kill()
process.on('exit', shutdown)
process.on('SIGINT', () => process.exit(1))

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.on('pageerror', e => console.log('  [pageerror]', e.message))

  // The dev server needs a moment to come up; retry rather than guess a sleep.
  for (let i = 0; ; i++) {
    try {
      await page.goto(`http://localhost:${PORT}/dev/gapcheck.html`)
      break
    } catch (err) {
      if (i >= 20) throw err
      await new Promise(r => setTimeout(r, 500))
    }
  }

  // Explicit `null`: waitForFunction is (fn, arg, options), so an options object
  // passed second is treated as the argument and the timeout stays at 30s.
  await page.waitForFunction(() => window.__done === true, null, { timeout: 60000 })
  console.log(await page.textContent('#out'))
  process.exitCode = (await page.evaluate(() => window.__fail)) ? 1 : 0
} finally {
  await browser.close()
  shutdown()
}
