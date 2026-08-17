/**
 * Set the Windows AppUserModelID (taskbar grouping + notifications). When the dev
 * launcher is active (DESKTOP_SHELL_DEV_URL set), a `.dev` suffix gives the live-HMR
 * build its own taskbar identity, separate from the installed app.
 */
export declare function setAppIdentity(baseAppId: string): void;
