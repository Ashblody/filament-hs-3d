import { defineConfig } from 'vite'

const forCapacitor = process.env.CAP_BUILD === '1'

export default defineConfig({
  // GitHub Pages needs /filament-hs-3d/; Capacitor WebView needs relative paths.
  base: forCapacitor ? './' : '/filament-hs-3d/',
})
