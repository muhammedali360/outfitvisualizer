/**
 * Runtime backend selection for the in-browser models.
 *
 * Transformers.js defaults to single-threaded WASM at q8 in a browser, which is
 * by far the slowest way to run any of this: ONNX Runtime only spins up worker
 * threads when the page is cross-origin isolated, and without WebGPU every
 * convolution runs on one CPU core. Picking WebGPU when the adapter is there —
 * and telling ORT how many threads it may use when it isn't — is the single
 * cheapest speedup available, since neither costs an extra byte of download.
 *
 * WebGPU is still marked experimental upstream and quantized weights have known
 * silent-accuracy bugs on it, so the dtype is chosen per device rather than
 * globally: fp16 where the adapter supports it, and q8 only on WASM where it's
 * well travelled.
 */

export type Device = 'webgpu' | 'wasm'

/** What a model should be loaded as on the device we ended up with. */
export interface Backend {
  device: Device
  dtype: 'fp16' | 'fp32' | 'q8'
}

interface GPUish {
  requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null>
}

function gpu(): GPUish | null {
  const nav = navigator as Navigator & { gpu?: GPUish }
  return nav.gpu ?? null
}

let probe: Promise<Backend> | null = null

/**
 * Probe the GPU once per session and cache the answer. Falls back to WASM on
 * any failure — a missing adapter, a driver that refuses, or a browser that
 * exposes `navigator.gpu` without a working implementation.
 */
export function backend(): Promise<Backend> {
  probe ??= (async (): Promise<Backend> => {
    const g = gpu()
    if (!g) return { device: 'wasm', dtype: 'q8' }
    try {
      const adapter = await g.requestAdapter()
      if (!adapter) return { device: 'wasm', dtype: 'q8' }
      // fp16 needs the shader-f16 feature; without it fp32 is the safe choice,
      // and q8-on-WebGPU is deliberately avoided (upstream accuracy bugs).
      return { device: 'webgpu', dtype: adapter.features.has('shader-f16') ? 'fp16' : 'fp32' }
    } catch {
      return { device: 'wasm', dtype: 'q8' }
    }
  })()
  return probe
}

let configured = false

/**
 * Tell ONNX Runtime how many WASM threads it may use. Multi-threading needs
 * SharedArrayBuffer, which the browser only hands out to cross-origin-isolated
 * pages, so this is a no-op unless the COOP/COEP headers (or the service worker
 * that fakes them on static hosts) are in place.
 */
export function configureWasmThreads(env: {
  backends?: { onnx?: { wasm?: { numThreads?: number } } }
}): void {
  if (configured) return
  configured = true
  const wasm = env.backends?.onnx?.wasm
  if (!wasm) return
  const cores = navigator.hardwareConcurrency || 4
  wasm.numThreads = isIsolated() ? Math.min(8, Math.max(1, cores - 1)) : 1
}

/** Whether threading is actually available, for diagnostics in the UI. */
export function isIsolated(): boolean {
  return typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
}
