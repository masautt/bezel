import type { UserConfig, PluginOption } from 'vite' with { 'resolution-mode': 'import' };
export interface ViteClientOptions {
    /** The vite plugin to drive JSX (e.g. react()), injected by the consumer so this
     *  CJS package never imports the ESM-only @vitejs/plugin-react. */
    plugin: PluginOption;
    /** Dev-server port. */
    port: number;
    /** Proxy target for `/api` (e.g. 'http://localhost:3000'). */
    apiTarget: string;
    /** Set proxy `changeOrigin` (needed when the target host differs). Default false. */
    changeOrigin?: boolean;
    /** Project root holding index.html (e.g. 'client'). Omit if the config sits at the SPA root. */
    root?: string;
    /** Build output dir. Default '../dist/client'. */
    outDir?: string;
    /** Fail loudly if the port is taken instead of drifting (electron:hmr hardcodes the
     *  port in wait-on + DESKTOP_SHELL_DEV_URL). Default true. */
    strictPort?: boolean;
    /** Empty outDir before building. Default true. */
    emptyOutDir?: boolean;
}
/**
 * The shared Vite config for a desktop-shell SPA client: a react() plugin, a dev
 * server with an `/api` proxy to the tool's Node backend, and a client build. The
 * consumer wraps the result in `defineConfig()` and injects its react() plugin —
 * mirroring the `clientProject` vitest factory.
 */
export declare function viteClientConfig(opts: ViteClientOptions): UserConfig;
