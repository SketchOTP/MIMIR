import { execSync, type ExecSyncOptions } from "child_process";

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
      // `shell` must be a string in @types/node; `true` is invalid for this overload.
      shell: process.env.ComSpec ?? "cmd.exe",
      windowsHide: true,
    };
  }
  return base;
}

/**
 * Run a git command and return trimmed UTF-8 stdout.
 * Normalizes `execSync` return type (`string | Buffer` in current @types/node) for `.trim()` safety.
 */
export function execGitOutput(command: string, cwd: string): string {
  const raw = execSync(command, gitExecSyncOptions(cwd));
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  return text.trim();
}
