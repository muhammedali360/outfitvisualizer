/**
 * Packing-selection check for the trip planner.
 *
 * The premise — pack for combinations, not for days — is only worth anything if
 * the case really does come out smaller than a change of clothes per day, so
 * that's the headline assertion. The rest pins the things a packing list can
 * get wrong in a way that actually costs you: a trip that swings from 28°C to
 * 1°C must carry both ends rather than the average, a cold trip must not leave
 * the warm jacket at home, and nothing in the wash may end up in the case.
 *
 *   npm run packcheck
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5183
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
      await page.goto(`http://localhost:${PORT}/dev/packcheck.html`)
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
