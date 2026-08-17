"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nodeProject = nodeProject;
exports.clientProject = clientProject;
/** A node-environment vitest project for server/CLI/library unit tests. */
function nodeProject(opts = {}) {
    const test = {
        name: opts.name ?? 'node',
        environment: 'node',
        include: opts.include ?? ['tests/**/*.test.ts'],
    };
    if (opts.exclude !== undefined)
        test.exclude = opts.exclude;
    if (opts.globals !== undefined)
        test.globals = opts.globals;
    if (opts.testTimeout !== undefined)
        test.testTimeout = opts.testTimeout;
    if (opts.maxWorkers !== undefined)
        test.maxWorkers = opts.maxWorkers;
    return { test };
}
/** A jsdom vitest project for React component/hook tests. */
function clientProject(opts) {
    const test = {
        name: opts.name ?? 'client',
        environment: 'jsdom',
        include: opts.include ?? ['src/**/*.test.{ts,tsx}'],
    };
    if (opts.exclude !== undefined)
        test.exclude = opts.exclude;
    if (opts.setupFiles !== undefined)
        test.setupFiles = opts.setupFiles;
    if (opts.globals !== undefined)
        test.globals = opts.globals;
    if (opts.testTimeout !== undefined)
        test.testTimeout = opts.testTimeout;
    const project = {
        plugins: [opts.plugin],
        // Dedupe React so a consumer testing a desktop-shell React component (resolved via
        // the file: symlink) doesn't load a second React copy → "Invalid hook call".
        resolve: { dedupe: ['react', 'react-dom'] },
        test,
    };
    if (opts.root !== undefined)
        project.root = opts.root;
    return project;
}
