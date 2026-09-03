import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // In dev, calls to /api/* are forwarded to the Express backend on :3000
    // (so there are no CORS issues and no hard-coded localhost URLs in the app).
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // The realtime socket. `ws: true` is what makes Vite forward the HTTP
      // upgrade handshake rather than answering it as a normal request.
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
})
