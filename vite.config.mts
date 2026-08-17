import { defineConfig } from 'vite'
import { readFileSync, readdirSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'

const manifest = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
) as { version: string; repository?: { url?: string } | string }

/**
 * The internal packages bezel is actually running, for the About section.
 *
 * RESOLVED versions read out of node_modules, not the `^2.6.0` ranges in
 * package.json: the range says what would satisfy an install, and the question
 * this answers is which build is in front of you right now.
 *
 * Read at build time and injected, for the same reason __APP_VERSION__ is —
 * so no manifest ends up in the renderer bundle, and so the renderer needs no
 * filesystem access to answer a question about itself.
 */
function internalDeps(): Array<{ name: string; version: string; repository?: string }> {
  const scope = new URL('./node_modules/@devkit-inc/', import.meta.url)
  let names: string[]
  try {
    names = readdirSync(scope)
  } catch {
    return [] // scope not installed — the About section simply lists nothing
  }
  return names
    .map(name => {
      try {
        const pkg = JSON.parse(
          readFileSync(new URL(`${name}/package.json`, scope), 'utf-8')
        ) as { version: string; repository?: { url?: string } | string }
        const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
        return { name: `@devkit-inc/${name}`, version: pkg.version, repository: repo }
      } catch {
        return null // not a package directory, or unreadable
      }
    })
    .filter((d): d is { name: string; version: string; repository?: string } => d !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export default defineConfig({
  plugins: [react()],
  // The About section shows the running version. Injected at build time rather
  // than imported, so package.json does not end up in the renderer bundle.
  define: {
    __APP_VERSION__: JSON.stringify(manifest.version),
    __APP_REPOSITORY__: JSON.stringify(
      typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url ?? ''
    ),
    __INTERNAL_DEPS__: JSON.stringify(internalDeps()),
  },
  base: './',
  root: '.',
  build: { outDir: 'dist', emptyOutDir: true },
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
