"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.viteClientConfig = viteClientConfig;
/**
 * The shared Vite config for a desktop-shell SPA client: a react() plugin, a dev
 * server with an `/api` proxy to the tool's Node backend, and a client build. The
 * consumer wraps the result in `defineConfig()` and injects its react() plugin —
 * mirroring the `clientProject` vitest factory.
 */
function viteClientConfig(opts) {
    const proxyEntry = opts.changeOrigin
        ? { target: opts.apiTarget, changeOrigin: true }
        : opts.apiTarget;
    const build = { outDir: opts.outDir ?? '../dist/client' };
    if (opts.emptyOutDir ?? true)
        build.emptyOutDir = true;
    const config = {
        plugins: [opts.plugin],
        // Dedupe React so the production bundle doesn't include a SECOND copy from a
        // file:-symlinked dependency (e.g. desktop-shell's own react). Two React copies
        // crash at runtime ("Invalid hook call") the moment a shared component (AppBar)
        // uses a hook — a blank screen. Mirrors the clientProject vitest dedupe.
        resolve: { dedupe: ['react', 'react-dom'] },
        server: {
            port: opts.port,
            strictPort: opts.strictPort ?? true,
            proxy: { '/api': proxyEntry },
        },
        build,
    };
    if (opts.root !== undefined)
        config.root = opts.root;
    return config;
}
