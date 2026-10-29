import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative asset URLs support both the local root and GitHub Pages project path.
  base: './',
  plugins: [react()],
  server: { host: '0.0.0.0' },
})
