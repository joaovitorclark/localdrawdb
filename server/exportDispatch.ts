// Dispatcher unificado de export por formato.
import { modelToDbtFiles } from './dbtExport.ts';
import { modelToErwinDDL } from './ddl/erwin.ts';
import { modelToMermaid } from './ddl/mermaid.ts';
import { modelToDicionarioXlsx } from './ddl/xlsx.ts';
import { modelToLlmContext } from './ddl/llmContext.ts';
import { oracleDDLBySchema } from './ddl/oracle.ts';
import { postgresDDLBySchema } from './ddl/postgres.ts';
import { sparkDDLBySchema } from './ddl/spark.ts';
import { writeOutput } from './files.ts';
import type { Model } from './model.ts';
import { modelToInputSql, type InputDialect } from './sqlExport.ts';

export type ExportFormat =
  | 'localdrawdb'
  | 'spark-ddl'
  | 'oracle-ddl'
  | 'postgres-ddl'
  | 'erwin'
  | 'dbt'
  | 'mermaid'
  | 'xlsx'
  | 'llm-context';

export type ExportRequest = {
  format: ExportFormat;
  dialect?: InputDialect;
};

export async function runExport(model: Model, req: ExportRequest): Promise<string[]> {
  const { format, dialect = 'spark' } = req;
  const written: string[] = [];

  switch (format) {
    case 'localdrawdb': {
      const content = modelToInputSql(model, dialect);
      const filename =
        dialect === 'oracle' ? 'model_oracle.sql' : 'model_spark.sql';
      written.push(await writeOutput(`localdrawdb/${filename}`, content));
      break;
    }
    case 'spark-ddl': {
      for (const [name, content] of Object.entries(sparkDDLBySchema(model))) {
        written.push(await writeOutput(`spark/${name}`, content));
      }
      break;
    }
    case 'oracle-ddl': {
      for (const [name, content] of Object.entries(oracleDDLBySchema(model))) {
        written.push(await writeOutput(`oracle/${name}`, content));
      }
      break;
    }
    case 'postgres-ddl': {
      for (const [name, content] of Object.entries(postgresDDLBySchema(model))) {
        written.push(await writeOutput(`postgres/${name}`, content));
      }
      break;
    }
    case 'erwin': {
      written.push(await writeOutput('erwin/modelo.sql', modelToErwinDDL(model)));
      break;
    }
    case 'dbt': {
      for (const f of modelToDbtFiles(model)) {
        written.push(await writeOutput(`dbt/${f.path}`, f.content));
      }
      break;
    }
    case 'mermaid': {
      written.push(await writeOutput('mermaid/modelo.mmd', modelToMermaid(model)));
      break;
    }
    case 'xlsx': {
      const buf = modelToDicionarioXlsx(model);
      written.push(await writeOutput('xlsx/dicionario.xlsx', buf));
      break;
    }
    case 'llm-context': {
      written.push(await writeOutput('llm/contexto.md', modelToLlmContext(model)));
      break;
    }
    default: {
      const _exhaustive: never = format;
      throw new Error(`Formato de export desconhecido: ${_exhaustive}`);
    }
  }

  return written;
}
