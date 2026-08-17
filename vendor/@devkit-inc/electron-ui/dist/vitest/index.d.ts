import type { TestProjectConfiguration } from 'vitest/config' with { 'resolution-mode': 'import' };
import type { PluginOption } from 'vite' with { 'resolution-mode': 'import' };
export interface NodeProjectOptions {
    /** Project name (default 'node'). */
    name?: string;
    /** Test globs (default `['tests/**\/*.test.ts']`). */
    include?: string[];
    exclude?: string[];
    globals?: boolean;
    testTimeout?: number;
    maxWorkers?: number;
}
export interface ClientProjectOptions {
    /** The vite plugin to drive JSX (e.g. react()), injected by the consumer. */
    plugin: PluginOption;
    /** Project name (default 'client'). */
    name?: string;
    /** Project root (e.g. 'client'). */
    root?: string;
    /** Test globs (default `['src/**\/*.test.{ts,tsx}']`). */
    include?: string[];
    exclude?: string[];
    setupFiles?: string[];
    globals?: boolean;
    testTimeout?: number;
}
/** A node-environment vitest project for server/CLI/library unit tests. */
export declare function nodeProject(opts?: NodeProjectOptions): TestProjectConfiguration;
/** A jsdom vitest project for React component/hook tests. */
export declare function clientProject(opts: ClientProjectOptions): TestProjectConfiguration;
