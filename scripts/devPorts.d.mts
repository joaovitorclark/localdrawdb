export function findFreePort(start: number, host?: string, exclude?: Set<number>): Promise<number>;
export function waitForPort(port: number, host?: string, timeoutMs?: number): Promise<void>;
export function allocateDevPorts(
  env?: NodeJS.ProcessEnv,
  exclude?: Set<number>,
): Promise<{ apiPort: number; webPort: number }>;
