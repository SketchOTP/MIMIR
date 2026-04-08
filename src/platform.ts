import type { ExecSyncOptions } from "child_process";

/** Current `process.platform` (e.g. `win32`, `linux`, `darwin`). */
export const platform = process.platform as NodeJS.Platform;

export const isWindows = platform === "win32";
export const isLinux = platform === "linux";
export const isDarwin = platform === "darwin";

/** Human-readable OS name for logs and hints. */
export function osDisplayName(): string {
  if (isWindows) return "Windows";
  if (isDarwin) return "macOS";
  if (isLinux) return "Linux";
  return platform;
}

/**
 * Options for `execSync` when invoking `git` so behavior is correct on Windows and POSIX.
 * On Windows, uses the system shell so `git` from PATH (e.g. Git for Windows) resolves when `cwd`
 * or install paths differ; on Linux/macOS uses the default direct spawn (no shell).
 */
export function gitExecSyncOptions(cwd: string): ExecSyncOptions {
  const base: ExecSyncOptions = {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 10 * 1024 * 1024,
  };
  if (isWindows) {
    return {
      ...base,
      shell: process.env.ComSpec || true,
      windowsHide: true,
    };
  }
  return base;
}
