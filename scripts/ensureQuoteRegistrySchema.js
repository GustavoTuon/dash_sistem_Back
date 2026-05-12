import { pool } from "../src/db/pool.js";
import { env } from "../src/config/env.js";

const table = `${env.dbSchema}.cadastro_cotacao_frete`;

async function ensureQuoteRegistrySchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id SERIAL PRIMARY KEY,
      numero_viagem TEXT,
      placa_veiculo TEXT,
      situacao TEXT NOT NULL DEFAULT 'faltando_dados',
      data DATE DEFAULT CURRENT_DATE,
      cidade_origem TEXT,
      uf_origem CHAR(2),
      cidade_destino TEXT,
      uf_destino CHAR(2),
      cliente TEXT,
      cliente_final TEXT,
      valor_cliente NUMERIC(12, 2) DEFAULT 0,
      km_viagem NUMERIC(12, 2),
      material TEXT,
      peso_kg NUMERIC(12, 3) DEFAULT 0,
      motorista TEXT,
      valor_motorista NUMERIC(12, 2) DEFAULT 0,
      vendedor TEXT,
      tomador_servico TEXT,
      condicao_pagamento TEXT,
      numero_motorista TEXT,
      cnh_motorista TEXT,
      antt_veiculo TEXT,
      conta_deposito TEXT,
      chave_pix TEXT,
      doc_placas BOOLEAN NOT NULL DEFAULT false,
      doc_antt BOOLEAN NOT NULL DEFAULT false,
      doc_conta_deposito BOOLEAN NOT NULL DEFAULT false,
      doc_chave_pix BOOLEAN NOT NULL DEFAULT false,
      doc_cnh_motorista BOOLEAN NOT NULL DEFAULT false,
      doc_comprovante_residencia BOOLEAN NOT NULL DEFAULT false,
      doc_numero_motorista BOOLEAN NOT NULL DEFAULT false,
      valor_kg NUMERIC(12, 4) GENERATED ALWAYS AS (
        CASE WHEN peso_kg > 0 THEN valor_cliente / peso_kg ELSE 0 END
      ) STORED,
      valor_ton NUMERIC(12, 2) GENERATED ALWAYS AS (
        CASE WHEN peso_kg > 0 THEN valor_cliente / (peso_kg / 1000) ELSE 0 END
      ) STORED,
      observacoes TEXT,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    ALTER TABLE ${table}
      ADD COLUMN IF NOT EXISTS numero_viagem TEXT,
      ADD COLUMN IF NOT EXISTS placa_veiculo TEXT,
      ADD COLUMN IF NOT EXISTS situacao TEXT NOT NULL DEFAULT 'faltando_dados',
      ADD COLUMN IF NOT EXISTS data DATE DEFAULT CURRENT_DATE,
      ADD COLUMN IF NOT EXISTS cidade_origem TEXT,
      ADD COLUMN IF NOT EXISTS uf_origem CHAR(2),
      ADD COLUMN IF NOT EXISTS cidade_destino TEXT,
      ADD COLUMN IF NOT EXISTS uf_destino CHAR(2),
      ADD COLUMN IF NOT EXISTS cliente TEXT,
      ADD COLUMN IF NOT EXISTS cliente_final TEXT,
      ADD COLUMN IF NOT EXISTS valor_cliente NUMERIC(12, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS km_viagem NUMERIC(12, 2),
      ADD COLUMN IF NOT EXISTS material TEXT,
      ADD COLUMN IF NOT EXISTS peso_kg NUMERIC(12, 3) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS motorista TEXT,
      ADD COLUMN IF NOT EXISTS valor_motorista NUMERIC(12, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS vendedor TEXT,
      ADD COLUMN IF NOT EXISTS tomador_servico TEXT,
      ADD COLUMN IF NOT EXISTS condicao_pagamento TEXT,
      ADD COLUMN IF NOT EXISTS numero_motorista TEXT,
      ADD COLUMN IF NOT EXISTS cnh_motorista TEXT,
      ADD COLUMN IF NOT EXISTS antt_veiculo TEXT,
      ADD COLUMN IF NOT EXISTS conta_deposito TEXT,
      ADD COLUMN IF NOT EXISTS chave_pix TEXT,
      ADD COLUMN IF NOT EXISTS doc_placas BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS doc_antt BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS doc_conta_deposito BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS doc_chave_pix BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS doc_cnh_motorista BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS doc_comprovante_residencia BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS doc_numero_motorista BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS valor_kg NUMERIC(12, 4) GENERATED ALWAYS AS (
        CASE WHEN peso_kg > 0 THEN valor_cliente / peso_kg ELSE 0 END
      ) STORED,
      ADD COLUMN IF NOT EXISTS valor_ton NUMERIC(12, 2) GENERATED ALWAYS AS (
        CASE WHEN peso_kg > 0 THEN valor_cliente / (peso_kg / 1000) ELSE 0 END
      ) STORED,
      ADD COLUMN IF NOT EXISTS observacoes TEXT,
      ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `);

  const { rows } = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = 'cadastro_cotacao_frete'
      ORDER BY ordinal_position;
    `,
    [env.dbSchema],
  );

  console.log(`Banco: ${env.dbName}`);
  console.log(`Tabela: ${table}`);
  console.log(`Colunas: ${rows.map((row) => row.column_name).join(", ")}`);
}

ensureQuoteRegistrySchema()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
