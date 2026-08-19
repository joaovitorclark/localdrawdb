import type { ChildProcess } from 'node:child_process';

export const ROOT: string;
export const TSX_CLI: string;
export const VITE_CLI: string;

export function buildInstanceEnv(
  opts: { domainSlug?: string | null; projectSlug?: string | null; apiPort: number; webPort: number },
  baseEnv?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;

export function startInstance(opts: {
  domainSlug?: string | null;
  projectSlug?: string | null;
  apiPort: number;
  webPort: number;
}): Promise<{ server: ChildProcess; web: ChildProcess }>;

export function startPreviewInstance(opts: {
  domainSlug?: string | null;
  projectSlug?: string | null;
  port: number;
}): { server: ChildProcess; web: null };

export function stopInstance(handle: { server: ChildProcess; web: ChildProcess | null }): void;
