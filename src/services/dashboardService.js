import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { parseMonthLabel, parseNumber } from "../utils/formatters.js";

let resolvedSchemaPromise;

function normalizeMonths(months = []) {
  return months
    .filter(Boolean)
    .map((month) => String(month).trim())
    .filter((month) => /^\d{4}-\d{2}$/.test(month));
}

function buildFilters({
  placa,
  plateColumn = "placa",
  monthColumn,
  months = [],
  motorista,
  driverColumn,
  categoria,
  categoryColumn,
}) {
  const values = [];
  const where = [];
  const normalizedMonths = normalizeMonths(months);

  if (placa) {
    values.push(placa);
    where.push(`${plateColumn} = $${values.length}`);
  }

  if (monthColumn && normalizedMonths.length) {
    values.push(normalizedMonths);
    where.push(`TO_CHAR(${monthColumn}, 'YYYY-MM') = ANY($${values.length})`);
  }

  if (motorista && driverColumn) {
    values.push(motorista);
    where.push(`${driverColumn} = $${values.length}`);
  }

  if (categoria && categoryColumn) {
    values.push(categoria);
    where.push(`${categoryColumn} = $${values.length}`);
  }

  return {
    clause: where.length ? `WHERE ${where.join(" AND ")}` : "",
    values,
  };
}

async function resolveSchema() {
  if (!resolvedSchemaPromise) {
    resolvedSchemaPromise = (async () => {
      const candidates = [env.dbSchema, "dashboard_cliente", "public"].filter(Boolean);

      for (const schema of [...new Set(candidates)]) {
        const { rows } = await pool.query(
          `
            SELECT EXISTS (
              SELECT 1
              FROM information_schema.tables
              WHERE table_schema = $1
                AND table_name = 'veiculo'
            ) AS exists;
          `,
          [schema],
        );

        if (rows[0]?.exists) {
          return schema;
        }
      }

      return env.dbSchema;
    })();
  }

  return resolvedSchemaPromise;
}

export async function getAvailablePlates() {
  const schema = await resolveSchema();

  const { rows } = await pool.query(`
    SELECT DISTINCT placa, descricao, empresa
    FROM ${schema}.veiculo
    ORDER BY placa;
  `);

  return rows;
}

export async function getAvailableDrivers(placa) {
  const schema = await resolveSchema();
  const filters = buildFilters({
    placa,
    plateColumn: "placa_veiculo",
  });

  const { rows } = await pool.query(
    `
      SELECT DISTINCT motorista
      FROM ${schema}.vw_abastecimento_dashboard
      ${filters.clause}
      ORDER BY motorista;
    `,
    filters.values,
  );

  return rows
    .map((row) => row.motorista)
    .filter(Boolean)
    .map((motorista) => ({ value: motorista, label: motorista }));
}

export async function getAvailableMonths() {
  const schema = await resolveSchema();

  const { rows } = await pool.query(`
    SELECT referencia
    FROM (
      SELECT DISTINCT TO_CHAR(competencia, 'YYYY-MM') AS referencia
      FROM ${schema}.vw_dashboard_financeiro
      UNION
      SELECT DISTINCT TO_CHAR(data_abastecimento, 'YYYY-MM') AS referencia
      FROM ${schema}.vw_abastecimento_dashboard
    ) base
    ORDER BY referencia;
  `);

  return rows.map((row) => ({
    value: row.referencia,
    label: parseMonthLabel(row.referencia),
  }));
}

export async function getOverviewDashboard(placa, months = [], categoria) {
  const schema = await resolveSchema();
  const filters = buildFilters({
    placa,
    plateColumn: "placa",
    monthColumn: "competencia",
    months,
    categoria,
    categoryColumn: "categoria_principal",
  });

  const summaryQuery = `
    WITH base AS (
      SELECT
        placa,
        competencia,
        categoria_principal,
        descricao_conta,
        codigo_conta,
        valor,
        tipo_movimento
      FROM ${schema}.vw_dashboard_financeiro
      ${filters.clause}
    )
    SELECT
      COALESCE(SUM(CASE WHEN tipo_movimento = 'C' THEN valor ELSE 0 END), 0) AS receita_total,
      COALESCE(SUM(CASE WHEN tipo_movimento = 'D' THEN valor ELSE 0 END), 0) AS custo_total,
      COALESCE(SUM(CASE WHEN tipo_movimento = 'C' THEN valor ELSE -valor END), 0) AS lucro_total,
      COUNT(DISTINCT competencia) AS total_competencias,
      COUNT(DISTINCT placa) AS total_placas
    FROM base;
  `;

  const monthlyQuery = `
    SELECT
      TO_CHAR(competencia, 'YYYY-MM') AS referencia,
      SUM(CASE WHEN tipo_movimento = 'C' THEN valor ELSE 0 END) AS receita,
      SUM(CASE WHEN tipo_movimento = 'D' THEN valor ELSE 0 END) AS custo,
      SUM(CASE WHEN tipo_movimento = 'C' THEN valor ELSE -valor END) AS lucro
    FROM ${schema}.vw_dashboard_financeiro
    ${filters.clause}
    GROUP BY competencia
    ORDER BY competencia;
  `;

  const categoriesQuery = `
    SELECT
      categoria_principal,
      SUM(valor) AS total
    FROM ${schema}.vw_dashboard_financeiro
    ${filters.clause ? `${filters.clause} AND tipo_movimento = 'D'` : "WHERE tipo_movimento = 'D'"}
    GROUP BY categoria_principal
    ORDER BY total DESC;
  `;

  const accountsQuery = `
    SELECT
      descricao_conta,
      SUM(valor) AS total
    FROM ${schema}.vw_dashboard_financeiro
    ${filters.clause ? `${filters.clause} AND tipo_movimento = 'D'` : "WHERE tipo_movimento = 'D'"}
    GROUP BY descricao_conta
    ORDER BY total DESC
    LIMIT 20;
  `;

  const indicatorQuery = `
    SELECT
      COALESCE(SUM(CASE WHEN codigo_conta = '4.1.005' THEN valor ELSE 0 END), 0) AS pedagio,
      COALESCE(SUM(CASE WHEN codigo_conta IN ('4.009', '6.2.067') THEN valor ELSE 0 END), 0) AS seguro,
      COALESCE(SUM(CASE WHEN codigo_conta = '4.1.004' THEN valor ELSE 0 END), 0) AS combustivel,
      COALESCE(SUM(CASE WHEN codigo_conta IN ('4.1.008', '4.1.014') THEN valor ELSE 0 END), 0) AS manutencao,
      COALESCE(SUM(CASE WHEN codigo_conta = '6.5.001' THEN valor ELSE 0 END), 0) AS financiamento,
      COALESCE(SUM(CASE WHEN codigo_conta = '4.1.015' THEN valor ELSE 0 END), 0) AS despesas_viagem,
      COALESCE(SUM(CASE WHEN codigo_conta = '6.1.002' THEN valor ELSE 0 END), 0) AS salarios_variaveis,
      COALESCE(SUM(CASE WHEN tipo_movimento = 'D' THEN valor ELSE 0 END), 0) AS total_custos
    FROM ${schema}.vw_dashboard_financeiro
    ${filters.clause};
  `;

  const [
    summaryResult,
    monthlyResult,
    categoriesResult,
    accountsResult,
    indicatorResult,
  ] = await Promise.all([
    pool.query(summaryQuery, filters.values),
    pool.query(monthlyQuery, filters.values),
    pool.query(categoriesQuery, filters.values),
    pool.query(accountsQuery, filters.values),
    pool.query(indicatorQuery, filters.values),
  ]);

  const summary = summaryResult.rows[0];
  const indicators = indicatorResult.rows[0];

  const costIndicators = [
    { id: "pedagio", label: "Pedágio", total: parseNumber(indicators.pedagio) },
    { id: "seguro", label: "Seguro", total: parseNumber(indicators.seguro) },
    { id: "combustivel", label: "Combustível", total: parseNumber(indicators.combustivel) },
    { id: "manutencao", label: "Manutenção", total: parseNumber(indicators.manutencao) },
    { id: "financiamento", label: "Financiamento", total: parseNumber(indicators.financiamento) },
    {
      id: "despesasViagem",
      label: "Despesas de Viagem",
      total: parseNumber(indicators.despesas_viagem),
    },
    {
      id: "salariosVariaveis",
      label: "Salários Variáveis",
      total: parseNumber(indicators.salarios_variaveis),
    },
  ];

  const mappedCostTotal = costIndicators.reduce((total, indicator) => total + indicator.total, 0);
  const otherCosts = Math.max(parseNumber(indicators.total_custos) - mappedCostTotal, 0);

  if (otherCosts > 0) {
    costIndicators.push({
      id: "outros",
      label: "Outros Custos",
      total: otherCosts,
    });
  }

  return {
    summary: {
      receitaTotal: parseNumber(summary.receita_total),
      custoTotal: parseNumber(summary.custo_total),
      lucroTotal: parseNumber(summary.lucro_total),
      totalCompetencias: parseNumber(summary.total_competencias),
      totalPlacas: parseNumber(summary.total_placas),
      margemPercentual:
        parseNumber(summary.receita_total) > 0
          ? (parseNumber(summary.lucro_total) / parseNumber(summary.receita_total)) * 100
          : 0,
      ticketMedioReceita:
        parseNumber(summary.total_competencias) > 0
          ? parseNumber(summary.receita_total) / parseNumber(summary.total_competencias)
          : 0,
      ticketMedioCusto:
        parseNumber(summary.total_competencias) > 0
          ? parseNumber(summary.custo_total) / parseNumber(summary.total_competencias)
          : 0,
    },
    monthly: monthlyResult.rows.map((row) => ({
      referencia: row.referencia,
      label: parseMonthLabel(row.referencia),
      receita: parseNumber(row.receita),
      custo: parseNumber(row.custo),
      lucro: parseNumber(row.lucro),
    })),
    categories: categoriesResult.rows.map((row) => ({
      categoria: row.categoria_principal ?? "Sem categoria",
      total: parseNumber(row.total),
    })),
    topAccounts: accountsResult.rows.map((row) => ({
      conta: row.descricao_conta,
      total: parseNumber(row.total),
    })),
    costIndicators,
    selectedCategory: categoria ?? "",
  };
}

export async function getFuelDashboard(placa, months = [], motorista) {
  const schema = await resolveSchema();
  const filters = buildFilters({
    placa,
    plateColumn: "placa_veiculo",
    monthColumn: "data_abastecimento",
    months,
    motorista,
    driverColumn: "motorista",
  });

  const summaryQuery = `
    SELECT
      COALESCE(SUM(valor_abastecimento), 0) AS gasto_total,
      COALESCE(SUM(litros_abastecidos), 0) AS litros_total,
      COALESCE(SUM(km_rodado), 0) AS km_total,
      COALESCE(AVG(media_km_l), 0) AS media_consumo,
      COALESCE(AVG(valor_por_litro), 0) AS preco_medio,
      COUNT(*) AS total_abastecimentos
    FROM ${schema}.vw_abastecimento_dashboard
    ${filters.clause};
  `;

  const monthlyQuery = `
    SELECT
      TO_CHAR(data_abastecimento, 'YYYY-MM') AS referencia,
      SUM(valor_abastecimento) AS gasto_total,
      SUM(litros_abastecidos) AS litros_total,
      SUM(km_rodado) AS km_total,
      AVG(media_km_l) AS media_consumo,
      AVG(valor_por_litro) AS preco_medio
    FROM ${schema}.vw_abastecimento_dashboard
    ${filters.clause}
    GROUP BY DATE_TRUNC('month', data_abastecimento), TO_CHAR(data_abastecimento, 'YYYY-MM')
    ORDER BY DATE_TRUNC('month', data_abastecimento);
  `;

  const driversQuery = `
    SELECT
      motorista,
      COUNT(*) AS abastecimentos,
      SUM(valor_abastecimento) AS gasto_total,
      AVG(media_km_l) AS media_consumo
    FROM ${schema}.vw_abastecimento_dashboard
    ${filters.clause}
    GROUP BY motorista
    ORDER BY gasto_total DESC;
  `;

  const stationsQuery = `
    SELECT
      posto,
      COUNT(*) AS abastecimentos,
      SUM(valor_abastecimento) AS gasto_total,
      AVG(valor_por_litro) AS preco_medio
    FROM ${schema}.vw_abastecimento_dashboard
    ${filters.clause}
    GROUP BY posto
    ORDER BY gasto_total DESC
    LIMIT 20;
  `;

  const latestSupplyQuery = `
    SELECT
      codigo_abastecimento,
      data_abastecimento,
      motorista,
      posto,
      km_rodado,
      litros_abastecidos,
      media_km_l,
      valor_abastecimento,
      valor_por_litro
    FROM ${schema}.vw_abastecimento_dashboard
    ${filters.clause}
    ORDER BY data_abastecimento DESC, codigo_abastecimento DESC
    LIMIT 20;
  `;

  const [summaryResult, monthlyResult, driversResult, stationsResult, latestSupplyResult] =
    await Promise.all([
      pool.query(summaryQuery, filters.values),
      pool.query(monthlyQuery, filters.values),
      pool.query(driversQuery, filters.values),
      pool.query(stationsQuery, filters.values),
      pool.query(latestSupplyQuery, filters.values),
    ]);

  const summary = summaryResult.rows[0];

  return {
    summary: {
      gastoTotal: parseNumber(summary.gasto_total),
      litrosTotal: parseNumber(summary.litros_total),
      kmTotal: parseNumber(summary.km_total),
      mediaConsumo: parseNumber(summary.media_consumo),
      precoMedio: parseNumber(summary.preco_medio),
      totalAbastecimentos: parseNumber(summary.total_abastecimentos),
      custoPorKm:
        parseNumber(summary.km_total) > 0
          ? parseNumber(summary.gasto_total) / parseNumber(summary.km_total)
          : 0,
      ticketMedioAbastecimento:
        parseNumber(summary.total_abastecimentos) > 0
          ? parseNumber(summary.gasto_total) / parseNumber(summary.total_abastecimentos)
          : 0,
    },
    monthly: monthlyResult.rows.map((row) => ({
      referencia: row.referencia,
      label: parseMonthLabel(row.referencia),
      gastoTotal: parseNumber(row.gasto_total),
      litrosTotal: parseNumber(row.litros_total),
      kmTotal: parseNumber(row.km_total),
      mediaConsumo: parseNumber(row.media_consumo),
      precoMedio: parseNumber(row.preco_medio),
    })),
    drivers: driversResult.rows.map((row) => ({
      motorista: row.motorista ?? "Não informado",
      abastecimentos: parseNumber(row.abastecimentos),
      gastoTotal: parseNumber(row.gasto_total),
      mediaConsumo: parseNumber(row.media_consumo),
    })),
    stations: stationsResult.rows.map((row) => ({
      posto: row.posto,
      abastecimentos: parseNumber(row.abastecimentos),
      gastoTotal: parseNumber(row.gasto_total),
      precoMedio: parseNumber(row.preco_medio),
    })),
    recentSupplies: latestSupplyResult.rows.map((row) => ({
      codigoAbastecimento: row.codigo_abastecimento,
      dataAbastecimento: row.data_abastecimento,
      motorista: row.motorista,
      posto: row.posto,
      kmRodado: parseNumber(row.km_rodado),
      litrosAbastecidos: parseNumber(row.litros_abastecidos),
      mediaKmL: parseNumber(row.media_km_l),
      valorAbastecimento: parseNumber(row.valor_abastecimento),
      valorPorLitro: parseNumber(row.valor_por_litro),
    })),
  };
}

export async function getDashboardDiagnostics(months = [], categoria, motorista) {
  const schema = await resolveSchema();

  const [vehicleResult, entriesResult, supplyResult, overviewResult, fuelResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS total FROM ${schema}.veiculo`),
    pool.query(`SELECT COUNT(*) AS total FROM ${schema}.lancamento_financeiro`),
    pool.query(`SELECT COUNT(*) AS total FROM ${schema}.abastecimento`),
    getOverviewDashboard(undefined, months, categoria),
    getFuelDashboard(undefined, months, motorista),
  ]);

  return {
    totals: {
      vehicles: parseNumber(vehicleResult.rows[0]?.total),
      financialEntries: parseNumber(entriesResult.rows[0]?.total),
      supplies: parseNumber(supplyResult.rows[0]?.total),
    },
    averages: {
      receitaMediaPorCompetencia: overviewResult.summary.ticketMedioReceita,
      custoMedioPorCompetencia: overviewResult.summary.ticketMedioCusto,
      mediaConsumo: fuelResult.summary.mediaConsumo,
      ticketMedioAbastecimento: fuelResult.summary.ticketMedioAbastecimento,
    },
  };
}
