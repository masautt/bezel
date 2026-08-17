import type { App } from 'electron';
/** Read a JSON config from the app's userData dir. Returns {} on missing/invalid JSON. */
export declare function readUserConfig<T extends object>(app: App, file?: string): Partial<T>;
/** Write a JSON config to the app's userData dir (best-effort). */
export declare function writeUserConfig<T extends object>(app: App, data: T, file?: string): void;
