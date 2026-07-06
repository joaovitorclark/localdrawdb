import type { FastifyInstance, FastifyReply } from 'fastify';
import { dbmlToModel, modelToDbml } from './dbmlIo.ts';
import { mergeModel, sqlToModel } from './sqlImport.ts';
import { dbtFilesToModel } from './dbtImport.ts';
import {
  DATA_DIR,
  ROOT,
  getActiveInputDir,
  getActiveId,
  getProject,
  listProjects,
  createProject,
  renameProject,
  deleteProject,
  duplicateProject,
  setActiveProject,
  loadProject,
  loadProjectBySlug,
  saveProjectBySlug,
  ensureRegistry,
  readImportInputsForSlug,
  getActiveSlug,
  saveProject,
  writeOutput,
  pinnedSlug,
  readRegistry,
} from './files.ts';
import type { Model } from './model.ts';
import { registerExportRoutes } from './routes/exportRoutes.ts';

type ProjectBody = { dbml?: string; canvas?: unknown };
type DbmlBody = { dbml?: string };
type PngBody = { pngBase64?: string };
type CreateProjectBody = { name?: string };
type DuplicateBody = { name?: string };

/** Faz parse do DBML; em caso de erro de sintaxe responde 400 e retorna null. */
function parseOr400(dbml: string, reply: FastifyReply): Model | null {
  try {
    return dbmlToModel(dbml);
  } catch (e: any) {
    const msg = e?.diags?.[0]?.message ?? e?.diags?.[0]?.error ?? e?.message ?? 'DBML inválido';
    reply.code(400).send({ error: `DBML inválido: ${msg}` });
    return null;
  }
}

/**
 * Núcleo do import: recebe lista de arquivos SQL e DBML base, retorna
 * resultado merged. Compartilhado por /api/import e /api/projects/:id/import.
 */
export async function runImport(
  inputs: { file: string; content: string }[],
  baseDbml: string,
): Promise<{
  dbml: string;
  imported: string[];
  lineageFieldCount: number;
  warnings?: string[];
}> {
  const warnings: string[] = [];
  let model: Model = { tables: [], refs: [] };
  if (baseDbml.trim()) {
    try {
      model = dbmlToModel(baseDbml);
    } catch (e: any) {
      const msg = e?.diags?.[0]?.message ?? e?.diags?.[0]?.error ?? e?.message ?? 'DBML inválido';
      warnings.push(`DBML do projeto ignorado: ${msg}`);
    }
  }
  let merged = model;
  const imported: string[] = [];

  // DBML nativo (.dbml): merge direto do modelo canônico — formato sem perdas.
  const dbmlInputs = inputs.filter((f) => /\.dbml$/i.test(f.file));
  for (const { file, content } of dbmlInputs) {
    let incoming: Model;
    try {
      incoming = dbmlToModel(content);
    } catch (e: any) {
      const msg = e?.diags?.[0]?.message ?? e?.diags?.[0]?.error ?? e?.message ?? 'DBML inválido';
      warnings.push(`${file}: DBML inválido: ${msg}`);
      continue;
    }
    if (incoming.tables.length) {
      merged = mergeModel(merged, incoming);
      const refCount = incoming.refs.length;
      imported.push(
        `${file} (${incoming.tables.length} tabela(s)${refCount ? `, ${refCount} ref(s)` : ''})`,
      );
    }
  }

  // Separa artefatos dbt (.yml/.json e .sql com Jinja) do SQL DDL puro.
  const isDbtArtifact = (f: { file: string; content: string }) =>
    /\.(ya?ml|json)$/i.test(f.file) || (/\.sql$/i.test(f.file) && f.content.includes('{{'));
  const rest = inputs.filter((f) => !/\.dbml$/i.test(f.file));
  const dbtInputs = rest.filter(isDbtArtifact);
  const ddlInputs = rest.filter((f) => !isDbtArtifact(f));

  for (const { file, content } of ddlInputs) {
    const incoming = sqlToModel(content);
    if (incoming.warnings?.length) {
      for (const w of incoming.warnings) warnings.push(`${file}: ${w}`);
    }
    if (incoming.tables.length) {
      merged = mergeModel(merged, incoming);
      const refCount = incoming.refs.length;
      imported.push(
        `${file} (${incoming.tables.length} tabela(s)${refCount ? `, ${refCount} ref(s)` : ''})`,
      );
    }
  }

  // Import dbt: todos os artefatos são considerados em conjunto (um projeto dbt
  // abrange schema.yml + *.sql; manifest.json é autossuficiente).
  if (dbtInputs.length) {
    const dbtModel = dbtFilesToModel(dbtInputs);
    if (dbtModel?.tables.length) {
      merged = mergeModel(merged, dbtModel);
      const refCount = dbtModel.refs.length;
      imported.push(
        `dbt: ${dbtInputs.map((f) => f.file).join(', ')} (${dbtModel.tables.length} tabela(s)${refCount ? `, ${refCount} ref(s)` : ''})`,
      );
    }
  }
  return {
    dbml: modelToDbml(merged),
    imported,
    lineageFieldCount: merged.lineageFields?.length ?? 0,
    warnings: warnings.length ? warnings : undefined,
  };
}

async function requireUnpinned(reply: FastifyReply): Promise<boolean> {
  const pin = await pinnedSlug();
  if (pin) {
    reply.code(409).send({ error: `Instância fixada no projeto "${pin}"; gerenciamento desabilitado.` });
    return false;
  }
  return true;
}

async function requirePinMatch(reply: FastifyReply, id: string): Promise<boolean> {
  const pin = await pinnedSlug();
  if (!pin) return true;
  const proj = await getProject(id).catch(() => null);
  if (proj && proj.slug !== pin) {
    reply.code(409).send({ error: `Instância fixada no projeto "${pin}"; gravação em outro projeto bloqueada.` });
    return false;
  }
  return true; // sem pin, ou id é o próprio projeto fixado, ou id inexistente (handler trata 404)
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Garante estrutura multi-projeto antes de qualquer rota ser chamada.
  await ensureRegistry();

  app.get('/api/meta', async () => {
    const pin = await pinnedSlug();
    let pinnedProjectId: string | null = null;
    if (pin) {
      const reg = await readRegistry();
      pinnedProjectId = reg.projects.find((p) => p.slug === pin)?.id ?? null;
    }
    return {
      root: ROOT,
      dataDir: DATA_DIR,
      inputDir: await getActiveInputDir(),
      port: Number(process.env.PORT ?? 5174),
      pinnedProject: pin,
      pinnedProjectId,
    };
  });

  // ──────────────────────────────────────────────────────────────
  // Rotas CRUD de projetos
  // ──────────────────────────────────────────────────────────────

  /** Lista todos os projetos e o id ativo. */
  app.get('/api/projects', async () => {
    const [projects, activeId] = await Promise.all([listProjects(), getActiveId()]);
    return { activeId, projects };
  });

  /** Cria novo projeto. Retorna 201 com o ProjectMeta. */
  app.post<{ Body: CreateProjectBody }>('/api/projects', async (req, reply) => {
    if (!(await requireUnpinned(reply))) return;
    const name = req.body?.name ?? 'Novo Projeto';
    const meta = await createProject(name);
    reply.code(201);
    return meta;
  });

  /** Carrega DBML + canvas de um projeto pelo id. */
  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    try {
      const proj = await getProject(req.params.id);
      return loadProjectBySlug(proj.slug);
    } catch (e: any) {
      if (e?.message?.includes('não encontrado')) {
        return reply.code(404).send({ error: e.message });
      }
      throw e;
    }
  });

  /** Salva DBML + canvas de um projeto pelo id. */
  app.put<{ Params: { id: string }; Body: ProjectBody }>('/api/projects/:id', async (req, reply) => {
    if (!(await requirePinMatch(reply, req.params.id))) return;
    try {
      const proj = await getProject(req.params.id);
      const { dbml = '', canvas = {} } = req.body ?? {};
      await saveProjectBySlug(proj.slug, dbml, canvas);
      return { ok: true };
    } catch (e: any) {
      if (e?.message?.includes('não encontrado')) {
        return reply.code(404).send({ error: e.message });
      }
      throw e;
    }
  });

  /** Renomeia um projeto pelo id. */
  app.patch<{ Params: { id: string }; Body: { name?: string } }>('/api/projects/:id', async (req, reply) => {
    if (!(await requireUnpinned(reply))) return;
    try {
      const name = req.body?.name ?? '';
      await renameProject(req.params.id, name);
      return { ok: true };
    } catch (e: any) {
      if (e?.message?.includes('não encontrado')) {
        return reply.code(404).send({ error: e.message });
      }
      throw e;
    }
  });

  /** Remove um projeto. 409 se for o último; 404 se não encontrado. */
  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    if (!(await requireUnpinned(reply))) return;
    try {
      // Verifica existência antes de tentar deletar (para distinguir 404 de 409).
      await getProject(req.params.id);
      await deleteProject(req.params.id);
      return { ok: true };
    } catch (e: any) {
      const msg: string = e?.message ?? '';
      if (msg.includes('não encontrado')) {
        return reply.code(404).send({ error: msg });
      }
      if (msg.toLowerCase().includes('único projeto') || msg.toLowerCase().includes('unico projeto')) {
        return reply.code(409).send({ error: msg });
      }
      throw e;
    }
  });

  /** Duplica um projeto. Retorna 201 com o novo ProjectMeta. */
  app.post<{ Params: { id: string }; Body: DuplicateBody }>('/api/projects/:id/duplicate', async (req, reply) => {
    if (!(await requireUnpinned(reply))) return;
    try {
      const newName = req.body?.name;
      const meta = await duplicateProject(req.params.id, newName);
      reply.code(201);
      return meta;
    } catch (e: any) {
      if (e?.message?.includes('não encontrado')) {
        return reply.code(404).send({ error: e.message });
      }
      throw e;
    }
  });

  /** Torna um projeto o ativo. */
  app.post<{ Params: { id: string } }>('/api/projects/:id/activate', async (req, reply) => {
    const pin = await pinnedSlug();
    if (pin) return { ok: true, pinned: pin };
    try {
      await setActiveProject(req.params.id);
      return { ok: true, activeId: req.params.id };
    } catch (e: any) {
      if (e?.message?.includes('não encontrado')) {
        return reply.code(404).send({ error: e.message });
      }
      throw e;
    }
  });

  /** Import de SQL para um projeto específico pelo id. */
  app.post<{ Params: { id: string }; Body: DbmlBody }>('/api/projects/:id/import', async (req, reply) => {
    if (!(await requirePinMatch(reply, req.params.id))) return;
    try {
      const proj = await getProject(req.params.id);
      const baseDbml = req.body?.dbml ?? '';
      const inputs = await readImportInputsForSlug(proj.slug);
      return runImport(inputs, baseDbml);
    } catch (e: any) {
      if (e?.message?.includes('não encontrado')) {
        return reply.code(404).send({ error: e.message });
      }
      throw e;
    }
  });

  // ──────────────────────────────────────────────────────────────
  // Rotas legadas (projeto ativo)
  // ──────────────────────────────────────────────────────────────

  app.get('/api/project', async () => loadProject());

  app.put<{ Body: ProjectBody }>('/api/project', async (req) => {
    const { dbml = '', canvas = {} } = req.body ?? {};
    await saveProject(dbml, canvas);
    return { ok: true };
  });

  app.post<{ Body: DbmlBody }>('/api/import', async (req) => {
    const baseDbml = req.body?.dbml ?? '';
    const inputs = await readImportInputsForSlug(await getActiveSlug());
    return runImport(inputs, baseDbml);
  });

  registerExportRoutes(app, parseOr400);

  app.post<{ Body: PngBody }>('/api/export/png', async (req) => {
    const data = (req.body?.pngBase64 ?? '').replace(/^data:image\/png;base64,/, '');
    const buf = Buffer.from(data, 'base64');
    const file = await writeOutput('diagram.png', buf);
    return { file };
  });
}
