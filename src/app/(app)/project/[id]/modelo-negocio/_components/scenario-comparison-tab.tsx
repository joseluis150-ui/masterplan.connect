"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { formatNumber, formatPct, formatPeriodLabel } from "../_lib/formatters";
import type { BusinessModel, ScenarioCalculationResult } from "../_lib/types";

/**
 * Tab Comparativa: tabla con escenarios como columnas y KPIs como filas.
 * Resalta el mejor valor por fila en verde claro.
 */
export function ScenarioComparisonTab({
  results, model, loading,
}: {
  results: ScenarioCalculationResult[];
  model: BusinessModel;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando comparativa de escenarios...
      </div>
    );
  }
  if (results.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">Sin escenarios para comparar.</p>;
  }
  const ccy = model.reportingCurrency;

  type Row = {
    label: string;
    values: { display: string; raw: number | null }[];
    higherIsBetter: boolean;
  };

  const rows = useMemo<Row[]>(() => [
    { label: "ROI", higherIsBetter: true,
      values: results.map((r) => ({ display: formatPct(r.kpis.roiPct, 1), raw: r.kpis.roiPct })) },
    { label: "TIR anualizada", higherIsBetter: true,
      values: results.map((r) => ({
        display: Number.isNaN(r.kpis.irrAnnualPct) ? "—" : formatPct(r.kpis.irrAnnualPct, 1),
        raw: Number.isNaN(r.kpis.irrAnnualPct) ? null : r.kpis.irrAnnualPct,
      })) },
    { label: "VAN", higherIsBetter: true,
      values: results.map((r) => ({ display: `${ccy} ${formatNumber(r.kpis.npv, 0)}`, raw: r.kpis.npv })) },
    { label: "Margen bruto", higherIsBetter: true,
      values: results.map((r) => ({ display: formatPct(r.kpis.grossMarginPct, 1), raw: r.kpis.grossMarginPct })) },
    { label: "Margen neto", higherIsBetter: true,
      values: results.map((r) => ({ display: formatPct(r.kpis.netMarginPct, 1), raw: r.kpis.netMarginPct })) },
    { label: "Payback", higherIsBetter: false,
      values: results.map((r) => ({
        display: r.kpis.paybackPeriod >= 0 ? formatPeriodLabel(r.kpis.paybackPeriod, model.granularity) : "No alcanza",
        raw: r.kpis.paybackPeriod >= 0 ? r.kpis.paybackPeriod : null,
      })) },
    { label: "Break-even (unidades)", higherIsBetter: false,
      values: results.map((r) => ({
        display: r.kpis.breakEvenUnits > 0 ? formatNumber(r.kpis.breakEvenUnits, 1) : "—",
        raw: r.kpis.breakEvenUnits > 0 ? r.kpis.breakEvenUnits : null,
      })) },
    { label: "Inversión total", higherIsBetter: false,
      values: results.map((r) => ({ display: `${ccy} ${formatNumber(r.kpis.totalInvestment, 0)}`, raw: r.kpis.totalInvestment })) },
    { label: "Ingresos totales", higherIsBetter: true,
      values: results.map((r) => ({ display: `${ccy} ${formatNumber(r.kpis.totalRevenue, 0)}`, raw: r.kpis.totalRevenue })) },
    { label: "Utilidad neta", higherIsBetter: true,
      values: results.map((r) => ({ display: `${ccy} ${formatNumber(r.kpis.netProfit, 0)}`, raw: r.kpis.netProfit })) },
  ], [results, ccy, model.granularity]);

  function bestIndex(row: Row): number {
    let best = -1;
    let bestVal: number | null = null;
    for (let i = 0; i < row.values.length; i++) {
      const v = row.values[i].raw;
      if (v == null) continue;
      if (bestVal == null || (row.higherIsBetter ? v > bestVal : v < bestVal)) {
        best = i; bestVal = v;
      }
    }
    return best;
  }

  return (
    <div className="p-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Comparativa de escenarios</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Indicador</th>
                  {results.map((r) => (
                    <th key={r.scenario.id} className="text-right px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      {r.scenario.name}
                      {r.scenario.isDefault && (
                        <span className="ml-1 text-[9px] uppercase text-amber-600 font-mono">★</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const best = bestIndex(row);
                  return (
                    <tr key={row.label} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-2 text-sm">{row.label}</td>
                      {row.values.map((v, i) => (
                        <td key={i} className={cn(
                          "px-3 py-2 text-right",
                          i === best && results.length > 1 && v.raw != null && "bg-emerald-50 text-emerald-800 font-semibold",
                        )}>
                          {v.display}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground pt-2 px-2">
            La celda en verde claro indica el mejor valor por fila. Para Payback, Break-even e Inversión, "menor es mejor".
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
