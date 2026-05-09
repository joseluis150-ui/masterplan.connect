"use client";

import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, Activity, Target, Clock, Award, BarChart2, Percent } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber, formatPct, formatPeriodLabel } from "../_lib/formatters";
import type { BusinessModel, ScenarioCalculationResult } from "../_lib/types";

/**
 * Tab KPIs: grid de cards con cada indicador. Layout responsive: 4 columnas
 * en pantallas grandes, 2 en medianas, 1 en mobile.
 */
export function KpisTab({
  result, model,
}: {
  result: ScenarioCalculationResult;
  model: BusinessModel;
}) {
  const k = result.kpis;
  const ccy = model.reportingCurrency;

  return (
    <div className="p-4 space-y-3">
      {/* Sección rentabilidad */}
      <SectionHeader title="Rentabilidad" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          icon={TrendingUp}
          label="ROI"
          value={formatPct(k.roiPct, 1)}
          color={k.roiPct >= 0 ? "emerald" : "red"}
          footnote={`Utilidad neta / Inversión total`}
        />
        <Kpi
          icon={Activity}
          label="TIR (anualizada)"
          value={Number.isNaN(k.irrAnnualPct) ? "No converge" : formatPct(k.irrAnnualPct, 1)}
          color={!Number.isNaN(k.irrAnnualPct) && k.irrAnnualPct >= 0 ? "emerald" : "red"}
          footnote={`TIR por período: ${Number.isNaN(k.irrPeriodPct) ? "—" : formatPct(k.irrPeriodPct, 2)}`}
        />
        <Kpi
          icon={DollarSign}
          label="VAN"
          value={`${ccy} ${formatNumber(k.npv, 0)}`}
          color={k.npv >= 0 ? "emerald" : "red"}
          footnote={`@ ${formatPct(k.discountRateUsed, 1)} anual`}
        />
        <Kpi
          icon={Percent}
          label="Margen neto"
          value={k.totalRevenue > 0 ? formatPct(k.netMarginPct, 1) : "—"}
          color={k.netMarginPct >= 0 ? "emerald" : "red"}
          footnote={`Margen bruto: ${k.totalRevenue > 0 ? formatPct(k.grossMarginPct, 1) : "—"}`}
        />
      </div>

      {/* Sección montos absolutos */}
      <SectionHeader title="Montos totales" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          icon={TrendingUp}
          label="Ingresos totales"
          value={`${ccy} ${formatNumber(k.totalRevenue, 0)}`}
          color="emerald"
        />
        <Kpi
          icon={TrendingDown}
          label="Inversión total"
          value={`${ccy} ${formatNumber(k.totalInvestment, 0)}`}
          color="red"
          footnote={`Tierra + Construcción + Otros`}
        />
        <Kpi
          icon={Award}
          label="Utilidad neta"
          value={`${ccy} ${formatNumber(k.netProfit, 0)}`}
          color={k.netProfit >= 0 ? "emerald" : "red"}
          footnote={`Utilidad bruta: ${ccy} ${formatNumber(k.grossProfit, 0)}`}
        />
        <Kpi
          icon={Clock}
          label="Payback"
          value={k.paybackPeriod >= 0 ? formatPeriodLabel(k.paybackPeriod, model.granularity) : "No alcanza"}
          color={k.paybackPeriod >= 0 ? "neutral" : "red"}
          footnote={`Período donde acumulado ≥ 0`}
        />
      </div>

      {/* Sección punto de equilibrio */}
      <SectionHeader title="Punto de equilibrio" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          icon={Target}
          label="Break-even (unidades)"
          value={k.breakEvenUnits > 0 ? formatNumber(k.breakEvenUnits, 1) : "—"}
          footnote={`Costos / precio promedio por unidad`}
        />
        <Kpi
          icon={BarChart2}
          label="Break-even (período)"
          value={k.breakEvenPeriod >= 0 ? formatPeriodLabel(k.breakEvenPeriod, model.granularity) : "No alcanza"}
          footnote={`Ingresos acum. ≥ Costos acum.`}
        />
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-mono px-1 pt-2">
      {title}
    </p>
  );
}

type KpiColor = "emerald" | "red" | "neutral";
function Kpi({
  icon: Icon, label, value, footnote, color = "neutral",
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  footnote?: string;
  color?: KpiColor;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-mono">
            {label}
          </p>
          <Icon className={cn(
            "h-4 w-4",
            color === "emerald" ? "text-emerald-600" :
            color === "red" ? "text-red-600" :
            "text-muted-foreground",
          )} />
        </div>
        <p className={cn(
          "text-2xl font-semibold tabular-nums mt-1",
          color === "emerald" ? "text-emerald-700" :
          color === "red" ? "text-red-700" : "",
        )}>
          {value}
        </p>
        {footnote && <p className="text-[10px] text-muted-foreground mt-1">{footnote}</p>}
      </CardContent>
    </Card>
  );
}
