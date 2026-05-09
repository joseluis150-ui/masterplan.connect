/**
 * Paleta y estilos reutilizables del Excel generado.
 *
 * Colors: verde MPA #217346 para headers de bloque (paleta corporativa);
 * neutros (#F1F5F9, #FFFFFF) para fondos. Numbers en tabular-nums.
 */

import type { Style } from "exceljs";

export const COLOR_MPA_GREEN = "FF217346";
export const COLOR_MPA_GREEN_LIGHT = "FFD6EAE0";
export const COLOR_HEADER_TEXT = "FFFFFFFF";
export const COLOR_BORDER = "FFE5E7EB";
export const COLOR_GRID = "FFF1F5F9";

/** Estilo de header de bloque (verde MPA, texto blanco, bold). */
export const blockHeaderStyle: Partial<Style> = {
  font: { bold: true, color: { argb: COLOR_HEADER_TEXT }, size: 11 },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_MPA_GREEN } },
  alignment: { vertical: "middle", horizontal: "left" },
  border: {
    top: { style: "thin", color: { argb: COLOR_MPA_GREEN } },
    bottom: { style: "thin", color: { argb: COLOR_MPA_GREEN } },
    left: { style: "thin", color: { argb: COLOR_MPA_GREEN } },
    right: { style: "thin", color: { argb: COLOR_MPA_GREEN } },
  },
};

/** Estilo de fila de header de tabla (verde claro, texto oscuro). */
export const tableHeaderStyle: Partial<Style> = {
  font: { bold: true, color: { argb: "FF0A0A0A" }, size: 10 },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_MPA_GREEN_LIGHT } },
  alignment: { vertical: "middle", horizontal: "center" },
  border: {
    bottom: { style: "thin", color: { argb: COLOR_MPA_GREEN } },
  },
};

/** Estilo numérico USD (sin decimales). */
export const usdStyle: Partial<Style> = {
  numFmt: '"USD" #,##0',
  alignment: { horizontal: "right" },
};

/** Estilo numérico genérico con separador de miles. */
export const numberStyle: Partial<Style> = {
  numFmt: "#,##0",
  alignment: { horizontal: "right" },
};

/** Estilo porcentaje. */
export const pctStyle: Partial<Style> = {
  numFmt: "0.00%",
  alignment: { horizontal: "right" },
};

/** Estilo fila de totales (negrita + fondo gris). */
export const totalRowStyle: Partial<Style> = {
  font: { bold: true },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } },
  border: {
    top: { style: "double", color: { argb: COLOR_MPA_GREEN } },
  },
};
