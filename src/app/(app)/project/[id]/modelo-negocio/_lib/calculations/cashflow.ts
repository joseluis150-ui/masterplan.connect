/**
 * Motor de cálculo de flujo de caja por período.
 *
 * Implementa el algoritmo del §6 de la spec. Función pura: toma todos los
 * inputs del escenario y devuelve un array de CashflowPeriod listo para
 * renderizar y para alimentar el cálculo de KPIs.
 *
 * Pasos (ver spec §6.2):
 *   1. Generar timeline + TC por período (devaluación compuesta).
 *   2. Distribuir costos de tierra (lump_sum o cuotas).
 *   3. Distribuir costos de construcción (curva × totalAmount × TC).
 *   4. Calcular ingresos por venta (anticipo + cuotas + saldo) con TC.
 *   5. Calcular otros gastos según basis y timing.
 *   6. Consolidar netCashflow + accumulated.
 */

import type {
  CashflowPeriod,
  ConstructionCategory,
  LandCost,
  OtherExpense,
  ScenarioInput,
} from "../types";
import { generateDistribution } from "./distributions";
import { convertToReporting, fxRateAt, periodsPerYear } from "./currency";

/* ─── Helpers de date math ─────────────────────────────────────────── */

/** Suma N meses (o trimestres) a una fecha ISO. Devuelve ISO YYYY-MM-DD del
 *  primer día del período resultante. */
function addPeriods(startDate: string, periods: number, granularity: "monthly" | "quarterly"): string {
  const monthsToAdd = granularity === "monthly" ? periods : periods * 3;
  const d = new Date(startDate + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + monthsToAdd);
  return d.toISOString().slice(0, 10);
}

/* ─── Helpers de inicialización de período ─────────────────────────── */

function emptyPeriod(period: number, date: string, fxRate: number): CashflowPeriod {
  return {
    period,
    date,
    fxRate,
    inflows: { sales: 0, breakdown: {} },
    outflows: {
      land: 0,
      construction: 0,
      constructionByCategory: {},
      otherExpenses: 0,
      otherExpensesByType: {},
      total: 0,
    },
    netCashflow: 0,
    accumulatedCashflow: 0,
  };
}

/* ─── Distribución de costos de tierra ─────────────────────────────── */

function distributeLandCost(
  land: LandCost,
  cashflow: CashflowPeriod[],
  reportingCurrency: ScenarioInput["model"]["reportingCurrency"],
): void {
  const horizon = cashflow.length;

  if (land.paymentStructure === "lump_sum") {
    const t = clampPeriod(land.paymentStartPeriod, horizon);
    if (t === -1) return;
    const cv = convertToReporting(land.totalAmount, land.currency, reportingCurrency, cashflow[t].fxRate);
    cashflow[t].outflows.land += cv;
    return;
  }

  // installments
  const count = land.installmentsCount ?? 1;
  const freq = land.installmentFrequencyPeriods ?? 1;
  if (count <= 0 || freq <= 0) return;
  const perInstallment = land.totalAmount / count;
  for (let i = 0; i < count; i++) {
    const t = clampPeriod(land.paymentStartPeriod + i * freq, horizon);
    if (t === -1) continue;
    const cv = convertToReporting(perInstallment, land.currency, reportingCurrency, cashflow[t].fxRate);
    cashflow[t].outflows.land += cv;
  }
}

/* ─── Distribución de costos de construcción ───────────────────────── */

function distributeConstructionCost(
  cat: ConstructionCategory,
  cashflow: CashflowPeriod[],
  reportingCurrency: ScenarioInput["model"]["reportingCurrency"],
): void {
  const horizon = cashflow.length;
  const dist = generateDistribution(cat.distributionCurve, cat.durationPeriods, cat.customDistribution);

  for (let i = 0; i < cat.durationPeriods; i++) {
    const t = clampPeriod(cat.startPeriod + i, horizon);
    if (t === -1) continue;
    const amountInNative = cat.totalAmount * dist[i];
    const cv = convertToReporting(amountInNative, cat.currency, reportingCurrency, cashflow[t].fxRate);
    cashflow[t].outflows.construction += cv;
    cashflow[t].outflows.constructionByCategory[cat.categoryName] =
      (cashflow[t].outflows.constructionByCategory[cat.categoryName] ?? 0) + cv;
  }
}

/* ─── Distribución de ingresos por ventas ──────────────────────────── */

function distributeSales(
  units: ScenarioInput["units"],
  cashflow: CashflowPeriod[],
  reportingCurrency: ScenarioInput["model"]["reportingCurrency"],
): void {
  const horizon = cashflow.length;

  for (const unit of units) {
    const phases = unit.salesPhases ?? [];
    for (const phase of phases) {
      // Distribuir las ventas uniformemente entre salePeriodStart y salePeriodEnd
      const span = phase.salePeriodEnd - phase.salePeriodStart + 1;
      const unitsPerPeriod = phase.unitsToSell / span;
      const breakdownKey = `${unit.unitName} / ${phase.phaseName}`;

      for (let saleP = phase.salePeriodStart; saleP <= phase.salePeriodEnd; saleP++) {
        const tSale = clampPeriod(saleP, horizon);
        if (tSale === -1) continue;

        const totalSaleAmount = unitsPerPeriod * phase.pricePerUnit;

        // Anticipo en período tSale
        const downAmount = totalSaleAmount * phase.downPaymentPct;
        if (downAmount > 0) {
          const cv = convertToReporting(downAmount, phase.currency, reportingCurrency, cashflow[tSale].fxRate);
          cashflow[tSale].inflows.sales += cv;
          cashflow[tSale].inflows.breakdown[breakdownKey] =
            (cashflow[tSale].inflows.breakdown[breakdownKey] ?? 0) + cv;
        }

        // Cuotas: dividir installmentsPct en N cuotas iguales en períodos tSale+1..tSale+N
        const totalInstallments = totalSaleAmount * phase.installmentsPct;
        if (phase.installmentsCount > 0 && totalInstallments > 0) {
          const perInstallment = totalInstallments / phase.installmentsCount;
          for (let i = 1; i <= phase.installmentsCount; i++) {
            const tCuota = clampPeriod(saleP + i, horizon);
            if (tCuota === -1) continue;
            const cv = convertToReporting(perInstallment, phase.currency, reportingCurrency, cashflow[tCuota].fxRate);
            cashflow[tCuota].inflows.sales += cv;
            cashflow[tCuota].inflows.breakdown[breakdownKey] =
              (cashflow[tCuota].inflows.breakdown[breakdownKey] ?? 0) + cv;
          }
        }

        // Saldo final: en finalPaymentPeriod si está definido, si no en tSale + installmentsCount + 1
        const finalAmount = totalSaleAmount * phase.finalPaymentPct;
        if (finalAmount > 0) {
          const tFinal = clampPeriod(
            phase.finalPaymentPeriod ?? saleP + phase.installmentsCount + 1,
            horizon,
          );
          if (tFinal !== -1) {
            const cv = convertToReporting(finalAmount, phase.currency, reportingCurrency, cashflow[tFinal].fxRate);
            cashflow[tFinal].inflows.sales += cv;
            cashflow[tFinal].inflows.breakdown[breakdownKey] =
              (cashflow[tFinal].inflows.breakdown[breakdownKey] ?? 0) + cv;
          }
        }
      }
    }
  }
}

/* ─── Otros gastos ──────────────────────────────────────────────────── */

/** Calcula el monto base "raw" del gasto antes del timing. */
function computeBaseAmount(
  expense: OtherExpense,
  totals: { construction: number; sales: number; land: number },
): number {
  switch (expense.calculationBasis) {
    case "fixed_amount":
      return expense.fixedAmount ?? 0;
    case "pct_of_construction":
      return (expense.percentage ?? 0) * totals.construction;
    case "pct_of_sales":
      return (expense.percentage ?? 0) * totals.sales;
    case "pct_of_land":
      return (expense.percentage ?? 0) * totals.land;
  }
}

function distributeOtherExpense(
  expense: OtherExpense,
  cashflow: CashflowPeriod[],
  reportingCurrency: ScenarioInput["model"]["reportingCurrency"],
  totalsForBasis: { construction: number; sales: number; land: number },
): void {
  const horizon = cashflow.length;
  const baseAmount = computeBaseAmount(expense, totalsForBasis);
  if (baseAmount <= 0) return;

  // Si fixed_amount tiene currency, usamos esa; si es %, usamos reporting
  // (los totales ya están en reporting currency). Para simplicidad,
  // tratamos el monto base como ya en reporting cuando es %. Para
  // fixed_amount con currency, convertimos por período.
  const isPct = expense.calculationBasis !== "fixed_amount";
  const nativeCurrency = isPct ? reportingCurrency : (expense.currency ?? reportingCurrency);

  const allocate = (period: number, amt: number) => {
    const t = clampPeriod(period, horizon);
    if (t === -1) return;
    const cv = convertToReporting(amt, nativeCurrency, reportingCurrency, cashflow[t].fxRate);
    cashflow[t].outflows.otherExpenses += cv;
    cashflow[t].outflows.otherExpensesByType[expense.expenseType] =
      (cashflow[t].outflows.otherExpensesByType[expense.expenseType] ?? 0) + cv;
  };

  switch (expense.timingType) {
    case "one_time": {
      allocate(expense.periodStart ?? 0, baseAmount);
      return;
    }
    case "recurring": {
      const start = expense.periodStart ?? 0;
      const end = expense.periodEnd ?? horizon - 1;
      const freq = expense.recurrencePeriods ?? 1;
      if (freq <= 0) return;
      // recurring: cargar el monto baseAmount cada `freq` períodos (no dividido)
      // Esto asume que el "fixed_amount" ya es por ocurrencia. Si es %, no es
      // común con recurring (el usuario probablemente quería distributed).
      for (let p = start; p <= end; p += freq) {
        allocate(p, baseAmount);
      }
      return;
    }
    case "distributed": {
      const start = expense.periodStart ?? 0;
      const end = expense.periodEnd ?? horizon - 1;
      const span = end - start + 1;
      if (span <= 0) return;
      const perPeriod = baseAmount / span;
      for (let p = start; p <= end; p++) allocate(p, perPeriod);
      return;
    }
    case "on_event": {
      // Comisión de venta y similares: distribuir proporcional al ingreso
      // del período (el evento es la "venta" / cobro).
      // Total de ingresos que ya están cargados:
      const totalIncome = cashflow.reduce((a, c) => a + c.inflows.sales, 0);
      if (totalIncome <= 0) return;
      for (let p = 0; p < horizon; p++) {
        const share = cashflow[p].inflows.sales / totalIncome;
        if (share > 0) allocate(p, baseAmount * share);
      }
      return;
    }
  }
}

/* ─── Util ─────────────────────────────────────────────────────────── */

function clampPeriod(t: number, horizon: number): number {
  if (t < 0 || t >= horizon || !Number.isFinite(t)) return -1;
  return Math.floor(t);
}

/* ─── API pública ──────────────────────────────────────────────────── */

/**
 * Calcula el flujo de caja completo del escenario.
 *
 * Paso 4 (ingresos) se calcula ANTES que paso 5 (otros gastos) porque
 * algunos gastos `on_event=sale` necesitan los ingresos ya distribuidos
 * para calcular su prorrateo.
 */
export function calculateCashflow(input: ScenarioInput): CashflowPeriod[] {
  const { model, land, construction, otherExpenses, units } = input;

  // Paso 1: Timeline + TC por período
  const cashflow: CashflowPeriod[] = [];
  for (let t = 0; t < model.horizonPeriods; t++) {
    const date = addPeriods(model.startDate, t, model.granularity);
    const fxRate = fxRateAt(model.baseExchangeRate ?? 0, model.annualDevaluation, t, model.granularity);
    cashflow.push(emptyPeriod(t, date, fxRate));
  }

  // Paso 2: Tierra
  for (const l of land) distributeLandCost(l, cashflow, model.reportingCurrency);

  // Paso 3: Construcción
  for (const c of construction) distributeConstructionCost(c, cashflow, model.reportingCurrency);

  // Paso 4: Ventas (necesario antes de otros gastos on_event)
  distributeSales(units, cashflow, model.reportingCurrency);

  // Paso 5: Otros gastos (totales para los % se computan en reporting currency,
  // sumando lo distribuido hasta acá)
  const totalLand = cashflow.reduce((a, c) => a + c.outflows.land, 0);
  const totalConstr = cashflow.reduce((a, c) => a + c.outflows.construction, 0);
  const totalSales = cashflow.reduce((a, c) => a + c.inflows.sales, 0);
  for (const e of otherExpenses) {
    distributeOtherExpense(e, cashflow, model.reportingCurrency, {
      construction: totalConstr,
      sales: totalSales,
      land: totalLand,
    });
  }

  // Paso 6: Consolidar totales por período + acumulado
  let accumulated = 0;
  for (const p of cashflow) {
    p.outflows.total = p.outflows.land + p.outflows.construction + p.outflows.otherExpenses;
    p.netCashflow = p.inflows.sales - p.outflows.total;
    accumulated += p.netCashflow;
    p.accumulatedCashflow = accumulated;
  }

  return cashflow;
}

/** Re-export para uso interno del módulo (tests, KPIs). */
export { periodsPerYear };
