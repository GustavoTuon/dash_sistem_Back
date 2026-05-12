import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { parseNumber } from "../utils/formatters.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const dataDir = path.resolve(currentDir, "../../data");
const dataFile = path.join(dataDir, "freight-quotes.json");

const EMPTY_STORE = {
  nextId: 1,
  quotes: [],
};

let tableAvailablePromise;

function parseNullableNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }

  const parsed = parseNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeStatus(value) {
  const status = normalizeText(value);
  return ["aguardando_cte", "faltando_dados"].includes(status)
    ? status
    : "faltando_dados";
}

function getAutomaticStatus(quote) {
  const requiredValues = [
    quote.tripNumber,
    quote.date,
    quote.originCity,
    quote.originUf,
    quote.destinationCity,
    quote.destinationUf,
    quote.customer,
    quote.customerValue,
    quote.material,
    quote.weightKg,
    quote.serviceTaker,
    quote.paymentCondition,
    quote.vehiclePlate,
    quote.driverLicenseNumber,
    quote.vehicleAntt,
  ];

  return requiredValues.every((value) => String(value ?? "").trim() !== "")
    ? "aguardando_cte"
    : "faltando_dados";
}

async function readStore() {
  try {
    const raw = await fs.readFile(dataFile, "utf8");
    const parsed = JSON.parse(raw);
    return {
      nextId: parsed.nextId ?? 1,
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    return EMPTY_STORE;
  }
}

async function writeStore(store) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(store, null, 2), "utf8");
}

function normalizeQuote(payload, existing = {}) {
  const customerValue = parseNumber(payload.customerValue);
  const driverValue = parseNumber(payload.driverValue);
  const weightKg = parseNumber(payload.weightKg);
  const tripKm = parseNullableNumber(payload.tripKm ?? payload.kmViagem);
  const pricePerKg = weightKg > 0 ? customerValue / weightKg : 0;
  const pricePerTon = weightKg > 0 ? customerValue / (weightKg / 1000) : 0;

  const quote = {
    ...existing,
    tripNumber: normalizeText(payload.tripNumber ?? payload.numeroViagem),
    vehiclePlate: normalizeText(payload.vehiclePlate),
    status: normalizeStatus(payload.status),
    date: normalizeText(payload.date) || existing.date || new Date().toISOString().slice(0, 10),
    originCity: normalizeText(payload.originCity),
    originUf: normalizeText(payload.originUf).toUpperCase(),
    destinationCity: normalizeText(payload.destinationCity),
    destinationUf: normalizeText(payload.destinationUf).toUpperCase(),
    customer: normalizeText(payload.customer),
    finalCustomer: normalizeText(payload.finalCustomer),
    customerValue,
    tripKm,
    material: normalizeText(payload.material),
    weightKg,
    driver: normalizeText(payload.driver),
    driverValue,
    seller: normalizeText(payload.seller),
    serviceTaker: normalizeText(payload.serviceTaker),
    paymentCondition: normalizeText(payload.paymentCondition),
    driverPhone: normalizeText(payload.driverPhone),
    driverLicenseNumber: normalizeText(payload.driverLicenseNumber),
    vehicleAntt: normalizeText(payload.vehicleAntt),
    depositAccount: normalizeText(payload.depositAccount),
    pixKey: normalizeText(payload.pixKey),
    documents: {
      plates: normalizeBoolean(payload.documents?.plates ?? payload.docPlacas),
      antt: normalizeBoolean(payload.documents?.antt ?? payload.docAntt),
      depositAccount: normalizeBoolean(
        payload.documents?.depositAccount ?? payload.docContaDeposito,
      ),
      pixKey: normalizeBoolean(payload.documents?.pixKey ?? payload.docChavePix),
      driverLicense: normalizeBoolean(payload.documents?.driverLicense ?? payload.docCnhMotorista),
      proofOfAddress: normalizeBoolean(
        payload.documents?.proofOfAddress ?? payload.docComprovanteResidencia,
      ),
      driverPhone: normalizeBoolean(payload.documents?.driverPhone ?? payload.docNumeroMotorista),
    },
    notes: normalizeText(payload.notes),
    pricePerKg: Math.round(pricePerKg * 10000) / 10000,
    pricePerTon: Math.round(pricePerTon * 100) / 100,
    updatedAt: new Date().toISOString(),
  };

  quote.status = getAutomaticStatus(quote);
  return quote;
}

function mapDbQuote(row) {
  return {
    id: row.id,
    tripNumber: row.numero_viagem,
    vehiclePlate: row.placa_veiculo,
    status: row.situacao,
    date: row.data ? new Date(row.data).toISOString().slice(0, 10) : "",
    originCity: row.cidade_origem,
    originUf: row.uf_origem,
    destinationCity: row.cidade_destino,
    destinationUf: row.uf_destino,
    customer: row.cliente,
    finalCustomer: row.cliente_final,
    customerValue: parseNumber(row.valor_cliente),
    tripKm: row.km_viagem === null || row.km_viagem === undefined ? null : parseNumber(row.km_viagem),
    material: row.material,
    weightKg: parseNumber(row.peso_kg),
    driver: row.motorista,
    driverValue: parseNumber(row.valor_motorista),
    seller: row.vendedor,
    serviceTaker: row.tomador_servico,
    paymentCondition: row.condicao_pagamento,
    driverPhone: row.numero_motorista,
    driverLicenseNumber: row.cnh_motorista,
    vehicleAntt: row.antt_veiculo,
    depositAccount: row.conta_deposito,
    pixKey: row.chave_pix,
    documents: {
      plates: Boolean(row.doc_placas),
      antt: Boolean(row.doc_antt),
      depositAccount: Boolean(row.doc_conta_deposito),
      pixKey: Boolean(row.doc_chave_pix),
      driverLicense: Boolean(row.doc_cnh_motorista),
      proofOfAddress: Boolean(row.doc_comprovante_residencia),
      driverPhone: Boolean(row.doc_numero_motorista),
    },
    notes: row.observacoes,
    pricePerKg: parseNumber(row.valor_kg),
    pricePerTon: parseNumber(row.valor_ton),
    createdAt: row.criado_em,
    updatedAt: row.atualizado_em,
  };
}

async function hasDatabaseTable() {
  if (!tableAvailablePromise) {
    tableAvailablePromise = (async () => {
      if (!env.dbName || !env.dbUser) {
        return false;
      }

      const { rows } = await pool.query(
        `
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = $1
              AND table_name = 'cadastro_cotacao_frete'
          ) AS exists;
        `,
        [env.dbSchema],
      );

      return Boolean(rows[0]?.exists);
    })().catch((error) => {
      console.warn("Usando cadastro local por falha ao consultar o banco.", error.message);
      return false;
    });
  }

  return tableAvailablePromise;
}

function buildDbFilters(filters = {}) {
  const values = [];
  const clauses = [];
  const terms = normalizeText(filters.search)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  if (terms.length) {
    values.push(terms.map((term) => `%${term}%`));
    clauses.push(`
      CONCAT_WS(' ',
        id,
        numero_viagem,
        placa_veiculo,
        cidade_origem,
        uf_origem,
        cidade_destino,
        uf_destino,
        cliente,
        cliente_final,
        material,
        motorista,
        vendedor
      ) ILIKE ALL($${values.length})
    `);
  }

  const exactFilters = [["status", "situacao"]];

  for (const [key, column] of exactFilters) {
    const value = normalizeText(filters[key]);
    if (value) {
      values.push(value);
      clauses.push(`${column} = $${values.length}`);
    }
  }

  const partialFilters = [
    ["customer", "cliente"],
    ["origin", "CONCAT_WS('/', cidade_origem, uf_origem)"],
    ["destination", "CONCAT_WS('/', cidade_destino, uf_destino)"],
  ];

  for (const [key, expression] of partialFilters) {
    const value = normalizeText(filters[key]);
    if (value) {
      values.push(`%${value}%`);
      clauses.push(`${expression} ILIKE $${values.length}`);
    }
  }

  return {
    clause: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

const SORT_COLUMNS = {
  id: "id",
  tripNumber: "numero_viagem",
  vehiclePlate: "placa_veiculo",
  status: "situacao",
  date: "data",
  customer: "cliente",
  origin: "cidade_origem",
  destination: "cidade_destino",
  customerValue: "valor_cliente",
  weightKg: "peso_kg",
  tripKm: "km_viagem",
  profit: "(valor_cliente - valor_motorista)",
  driver: "motorista",
};

function normalizeSort(sort = "id", direction = "desc") {
  return {
    column: SORT_COLUMNS[sort] ?? SORT_COLUMNS.id,
    direction: String(direction).toLowerCase() === "asc" ? "ASC" : "DESC",
  };
}

export async function listQuoteRegistry(filters = {}, sort = "id", direction = "desc") {
  if (await hasDatabaseTable()) {
    const dbFilters = buildDbFilters(filters);
    const sortConfig = normalizeSort(sort, direction);
    const { rows } = await pool.query(
      `
        SELECT *
        FROM ${env.dbSchema}.cadastro_cotacao_frete
        ${dbFilters.clause}
        ORDER BY ${sortConfig.column} ${sortConfig.direction}, id DESC
      `,
      dbFilters.values,
    );

    return rows.map(mapDbQuote);
  }

  const store = await readStore();
  const query = normalizeText(filters.search).toLocaleLowerCase("pt-BR");
  const quotes = [...store.quotes].sort((left, right) => {
    const directionFactor = String(direction).toLowerCase() === "asc" ? 1 : -1;
    const leftValue = left[sort] ?? left.id;
    const rightValue = right[sort] ?? right.id;

    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return (leftValue - rightValue) * directionFactor;
    }

    return String(leftValue).localeCompare(String(rightValue), "pt-BR") * directionFactor;
  });

  if (!query) {
    return quotes;
  }

  return quotes.filter((quote) =>
    [
      quote.id,
      quote.originCity,
      quote.originUf,
      quote.destinationCity,
      quote.destinationUf,
      quote.customer,
      quote.finalCustomer,
      quote.material,
      quote.driver,
      quote.seller,
    ]
      .join(" ")
      .toLocaleLowerCase("pt-BR")
      .includes(query),
  );
}

export async function getQuoteRegistrySummary(filters = {}) {
  if (await hasDatabaseTable()) {
    const dbFilters = buildDbFilters(filters);
    const { rows } = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total,
          COALESCE(SUM(valor_cliente), 0)::float AS customer_total,
          COALESCE(SUM(valor_motorista), 0)::float AS driver_total,
          COALESCE(SUM(valor_cliente - valor_motorista), 0)::float AS profit_total
        FROM ${env.dbSchema}.cadastro_cotacao_frete
        ${dbFilters.clause};
      `,
      dbFilters.values,
    );

    return {
      total: rows[0]?.total ?? 0,
      customerTotal: parseNumber(rows[0]?.customer_total),
      driverTotal: parseNumber(rows[0]?.driver_total),
      profitTotal: parseNumber(rows[0]?.profit_total),
    };
  }

  const quotes = await listQuoteRegistry(filters);
  return {
    total: quotes.length,
    customerTotal: quotes.reduce((total, quote) => total + parseNumber(quote.customerValue), 0),
    driverTotal: quotes.reduce((total, quote) => total + parseNumber(quote.driverValue), 0),
    profitTotal: quotes.reduce(
      (total, quote) => total + parseNumber(quote.customerValue) - parseNumber(quote.driverValue),
      0,
    ),
  };
}

export async function listQuoteRegistryOptions() {
  if (await hasDatabaseTable()) {
    const { rows } = await pool.query(`
      SELECT
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT cliente ORDER BY cliente), NULL) AS customers,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT CONCAT_WS('/', cidade_origem, uf_origem) ORDER BY CONCAT_WS('/', cidade_origem, uf_origem)), NULL) AS origins,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT CONCAT_WS('/', cidade_destino, uf_destino) ORDER BY CONCAT_WS('/', cidade_destino, uf_destino)), NULL) AS destinations
      FROM ${env.dbSchema}.cadastro_cotacao_frete;
    `);

    return {
      customers: rows[0]?.customers ?? [],
      origins: rows[0]?.origins ?? [],
      destinations: rows[0]?.destinations ?? [],
    };
  }

  const store = await readStore();
  const customers = new Set();
  const origins = new Set();
  const destinations = new Set();

  for (const quote of store.quotes) {
    if (quote.customer) customers.add(quote.customer);
    if (quote.originCity) origins.add(`${quote.originCity}/${quote.originUf}`);
    if (quote.destinationCity) destinations.add(`${quote.destinationCity}/${quote.destinationUf}`);
  }

  return {
    customers: [...customers].sort(),
    origins: [...origins].sort(),
    destinations: [...destinations].sort(),
  };
}

export async function createQuoteRegistry(payload) {
  if (await hasDatabaseTable()) {
    const quote = normalizeQuote(payload);
    const { rows } = await pool.query(
      `
        INSERT INTO ${env.dbSchema}.cadastro_cotacao_frete (
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
          condicao_pagamento,
          numero_motorista,
          cnh_motorista,
          antt_veiculo,
          conta_deposito,
          chave_pix,
          doc_placas,
          doc_antt,
          doc_conta_deposito,
          doc_chave_pix,
          doc_cnh_motorista,
          doc_comprovante_residencia,
          doc_numero_motorista
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23, $24, $25, $26,
          $27, $28, $29, $30, $31, $32
        )
        RETURNING *;
      `,
      [
        quote.date,
        quote.tripNumber,
        quote.vehiclePlate,
        quote.status,
        quote.originCity,
        quote.originUf,
        quote.destinationCity,
        quote.destinationUf,
        quote.customer,
        quote.finalCustomer,
        quote.customerValue,
        quote.tripKm,
        quote.material,
        quote.weightKg,
        quote.driver,
        quote.driverValue,
        quote.seller,
        quote.notes,
        quote.serviceTaker,
        quote.paymentCondition,
        quote.driverPhone,
        quote.driverLicenseNumber,
        quote.vehicleAntt,
        quote.depositAccount,
        quote.pixKey,
        quote.documents.plates,
        quote.documents.antt,
        quote.documents.depositAccount,
        quote.documents.pixKey,
        quote.documents.driverLicense,
        quote.documents.proofOfAddress,
        quote.documents.driverPhone,
      ],
    );

    return mapDbQuote(rows[0]);
  }

  const store = await readStore();
  const now = new Date().toISOString();
  const quote = normalizeQuote(payload, {
    id: store.nextId,
    createdAt: now,
  });

  store.nextId += 1;
  store.quotes.push(quote);
  await writeStore(store);
  return quote;
}

export async function updateQuoteRegistry(id, payload) {
  if (await hasDatabaseTable()) {
    const quote = normalizeQuote(payload);
    const { rows } = await pool.query(
      `
        UPDATE ${env.dbSchema}.cadastro_cotacao_frete
        SET
          data = $1,
          numero_viagem = $2,
          placa_veiculo = $3,
          situacao = $4,
          cidade_origem = $5,
          uf_origem = $6,
          cidade_destino = $7,
          uf_destino = $8,
          cliente = $9,
          cliente_final = $10,
          valor_cliente = $11,
          km_viagem = $12,
          material = $13,
          peso_kg = $14,
          motorista = $15,
          valor_motorista = $16,
          vendedor = $17,
          observacoes = $18,
          tomador_servico = $19,
          condicao_pagamento = $20,
          numero_motorista = $21,
          cnh_motorista = $22,
          antt_veiculo = $23,
          conta_deposito = $24,
          chave_pix = $25,
          doc_placas = $26,
          doc_antt = $27,
          doc_conta_deposito = $28,
          doc_chave_pix = $29,
          doc_cnh_motorista = $30,
          doc_comprovante_residencia = $31,
          doc_numero_motorista = $32,
          atualizado_em = CURRENT_TIMESTAMP
        WHERE id = $33
        RETURNING *;
      `,
      [
        quote.date,
        quote.tripNumber,
        quote.vehiclePlate,
        quote.status,
        quote.originCity,
        quote.originUf,
        quote.destinationCity,
        quote.destinationUf,
        quote.customer,
        quote.finalCustomer,
        quote.customerValue,
        quote.tripKm,
        quote.material,
        quote.weightKg,
        quote.driver,
        quote.driverValue,
        quote.seller,
        quote.notes,
        quote.serviceTaker,
        quote.paymentCondition,
        quote.driverPhone,
        quote.driverLicenseNumber,
        quote.vehicleAntt,
        quote.depositAccount,
        quote.pixKey,
        quote.documents.plates,
        quote.documents.antt,
        quote.documents.depositAccount,
        quote.documents.pixKey,
        quote.documents.driverLicense,
        quote.documents.proofOfAddress,
        quote.documents.driverPhone,
        parseNumber(id),
      ],
    );

    if (!rows.length) {
      const error = new Error("Cotação não encontrada.");
      error.statusCode = 404;
      throw error;
    }

    return mapDbQuote(rows[0]);
  }

  const store = await readStore();
  const numericId = parseNumber(id);
  const index = store.quotes.findIndex((quote) => quote.id === numericId);

  if (index === -1) {
    const error = new Error("Cotação não encontrada.");
    error.statusCode = 404;
    throw error;
  }

  store.quotes[index] = normalizeQuote(payload, store.quotes[index]);
  await writeStore(store);
  return store.quotes[index];
}

export async function deleteQuoteRegistry(id) {
  if (await hasDatabaseTable()) {
    const { rowCount } = await pool.query(
      `DELETE FROM ${env.dbSchema}.cadastro_cotacao_frete WHERE id = $1;`,
      [parseNumber(id)],
    );

    if (!rowCount) {
      const error = new Error("Cotação não encontrada.");
      error.statusCode = 404;
      throw error;
    }

    return { ok: true };
  }

  const store = await readStore();
  const numericId = parseNumber(id);
  const originalLength = store.quotes.length;
  store.quotes = store.quotes.filter((quote) => quote.id !== numericId);

  if (store.quotes.length === originalLength) {
    const error = new Error("Cotação não encontrada.");
    error.statusCode = 404;
    throw error;
  }

  await writeStore(store);
  return { ok: true };
}
