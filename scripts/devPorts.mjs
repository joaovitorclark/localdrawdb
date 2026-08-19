import net from 'node:net';

/**
 * true = dá para bindar nesta família. Falha de família inexistente
 * (sem IPv6 na máquina) conta como livre — não é ocupação da porta.
 * EADDRINUSE (e similares) conta como ocupada.
 */
function canListen(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (err) => {
      const code = err && err.code;
      if (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT' || code === 'EINVAL') {
        resolve(true);
        return;
      }
      resolve(false);
    });
    server.listen({ port, host }, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Porta livre em IPv4 e IPv6. O Vite no macOS costuma bindar em `::1`;
 * probe só em `127.0.0.1` via a porta como livre e o `--strictPort` explode.
 * `host` extra é checado também (ex.: `0.0.0.0` no launcher Windows).
 */
export async function findFreePort(start, host = '127.0.0.1', exclude = new Set()) {
  let port = start;
  for (let i = 0; i < 1000; i++, port += 1) {
    if (exclude.has(port)) continue;
    const v4 = await canListen(port, '127.0.0.1');
    const v6 = await canListen(port, '::1');
    const extra = host === '127.0.0.1' || host === '::1' ? true : await canListen(port, host);
    if (v4 && v6 && extra) return port;
  }
  throw new Error(`Nenhuma porta livre a partir de ${start}`);
}

/** @param {number} port @param {string} host @param {number} timeoutMs */
export async function waitForPort(port, host = '127.0.0.1', timeoutMs = 60_000) {
  const hosts = host === '127.0.0.1' || host === 'localhost' ? ['127.0.0.1', '::1'] : [host];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const h of hosts) {
      try {
        await new Promise((resolve, reject) => {
          const socket = net.connect({ port, host: h }, () => {
            socket.end();
            resolve(undefined);
          });
          socket.on('error', reject);
        });
        return;
      } catch {
        /* tenta a outra família */
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`API nao respondeu em ${host}:${port} dentro de ${timeoutMs}ms`);
}

export async function allocateDevPorts(env = process.env, exclude = new Set()) {
  const apiPort = await findFreePort(Number(env.PORT) || 5174, '127.0.0.1', exclude);
  const webPort = await findFreePort(Number(env.VITE_PORT) || 5173, '127.0.0.1', new Set([...exclude, apiPort]));
  if (webPort === apiPort) {
    throw new Error(`Portas dev conflitantes (web=api=${apiPort}). Encerre outros npm run dev e tente de novo.`);
  }
  return { apiPort, webPort };
}
