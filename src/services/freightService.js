import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { parseNumber } from "../utils/formatters.js";

const DEFAULT_FREIGHT_RATES = [
  {
    vehicleType: "Truck",
    axles: 3,
    normalDisplacementCost: 5.1295,
    normalLoadUnloadCost: 523.33,
    highPerformanceDisplacementCost: 4.3727,
    highPerformanceLoadUnloadCost: 190.36,
  },
  {
    vehicleType: "Bitruck",
    axles: 4,
    normalDisplacementCost: 5.8178,
    normalLoadUnloadCost: 568.72,
    highPerformanceDisplacementCost: 4.9981,
    highPerformanceLoadUnloadCost: 205.98,
  },
  {
    vehicleType: "Carreta 5e",
    axles: 5,
    normalDisplacementCost: 6.7126,
    normalLoadUnloadCost: 635.08,
    highPerformanceDisplacementCost: 5.7382,
    highPerformanceLoadUnloadCost: 220.28,
  },
  {
    vehicleType: "Carreta 6e",
    axles: 6,
    normalDisplacementCost: 7.4124,
    normalLoadUnloadCost: 648.95,
    highPerformanceDisplacementCost: 6.4057,
    highPerformanceLoadUnloadCost: 223.27,
  },
  {
    vehicleType: "Carreta 7e",
    axles: 7,
    normalDisplacementCost: 8.1252,
    normalLoadUnloadCost: 803.22,
    highPerformanceDisplacementCost: 6.8012,
    highPerformanceLoadUnloadCost: 263.47,
  },
];

const DEFAULTS = {
  profitPercent: 30,
  fixedProfitValue: 1500,
  icmsPercent: 12,
  cargoInsurancePercent: 0.042952,
  thirdPartyInsurancePerKm: 0.02748,
  inssBasePercent: 20,
  inssPercent: 11,
  sestPercent: 1.5,
  senatPercent: 1,
  patronalInssPercent: 2.698,
};

let freightSchemaPromise;

function normalizeRate(row) {
  return {
    id: row.id ?? `${row.tipo_veiculo}-${row.eixos}`,
    vehicleType: row.tipo_veiculo,
    axles: parseNumber(row.eixos),
    normalDisplacementCost: parseNumber(row.normal_custo_deslocamento),
    normalLoadUnloadCost: parseNumber(row.normal_carga_descarga),
    highPerformanceDisplacementCost: parseNumber(row.alto_desempenho_custo_deslocamento),
    highPerformanceLoadUnloadCost: parseNumber(row.alto_desempenho_carga_descarga),
    source: row.fonte ?? "ANTT",
  };
}

async function resolveFreightSchema() {
  if (!freightSchemaPromise) {
    freightSchemaPromise = (async () => {
      if (!env.dbName || !env.dbUser) {
        return null;
      }

      const candidates = [env.dbSchema, "dashboard_cliente", "public"].filter(Boolean);

      for (const schema of [...new Set(candidates)]) {
        const { rows } = await pool.query(
          `
            SELECT EXISTS (
              SELECT 1
              FROM information_schema.tables
              WHERE table_schema = $1
                AND table_name = 'frete_tabela_antt'
            ) AS exists;
          `,
          [schema],
        );

        if (rows[0]?.exists) {
          return schema;
        }
      }

      return null;
    })();
  }

  return freightSchemaPromise;
}

export async function getFreightRates() {
  try {
    const schema = await resolveFreightSchema();

    if (!schema) {
      return DEFAULT_FREIGHT_RATES.map((rate) => ({ ...rate, source: "Planilha ANTT" }));
    }

    const { rows } = await pool.query(`
      SELECT
        id,
        tipo_veiculo,
        eixos,
        normal_custo_deslocamento,
        normal_carga_descarga,
        alto_desempenho_custo_deslocamento,
        alto_desempenho_carga_descarga,
        fonte
      FROM ${schema}.frete_tabela_antt
      WHERE ativo = true
      ORDER BY eixos, tipo_veiculo;
    `);

    return rows.map(normalizeRate);
  } catch (error) {
    console.warn("Usando tabela ANTT local por falha ao consultar o banco.", error.message);
    return DEFAULT_FREIGHT_RATES.map((rate) => ({ ...rate, source: "Planilha ANTT" }));
  }
}

function readNumber(value, fallback = 0) {
  const parsed = parseNumber(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((readNumber(value) + Number.EPSILON) * 100) / 100;
}

function calculateRpaCharges(driverValue) {
  const inssBase = driverValue * (DEFAULTS.inssBasePercent / 100);
  const inss = inssBase * (DEFAULTS.inssPercent / 100);
  const sest = inssBase * (DEFAULTS.sestPercent / 100);
  const senat = inssBase * (DEFAULTS.senatPercent / 100);
  const totalDiscounts = inss + sest + senat;
  const patronalInss = driverValue * (DEFAULTS.patronalInssPercent / 100);

  return {
    inssBase: roundMoney(inssBase),
    inss: roundMoney(inss),
    sest: roundMoney(sest),
    senat: roundMoney(senat),
    irrfBase: 0,
    irrf: 0,
    totalDiscounts: roundMoney(totalDiscounts),
    netDriverValue: roundMoney(driverValue - totalDiscounts),
    patronalInss: roundMoney(patronalInss),
  };
}

export async function calculateFreightQuote(input) {
  const rates = await getFreightRates();
  const axles = readNumber(input.axles);
  const rate = rates.find((item) => item.axles === axles);

  if (!rate) {
    const error = new Error("Tabela ANTT não encontrada para o número de eixos informado.");
    error.statusCode = 404;
    throw error;
  }

  const loadType = input.loadType === "high_performance" ? "high_performance" : "normal";
  const operationType = input.operationType === "tac" ? "tac" : "etc";
  const pricingReference =
    input.pricingReference === "selected_load" ? "selected_load" : "normal_antt";
  const km = readNumber(input.km);
  const invoiceValue = readNumber(input.invoiceValue);
  const cteValue = readNumber(input.cteValue);
  const tollValue = readNumber(input.tollValue);
  const manualThirdPartyInsurance = input.thirdPartyInsuranceValue === ""
    ? 0
    : readNumber(input.thirdPartyInsuranceValue);
  const profitMode = ["percent", "fixed", "net_margin"].includes(input.profitMode)
    ? input.profitMode
    : "net_margin";
  const profitValue = readNumber(
    input.profitValue ?? input.profitPercent,
    profitMode === "fixed" ? DEFAULTS.fixedProfitValue : DEFAULTS.profitPercent,
  );
  const icmsPercent =
    input.icmsPercent === "" || input.icmsPercent == null
      ? DEFAULTS.icmsPercent
      : readNumber(input.icmsPercent, DEFAULTS.icmsPercent);
  const taxMode = input.taxMode === "cte_value" ? "cte_value" : "inside";
  const manualDriverValue = input.manualDriverValue === "" ? 0 : readNumber(input.manualDriverValue);
  const manualClientValue = input.manualClientValue === "" ? 0 : readNumber(input.manualClientValue);
  const oldDriverValue = input.oldDriverValue === "" ? 0 : readNumber(input.oldDriverValue);
  const oldClientValue = input.oldClientValue === "" ? 0 : readNumber(input.oldClientValue);

  const displacementCost =
    loadType === "high_performance"
      ? rate.highPerformanceDisplacementCost
      : rate.normalDisplacementCost;
  const loadUnloadCost =
    loadType === "high_performance"
      ? rate.highPerformanceLoadUnloadCost
      : rate.normalLoadUnloadCost;

  const normalAnttValue = km * rate.normalDisplacementCost + rate.normalLoadUnloadCost;
  const tableDriverValue = km * displacementCost + loadUnloadCost;
  const driverValue = tableDriverValue;
  const pricingReferenceValue =
    pricingReference === "normal_antt" ? normalAnttValue : driverValue;
  const cargoInsurance = invoiceValue * (DEFAULTS.cargoInsurancePercent / 100);
  const estimatedThirdPartyInsurance = km * DEFAULTS.thirdPartyInsurancePerKm;
  const thirdPartyInsurance =
    manualThirdPartyInsurance > 0 ? manualThirdPartyInsurance : estimatedThirdPartyInsurance;
  const rpa = operationType === "tac" ? calculateRpaCharges(driverValue) : null;
  const driverWithRpa = driverValue + (rpa?.totalDiscounts ?? 0);
  const driverWithTacCharges = driverWithRpa + (rpa?.patronalInss ?? 0);
  const additionalCosts = cargoInsurance + thirdPartyInsurance + tollValue + (rpa?.patronalInss ?? 0);
  const operationalCosts = driverValue + additionalCosts;
  const taxRate = Math.max(icmsPercent, 0) / 100;
  const shouldUseCustomerAsCte = taxMode === "cte_value" && cteValue <= 0;
  const cteTaxValue = cteValue * taxRate;
  const pricingBase =
    taxMode === "cte_value" && !shouldUseCustomerAsCte
      ? operationalCosts + cteTaxValue
      : operationalCosts;

  let targetProfit = 0;
  let clientValue = pricingBase;

  if (profitMode === "fixed") {
    targetProfit = profitValue;
    clientValue =
      taxMode === "inside" || shouldUseCustomerAsCte
        ? (operationalCosts + targetProfit) / Math.max(1 - taxRate, 0.0001)
        : pricingBase + targetProfit;
  } else if (profitMode === "net_margin") {
    const marginRate = Math.max(profitValue, 0) / 100;
    clientValue =
      taxMode === "inside" || shouldUseCustomerAsCte
        ? operationalCosts / Math.max(1 - taxRate - marginRate, 0.0001)
        : pricingBase / Math.max(1 - marginRate, 0.0001);
    targetProfit = clientValue * marginRate;
  } else {
    const grossPercentRate = Math.max(profitValue, 0) / 100;
    clientValue = pricingReferenceValue / Math.max(1 - grossPercentRate, 0.0001);
    targetProfit = clientValue - pricingReferenceValue;
  }

  const taxBaseValue = taxMode === "inside" || shouldUseCustomerAsCte ? clientValue : cteValue;
  const icmsValue = taxBaseValue * taxRate;
  const taxTotal = additionalCosts + icmsValue;
  const result = clientValue - driverValue - taxTotal;
  const realMarginPercent = clientValue > 0 ? (result / clientValue) * 100 : 0;
  const oldResult =
    oldDriverValue > 0 || oldClientValue > 0
      ? oldClientValue - oldDriverValue - cargoInsurance - thirdPartyInsurance - icmsValue - tollValue
      : 0;
  const simulation =
    manualDriverValue > 0 || manualClientValue > 0
      ? calculateDriverSimulation({
          driverValue: manualDriverValue > 0 ? manualDriverValue : driverValue,
          manualClientValue,
          normalAnttValue,
          pricingReference,
          cargoInsurance,
          estimatedThirdPartyInsurance,
          manualThirdPartyInsurance,
          tollValue,
          operationType,
          taxRate,
          cteValue,
          taxMode,
          profitMode,
          profitValue,
        })
      : null;

  return {
    input: {
      vehicleType: rate.vehicleType,
      axles,
      loadType,
      operationType,
      pricingReference,
      km,
      invoiceValue,
      cteValue,
      cteValueUsed: roundMoney(taxBaseValue),
      tollValue,
      thirdPartyInsuranceValue: manualThirdPartyInsurance,
      profitMode,
      profitValue,
      icmsPercent,
      taxMode,
      manualDriverValue,
      manualClientValue,
      oldDriverValue,
      oldClientValue,
    },
    rate,
    table: {
      displacementCost: roundMoney(displacementCost),
      loadUnloadCost: roundMoney(loadUnloadCost),
      normalAnttValue: roundMoney(normalAnttValue),
      pricingReferenceValue: roundMoney(pricingReferenceValue),
      minimumAnttValue: roundMoney(tableDriverValue),
      tableDriverValue: roundMoney(tableDriverValue),
      driverValue: roundMoney(driverValue),
      clientValue: roundMoney(clientValue),
    },
    charges: {
      cargoInsurance: roundMoney(cargoInsurance),
      thirdPartyInsurance: roundMoney(thirdPartyInsurance),
      estimatedThirdPartyInsurance: roundMoney(estimatedThirdPartyInsurance),
      icmsValue: roundMoney(icmsValue),
      taxBaseValue: roundMoney(taxBaseValue),
      tollValue: roundMoney(tollValue),
      additionalCosts: roundMoney(additionalCosts),
      operationalCosts: roundMoney(operationalCosts),
      taxTotal: roundMoney(taxTotal),
      driverWithRpa: roundMoney(driverWithRpa),
      driverWithTacCharges: roundMoney(driverWithTacCharges),
      rpa,
    },
    result: {
      customerTotal: roundMoney(clientValue),
      grossRevenue: roundMoney(clientValue),
      totalCost: roundMoney(driverValue + taxTotal),
      targetProfit: roundMoney(targetProfit),
      netResult: roundMoney(result),
      realMarginPercent: Math.round(realMarginPercent * 100) / 100,
      oldResult: roundMoney(oldResult),
      oldMarginPercent: oldClientValue > 0 ? Math.round((oldResult / oldClientValue) * 10000) / 100 : 0,
    },
    simulation,
  };
}

function calculateDriverSimulation({
  driverValue,
  manualClientValue,
  normalAnttValue,
  pricingReference,
  cargoInsurance,
  estimatedThirdPartyInsurance,
  manualThirdPartyInsurance,
  tollValue,
  operationType,
  taxRate,
  cteValue,
  taxMode,
  profitMode,
  profitValue,
}) {
  const pricingReferenceValue = pricingReference === "normal_antt" ? normalAnttValue : driverValue;
  const thirdPartyInsurance =
    manualThirdPartyInsurance > 0 ? manualThirdPartyInsurance : estimatedThirdPartyInsurance;
  const rpa = operationType === "tac" ? calculateRpaCharges(driverValue) : null;
  const additionalCosts = cargoInsurance + thirdPartyInsurance + tollValue + (rpa?.patronalInss ?? 0);
  const operationalCosts = driverValue + additionalCosts;
  const pricingBase = operationalCosts;

  let targetProfit = 0;
  let clientValue = pricingBase;

  if (manualClientValue > 0) {
    clientValue = manualClientValue;
  } else if (profitMode === "fixed") {
    targetProfit = profitValue;
    clientValue =
      taxMode === "inside" || taxMode === "cte_value"
        ? (operationalCosts + targetProfit) / Math.max(1 - taxRate, 0.0001)
        : pricingBase + targetProfit;
  } else if (profitMode === "net_margin") {
    const marginRate = Math.max(profitValue, 0) / 100;
    clientValue =
      taxMode === "inside" || taxMode === "cte_value"
        ? operationalCosts / Math.max(1 - taxRate - marginRate, 0.0001)
        : pricingBase / Math.max(1 - marginRate, 0.0001);
    targetProfit = clientValue * marginRate;
  } else {
    const grossPercentRate = Math.max(profitValue, 0) / 100;
    clientValue = pricingReferenceValue / Math.max(1 - grossPercentRate, 0.0001);
    targetProfit = clientValue - pricingReferenceValue;
  }

  const taxBaseValue = clientValue;
  const icmsValue = taxBaseValue * taxRate;
  const taxTotal = additionalCosts + icmsValue;
  const netResult = clientValue - driverValue - taxTotal;
  const marginPercent = clientValue > 0 ? (netResult / clientValue) * 100 : 0;
  if (manualClientValue > 0) {
    targetProfit = netResult;
  }

  return {
    driverValue: roundMoney(driverValue),
    customerTotal: roundMoney(clientValue),
    pricingReferenceValue: roundMoney(pricingReferenceValue),
    cteValueUsed: roundMoney(taxBaseValue),
    cargoInsurance: roundMoney(cargoInsurance),
    thirdPartyInsurance: roundMoney(thirdPartyInsurance),
    icmsValue: roundMoney(icmsValue),
    tollValue: roundMoney(tollValue),
    additionalCosts: roundMoney(additionalCosts),
    operationalCosts: roundMoney(operationalCosts),
    targetProfit: roundMoney(targetProfit),
    taxTotal: roundMoney(taxTotal),
    totalCost: roundMoney(driverValue + taxTotal),
    rpa,
    driverWithRpa: roundMoney(driverValue + (rpa?.totalDiscounts ?? 0)),
    driverWithTacCharges: roundMoney(driverValue + (rpa?.totalDiscounts ?? 0) + (rpa?.patronalInss ?? 0)),
    netResult: roundMoney(netResult),
    marginPercent: Math.round(marginPercent * 100) / 100,
  };
}
