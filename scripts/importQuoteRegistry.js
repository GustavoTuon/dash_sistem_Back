import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import xlsx from "xlsx";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const backendDir = path.resolve(currentDir, "..");

dotenv.config({ path: path.join(backendDir, ".env") });
dotenv.config({ path: path.resolve(backendDir, "../.env"), override: false });

const DEFAULT_FILE = "c:\\Users\\PC\\OneDrive\\Desktop\\Rodobach\\Relação de viagens.xlsx";
const DEFAULT_SHEETS = ["Cotação", "Cota"];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const truncate = args.includes("--truncate");
const fileArg = args.find((arg) => !arg.startsWith("--"));
const filePath = fileArg ? path.resolve(fileArg) : DEFAULT_FILE;
const schema = process.env.DB_SCHEMA || "public";

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD ?? ""),
});

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text === "-" ? "" : text;
}

function normalizeUf(value) {
  return normalizeText(value).slice(0, 2).toUpperCase();
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "" || value === "-") {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const clean = String(value).replace(/[^\d,.-]/g, "");
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === "" || value === "-") {
    return null;
  }

  return normalizeNumber(value);
}

function excelDateToIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = xlsx.SSF.parse_date_code(value);
    if (parsed) {
      const date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
      return date.toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(normalizeText(value));
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return new Date().toISOString().slice(0, 10);
}

function rowToQuote(row, sheetName) {
  const quote = {
    sourceSheet: sheetName,
    sourceNumber: normalizeText(row["N°"]),
    tripNumber: normalizeText(row["N°"]),
    vehiclePlate: null,
    status: "faltando_dados",
    date: excelDateToIso(row.Data),
    originCity: normalizeText(row["Cidade de origem"]),
    originUf: normalizeUf(row.UF),
    destinationCity: normalizeText(row["Cidade de destino"]),
    destinationUf: normalizeUf(row["UF "] ?? row.UF2),
    customer: normalizeText(row.Cliente),
    finalCustomer: normalizeText(row["Cliente Final"]),
    customerValue: normalizeNumber(row["Valor Cliente"]),
    tripKm: normalizeNullableNumber(row.KM ?? row.Km ?? row["KM Viagem"] ?? row["Km Viagem"]),
    material: normalizeText(row.Material),
    weightKg: normalizeNumber(row["Peso KG"]),
    driver: normalizeText(row.Motorista),
    driverValue: normalizeNumber(row["Valor Motorista"]),
    seller: normalizeText(row.Vendedor),
  };

  if (!quote.originCity || !quote.destinationCity || !quote.customer) {
    return null;
  }

  return quote;
}

function readQuotes() {
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const quotes = [];

  for (const sheetName of DEFAULT_SHEETS) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }

    const rows = xlsx.utils.sheet_to_json(sheet, {
      defval: "",
      raw: true,
    });

    for (const row of rows) {
      const quote = rowToQuote(row, sheetName);
      if (quote) {
        quotes.push(quote);
      }
    }
  }

  return quotes;
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.cadastro_cotacao_frete (
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

  await client.query(`
    ALTER TABLE ${schema}.cadastro_cotacao_frete
      ADD COLUMN IF NOT EXISTS numero_viagem TEXT,
      ADD COLUMN IF NOT EXISTS placa_veiculo TEXT,
      ADD COLUMN IF NOT EXISTS situacao TEXT NOT NULL DEFAULT 'faltando_dados',
      ADD COLUMN IF NOT EXISTS km_viagem NUMERIC(12, 2),
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
      ADD COLUMN IF NOT EXISTS doc_numero_motorista BOOLEAN NOT NULL DEFAULT false;
  `);
}

async function importQuotes(quotes) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensureTable(client);

    if (truncate) {
      await client.query(`TRUNCATE TABLE ${schema}.cadastro_cotacao_frete RESTART IDENTITY;`);
    }

    const statement = `
      INSERT INTO ${schema}.cadastro_cotacao_frete (
        data,
        numero_viagem,
        placa_veiculo,
        situacao,
        cidade_origem,
        uf_origem,
        cidade_destino,
        uf_destino,
        cliente,
        cliente_final,
        valor_cliente,
        km_viagem,
        material,
        peso_kg,
        motorista,
        valor_motorista,
        vendedor,
        observacoes,
        tomador_servico,
        condicao_pagamento
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      );
    `;

    for (const quote of quotes) {
      await client.query(statement, [
        quote.date,
        quote.tripNumber,
        quote.vehiclePlate,
        quote.status,
        quote.originCity,
        quote.originUf,
        quote.destinationCity,
        quote.destinationUf,
        quote.customer,
        quote.finalCustomer || null,
        quote.customerValue,
        quote.tripKm,
        quote.material || null,
        quote.weightKg,
        quote.driver || null,
        quote.driverValue,
        quote.seller || null,
        `Importado da planilha ${quote.sourceSheet}${quote.sourceNumber ? ` - N ${quote.sourceNumber}` : ""}`,
        quote.customer,
        null,
      ]);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const quotes = readQuotes();
  const sample = quotes.slice(0, 5).map((quote) => ({
    data: quote.date,
    rota: `${quote.originCity}/${quote.originUf} -> ${quote.destinationCity}/${quote.destinationUf}`,
    cliente: quote.customer,
    valorCliente: quote.customerValue,
    kmViagem: quote.tripKm,
    pesoKg: quote.weightKg,
  }));

  console.log(`Banco: ${process.env.DB_NAME}`);
  console.log(`Arquivo: ${filePath}`);
  console.log(`Registros lidos: ${quotes.length}`);
  console.table(sample);

  if (dryRun) {
    console.log("Dry-run: nenhum registro foi inserido.");
    await pool.end();
    return;
  }

  await importQuotes(quotes);
  console.log(`Importacao concluida: ${quotes.length} registros inseridos.`);
}

main().catch(async (error) => {
  console.error("Falha na importacao:", error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
