/**
 * Cálculo de indicadores financieros (KPIs) del modelo de negocio.
 *
 * Implementa §7 de la spec. Función pura: toma el cashflow ya calculado
 * (por calculateCashflow) + los inputs originales para break-even, y
 * devuelve un objeto Kpis.
 */

import type { CashflowPeriod, Kpis, ScenarioInput } from "../types";
import { periodsPerYear } from "./cashflow";

/* ─── IRR (Newton-Raphson) ────────────────────────────────────────── */

/**
 * Calcula la TIR (rate por período) usando Newton-Raphson.
 *
 * @param cashflows  Array de flujos por período (signo: negativos egresos,
 *                   positivos ingresos). El período 0 generalmente es
 *                   negativo (inversión inicial).
 * @param guess      Estimación inicial (default 0.1)
 * @returns Tasa por período (decimal). NaN si no converge.
 */
export function calculateIRR(cashflows: number[], guess = 0.1): number {
  if (cashflows.length < 2) return NaN;
  // Sanity: debe haber al menos un signo cambiado (si todos son del mismo
  // signo, la TIR no existe)
  const hasPositive = cashflows.some((v) => v > 0);
  const hasNegative = cashflows.some((v) => v < 0);
  if (!hasPositive || !hasNegative) return NaN;

  const maxIterations = 100;
  const tolerance = 1e-7;
  let rate = guess;

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const denom = Math.pow(1 + rate, t);
      npv += cashflows[t] / denom;
      if (t > 0) dnpv -= (t * cashflows[t]) / Math.pow(1 + rate, t + 1);
    }
    if (Math.abs(npv) < tolerance) return rate;
    if (dnpv === 0) break;
    const newRate = rate - npv / dnpv;
    // Clamp: evitar divergencia hacia -1
    rate = newRate < -0.99 ? -0.99 : newRate;
  }
  return NaN;
}

/* ─── NPV (Valor Actual Neto) ─────────────────────────────────────── */

export function calculateNPV(cashflows: number[], discountRatePerPeriod: number): number {
  let npv = 0;
  for (let t = 0; t < cashflows.length; t++) {
    npv += cashflows[t] / Math.pow(1 + discountRatePerPeriod, t);
  }
  return npv;
}

/* ─── Payback ─────────────────────────────────────────────────────── */

/** Primer período donde el acumulado >= 0. -1 si nunca. */
function findPaybackPeriod(cashflow: CashflowPeriod[]): number {
  for (let i = 0; i < cashflow.length; i++) {
    if (cashflow[i].accumulatedCashflow >= 0) return i;
  }
  return -1;
}

/** Primer período donde inflows acumulados >= outflows acumulados. */
function findBreakEvenPeriod(cashflow: CashflowPeriod[]): number {
  let cumIn = 0;
  let cumOut = 0;
  for (let i = 0; i < cashflow.length; i++) {
    cumIn += cashflow[i].inflows.sales;
    cumOut += cashflow[i].outflows.total;
    if (cumIn >= cumOut && cumOut > 0) return i;
  }
  return -1;
}

/* ─── Break-even en unidades ──────────────────────────────────────── */

/** Costo total / precio promedio ponderado por unidad. */
function calculateBreakEvenUnits(input: ScenarioInput, totalCosts: number): number {
  let totalUnits = 0;
  let totalRevenuePotential = 0;
  for (const u of input.units) {
    for (const phase of u.salesPhases ?? []) {
      totalUnits += phase.unitsToSell;
      totalRevenuePotential += phase.unitsToSell * phase.pricePerUnit;
    }
  }
  if (totalUnits === 0 || totalRevenuePotential === 0) return 0;
  const avgPricePerUnit = totalRevenuePotential / totalUnits;
  return totalCosts / avgPricePerUnit;
}

/* ─── API pública ─────────────────────────────────────────────────── */

/**
 * Calcula los KPIs del escenario.
 *
 * @param cashflow  Flujo de caja ya calculado (por calculateCashflow)
 * @param input     Inputs del escenario (necesario para break-even units)
 */
export function calculateKpis(
  cashflow: CashflowPeriod[],
  input: ScenarioInput,
): Kpis {
  const ppy = periodsPerYear(input.model.granularity);
  const discountRate = input.model.discountRate;
  const discountPerPeriod = discountRate / ppy;

  // Totales
  const totalRevenue = cashflow.reduce((a, c) => a + c.inflows.sales, 0);
  const totalLand = cashflow.reduce((a, c) => a + c.outflows.land, 0);
  const totalConstruction = cashflow.reduce((a, c) => a + c.outflows.construction, 0);
  const totalOthers = cashflow.reduce((a, c) => a + c.outflows.otherExpenses, 0);
  const totalInvestment = totalLand + totalConstruction + totalOthers;

  const grossProfit = totalRevenue - (totalLand + totalConstruction);
  const netProfit = totalRevenue - totalInvestment;

  const grossMarginPct = totalRevenue !== 0 ? grossProfit / totalRevenue : 0;
  const netMarginPct = totalRevenue !== 0 ? netProfit / totalRevenue : 0;
  const roiPct = totalInvestment !== 0 ? netProfit / totalInvestment : 0;

  // IRR/NPV usan el array de netCashflow
  const netSeries = cashflow.map((c) => c.netCashflow);
  const irrPeriodPct = calculateIRR(netSeries);
  const irrAnnualPct = Number.isNaN(irrPeriodPct) ? NaN : Math.pow(1 + irrPeriodPct, ppy) - 1;
  const npv = calculateNPV(netSeries, discountPerPeriod);

  const paybackPeriod = findPaybackPeriod(cashflow);
  const breakEvenPeriod = findBreakEvenPeriod(cashflow);
  const breakEvenUnits = calculateBreakEvenUnits(input, totalInvestment);

  return {
    totalInvestment,
    totalRevenue,
    grossProfit,
    netProfit,
    grossMarginPct,
    netMarginPct,
    roiPct,
    irrPeriodPct,
    irrAnnualPct,
    npv,
    discountRateUsed: discountRate,
    paybackPeriod,
    breakEvenUnits,
    breakEvenPeriod,
  };
}
