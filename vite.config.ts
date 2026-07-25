import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cross-origin isolation unlocks SharedArrayBuffer, which is what lets ONNX
// Runtime use more than one WASM thread. On a static host the service worker in
// public/ adds these after the fact; on the dev server we can just send them.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  // Relative asset paths so the build works at any URL, including GitHub
  // Pages' /outfitvisualizer/ subpath.
  base: './',
  plugins: [react()],
  server: { headers: isolation },
  preview: { headers: isolation },
  optimizeDeps: {
    exclude: ['@imgly/background-removal', '@huggingface/transformers'],
  },
})
