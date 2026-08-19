// Registro em memória das instâncias dedicadas que o controlboard sobe sob
// demanda (server+vite por domínio+projeto). Cada instância roda até ser
// parada explicitamente ou até o processo filho cair sozinho. Estado vive só
// na memória do processo do controlboard — não persiste em disco.
import crypto from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { startInstance, stopInstance } from '../scripts/instanceLauncher.mjs';
import { findFreePort } from '../scripts/devPorts.mjs';

export interface BoardInstance {
  id: string;
  domainSlug: string;
  domainName: string;
  projectSlug: string;
  projectName: string;
  apiPort: number;
  webPort: number;
  url: string;
  startedAt: string;
}

type KillableHandle = { server: ChildProcess; web: ChildProcess | null };

export interface InstanceManagerDeps {
  startInstance: (opts: {
    domainSlug: string;
    projectSlug: string;
    apiPort: number;
    webPort: number;
  }) => Promise<KillableHandle>;
  stopInstance: (handle: KillableHandle) => void;
  findFreePort: (start: number, host?: string, exclude?: Set<number>) => Promise<number>;
}

const defaultDeps: InstanceManagerDeps = { startInstance: startInstance as any, stopInstance, findFreePort };

export function createInstanceManager(deps: InstanceManagerDeps = defaultDeps) {
  const instances = new Map<string, { meta: BoardInstance; handle: KillableHandle }>();
  const usedPorts = new Set<number>();

  function release(id: string): void {
    const entry = instances.get(id);
    if (!entry) return;
    usedPorts.delete(entry.meta.apiPort);
    usedPorts.delete(entry.meta.webPort);
    instances.delete(id);
  }

  async function launch(opts: {
    domainSlug: string;
    domainName: string;
    projectSlug: string;
    projectName: string;
  }): Promise<BoardInstance> {
    const apiPort = await deps.findFreePort(5174, '127.0.0.1', usedPorts);
    usedPorts.add(apiPort);
    const webPort = await deps.findFreePort(5173, '127.0.0.1', usedPorts);
    usedPorts.add(webPort);

    const handle = await deps.startInstance({
      domainSlug: opts.domainSlug,
      projectSlug: opts.projectSlug,
      apiPort,
      webPort,
    });

    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const meta: BoardInstance = {
      id,
      domainSlug: opts.domainSlug,
      domainName: opts.domainName,
      projectSlug: opts.projectSlug,
      projectName: opts.projectName,
      apiPort,
      webPort,
      url: `http://127.0.0.1:${webPort}`,
      startedAt: new Date().toISOString(),
    };
    instances.set(id, { meta, handle });

    const onExit = () => release(id);
    handle.server.on('exit', onExit);
    handle.web?.on('exit', onExit);

    return meta;
  }

  function list(): BoardInstance[] {
    return [...instances.values()].map((e) => e.meta);
  }

  function stop(id: string): boolean {
    const entry = instances.get(id);
    if (!entry) return false;
    deps.stopInstance(entry.handle);
    release(id);
    return true;
  }

  function stopByDomain(domainSlug: string): void {
    for (const [id, entry] of instances) {
      if (entry.meta.domainSlug === domainSlug) {
        deps.stopInstance(entry.handle);
        release(id);
      }
    }
  }

  function stopAll(): void {
    for (const id of [...instances.keys()]) stop(id);
  }

  return { launch, list, stop, stopByDomain, stopAll };
}

export type InstanceManager = ReturnType<typeof createInstanceManager>;
