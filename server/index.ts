// Servidor Fastify: API /api + (em produção) serve o frontend buildado em dist/.
import path from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { registerRoutes } from './routes.ts';
import { ROOT, pinnedSlug } from './files.ts';
import { migrateLegacyDomains } from './domains.ts';
import { getActiveDomainSlug } from './domainContext.ts';

const APP_ROOT = ROOT;
const PORT = Number(process.env.PORT ?? 5174);
const isProd = process.env.NODE_ENV === 'production';

async function main() {
  // Migra o layout legado (data/projects/ direto em data/) para
  // data/domains/local/ — idempotente e não requer domínio ativo.
  await migrateLegacyDomains();

  // Falha cedo se LOCALDRAWDB_PROJECT apontar para um projeto inexistente —
  // só faz sentido checar quando já há domínio ativo (LOCALDRAWDB_DOMAIN);
  // sem ele, a tela de escolha é quem vai definir o domínio.
  if (getActiveDomainSlug()) {
    await pinnedSlug();
  }

  const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 });

  await registerRoutes(app);

  // Em produção, serve os estáticos buildados pelo Vite.
  const dist = path.join(APP_ROOT, 'dist');
  if (isProd && existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  await app.listen({ port: PORT, host: '127.0.0.1' });
  app.log.info({ root: APP_ROOT, port: PORT }, 'localdrawdb API');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
