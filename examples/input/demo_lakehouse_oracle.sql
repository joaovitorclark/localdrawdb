-- =============================================================================
-- Exemplo educativo Oracle — examples/input/demo_lakehouse_oracle.sql
--
-- Lakehouse genérico (comércio/vendas) em sintaxe Oracle, pensado para demonstrar
-- TODAS as capacidades de import do LocalDrawDB:
--   • @layer / @group / @note / @fk / @origen (L1) / @lineage (L2)
--   • CONSTRAINT nomeada (PK/FK), PK composta, COMMENT ON TABLE/COLUMN
--   • INSERT (Records), fan-in de linhagem, tabela larga (scroll no canvas)
--
-- Copie para o input do projeto e importe:
--   mkdir -p data/projects/demo-lakehouse-oracle/input
--   cp examples/input/demo_lakehouse_oracle.sql data/projects/demo-lakehouse-oracle/input/
--   cp examples/demo_lakehouse_oracle/project.dbml data/projects/demo-lakehouse-oracle/
--   cp examples/demo_lakehouse_oracle/canvas.json data/projects/demo-lakehouse-oracle/
--
-- Par de artefatos prontos: examples/demo_lakehouse_oracle/
-- =============================================================================

-- --- Bronze / staging (Oracle) ------------------------------------------------

-- @layer: bronze
-- @group: ingestao_oracle
-- @note: Cabeçalho de pedidos exportado do ERP (granularidade pedido_id)
-- @fk: conta_id -> staging.crm_conta.conta_id
CREATE TABLE staging.erp_pedido (
  pedido_id NUMBER(19) NOT NULL,
  conta_id VARCHAR2(32),
  loja_codigo VARCHAR2(16),
  moeda VARCHAR2(3),
  status_pedido VARCHAR2(32),
  valor_bruto NUMBER(18,2),
  criado_em TIMESTAMP,
  CONSTRAINT pk_erp_pedido PRIMARY KEY (pedido_id),
  CONSTRAINT fk_erp_pedido_conta FOREIGN KEY (conta_id)
    REFERENCES staging.crm_conta (conta_id)
);

INSERT INTO staging.erp_pedido (pedido_id, conta_id, loja_codigo, moeda, status_pedido, valor_bruto, criado_em)
VALUES (10001, 'ACC-001', 'LJ-SP', 'BRL', 'FECHADO', 1250.00, TIMESTAMP '2024-03-01 09:15:00');
INSERT INTO staging.erp_pedido (pedido_id, conta_id, loja_codigo, moeda, status_pedido, valor_bruto, criado_em)
VALUES (10002, 'ACC-002', 'LJ-RS', 'BRL', 'ABERTO', 389.90, TIMESTAMP '2024-03-02 11:40:00');

COMMENT ON TABLE staging.erp_pedido IS 'Pedidos brutos do ERP — fixture educativa Oracle';
COMMENT ON COLUMN staging.erp_pedido.pedido_id IS 'Identificador natural do pedido no ERP';

-- @layer: bronze
-- @group: ingestao_oracle
-- @note: Itens de pedido (granularidade pedido_id + seq_item)
-- @fk: pedido_id -> staging.erp_pedido.pedido_id
-- @fk: sku -> staging.catalogo_produto.sku
CREATE TABLE staging.erp_pedido_item (
  pedido_id NUMBER(19) NOT NULL,
  seq_item NUMBER(5) NOT NULL,
  sku VARCHAR2(32),
  quantidade NUMBER(10),
  preco_unitario NUMBER(18,4),
  desconto_pct NUMBER(5,2),
  CONSTRAINT pk_erp_pedido_item PRIMARY KEY (pedido_id, seq_item),
  CONSTRAINT fk_erp_item_pedido FOREIGN KEY (pedido_id)
    REFERENCES staging.erp_pedido (pedido_id),
  CONSTRAINT fk_erp_item_produto FOREIGN KEY (sku)
    REFERENCES staging.catalogo_produto (sku)
);

INSERT INTO staging.erp_pedido_item (pedido_id, seq_item, sku, quantidade, preco_unitario, desconto_pct)
VALUES (10001, 1, 'SKU-A100', 2, 120.0000, 5.00);
INSERT INTO staging.erp_pedido_item (pedido_id, seq_item, sku, quantidade, preco_unitario, desconto_pct)
VALUES (10001, 2, 'SKU-B200', 1, 450.0000, 0.00);

-- @layer: bronze
-- @group: ingestao_oracle
-- @note: Contas comerciais (CRM)
CREATE TABLE staging.crm_conta (
  conta_id VARCHAR2(32) NOT NULL,
  razao_social VARCHAR2(255),
  segmento VARCHAR2(64),
  regiao VARCHAR2(64),
  pais VARCHAR2(2),
  CONSTRAINT pk_crm_conta PRIMARY KEY (conta_id)
);

INSERT INTO staging.crm_conta (conta_id, razao_social, segmento, regiao, pais)
VALUES ('ACC-001', 'Acme Industria Ltda', 'Enterprise', 'Sudeste', 'BR');
INSERT INTO staging.crm_conta (conta_id, razao_social, segmento, regiao, pais)
VALUES ('ACC-002', 'Beta Comercio SA', 'Mid-Market', 'Sul', 'BR');

-- @layer: bronze
-- @group: ingestao_oracle
-- @note: Contatos por conta
-- @fk: conta_id -> staging.crm_conta.conta_id
CREATE TABLE staging.crm_contato (
  contato_id VARCHAR2(32) NOT NULL,
  conta_id VARCHAR2(32),
  nome VARCHAR2(255),
  email VARCHAR2(255),
  cargo VARCHAR2(128),
  CONSTRAINT pk_crm_contato PRIMARY KEY (contato_id),
  CONSTRAINT fk_crm_contato_conta FOREIGN KEY (conta_id)
    REFERENCES staging.crm_conta (conta_id)
);

INSERT INTO staging.crm_contato (contato_id, conta_id, nome, email, cargo)
VALUES ('CT-001', 'ACC-001', 'Maria Souza', 'maria@acme.com.br', 'Compradora');
INSERT INTO staging.crm_contato (contato_id, conta_id, nome, email, cargo)
VALUES ('CT-002', 'ACC-002', 'Joao Lima', 'joao@beta.com.br', 'Proprietario');

-- @layer: bronze
-- @group: ingestao_oracle
-- @note: Catálogo de produtos (PIM)
CREATE TABLE staging.catalogo_produto (
  sku VARCHAR2(32) NOT NULL,
  nome_produto VARCHAR2(255),
  categoria_n1 VARCHAR2(64),
  categoria_n2 VARCHAR2(64),
  preco_lista NUMBER(18,2),
  ativo NUMBER(1),
  CONSTRAINT pk_catalogo_produto PRIMARY KEY (sku)
);

INSERT INTO staging.catalogo_produto (sku, nome_produto, categoria_n1, categoria_n2, preco_lista, ativo)
VALUES ('SKU-A100', 'Motor Industrial A100', 'Maquinas', 'Motores', 125.00, 1);
INSERT INTO staging.catalogo_produto (sku, nome_produto, categoria_n1, categoria_n2, preco_lista, ativo)
VALUES ('SKU-B200', 'Painel Controle B200', 'Eletrica', 'Paineis', 480.00, 1);

-- @layer: bronze
-- @group: ingestao_oracle
-- @note: Transações do gateway de pagamento
-- @fk: pedido_id -> staging.erp_pedido.pedido_id
CREATE TABLE staging.gateway_pagamento (
  txn_id VARCHAR2(32) NOT NULL,
  pedido_id NUMBER(19),
  valor NUMBER(18,2),
  forma_pagamento VARCHAR2(32),
  status_pagamento VARCHAR2(32),
  pago_em TIMESTAMP,
  CONSTRAINT pk_gateway_pagamento PRIMARY KEY (txn_id),
  CONSTRAINT fk_gateway_pedido FOREIGN KEY (pedido_id)
    REFERENCES staging.erp_pedido (pedido_id)
);

INSERT INTO staging.gateway_pagamento (txn_id, pedido_id, valor, forma_pagamento, status_pagamento, pago_em)
VALUES ('TXN-001', 10001, 1196.50, 'CARTAO', 'CAPTURADO', TIMESTAMP '2024-03-01 10:05:00');

-- @layer: bronze
-- @group: ingestao_web
-- @note: Eventos de navegação (Segment → landing pages)
CREATE TABLE staging.web_evento (
  evento_id VARCHAR2(32) NOT NULL,
  sessao_id VARCHAR2(64),
  email_contato VARCHAR2(255),
  tipo_evento VARCHAR2(64),
  url_pagina VARCHAR2(512),
  ocorrido_em TIMESTAMP,
  CONSTRAINT pk_web_evento PRIMARY KEY (evento_id)
);

INSERT INTO staging.web_evento (evento_id, sessao_id, email_contato, tipo_evento, url_pagina, ocorrido_em)
VALUES ('EV-001', 'SESS-9A1', 'maria@acme.com.br', 'page_view', '/produtos/motores', TIMESTAMP '2024-03-01 08:50:00');

-- --- Silver: dimensões --------------------------------------------------------

-- @layer: prata
-- @group: dimensoes
-- @note: Dimensão de conta (SCD tipo 2 simplificado)
-- @origen: staging.crm_conta
-- @fk: conta_natural_id -> staging.crm_conta.conta_id
CREATE TABLE silver.dim_conta (
  sk_conta NUMBER(19) NOT NULL,
  conta_natural_id VARCHAR2(32),
  razao_social VARCHAR2(255),
  segmento VARCHAR2(64),
  regiao VARCHAR2(64),
  vigente NUMBER(1),
  valido_de TIMESTAMP,
  valido_ate TIMESTAMP,
  dt_carga_silver TIMESTAMP,
  CONSTRAINT pk_dim_conta PRIMARY KEY (sk_conta),
  CONSTRAINT fk_dim_conta_nat FOREIGN KEY (conta_natural_id)
    REFERENCES staging.crm_conta (conta_id)
);
-- @lineage silver.dim_conta
--   conta_natural_id <- staging.crm_conta.conta_id
--   razao_social <- staging.crm_conta.razao_social
--   segmento <- staging.crm_conta.segmento
--   regiao <- staging.crm_conta.regiao

INSERT INTO silver.dim_conta (sk_conta, conta_natural_id, razao_social, segmento, regiao, vigente, valido_de, dt_carga_silver)
VALUES (1, 'ACC-001', 'Acme Industria Ltda', 'Enterprise', 'Sudeste', 1, TIMESTAMP '2024-01-01', SYSTIMESTAMP);
INSERT INTO silver.dim_conta (sk_conta, conta_natural_id, razao_social, segmento, regiao, vigente, valido_de, dt_carga_silver)
VALUES (2, 'ACC-002', 'Beta Comercio SA', 'Mid-Market', 'Sul', 1, TIMESTAMP '2024-01-01', SYSTIMESTAMP);

-- @layer: prata
-- @group: dimensoes
-- @note: Dimensão de produto
-- @origen: staging.catalogo_produto
CREATE TABLE silver.dim_produto (
  sk_produto NUMBER(19) NOT NULL,
  sku VARCHAR2(32),
  nome_produto VARCHAR2(255),
  categoria_n1 VARCHAR2(64),
  categoria_n2 VARCHAR2(64),
  preco_lista NUMBER(18,2),
  dt_carga_silver TIMESTAMP,
  CONSTRAINT pk_dim_produto PRIMARY KEY (sk_produto),
  CONSTRAINT fk_dim_produto_sku FOREIGN KEY (sku)
    REFERENCES staging.catalogo_produto (sku)
);
-- @lineage silver.dim_produto
--   sku <- staging.catalogo_produto.sku
--   nome_produto <- staging.catalogo_produto.nome_produto
--   preco_lista <- staging.catalogo_produto.preco_lista

INSERT INTO silver.dim_produto (sk_produto, sku, nome_produto, categoria_n1, categoria_n2, preco_lista, dt_carga_silver)
VALUES (1, 'SKU-A100', 'Motor Industrial A100', 'Maquinas', 'Motores', 125.00, SYSTIMESTAMP);
INSERT INTO silver.dim_produto (sk_produto, sku, nome_produto, categoria_n1, categoria_n2, preco_lista, dt_carga_silver)
VALUES (2, 'SKU-B200', 'Painel Controle B200', 'Eletrica', 'Paineis', 480.00, SYSTIMESTAMP);

-- @layer: prata
-- @group: dimensoes
-- @note: Dimensão de loja (de-para simples)
CREATE TABLE silver.dim_loja (
  sk_loja NUMBER(5) NOT NULL,
  codigo_loja VARCHAR2(16),
  nome_loja VARCHAR2(128),
  uf VARCHAR2(2),
  CONSTRAINT pk_dim_loja PRIMARY KEY (sk_loja)
);

INSERT INTO silver.dim_loja (sk_loja, codigo_loja, nome_loja, uf)
VALUES (1, 'LJ-SP', 'Loja Sao Paulo', 'SP');
INSERT INTO silver.dim_loja (sk_loja, codigo_loja, nome_loja, uf)
VALUES (2, 'LJ-RS', 'Loja Porto Alegre', 'RS');

-- @layer: prata
-- @group: dimensoes
-- @note: Forma de pagamento (lookup)
CREATE TABLE silver.dim_forma_pagamento (
  sk_forma_pagamento NUMBER(5) NOT NULL,
  codigo VARCHAR2(32),
  descricao VARCHAR2(128),
  CONSTRAINT pk_dim_forma_pagamento PRIMARY KEY (sk_forma_pagamento)
);

INSERT INTO silver.dim_forma_pagamento (sk_forma_pagamento, codigo, descricao)
VALUES (1, 'CARTAO', 'Cartao de credito');
INSERT INTO silver.dim_forma_pagamento (sk_forma_pagamento, codigo, descricao)
VALUES (2, 'PIX', 'PIX instantaneo');

-- @layer: prata
-- @group: dimensoes
-- @note: Calendário (surrogate date key)
CREATE TABLE silver.dim_calendario (
  sk_data NUMBER(8) NOT NULL,
  data_ref DATE,
  ano NUMBER(4),
  mes NUMBER(2),
  dia NUMBER(2),
  CONSTRAINT pk_dim_calendario PRIMARY KEY (sk_data)
);

INSERT INTO silver.dim_calendario (sk_data, data_ref, ano, mes, dia)
VALUES (20240301, DATE '2024-03-01', 2024, 3, 1);

-- @layer: prata
-- @group: dimensoes
-- @note: Contato (role-playing dim)
-- @origen: staging.crm_contato
-- @fk: sk_conta -> silver.dim_conta.sk_conta
CREATE TABLE silver.dim_contato (
  sk_contato NUMBER(19) NOT NULL,
  contato_natural_id VARCHAR2(32),
  sk_conta NUMBER(19),
  nome VARCHAR2(255),
  email VARCHAR2(255),
  CONSTRAINT pk_dim_contato PRIMARY KEY (sk_contato),
  CONSTRAINT fk_dim_contato_conta FOREIGN KEY (sk_conta)
    REFERENCES silver.dim_conta (sk_conta)
);
-- @lineage silver.dim_contato
--   contato_natural_id <- staging.crm_contato.contato_id
--   nome <- staging.crm_contato.nome
--   email <- staging.crm_contato.email

-- --- Silver: fatos -------------------------------------------------------------

-- @layer: prata
-- @group: fatos
-- @note: Fato pedido (cabeçalho). Fan-in L1: ERP + pagamentos.
-- @origen: staging.erp_pedido, staging.gateway_pagamento
-- @fk: sk_conta -> silver.dim_conta.sk_conta
-- @fk: sk_loja -> silver.dim_loja.sk_loja
CREATE TABLE silver.fato_pedido (
  sk_pedido NUMBER(19) NOT NULL,
  pedido_natural_id NUMBER(19),
  sk_conta NUMBER(19),
  sk_loja NUMBER(5),
  sk_data NUMBER(8),
  valor_bruto NUMBER(18,2),
  status_pedido VARCHAR2(32),
  dt_carga_silver TIMESTAMP,
  CONSTRAINT pk_fato_pedido PRIMARY KEY (sk_pedido),
  CONSTRAINT fk_fato_pedido_conta FOREIGN KEY (sk_conta)
    REFERENCES silver.dim_conta (sk_conta),
  CONSTRAINT fk_fato_pedido_loja FOREIGN KEY (sk_loja)
    REFERENCES silver.dim_loja (sk_loja),
  CONSTRAINT fk_fato_pedido_data FOREIGN KEY (sk_data)
    REFERENCES silver.dim_calendario (sk_data)
);
-- @lineage silver.fato_pedido
--   pedido_natural_id <- staging.erp_pedido.pedido_id
--   valor_bruto <- staging.erp_pedido.valor_bruto
--   status_pedido <- staging.erp_pedido.status_pedido

INSERT INTO silver.fato_pedido (sk_pedido, pedido_natural_id, sk_conta, sk_loja, sk_data, valor_bruto, status_pedido, dt_carga_silver)
VALUES (1, 10001, 1, 1, 20240301, 1250.00, 'FECHADO', SYSTIMESTAMP);

-- @layer: prata
-- @group: fatos
-- @note: Fato item — tabela LARGA (52 colunas) para demonstrar scroll + FKs ancoradas
-- @origen: staging.erp_pedido_item
-- @fk: sk_pedido -> silver.fato_pedido.sk_pedido
-- @fk: sk_produto -> silver.dim_produto.sk_produto
CREATE TABLE silver.fato_pedido_item (
  sk_item NUMBER(19) NOT NULL,
  sk_pedido NUMBER(19),
  seq_item NUMBER(5),
  sk_produto NUMBER(19),
  quantidade NUMBER(10),
  preco_unitario NUMBER(18,4),
  desconto_pct NUMBER(5,2),
  attr_001 VARCHAR2(64),
  attr_002 VARCHAR2(64),
  attr_003 VARCHAR2(64),
  attr_004 VARCHAR2(64),
  attr_005 VARCHAR2(64),
  attr_006 VARCHAR2(64),
  attr_007 VARCHAR2(64),
  attr_008 VARCHAR2(64),
  attr_009 VARCHAR2(64),
  attr_010 VARCHAR2(64),
  attr_011 VARCHAR2(64),
  attr_012 VARCHAR2(64),
  attr_013 VARCHAR2(64),
  attr_014 VARCHAR2(64),
  attr_015 VARCHAR2(64),
  attr_016 VARCHAR2(64),
  attr_017 VARCHAR2(64),
  attr_018 VARCHAR2(64),
  attr_019 VARCHAR2(64),
  attr_020 VARCHAR2(64),
  attr_021 VARCHAR2(64),
  attr_022 VARCHAR2(64),
  attr_023 VARCHAR2(64),
  attr_024 VARCHAR2(64),
  attr_025 VARCHAR2(64),
  attr_026 VARCHAR2(64),
  attr_027 VARCHAR2(64),
  attr_028 VARCHAR2(64),
  attr_029 VARCHAR2(64),
  attr_030 VARCHAR2(64),
  attr_031 VARCHAR2(64),
  attr_032 VARCHAR2(64),
  attr_033 VARCHAR2(64),
  attr_034 VARCHAR2(64),
  attr_035 VARCHAR2(64),
  attr_036 VARCHAR2(64),
  attr_037 VARCHAR2(64),
  attr_038 VARCHAR2(64),
  attr_039 VARCHAR2(64),
  attr_040 VARCHAR2(64),
  attr_041 VARCHAR2(64),
  attr_042 VARCHAR2(64),
  attr_043 VARCHAR2(64),
  attr_044 VARCHAR2(64),
  attr_045 VARCHAR2(64),
  attr_046 VARCHAR2(64),
  attr_047 VARCHAR2(64),
  attr_048 VARCHAR2(64),
  dt_carga_silver TIMESTAMP,
  CONSTRAINT pk_fato_pedido_item PRIMARY KEY (sk_item),
  CONSTRAINT fk_fato_item_pedido FOREIGN KEY (sk_pedido)
    REFERENCES silver.fato_pedido (sk_pedido),
  CONSTRAINT fk_fato_item_produto FOREIGN KEY (sk_produto)
    REFERENCES silver.dim_produto (sk_produto)
);
-- @lineage silver.fato_pedido_item
--   seq_item <- staging.erp_pedido_item.seq_item
--   quantidade <- staging.erp_pedido_item.quantidade
--   preco_unitario <- staging.erp_pedido_item.preco_unitario
--   desconto_pct <- staging.erp_pedido_item.desconto_pct

-- @layer: prata
-- @group: fatos
-- @note: Fato pagamento (granularidade txn)
-- @origen: staging.gateway_pagamento
-- @fk: sk_pedido -> silver.fato_pedido.sk_pedido
-- @fk: sk_forma_pagamento -> silver.dim_forma_pagamento.sk_forma_pagamento
CREATE TABLE silver.fato_pagamento (
  sk_pagamento NUMBER(19) NOT NULL,
  txn_natural_id VARCHAR2(32),
  sk_pedido NUMBER(19),
  sk_forma_pagamento NUMBER(5),
  valor NUMBER(18,2),
  status_pagamento VARCHAR2(32),
  dt_carga_silver TIMESTAMP,
  CONSTRAINT pk_fato_pagamento PRIMARY KEY (sk_pagamento),
  CONSTRAINT fk_fato_pagamento_pedido FOREIGN KEY (sk_pedido)
    REFERENCES silver.fato_pedido (sk_pedido),
  CONSTRAINT fk_fato_pagamento_forma FOREIGN KEY (sk_forma_pagamento)
    REFERENCES silver.dim_forma_pagamento (sk_forma_pagamento)
);
-- @lineage silver.fato_pagamento
--   txn_natural_id <- staging.gateway_pagamento.txn_id
--   valor <- staging.gateway_pagamento.valor
--   status_pagamento <- staging.gateway_pagamento.status_pagamento

-- @layer: prata
-- @group: fatos
-- @note: Eventos de marketing ligados a contatos
-- @origen: staging.web_evento
-- @fk: sk_contato -> silver.dim_contato.sk_contato
CREATE TABLE silver.fato_evento_marketing (
  sk_evento NUMBER(19) NOT NULL,
  evento_natural_id VARCHAR2(32),
  sk_contato NUMBER(19),
  tipo_evento VARCHAR2(64),
  url_pagina VARCHAR2(512),
  ocorrido_em TIMESTAMP,
  dt_carga_silver TIMESTAMP,
  CONSTRAINT pk_fato_evento_marketing PRIMARY KEY (sk_evento),
  CONSTRAINT fk_fato_evento_contato FOREIGN KEY (sk_contato)
    REFERENCES silver.dim_contato (sk_contato)
);
-- @lineage silver.fato_evento_marketing
--   evento_natural_id <- staging.web_evento.evento_id
--   tipo_evento <- staging.web_evento.tipo_evento
--   url_pagina <- staging.web_evento.url_pagina

-- @layer: prata
-- @group: bridge
-- @note: Ponte conta↔contato (muitos-para-muitos lógico)
-- @fk: sk_conta -> silver.dim_conta.sk_conta
-- @fk: sk_contato -> silver.dim_contato.sk_contato
CREATE TABLE silver.bridge_conta_contato (
  sk_conta NUMBER(19) NOT NULL,
  sk_contato NUMBER(19) NOT NULL,
  papel VARCHAR2(64),
  dt_carga_silver TIMESTAMP,
  CONSTRAINT pk_bridge_conta_contato PRIMARY KEY (sk_conta, sk_contato),
  CONSTRAINT fk_bridge_conta FOREIGN KEY (sk_conta)
    REFERENCES silver.dim_conta (sk_conta),
  CONSTRAINT fk_bridge_contato FOREIGN KEY (sk_contato)
    REFERENCES silver.dim_contato (sk_contato)
);

-- --- Ouro: agregados e reports ------------------------------------------------

-- @layer: ouro
-- @group: agregados
-- @note: KPI diário de vendas (agregação sobre fato pedido)
-- @origen: silver.fato_pedido
CREATE TABLE gold.kpi_vendas_dia (
  sk_data NUMBER(8) NOT NULL,
  total_pedidos NUMBER(10),
  receita_bruta NUMBER(18,2),
  ticket_medio NUMBER(18,2),
  dt_carga_gold TIMESTAMP,
  CONSTRAINT pk_kpi_vendas_dia PRIMARY KEY (sk_data)
);
-- @lineage gold.kpi_vendas_dia
--   receita_bruta <- silver.fato_pedido.valor_bruto [note: 'SUM(valor_bruto) por dia']
--   total_pedidos <- silver.fato_pedido.sk_pedido [note: 'COUNT DISTINCT']

INSERT INTO gold.kpi_vendas_dia (sk_data, total_pedidos, receita_bruta, ticket_medio, dt_carga_gold)
VALUES (20240301, 2, 1639.90, 819.95, SYSTIMESTAMP);

-- @layer: ouro
-- @group: agregados
-- @note: Resumo mensal por conta (fan-in de pedido + pagamento)
-- @origen: silver.fato_pedido, silver.fato_pagamento
-- @fk: sk_conta -> silver.dim_conta.sk_conta
CREATE TABLE gold.fato_cliente_mes (
  sk_conta NUMBER(19) NOT NULL,
  ano_mes NUMBER(6) NOT NULL,
  receita NUMBER(18,2),
  qtd_pedidos NUMBER(10),
  valor_pago NUMBER(18,2),
  dt_carga_gold TIMESTAMP,
  CONSTRAINT pk_fato_cliente_mes PRIMARY KEY (sk_conta, ano_mes),
  CONSTRAINT fk_fato_cliente_mes_conta FOREIGN KEY (sk_conta)
    REFERENCES silver.dim_conta (sk_conta)
);

-- @layer: ouro
-- @group: reports
-- @note: Painel executivo — PK composta (periodo + regiao)
-- @origen: gold.kpi_vendas_dia, gold.fato_cliente_mes
CREATE TABLE gold.report_executivo (
  periodo DATE NOT NULL,
  regiao VARCHAR2(64) NOT NULL,
  segmento VARCHAR2(64),
  receita_consolidada NUMBER(18,2),
  pedidos NUMBER(10),
  CONSTRAINT pk_report_executivo PRIMARY KEY (periodo, regiao)
);
-- @lineage gold.report_executivo
--   receita_consolidada <- gold.kpi_vendas_dia.receita_bruta [note: 'rollup regional']
--   pedidos <- gold.kpi_vendas_dia.total_pedidos

INSERT INTO gold.report_executivo (periodo, regiao, segmento, receita_consolidada, pedidos)
VALUES (DATE '2024-03-01', 'Sudeste', 'Enterprise', 1250.00, 1);
