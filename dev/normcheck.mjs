/**
 * Geometry check for garment normalization.
 *
 * Renders synthetic tees and pants at assorted rotations, scales and lengths,
 * runs each through the real `normalizeGarment`, then measures the results
 * straight off their pixels — so the assertions don't lean on the same anchor
 * code they're testing. Also drops a contact sheet at dev/contact-sheet.png,
 * which is the fastest way to eyeball the effect of retuning CANON.
 *
 *   npm run normcheck
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5179
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
      await page.goto(`http://localhost:${PORT}/dev/normcheck.html`)
      break
    } catch (err) {
      if (i >= 20) throw err
      await new Promise(r => setTimeout(r, 500))
    }
  }

  // Explicit `null`: waitForFunction is (fn, arg, options), so an options object
  // passed second is treated as the argument and the timeout stays at 30s.
  await page.waitForFunction(() => window.__done === true, null, { timeout: 120000 })
  console.log(await page.textContent('#out'))
  await page.locator('#sheet').screenshot({ path: 'dev/contact-sheet.png' })
  process.exitCode = (await page.evaluate(() => window.__fail)) ? 1 : 0
} finally {
  await browser.close()
  shutdown()
}
