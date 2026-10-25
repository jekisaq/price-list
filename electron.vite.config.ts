import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
        },
      },
    },
  },
  renderer: {
    server: { host: '127.0.0.1' },
    plugins: [
      react(),
      {
        name: 'development-csp',
        apply: 'serve',
        transformIndexHtml(html) {
          // React Refresh injects an inline preamble only during development.
          return html.replace(
            "script-src 'self'",
            "script-src 'self' 'unsafe-inline'",
          )
        },
      },
    ],
  },
})
