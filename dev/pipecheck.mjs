/**
 * End-to-end check for the extraction pipeline's newer stages.
 *
 * `normcheck` covers the geometry on synthetic silhouettes; this covers the
 * three things that geometry can't see — that the page is actually
 * cross-origin isolated (without it ONNX Runtime silently drops to one thread),
 * that mask cleanup removes halo/speckle/pinholes without eating the garment,
 * and that the ViTMatte refinement really loads and returns a usable alpha in a
 * browser. That last one downloads ~28 MB the first time, hence the long
 * timeout.
 *
 *   npm run pipecheck
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5180
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const shutdown = () => vite.kill()
process.on('exit', shutdown)
process.on('SIGINT', () => process.exit(1))

const browser = await chromium.launch({
  // Headless WebGPU falls back to a software adapter and is dramatically slower
  // than the real thing, so the timings it reports are a worst case rather than
  // anything a user would see. PIPECHECK_HEADED=1 runs against the actual GPU.
  headless: process.env.PIPECHECK_HEADED !== '1',
  // The WebGPU adapter is off by default in headless Chromium; without these
  // the check only ever exercises the WASM path.
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
})
try {
  const page = await browser.newPage()
  page.on('pageerror', e => console.log('  [pageerror]', e.message))
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${m.type()}]`, m.text())
  })

  for (let i = 0; ; i++) {
    try {
      await page.goto(`http://localhost:${PORT}/dev/pipecheck.html`)
      break
    } catch (err) {
      if (i >= 20) throw err
      await new Promise(r => setTimeout(r, 500))
    }
  }

  // Note the explicit `null` — waitForFunction is (fn, arg, options), so an
  // options object passed second is silently treated as the argument and the
  // timeout stays at the 30s default.
  try {
    await page.waitForFunction(() => window.__done === true, null, { timeout: 600000 })
  } finally {
    console.log(await page.textContent('#out'))
  }
  process.exitCode = (await page.evaluate(() => window.__fail)) ? 1 : 0
} finally {
  await browser.close()
  shutdown()
}
