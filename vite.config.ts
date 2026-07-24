import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative asset paths so the build works at any URL, including GitHub
  // Pages' /outfitvisualizer/ subpath.
  base: './',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@imgly/background-removal', '@huggingface/transformers'],
  },
})
