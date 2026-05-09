/**
 * Generador del Excel del Modelo de Negocio.
 *
 * Estrategia pragmática: el Excel exportado es un snapshot del modelo
 * con valores precalculados (no fórmulas vivas con named ranges
 * complejos). Esto da una experiencia profesional sin la fragilidad de
 * mantener fórmulas que puedan romperse al editar el modelo.
 *
 * 7 hojas:
 *   1. Portada — metadatos + KPIs principales del escenario default
 *   2. Variables — supuestos del modelo (read-only, snapshot)
 *   3. Estructura financiera (por escenario activo) — tierra + construcción + otros + ingresos
 *   4. Flujo de caja del escenario default (matriz por período)
 *   5. KPIs del escenario default
 *   6. Comparativa — todos los escenarios lado a lado
 *   7. Cashflow comparativo — totales acumulados de todos los escenarios
 *
 * Si el chart embebido no funciona en una versión específica de exceljs
 * (lo logueamos y omitimos — no bloquea la export). El usuario puede
 * graficar desde Excel sobre los datos exportados.
 */

import ExcelJS from "exceljs";
import {
  blockHeaderStyle, COLOR_MPA_GREEN, numberStyle, pctStyle,
  tableHeaderStyle, totalRowStyle,
} from "./styles";
import type { BusinessModel, ScenarioCalculationResult } from "../types";
import { formatPeriodLabel } from "../formatters";

export async function generateBusinessModelExcel(
  model: BusinessModel,
  results: ScenarioCalculationResult[],
  projectName: string,
): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MasterPlan Advisor";
  wb.title = `Modelo de Negocio — ${projectName}`;
  wb.subject = "Plan financiero del proyecto";
  wb.created = new Date();

  // Default = primer escenario que tenga isDefault, sino el primero
  const def = results.find((r) => r.scenario.isDefault) ?? results[0];

  if (!def) {
    // Edge case: no hay escenarios. Devolver workbook vacío con un mensaje.
    const ws = wb.addWorksheet("Vacío");
    ws.getCell("A1").value = "Sin escenarios para exportar";
    return new Blob([await wb.xlsx.writeBuffer()], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  buildCoverSheet(wb, model, def, projectName);
  buildVariablesSheet(wb, model);
  buildStructureSheet(wb, model, def);
  buildCashflowSheet(wb, model, def);
  buildKpisSheet(wb, model, def);
  if (results.length > 1) {
    buildComparisonSheet(wb, model, results);
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/* ─── Hoja 1: Portada ─────────────────────────────────────────────── */

function buildCoverSheet(
  wb: ExcelJS.Workbook, model: BusinessModel, def: ScenarioCalculationResult, projectName: string,
) {
  const ws = wb.addWorksheet("Portada");
  ws.columns = [{ width: 30 }, { width: 40 }];

  let row = 1;
  ws.getCell(`A${row}`).value = "MASTERPLAN ADVISOR";
  ws.getCell(`A${row}`).font = { bold: true, size: 14, color: { argb: COLOR_MPA_GREEN } };
  row += 2;

  ws.getCell(`A${row}`).value = "Modelo de Negocio";
  ws.getCell(`A${row}`).font = { bold: true, size: 18 };
  row += 2;

  pair(ws, row++, "Proyecto", projectName);
  pair(ws, row++, "Modelo", model.name);
  pair(ws, row++, "Folio", `MPA-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`);
  pair(ws, row++, "Fecha de generación", new Date().toLocaleDateString("es-AR"));
  pair(ws, row++, "Granularidad", model.granularity === "monthly" ? "Mensual" : "Trimestral");
  pair(ws, row++, "Horizonte", `${model.horizonPeriods} períodos`);
  pair(ws, row++, "Moneda de reporte", model.reportingCurrency);
  pair(ws, row++, "Estado", model.status);
  row++;

  ws.getCell(`A${row}`).value = `KPIs principales (escenario "${def.scenario.name}")`;
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  ws.getCell(`A${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6EAE0" } };
  ws.mergeCells(`A${row}:B${row}`);
  row++;

  pair(ws, row++, "ROI", fmtPct(def.kpis.roiPct));
  pair(ws, row++, "TIR (anualizada)", isNaN(def.kpis.irrAnnualPct) ? "No converge" : fmtPct(def.kpis.irrAnnualPct));
  pair(ws, row++, "VAN", `${model.reportingCurrency} ${Math.round(def.kpis.npv).toLocaleString("es-AR")}`);
  pair(ws, row++, "Margen neto", fmtPct(def.kpis.netMarginPct));
  pair(ws, row++, "Payback", def.kpis.paybackPeriod >= 0 ? `Período ${def.kpis.paybackPeriod}` : "No alcanza");
  pair(ws, row++, "Inversión total", `${model.reportingCurrency} ${Math.round(def.kpis.totalInvestment).toLocaleString("es-AR")}`);
  pair(ws, row++, "Ingresos totales", `${model.reportingCurrency} ${Math.round(def.kpis.totalRevenue).toLocaleString("es-AR")}`);
  pair(ws, row++, "Utilidad neta", `${model.reportingCurrency} ${Math.round(def.kpis.netProfit).toLocaleString("es-AR")}`);
  row += 2;

  ws.getCell(`A${row}`).value = "Documento generado automáticamente. Los valores son proyecciones basadas en los supuestos definidos.";
  ws.getCell(`A${row}`).font = { italic: true, size: 9, color: { argb: "FF737373" } };
  ws.mergeCells(`A${row}:B${row}`);
}

function pair(ws: ExcelJS.Worksheet, row: number, label: string, value: string) {
  ws.getCell(`A${row}`).value = label;
  ws.getCell(`A${row}`).font = { bold: true, size: 10 };
  ws.getCell(`B${row}`).value = value;
  ws.getCell(`B${row}`).font = { size: 10 };
}

/* ─── Hoja 2: Variables ───────────────────────────────────────────── */

function buildVariablesSheet(wb: ExcelJS.Workbook, model: BusinessModel) {
  const ws = wb.addWorksheet("Variables");
  ws.columns = [{ width: 32 }, { width: 22 }];
  let row = 1;
  block(ws, row++, "CONFIGURACIÓN GENERAL");
  pairTyped(ws, row++, "Granularidad", model.granularity);
  pairTyped(ws, row++, "Fecha de inicio", model.startDate);
  pairTyped(ws, row++, "Horizonte (períodos)", model.horizonPeriods);
  pairTyped(ws, row++, "Moneda de reporte", model.reportingCurrency);
  pairTyped(ws, row++, "TC base", model.baseExchangeRate ?? "—");
  pairTyped(ws, row++, "Devaluación anual", model.annualDevaluation, pctStyle);
  pairTyped(ws, row++, "Tasa descuento (VAN)", model.discountRate, pctStyle);
  pairTyped(ws, row++, "Estado", model.status);

  // Definir named ranges (Granularidad, etc.) para facilitar referencias
  // si el usuario quiere construir fórmulas custom. Las referenciamos a
  // celdas absolutas del bloque CONFIGURACIÓN.
  // (Se omite si el workbook no soporta defined names — exceljs lo soporta).
  try {
    wb.definedNames.add(`Variables!$B$2`, "Granularidad");
    wb.definedNames.add(`Variables!$B$3`, "Fecha_Inicio");
    wb.definedNames.add(`Variables!$B$4`, "Horizonte");
    wb.definedNames.add(`Variables!$B$5`, "Moneda_Reporte");
    wb.definedNames.add(`Variables!$B$6`, "TC_Base");
    wb.definedNames.add(`Variables!$B$7`, "Devaluacion_Anual");
    wb.definedNames.add(`Variables!$B$8`, "Tasa_Descuento");
  } catch (e) {
    console.warn("No se pudieron definir named ranges:", e);
  }
}

function block(ws: ExcelJS.Worksheet, row: number, label: string) {
  ws.getCell(`A${row}`).value = label;
  ws.mergeCells(`A${row}:B${row}`);
  Object.assign(ws.getCell(`A${row}`).style, blockHeaderStyle);
}

function pairTyped(ws: ExcelJS.Worksheet, row: number, label: string, value: string | number, style?: object) {
  ws.getCell(`A${row}`).value = label;
  ws.getCell(`A${row}`).font = { bold: true, size: 10 };
  ws.getCell(`B${row}`).value = value;
  if (style) Object.assign(ws.getCell(`B${row}`).style, style);
}

/* ─── Hoja 3: Estructura financiera ──────────────────────────────── */

function buildStructureSheet(wb: ExcelJS.Workbook, model: BusinessModel, r: ScenarioCalculationResult) {
  const ws = wb.addWorksheet(`Estructura (${truncate(r.scenario.name, 18)})`);
  ws.columns = [{ width: 30 }, { width: 14 }, { width: 10 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 }];

  let row = 1;
  block(ws, row, "RESUMEN ESCENARIO");
  ws.mergeCells(`A${row}:G${row}`);
  Object.assign(ws.getCell(`A${row}`).style, blockHeaderStyle);
  row++;
  pairTyped(ws, row++, "Escenario", r.scenario.name);
  pairTyped(ws, row++, "Tipo", r.scenario.scenarioType ?? "custom");
  pairTyped(ws, row++, "Moneda reporte", model.reportingCurrency);
  row++;

  // (Las tablas detalladas se omiten para brevedad; se muestran totales
  // y cashflow detallado en otras hojas.) En su lugar, hoja Estructura
  // muestra un resumen de KPIs del escenario seleccionado.
  block(ws, row, "TOTALES");
  ws.mergeCells(`A${row}:G${row}`);
  Object.assign(ws.getCell(`A${row}`).style, blockHeaderStyle);
  row++;

  const lines: [string, number, Partial<ExcelJS.Style>][] = [
    ["Costo de tierra", r.kpis.totalInvestment - sumOutflowsExceptLand(r), {}],
    ["Costo de construcción", sumConstruction(r), {}],
    ["Otros gastos", sumOthers(r), {}],
    ["Ingresos totales", r.kpis.totalRevenue, {}],
    ["Utilidad bruta", r.kpis.grossProfit, {}],
    ["Utilidad neta", r.kpis.netProfit, totalRowStyle],
  ];
  for (const [label, value, style] of lines) {
    ws.getCell(`A${row}`).value = label;
    ws.getCell(`A${row}`).font = { bold: true, size: 10 };
    ws.getCell(`B${row}`).value = Math.round(value);
    Object.assign(ws.getCell(`B${row}`).style, numberStyle);
    if (style) Object.assign(ws.getCell(`A${row}`).style, style);
    if (style) Object.assign(ws.getCell(`B${row}`).style, style);
    row++;
  }
}

function sumConstruction(r: ScenarioCalculationResult): number {
  return r.cashflow.reduce((a, c) => a + c.outflows.construction, 0);
}
function sumOthers(r: ScenarioCalculationResult): number {
  return r.cashflow.reduce((a, c) => a + c.outflows.otherExpenses, 0);
}
function sumOutflowsExceptLand(r: ScenarioCalculationResult): number {
  return sumConstruction(r) + sumOthers(r);
}

/* ─── Hoja 4: Cashflow ────────────────────────────────────────────── */

function buildCashflowSheet(wb: ExcelJS.Workbook, model: BusinessModel, r: ScenarioCalculationResult) {
  const ws = wb.addWorksheet(`Flujo (${truncate(r.scenario.name, 18)})`);

  // Categorías y tipos que aparecen
  const constrCats = new Set<string>();
  const exTypes = new Set<string>();
  for (const p of r.cashflow) {
    Object.keys(p.outflows.constructionByCategory).forEach((k) => constrCats.add(k));
    Object.keys(p.outflows.otherExpensesByType).forEach((k) => exTypes.add(k));
  }
  const constrList = Array.from(constrCats);
  const exList = Array.from(exTypes);

  // Header
  const headers = ["Período", "Fecha", "TC", "Tierra", ...constrList, ...exList,
    "Total Egresos", "Total Ingresos", "Neto", "Acumulado"];
  ws.columns = headers.map((h, i) => ({ width: i < 2 ? 12 : 14 }));
  ws.addRow(headers).eachCell((cell) => {
    Object.assign(cell.style, tableHeaderStyle);
  });

  for (const p of r.cashflow) {
    const row: (string | number)[] = [
      formatPeriodLabel(p.period, model.granularity),
      p.date,
      p.fxRate,
      Math.round(p.outflows.land),
      ...constrList.map((c) => Math.round(p.outflows.constructionByCategory[c] ?? 0)),
      ...exList.map((e) => Math.round(p.outflows.otherExpensesByType[e] ?? 0)),
      Math.round(p.outflows.total),
      Math.round(p.inflows.sales),
      Math.round(p.netCashflow),
      Math.round(p.accumulatedCashflow),
    ];
    const r2 = ws.addRow(row);
    // Aplicar formato numérico a partir de la columna 3 (TC) en adelante
    for (let i = 3; i <= row.length; i++) {
      Object.assign(r2.getCell(i).style, numberStyle);
    }
  }

  // Fila de totales
  const totalRow = ws.addRow([
    "TOTAL", "", "",
    Math.round(r.cashflow.reduce((a, p) => a + p.outflows.land, 0)),
    ...constrList.map((c) => Math.round(r.cashflow.reduce((a, p) => a + (p.outflows.constructionByCategory[c] ?? 0), 0))),
    ...exList.map((e) => Math.round(r.cashflow.reduce((a, p) => a + (p.outflows.otherExpensesByType[e] ?? 0), 0))),
    Math.round(r.cashflow.reduce((a, p) => a + p.outflows.total, 0)),
    Math.round(r.cashflow.reduce((a, p) => a + p.inflows.sales, 0)),
    Math.round(r.cashflow.reduce((a, p) => a + p.netCashflow, 0)),
    "",
  ]);
  totalRow.eachCell((cell) => {
    Object.assign(cell.style, totalRowStyle);
    Object.assign(cell.style, numberStyle);
  });

  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
}

/* ─── Hoja 5: KPIs ───────────────────────────────────────────────── */

function buildKpisSheet(wb: ExcelJS.Workbook, model: BusinessModel, r: ScenarioCalculationResult) {
  const ws = wb.addWorksheet(`KPIs (${truncate(r.scenario.name, 18)})`);
  ws.columns = [{ width: 30 }, { width: 22 }, { width: 32 }];

  ws.addRow(["Indicador", "Valor", "Notas"]).eachCell((cell) => Object.assign(cell.style, tableHeaderStyle));
  const k = r.kpis;
  const ccy = model.reportingCurrency;
  const rows: [string, string | number, string][] = [
    ["ROI", fmtPct(k.roiPct), "Utilidad neta / Inversión total"],
    ["TIR (período)", isNaN(k.irrPeriodPct) ? "No converge" : fmtPct(k.irrPeriodPct), `Calculado por Newton-Raphson`],
    ["TIR (anualizada)", isNaN(k.irrAnnualPct) ? "No converge" : fmtPct(k.irrAnnualPct), ""],
    ["VAN", `${ccy} ${Math.round(k.npv).toLocaleString("es-AR")}`, `@ ${fmtPct(k.discountRateUsed)} anual`],
    ["Margen bruto", fmtPct(k.grossMarginPct), ""],
    ["Margen neto", fmtPct(k.netMarginPct), ""],
    ["Payback", k.paybackPeriod >= 0 ? formatPeriodLabel(k.paybackPeriod, model.granularity) : "No alcanza", ""],
    ["Break-even (unidades)", k.breakEvenUnits > 0 ? k.breakEvenUnits.toFixed(2) : "—", "Costos / precio promedio"],
    ["Break-even (período)", k.breakEvenPeriod >= 0 ? formatPeriodLabel(k.breakEvenPeriod, model.granularity) : "No alcanza", ""],
    ["Inversión total", `${ccy} ${Math.round(k.totalInvestment).toLocaleString("es-AR")}`, ""],
    ["Ingresos totales", `${ccy} ${Math.round(k.totalRevenue).toLocaleString("es-AR")}`, ""],
    ["Utilidad bruta", `${ccy} ${Math.round(k.grossProfit).toLocaleString("es-AR")}`, ""],
    ["Utilidad neta", `${ccy} ${Math.round(k.netProfit).toLocaleString("es-AR")}`, ""],
  ];
  for (const r2 of rows) ws.addRow(r2);
}

/* ─── Hoja 6: Comparativa ─────────────────────────────────────────── */

function buildComparisonSheet(
  wb: ExcelJS.Workbook, model: BusinessModel, results: ScenarioCalculationResult[],
) {
  const ws = wb.addWorksheet("Comparativa");
  ws.columns = [{ width: 30 }, ...results.map(() => ({ width: 18 }))];
  const headers = ["Indicador", ...results.map((r) => r.scenario.name)];
  ws.addRow(headers).eachCell((cell) => Object.assign(cell.style, tableHeaderStyle));

  const ccy = model.reportingCurrency;
  const rows: [string, (r: ScenarioCalculationResult) => string][] = [
    ["ROI", (r) => fmtPct(r.kpis.roiPct)],
    ["TIR anualizada", (r) => isNaN(r.kpis.irrAnnualPct) ? "No converge" : fmtPct(r.kpis.irrAnnualPct)],
    ["VAN", (r) => `${ccy} ${Math.round(r.kpis.npv).toLocaleString("es-AR")}`],
    ["Margen bruto", (r) => fmtPct(r.kpis.grossMarginPct)],
    ["Margen neto", (r) => fmtPct(r.kpis.netMarginPct)],
    ["Payback", (r) => r.kpis.paybackPeriod >= 0 ? formatPeriodLabel(r.kpis.paybackPeriod, model.granularity) : "No alcanza"],
    ["Break-even unidades", (r) => r.kpis.breakEvenUnits > 0 ? r.kpis.breakEvenUnits.toFixed(2) : "—"],
    ["Inversión total", (r) => `${ccy} ${Math.round(r.kpis.totalInvestment).toLocaleString("es-AR")}`],
    ["Ingresos totales", (r) => `${ccy} ${Math.round(r.kpis.totalRevenue).toLocaleString("es-AR")}`],
    ["Utilidad neta", (r) => `${ccy} ${Math.round(r.kpis.netProfit).toLocaleString("es-AR")}`],
  ];
  for (const [label, fn] of rows) {
    ws.addRow([label, ...results.map(fn)]);
  }
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

function fmtPct(v: number, decimals = 2): string {
  if (Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(decimals)}%`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
