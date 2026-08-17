import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'url'

export default defineConfig({
  // Mirrors vite.config.mts. Without it the About section is the one part of the
  // settings dialog no test can reach: it reads __APP_VERSION__ during render,
  // and an undefined global there is a ReferenceError, not an empty string.
  define: {
    __APP_VERSION__: JSON.stringify(
      (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }).version
    ),
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules/**', 'e2e/**'],
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
