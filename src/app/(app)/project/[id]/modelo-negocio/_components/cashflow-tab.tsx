"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber, formatPeriodDate, formatPeriodLabel } from "../_lib/formatters";
import type { BusinessModel, ScenarioCalculationResult } from "../_lib/types";

/**
 * Tab Flujo de caja: matriz periodo×categoría + chart SVG arriba.
 * Header sticky + columnas pinned (período + fecha) para scroll vertical/horizontal.
 */
export function CashflowTab({
  result, model,
}: {
  result: ScenarioCalculationResult;
  model: BusinessModel;
}) {
  const cf = result.cashflow;
  const reportingCcy = model.reportingCurrency;

  // Categorías de construcción y tipos de gastos que aparecen en el flujo
  const constrCols = useMemo(() => {
    const set = new Set<string>();
    for (const p of cf) for (const k of Object.keys(p.outflows.constructionByCategory)) set.add(k);
    return Array.from(set);
  }, [cf]);

  const expenseCols = useMemo(() => {
    const set = new Set<string>();
    for (const p of cf) for (const k of Object.keys(p.outflows.otherExpensesByType)) set.add(k);
    return Array.from(set);
  }, [cf]);

  // Totales para fila al pie
  const totals = useMemo(() => {
    const t = {
      land: 0, construction: 0, other: 0, totalOut: 0, sales: 0, net: 0,
      constrByCat: {} as Record<string, number>,
      otherByType: {} as Record<string, number>,
    };
    for (const p of cf) {
      t.land += p.outflows.land;
      t.construction += p.outflows.construction;
      t.other += p.outflows.otherExpenses;
      t.totalOut += p.outflows.total;
      t.sales += p.inflows.sales;
      t.net += p.netCashflow;
      for (const [k, v] of Object.entries(p.outflows.constructionByCategory)) t.constrByCat[k] = (t.constrByCat[k] ?? 0) + v;
      for (const [k, v] of Object.entries(p.outflows.otherExpensesByType)) t.otherByType[k] = (t.otherByType[k] ?? 0) + v;
    }
    return t;
  }, [cf]);

  return (
    <div className="p-4 space-y-3">
      {/* Chart */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Flujo neto y acumulado</CardTitle>
        </CardHeader>
        <CardContent>
          <CashflowChart cashflow={cf} reportingCurrency={reportingCcy} />
        </CardContent>
      </Card>

      {/* Matriz */}
      <Card>
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Matriz de flujo de caja</CardTitle>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-mono">
              Moneda: {reportingCcy}
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto" style={{ maxHeight: "calc(100vh - 380px)" }}>
            <table className="text-xs tabular-nums" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
              <thead className="sticky top-0 z-30 bg-background shadow-sm">
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Th sticky>Período</Th>
                  <Th>Fecha</Th>
                  <Th right>TC</Th>
                  <Th right className="border-l">Tierra</Th>
                  {constrCols.map((c) => <Th key={c} right>{c}</Th>)}
                  {expenseCols.map((e) => <Th key={e} right>{labelExpense(e)}</Th>)}
                  <Th right className="border-l font-semibold">EGRESOS</Th>
                  <Th right>INGRESOS</Th>
                  <Th right className="font-semibold">NETO</Th>
                  <Th right>ACUMULADO</Th>
                </tr>
              </thead>
              <tbody>
                {cf.map((p) => (
                  <tr key={p.period} className="border-t hover:bg-muted/30">
                    <Td sticky>{formatPeriodLabel(p.period, model.granularity)}</Td>
                    <Td>{formatPeriodDate(p.date)}</Td>
                    <Td right className="text-muted-foreground">{p.fxRate > 0 ? formatNumber(p.fxRate, 2) : "—"}</Td>
                    <Td right className="border-l">{formatOrDash(p.outflows.land)}</Td>
                    {constrCols.map((c) => <Td key={c} right>{formatOrDash(p.outflows.constructionByCategory[c] ?? 0)}</Td>)}
                    {expenseCols.map((e) => <Td key={e} right>{formatOrDash(p.outflows.otherExpensesByType[e] ?? 0)}</Td>)}
                    <Td right className="border-l font-semibold">{formatOrDash(p.outflows.total)}</Td>
                    <Td right>{formatOrDash(p.inflows.sales)}</Td>
                    <Td right className={cn("font-semibold", p.netCashflow > 0 ? "text-emerald-700" : p.netCashflow < 0 ? "text-red-700" : "")}>{formatNumber(p.netCashflow, 0)}</Td>
                    <Td right className={cn(p.accumulatedCashflow > 0 ? "text-emerald-700" : p.accumulatedCashflow < 0 ? "text-red-700" : "")}>{formatNumber(p.accumulatedCashflow, 0)}</Td>
                  </tr>
                ))}
                <tr className="border-t-2 bg-muted/40 font-semibold">
                  <Td sticky>TOTAL</Td>
                  <Td></Td>
                  <Td></Td>
                  <Td right className="border-l">{formatOrDash(totals.land)}</Td>
                  {constrCols.map((c) => <Td key={c} right>{formatOrDash(totals.constrByCat[c] ?? 0)}</Td>)}
                  {expenseCols.map((e) => <Td key={e} right>{formatOrDash(totals.otherByType[e] ?? 0)}</Td>)}
                  <Td right className="border-l">{formatOrDash(totals.totalOut)}</Td>
                  <Td right>{formatOrDash(totals.sales)}</Td>
                  <Td right className={cn(totals.net > 0 ? "text-emerald-700" : totals.net < 0 ? "text-red-700" : "")}>{formatNumber(totals.net, 0)}</Td>
                  <Td></Td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Th({ children, right, sticky, className }: { children: React.ReactNode; right?: boolean; sticky?: boolean; className?: string }) {
  return (
    <th className={cn(
      "px-2 py-1.5 font-semibold whitespace-nowrap bg-background",
      right ? "text-right" : "text-left",
      sticky && "sticky left-0 z-10 border-r",
      className,
    )}>{children}</th>
  );
}

function Td({ children, right, sticky, className }: { children?: React.ReactNode; right?: boolean; sticky?: boolean; className?: string }) {
  return (
    <td className={cn(
      "px-2 py-1 whitespace-nowrap",
      right ? "text-right" : "text-left",
      sticky && "sticky left-0 bg-background border-r",
      className,
    )}>{children}</td>
  );
}

function formatOrDash(v: number): string {
  if (!v) return "—";
  return formatNumber(v, 0);
}

function labelExpense(t: string): string {
  const map: Record<string, string> = {
    professional_fees: "Honorarios",
    taxes: "Impuestos",
    sales_commission: "Comisión",
    marketing: "Marketing",
    financial: "Financieros",
    permits: "Permisos",
    admin: "Admin",
    contingency: "Imprevistos",
    other: "Otros",
  };
  return map[t] ?? t;
}

/* ─── Chart SVG plano ───────────────────────────────────────────────── */

function CashflowChart({
  cashflow, reportingCurrency,
}: {
  cashflow: ScenarioCalculationResult["cashflow"];
  reportingCurrency: string;
}) {
  const W = 800;
  const H = 200;
  const pad = { top: 12, right: 12, bottom: 24, left: 60 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  if (cashflow.length === 0) return <div className="text-sm text-muted-foreground">Sin datos</div>;

  const nets = cashflow.map((c) => c.netCashflow);
  const accs = cashflow.map((c) => c.accumulatedCashflow);
  const yMax = Math.max(...nets, ...accs, 0);
  const yMin = Math.min(...nets, ...accs, 0);
  const yRange = (yMax - yMin) || 1;

  const xStep = innerW / Math.max(1, cashflow.length - 1);
  const yToPx = (v: number) => pad.top + innerH * (1 - (v - yMin) / yRange);

  // Línea acumulado
  const accPath = accs.map((v, i) => `${i === 0 ? "M" : "L"} ${pad.left + i * xStep} ${yToPx(v)}`).join(" ");
  // Bar width
  const barWidth = Math.max(2, Math.min(14, xStep * 0.6));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 600, fontFamily: "system-ui" }}>
        {/* Eje X (línea cero si hay valores negativos) */}
        <line x1={pad.left} x2={W - pad.right} y1={yToPx(0)} y2={yToPx(0)} stroke="#94a3b8" strokeWidth={0.5} />
        {/* Etiquetas eje Y */}
        <text x={4} y={yToPx(yMax)} fontSize={9} fill="#737373">{formatNumber(yMax, 0)}</text>
        <text x={4} y={yToPx(yMin)} fontSize={9} fill="#737373">{formatNumber(yMin, 0)}</text>
        <text x={4} y={yToPx(0)} fontSize={9} fill="#737373" dy={-2}>0</text>
        {/* Barras: neto */}
        {nets.map((v, i) => {
          const x = pad.left + i * xStep - barWidth / 2;
          const y = v >= 0 ? yToPx(v) : yToPx(0);
          const h = Math.abs(yToPx(v) - yToPx(0));
          return <rect key={i} x={x} y={y} width={barWidth} height={Math.max(1, h)} fill={v >= 0 ? "#10b981" : "#ef4444"} opacity={0.7} />;
        })}
        {/* Línea acumulado */}
        <path d={accPath} stroke="#E87722" strokeWidth={2} fill="none" />
        {/* Etiquetas eje X (cada N períodos) */}
        {cashflow.map((p, i) => {
          if (cashflow.length > 24 && i % 3 !== 0) return null;
          if (cashflow.length > 12 && cashflow.length <= 24 && i % 2 !== 0) return null;
          return (
            <text key={i} x={pad.left + i * xStep} y={H - 6} fontSize={9} fill="#737373" textAnchor="middle">
              {p.period}
            </text>
          );
        })}
      </svg>
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-1 px-2">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 bg-emerald-500 rounded-sm" /> Neto positivo</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 bg-red-500 rounded-sm" /> Neto negativo</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 bg-[#E87722]" /> Acumulado</span>
        <span className="ml-auto">Moneda: {reportingCurrency}</span>
      </div>
    </div>
  );
}
