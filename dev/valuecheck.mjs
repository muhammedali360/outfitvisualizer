/**
 * Arithmetic check for the closet-value stats.
 *
 * Cost per wear, utilization and the declutter shortlist all quietly encode
 * judgement calls — an unworn piece has no cost per wear rather than an
 * infinite one, a piece bought last week isn't "unworn", a parka idle through
 * July is behaving normally. Those are the things worth pinning down, so this
 * builds small synthetic closets and wear logs and asserts the answers.
 *
 *   npm run valuecheck
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5181
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
      await page.goto(`http://localhost:${PORT}/dev/valuecheck.html`)
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
