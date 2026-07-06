// Modelo canônico — fonte de verdade intermediária entre DBML, SQL e geradores de DDL.

// ---- Tipos de teste dbt (discriminated union) ----

export type ColumnTest =
  | { kind: 'unique' }
  | { kind: 'not_null' }
  | { kind: 'accepted_values'; values: string[] }
  | { kind: 'relationships'; to: string; field: string };

export type Column = {
  name: string;
  type: string; // tipo base lakehouse, minúsculo: string, decimal, timestamp, int, ...
  args?: string; // parâmetros do tipo, ex.: "15" ou "18,2" (decimal(p,s))
  pk?: boolean;
  nullable?: boolean; // default true
  unique?: boolean;   // coluna tem constraint UNIQUE (nativa DBML [unique])
  note?: string;
  /** Testes dbt para a coluna (accepted_values; unique/not_null são derivados). */
  tests?: ColumnTest[];
};

export type Table = {
  name: string;
  schema?: string; // namespace/banco
  columns: Column[];
  note?: string;
  /** Note do import (@note): exportar só no bloco Records, não no Table. */
  noteInRecordsOnly?: boolean;
  group?: string; // TableGroup (organização visual)
  layer?: string; // LayerGroup (import metadata)
  records?: { columns: string[]; rows: string[][] }; // sample data from INSERTs
  compositePks?: string[][]; // PK composta, ex.: [['period','region']]
  // ---- Metadados dbt (F0) — todos opcionais ----
  /** Tipo de recurso dbt. Padrão implícito = 'model' (não serializado quando ausente). */
  resourceType?: 'model' | 'source' | 'seed' | 'snapshot';
  materialization?: 'table' | 'view' | 'incremental' | 'ephemeral';
  tags?: string[];
  /** Passthrough livre de metadados dbt (preservado no round-trip). */
  dbtMeta?: Record<string, unknown>;
};

export type Ref = {
  from: { table: string; column: string };
  to: { table: string; column: string };
  kind: '>' | '<' | '-' | '<>'; // n:1, 1:n, 1:1, n:n
};

/** Linhagem L1 tabela→tabela (DBML `Lineage { }`). */
export type LineageEntry = { target: string; sources: string[] };

/** Linhagem L2 campo→campo (DBML `LineageFields { }`). */
export type FieldLineageEntry = {
  targetTable: string;
  targetColumn: string;
  sourceTable: string;
  sourceColumn: string;
  note?: string;
  ref?: string;
};

export type Model = {
  tables: Table[];
  refs: Ref[];
  lineage?: LineageEntry[];
  lineageFields?: FieldLineageEntry[];
  /** Cores do bloco DBML `Colors {}` — chave: `schema.tabela`, `@grupo` ou `schema.tabela.coluna`. */
  colors?: Record<string, string>;
  /** Cores de camada (`LayerGroup nome [color: #hex]`) — chave: nome da camada. */
  layerColors?: Record<string, string>;
  /** Avisos do import SQL (ex.: FK composta com aridade divergente). */
  warnings?: string[];
};

/** Quebra "decimal(18,2)" em { base: "decimal", args: "18,2" }. */
export function parseTypeName(typeName: string): { base: string; args?: string } {
  const m = /^\s*([A-Za-z0-9_ ]+?)\s*(?:\(\s*([^)]*)\s*\))?\s*$/.exec(typeName);
  if (!m) return { base: typeName.trim().toLowerCase() };
  return { base: m[1].trim().toLowerCase(), args: m[2]?.replace(/\s+/g, '') || undefined };
}

const emptyName = (n: string) => n.replace(/[`"']/g, '').trim();

/** Identificador qualificado schema.tabela (schema opcional). */
export function qualifiedName(t: Pick<Table, 'name' | 'schema'>): string {
  const name = emptyName(t.name);
  return t.schema ? `${emptyName(t.schema)}.${name}` : name;
}

// ---- Mapas de tipo lakehouse -> alvo ----

const SPARK_ALIASES: Record<string, string> = {
  string: 'STRING',
  varchar: 'STRING',
  integer: 'INT',
  int: 'INT',
  smallint: 'SMALLINT',
  tinyint: 'TINYINT',
  bigint: 'BIGINT',
  decimal: 'DECIMAL',
  numeric: 'DECIMAL',
  double: 'DOUBLE',
  float: 'FLOAT',
  boolean: 'BOOLEAN',
  timestamp: 'TIMESTAMP',
  date: 'DATE',
};

const ANSI_ALIASES: Record<string, string> = {
  string: 'VARCHAR',
  varchar: 'VARCHAR',
  integer: 'INTEGER',
  int: 'INTEGER',
  smallint: 'SMALLINT',
  tinyint: 'SMALLINT',
  bigint: 'BIGINT',
  decimal: 'DECIMAL',
  numeric: 'DECIMAL',
  double: 'DOUBLE PRECISION',
  float: 'REAL',
  boolean: 'BOOLEAN',
  timestamp: 'TIMESTAMP',
  date: 'DATE',
};

/** Tipo Spark/Databricks para o DDL. Tipos desconhecidos passam em maiúsculas. */
export function typeToSpark(col: Column): string {
  const base = SPARK_ALIASES[col.type] ?? col.type.toUpperCase();
  // No Spark só DECIMAL leva tamanho; STRING/INT/TIMESTAMP/etc. não.
  if (base === 'DECIMAL' && col.args) return `DECIMAL(${col.args})`;
  return base;
}

/** Tipo ANSI (erwin reverse-engineer). string->VARCHAR(n); n = args ou 255. */
export function typeToAnsi(col: Column): string {
  const base = ANSI_ALIASES[col.type] ?? col.type.toUpperCase();
  if (base === 'VARCHAR') return `VARCHAR(${col.args || 255})`;
  if ((base === 'DECIMAL') && col.args) return `DECIMAL(${col.args})`;
  return base;
}

/** Tipo Oracle (DDL limpo). */
export function typeToOracle(col: Column): string {
  const t = col.type.toLowerCase();
  if (t === 'string' || t === 'varchar') return `VARCHAR2(${col.args || 255})`;
  if (t === 'bigint') return col.args ? `NUMBER(${col.args})` : 'NUMBER(19)';
  if (t === 'int' || t === 'integer') return col.args ? `NUMBER(${col.args})` : 'NUMBER(10)';
  if (t === 'decimal' || t === 'numeric') return col.args ? `NUMBER(${col.args})` : 'NUMBER(18,2)';
  if (t === 'double' || t === 'float') return 'NUMBER';
  if (t === 'boolean') return 'NUMBER(1)';
  if (t === 'timestamp') return 'TIMESTAMP';
  if (t === 'date') return 'DATE';
  if (t === 'varchar2') return `VARCHAR2(${col.args || 255})`;
  if (t === 'number') return col.args ? `NUMBER(${col.args})` : 'NUMBER';
  const upper = col.type.toUpperCase();
  return col.args ? `${upper}(${col.args})` : upper;
}

/** Tipo PostgreSQL (DDL limpo). */
export function typeToPostgres(col: Column): string {
  const t = col.type.toLowerCase();
  if (t === 'string' || t === 'varchar') return col.args ? `VARCHAR(${col.args})` : 'TEXT';
  if (t === 'bigint') return 'BIGINT';
  if (t === 'int' || t === 'integer') return 'INTEGER';
  if (t === 'smallint') return 'SMALLINT';
  if (t === 'tinyint') return 'SMALLINT';
  if (t === 'decimal' || t === 'numeric') return col.args ? `NUMERIC(${col.args})` : 'NUMERIC(18,2)';
  if (t === 'double') return 'DOUBLE PRECISION';
  if (t === 'float') return 'REAL';
  if (t === 'boolean') return 'BOOLEAN';
  if (t === 'timestamp') return 'TIMESTAMP';
  if (t === 'date') return 'DATE';
  if (t === 'varchar2') return col.args ? `VARCHAR(${col.args})` : 'TEXT';
  if (t === 'number') return col.args ? `NUMERIC(${col.args})` : 'NUMERIC';
  const upper = col.type.toUpperCase();
  return col.args ? `${upper}(${col.args})` : upper;
}

/** Colunas da PK (simples ou composta). */
export function pkCols(t: Table): string[] {
  const composite = (t.compositePks ?? []).find((g) => g.length > 1);
  if (composite) return composite;
  return t.columns.filter((c) => c.pk).map((c) => c.name);
}
