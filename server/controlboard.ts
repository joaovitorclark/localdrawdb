// Processo do controlboard: UI dev-only pra escolher domínio+projeto e
// alocar uma instância dedicada sob demanda. Nunca roda em produção — só é
// spawnado por scripts/dev.mjs quando `npm run dev` roda sem argumentos.
import Fastify from 'fastify';
import { migrateLegacyDomains } from './domains.ts';
import { baseDataDir } from './domainContext.ts';
import { registerControlboardRoutes } from './routes/controlboardRoutes.ts';
import { createInstanceManager } from './controlboardInstances.ts';
import { CONTROLBOARD_HTML } from './controlboardUi.ts';

const PORT = Number(process.env.PORT ?? 5170);

async function main() {
  try {
    await migrateLegacyDomains();
  } catch (err) {
    console.error(
      `[localdrawdb] Falha ao migrar dados legados em "${baseDataDir()}" — inspecione manualmente ` +
        `antes de tentar de novo. Nenhum dado foi sobrescrito.`,
    );
    throw err;
  }

  const app = Fastify({ logger: false });
  const instances = createInstanceManager();
  registerControlboardRoutes(app, instances);

  app.get('/', async (_req, reply) => {
    reply.type('text/html').send(CONTROLBOARD_HTML);
  });

  const shutdown = () => {
    instances.stopAll();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`\nlocaldrawdb controlboard\n  http://127.0.0.1:${PORT}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
