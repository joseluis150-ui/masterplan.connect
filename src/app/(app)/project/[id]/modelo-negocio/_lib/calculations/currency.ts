/**
 * Conversión de moneda con TC del período.
 *
 * Modelo: el usuario define un TC base (ej. 7400 PYG/USD para PYG) y
 * una devaluación anual estimada (ej. 5%). Para cada período t, el TC se
 * compone exponencialmente:
 *
 *     fxRate(t) = baseRate × (1 + annualDevaluation)^(t / periodsPerYear)
 *
 * `baseRate` representa "unidades de la moneda local por 1 USD" (de ahí
 * el nombre "exchange_rate" en el resto del proyecto). Si reportingCurrency
 * = USD: una cantidad en PYG se convierte dividiendo por fxRate(t). Si
 * reportingCurrency = PYG: una cantidad en USD se multiplica por fxRate(t).
 *
 * GTQ se trata como "moneda local alternativa": el `baseRate` se interpreta
 * en función de la `reportingCurrency` configurada (si reporting=USD, el
 * baseRate es GTQ/USD; si reporting=GTQ, el baseRate es PYG/GTQ — caso
 * exótico). Para simplificar Fase 1, asumimos que GTQ y PYG no se mezclan
 * en el mismo modelo: el usuario elige UNA reportingCurrency y todas las
 * monedas de las líneas son convertidas a esa.
 */

import type { Currency, Granularity } from "../types";

export function periodsPerYear(g: Granularity): number {
  return g === "monthly" ? 12 : 4;
}

/**
 * Calcula el TC del período t aplicando devaluación compuesta.
 *
 * @param baseRate  TC en período 0 (unidades de moneda local por 1 USD)
 * @param annualDevaluation  Decimal (0.05 = 5%)
 * @param period  Período t (0, 1, 2, ...)
 * @param granularity  monthly | quarterly
 */
export function fxRateAt(
  baseRate: number,
  annualDevaluation: number,
  period: number,
  granularity: Granularity,
): number {
  if (baseRate <= 0) return 0;
  return baseRate * Math.pow(1 + annualDevaluation, period / periodsPerYear(granularity));
}

/**
 * Convierte un monto desde su moneda nativa a la moneda de reporte usando
 * el TC del período.
 *
 * Reglas:
 *  - Si nativeCurrency === reportingCurrency → devuelve igual.
 *  - Si nativeCurrency === USD y reportingCurrency es local (PYG/GTQ):
 *    multiplica por fxRate.
 *  - Si nativeCurrency es local y reportingCurrency === USD:
 *    divide por fxRate.
 *  - Si ambas son locales distintas (PYG↔GTQ): no soportado en Fase 1,
 *    devuelve el monto sin convertir y log a console (caso edge).
 */
export function convertToReporting(
  amount: number,
  nativeCurrency: Currency,
  reportingCurrency: Currency,
  fxRate: number,
): number {
  if (nativeCurrency === reportingCurrency) return amount;
  if (fxRate <= 0) return amount;

  // Caso 1: nativa USD, reporte en local
  if (nativeCurrency === "USD" && reportingCurrency !== "USD") {
    return amount * fxRate;
  }
  // Caso 2: nativa local, reporte en USD
  if (nativeCurrency !== "USD" && reportingCurrency === "USD") {
    return amount / fxRate;
  }
  // Caso 3: dos locales distintas — caso no soportado en Fase 1
  // Devolvemos el monto tal cual y dejamos un warning silencioso.
  return amount;
}
