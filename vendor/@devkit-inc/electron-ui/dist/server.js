"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serveApp = serveApp;
exports.resolveClientDist = resolveClientDist;
exports.mountSpa = mountSpa;
const node_http_1 = require("node:http");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/**
 * Start listening and resolve once the socket is up, with a handle whose close()
 * also calls closeAllConnections() so a live keep-alive socket can't stall shutdown.
 * The shared "serve + clean teardown" primitive behind each tool's startX() helper.
 *
 * Pass a request listener (an Express app is one) and it creates the http.Server for
 * you, OR pass an already-built, not-yet-listening http.Server (e.g. one a pure
 * engine handed back) to keep that engine free of any dependency on this package.
 */
function serveApp(target, opts) {
    const server = typeof target === 'function' ? (0, node_http_1.createServer)(target) : target;
    return new Promise((resolve, reject) => {
        const onError = (err) => reject(err);
        server.once('error', onError);
        const onListening = () => {
            server.removeListener('error', onError);
            const addr = server.address();
            const port = typeof addr === 'object' && addr ? addr.port : opts.port;
            resolve({
                port,
                url: `http://${opts.host ?? 'localhost'}:${port}`,
                close: () => new Promise((res, rej) => {
                    server.close((err) => (err ? rej(err) : res()));
                    server.closeAllConnections?.();
                }),
            });
        };
        if (opts.host !== undefined)
            server.listen(opts.port, opts.host, onListening);
        else
            server.listen(opts.port, onListening);
    });
}
/**
 * Locate a built SPA bundled in the app: walk up from `from` looking for
 * `<rel>/index.html`, returning the first hit. Handles dev (compiled module nested in
 * dist-electron/) and packaged (inside the asar) layouts. Falls back to
 * `<from>/../../<rel>` if nothing matched.
 */
function resolveClientDist(opts) {
    const rel = opts.rel ?? 'dist/client';
    const levels = opts.levels ?? 6;
    let dir = opts.from;
    for (let i = 0; i < levels; i += 1) {
        const candidate = (0, node_path_1.join)(dir, rel);
        if ((0, node_fs_1.existsSync)((0, node_path_1.join)(candidate, 'index.html')))
            return candidate;
        dir = (0, node_path_1.dirname)(dir);
    }
    return (0, node_path_1.join)(opts.from, '..', '..', rel);
}
/**
 * Serve a built SPA on an Express app: static assets first, then an index.html
 * catch-all for client-side routes. Call AFTER your /api routes. Pass your own
 * `express.static` so this package needs no express dependency (and there's only ever
 * one express instance — the app's). `@types/express` is a build-only devDependency.
 */
function mountSpa(app, clientDist, serveStatic) {
    app.use(serveStatic(clientDist));
    app.get('*', (_req, res) => {
        res.sendFile((0, node_path_1.join)(clientDist, 'index.html'));
    });
}
