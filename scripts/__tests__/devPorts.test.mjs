import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { allocateDevPorts, findFreePort } from '../devPorts.mjs';

function holdPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen({ port, host }, () => resolve(server));
  });
}

describe('findFreePort', () => {
  it('nao devolve porta ja reservada em exclude', async () => {
    const held = await holdPort(0);
    const addr = held.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const next = await findFreePort(port, '127.0.0.1', new Set([port]));
    expect(next).not.toBe(port);
    held.close();
  });

  it('nao devolve porta ocupada só em IPv6 (::1), que o Vite usa no macOS', async () => {
    let held;
    try {
      held = await holdPort(0, '::1');
    } catch {
      return; // máquina sem IPv6 — nada a provar
    }
    const addr = held.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      const next = await findFreePort(port, '127.0.0.1');
      expect(next).not.toBe(port);
    } finally {
      held.close();
    }
  });

  it('aloca par api/web distinto quando a base esta ocupada', async () => {
    const held = await holdPort(0);
    const addr = held.address();
    const busy = typeof addr === 'object' && addr ? addr.port : 0;
    const { apiPort, webPort } = await allocateDevPorts({ PORT: String(busy), VITE_PORT: String(busy) });
    expect(webPort).not.toBe(apiPort);
    held.close();
  });
});
