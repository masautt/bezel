import { type RequestListener, type Server } from 'node:http';
import type { Express, Handler } from 'express';
export interface ServerHandle {
    /** The actual bound port (resolved from the listening socket, so port 0 works). */
    port: number;
    /** `http://<host>:<port>` — load this in the window or open it in a browser. */
    url: string;
    /** Stop listening; also drops idle keep-alive sockets so close() can't hang. */
    close(): Promise<void>;
}
export interface ServeAppOptions {
    /** Port to bind. Pass a pre-resolved free port, or 0 to let the OS choose. */
    port: number;
    /** Bind host. Omit to bind all interfaces (dual-stack; `localhost` resolves);
     *  pass '127.0.0.1' to bind loopback only. */
    host?: string;
}
/**
 * Start listening and resolve once the socket is up, with a handle whose close()
 * also calls closeAllConnections() so a live keep-alive socket can't stall shutdown.
 * The shared "serve + clean teardown" primitive behind each tool's startX() helper.
 *
 * Pass a request listener (an Express app is one) and it creates the http.Server for
 * you, OR pass an already-built, not-yet-listening http.Server (e.g. one a pure
 * engine handed back) to keep that engine free of any dependency on this package.
 */
export declare function serveApp(target: RequestListener | Server, opts: ServeAppOptions): Promise<ServerHandle>;
export interface ResolveClientDistOptions {
    /** Where to start walking up from — pass the caller's `__dirname`. */
    from: string;
    /** Relative path to the built SPA dir (default 'dist/client'). */
    rel?: string;
    /** How many parent levels to try before giving up (default 6). */
    levels?: number;
}
/**
 * Locate a built SPA bundled in the app: walk up from `from` looking for
 * `<rel>/index.html`, returning the first hit. Handles dev (compiled module nested in
 * dist-electron/) and packaged (inside the asar) layouts. Falls back to
 * `<from>/../../<rel>` if nothing matched.
 */
export declare function resolveClientDist(opts: ResolveClientDistOptions): string;
/**
 * Serve a built SPA on an Express app: static assets first, then an index.html
 * catch-all for client-side routes. Call AFTER your /api routes. Pass your own
 * `express.static` so this package needs no express dependency (and there's only ever
 * one express instance — the app's). `@types/express` is a build-only devDependency.
 */
export declare function mountSpa(app: Express, clientDist: string, serveStatic: (root: string) => Handler): void;
