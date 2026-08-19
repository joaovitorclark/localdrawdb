import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createInstanceManager } from '../controlboardInstances.ts';

function fakeFindFreePort(start: number, _host?: string, exclude = new Set<number>()) {
  let port = start;
  while (exclude.has(port)) port++;
  return Promise.resolve(port);
}

function makeDeps() {
  const stopInstance = vi.fn();
  const startInstance = vi.fn(async () => ({ server: new EventEmitter(), web: new EventEmitter() }));
  return { startInstance: startInstance as any, stopInstance, findFreePort: fakeFindFreePort };
}

const OPTS_A = { domainSlug: 'vendas', domainName: 'Vendas', projectSlug: 'q1', projectName: 'Q1' };
const OPTS_B = { domainSlug: 'rh', domainName: 'RH', projectSlug: 'q2', projectName: 'Q2' };

describe('createInstanceManager', () => {
  it('launch aloca portas distintas pra cada instância', async () => {
    const manager = createInstanceManager(makeDeps());
    const a = await manager.launch(OPTS_A);
    const b = await manager.launch(OPTS_B);
    expect(a.apiPort).not.toBe(b.apiPort);
    expect(a.webPort).not.toBe(b.webPort);
    expect(a.url).toBe(`http://127.0.0.1:${a.webPort}`);
  });

  it('list reflete as instâncias lançadas', async () => {
    const manager = createInstanceManager(makeDeps());
    const a = await manager.launch(OPTS_A);
    expect(manager.list().map((i) => i.id)).toEqual([a.id]);
  });

  it('stop chama deps.stopInstance, remove da lista e libera as portas', async () => {
    const deps = makeDeps();
    const manager = createInstanceManager(deps);
    const a = await manager.launch(OPTS_A);
    expect(manager.stop(a.id)).toBe(true);
    expect(deps.stopInstance).toHaveBeenCalledTimes(1);
    expect(manager.list()).toHaveLength(0);

    const b = await manager.launch(OPTS_A);
    expect(b.apiPort).toBe(a.apiPort); // porta liberada foi reaproveitada
  });

  it('stop com id inexistente retorna false', () => {
    const manager = createInstanceManager(makeDeps());
    expect(manager.stop('nao-existe')).toBe(false);
  });

  it('remove sozinha quando o processo filho cai (evento exit)', async () => {
    const deps = makeDeps();
    const manager = createInstanceManager(deps);
    await manager.launch(OPTS_A);
    const handle = await deps.startInstance.mock.results[0].value;
    handle.server.emit('exit', 1);
    expect(manager.list()).toHaveLength(0);
  });

  it('stopByDomain para só as instâncias daquele domínio', async () => {
    const manager = createInstanceManager(makeDeps());
    const vendas = await manager.launch(OPTS_A);
    const rh = await manager.launch(OPTS_B);
    manager.stopByDomain('vendas');
    expect(manager.list().map((i) => i.id)).toEqual([rh.id]);
    expect(vendas).toBeTruthy();
  });

  it('stopAll para todas as instâncias', async () => {
    const deps = makeDeps();
    const manager = createInstanceManager(deps);
    await manager.launch(OPTS_A);
    await manager.launch(OPTS_B);
    manager.stopAll();
    expect(manager.list()).toHaveLength(0);
    expect(deps.stopInstance).toHaveBeenCalledTimes(2);
  });
});
