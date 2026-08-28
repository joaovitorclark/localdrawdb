import { describe, expect, it, vi } from 'vitest';
import { buildInstanceEnv, stopInstance } from '../instanceLauncher.mjs';

describe('buildInstanceEnv', () => {
  it('inclui PORT/API_PORT/VITE_PORT como string', () => {
    const env = buildInstanceEnv({ apiPort: 5174, webPort: 5173 }, {});
    expect(env.PORT).toBe('5174');
    expect(env.API_PORT).toBe('5174');
    expect(env.VITE_PORT).toBe('5173');
  });

  it('sem domainSlug/projectSlug, não pina domínio', () => {
    const env = buildInstanceEnv({ apiPort: 5174, webPort: 5173 }, {});
    expect(env.LOCALDRAWDB_DOMAIN).toBeUndefined();
    expect(env.LOCALDRAWDB_PROJECT).toBeUndefined();
  });

  it('com domainSlug+projectSlug, pina os dois', () => {
    const env = buildInstanceEnv(
      { domainSlug: 'vendas', projectSlug: 'q1', apiPort: 5174, webPort: 5173 },
      {},
    );
    expect(env.LOCALDRAWDB_DOMAIN).toBe('vendas');
    expect(env.LOCALDRAWDB_PROJECT).toBe('q1');
  });

  it('preserva o env base', () => {
    const env = buildInstanceEnv({ apiPort: 1, webPort: 2 }, { PATH: '/usr/bin' });
    expect(env.PATH).toBe('/usr/bin');
  });
});

describe('stopInstance', () => {
  it('manda SIGTERM pro server e pro web', () => {
    const server = { kill: vi.fn() };
    const web = { kill: vi.fn() };
    stopInstance({ server, web });
    expect(server.kill).toHaveBeenCalledWith('SIGTERM');
    expect(web.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('funciona sem web (modo preview)', () => {
    const server = { kill: vi.fn() };
    stopInstance({ server, web: null });
    expect(server.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
