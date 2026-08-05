// Entrypoint mínimo (rodado via tsx pelo launcher) que garante a existência do
// registry de projetos dentro do domínio "local" — o único que o CLI (./ldb)
// enxerga nesta versão. Delega à lógica canônica idempotente de files.ts e
// domains.ts, que respeitam LOCALDRAWDB_DATA_DIR (migra instalações legadas e
// reconstrói o registry a partir das pastas em projects/ quando apagado).
import { migrateLegacyDomains } from '../server/domains.ts';
import { setActiveDomainSlug } from '../server/domainContext.ts';
import { ensureRegistry } from '../server/files.ts';

await migrateLegacyDomains();
setActiveDomainSlug('local');
await ensureRegistry();
