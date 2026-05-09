/**
 * Formateadores de moneda, % y fechas para el módulo Modelo de Negocio.
 *
 * Usamos siempre locale "es" (separador de miles = punto, decimal = coma)
 * — coherente con la convención del resto del proyecto. Los montos en PYG
 * y GTQ se muestran sin decimales; USD con 0 o 2 decimales según context.
 */

import type { Currency, Granularity } from "./types";

const LOCALE = "es-AR";

/** Formato monetario con símbolo de moneda al frente. */
export function formatMoney(amount: number, currency: Currency, fractionDigits?: number): string {
  const fd = fractionDigits ?? (currency === "USD" ? 0 : 0);
  return `${currency} ${new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: fd,
    maximumFractionDigits: fd,
  }).format(amount)}`;
}

/** Formato sin símbolo (para celdas de tabla donde el header ya indica moneda). */
export function formatNumber(amount: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}

/** Decimal a porcentaje display (0.058 → "5,8%"). */
export function formatPct(decimal: number, fractionDigits = 1): string {
  if (Number.isNaN(decimal)) return "—";
  return `${(decimal * 100).toLocaleString(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`;
}

/** Date ISO YYYY-MM-DD → "Jun 2026" (mes corto + año). */
export function formatPeriodDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.toLocaleString(LOCALE, { month: "short", timeZone: "UTC" });
  const year = d.getUTCFullYear();
  return `${month.charAt(0).toUpperCase() + month.slice(1)} ${year}`;
}

/** Etiqueta corta del período (#0, #1, ...) o "Mes 0", "Q1", etc. */
export function formatPeriodLabel(period: number, granularity: Granularity): string {
  return granularity === "monthly" ? `Mes ${period}` : `Q${period + 1}`;
}

/** Etiqueta de horizonte para mostrar al usuario en la config. */
export function formatHorizonLabel(periods: number, granularity: Granularity): string {
  if (granularity === "monthly") {
    const years = (periods / 12).toFixed(1);
    return `${periods} meses (≈ ${years} años)`;
  }
  const years = (periods / 4).toFixed(1);
  return `${periods} trimestres (≈ ${years} años)`;
}
