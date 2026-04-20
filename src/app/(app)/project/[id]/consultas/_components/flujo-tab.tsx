"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/utils/formula";
import type {
  ProcurementPackage,
  ProcurementLine,
  Insumo,
  Articulo,
  ArticuloComposition,
  EdtCategory,
  EdtSubcategory,
} from "@/lib/types/database";
import { ChevronDown, ChevronRight, DollarSign, TrendingUp, Calendar, Package } from "lucide-react";
import {
  addWeeks, addDays, startOfWeek, startOfMonth, format, isBefore, isAfter,
  differenceInCalendarMonths,
} from "date-fns";
import { es } from "date-fns/locale";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

/* ── Types ── */
interface CashFlowItem {
  compositionId: string;
  insumoId: string;
  insumoDescription: string;
  insumoType: string;
  insumoUnit: string;
  packageId: string;
  packageName: string;
  purchaseType: string;
  catCode: string;
  catName: string;
  subCode: string;
  subName: string;
  artNumber: number;
  artDescription: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  needDate: Date | null;
  paymentDate: Date | null;
}

type PeriodMode = "week" | "biweekly" | "month";

interface PeriodBucket {
  key: string;
  label: string;
  start: Date;
  end: Date;
  amount: number;
  cumulative: number;
}

export function FlujoTab({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<CashFlowItem[]>([]);
  const [packages, setPackages] = useState<ProcurementPackage[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [periodMode, setPeriodMode] = useState<PeriodMode>("biweekly");

  const supabase = createClient();

  /* ── Load data ── */
  const loadData = useCallback(async () => {
    // Round 1
    const [catsRes, subsRes, qlRes, artsRes, pkgsRes, schedConfigRes] = await Promise.all([
      supabase.from("edt_categories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("quantification_lines").select("*").eq("project_id", projectId).is("deleted_at", null).order("line_number"),
      supabase.from("articulos").select("*").eq("project_id", projectId).order("number"),
      supabase.from("procurement_packages").select("*").eq("project_id", projectId).order("created_at"),
      supabase.from("schedule_config").select("*").eq("project_id", projectId).single(),
    ]);

    const startDate = schedConfigRes.data?.start_date || null;
    const cats = (catsRes.data || []) as EdtCategory[];
    const subs = (subsRes.data || []) as EdtSubcategory[];
    const qLines = qlRes.data || [];
    const arts = (artsRes.data || []) as Articulo[];
    const pkgs = (pkgsRes.data || []) as ProcurementPackage[];

    // Round 2
    const artIds = arts.map((a) => a.id);
    const pkgIds = pkgs.map((p) => p.id);

    const [compsRes, plRes, schedWeeksRes] = await Promise.all([
      artIds.length > 0
        ? supabase.from("articulo_compositions").select("*, insumo:insumos(*)").in("articulo_id", artIds)
        : Promise.resolve({ data: [] }),
      pkgIds.length > 0
        ? supabase.from("procurement_lines").select("*").in("package_id", pkgIds)
        : Promise.resolve({ data: [] }),
      supabase.from("schedule_weeks").select("*").eq("active", true),
    ]);

    const comps = (compsRes.data || []) as (ArticuloComposition & { insumo: Insumo })[];
    const pLines = (plRes.data || []) as ProcurementLine[];
    const schedWeeks = (schedWeeksRes.data || []) as { quantification_line_id: string; week_number: number }[];

    // Lookups
    const qlLineIds = new Set(qLines.map((ql: { id: string }) => ql.id));
    const qlEarliestWeek = new Map<string, number>();
    for (const sw of schedWeeks) {
      if (!qlLineIds.has(sw.quantification_line_id)) continue;
      const existing = qlEarliestWeek.get(sw.quantification_line_id);
      if (existing === undefined || sw.week_number < existing) {
        qlEarliestWeek.set(sw.quantification_line_id, sw.week_number);
      }
    }

    const catMap = new Map(cats.map((c) => [c.id, c]));
    const subMap = new Map(subs.map((s) => [s.id, s]));
    const artMap = new Map(arts.map((a) => [a.id, a]));
    const compMap = new Map(comps.map((c) => [c.id, c]));
    const pkgMap = new Map(pkgs.map((p) => [p.id, p]));

    // articulo → ql lines
    const artQlLines = new Map<string, typeof qLines>();
    for (const ql of qLines) {
      if (!ql.articulo_id) continue;
      const list = artQlLines.get(ql.articulo_id) || [];
      list.push(ql);
      artQlLines.set(ql.articulo_id, list);
    }

    const artQlQuantity = new Map<string, number>();
    for (const [artId, lines] of artQlLines) {
      artQlQuantity.set(artId, lines.reduce((sum: number, ql: { quantity: number | null }) => sum + (Number(ql.quantity) || 0), 0));
    }

    // composition → earliest week
    const compEarliestWeek = new Map<string, number>();
    for (const comp of comps) {
      const artLines = artQlLines.get(comp.articulo_id) || [];
      let earliest: number | undefined;
      for (const ql of artLines) {
        const w = qlEarliestWeek.get((ql as { id: string }).id);
        if (w !== undefined && (earliest === undefined || w < earliest)) earliest = w;
      }
      if (earliest !== undefined) compEarliestWeek.set(comp.id, earliest);
    }

    // Build cash flow items
    const cashItems: CashFlowItem[] = [];
    for (const pl of pLines) {
      const comp = compMap.get(pl.composition_id || "");
      const pkg = pkgMap.get(pl.package_id);
      if (!pkg) continue;

      let totalCost = 0;
      let unitCost = 0;
      let quantity = 0;
      let artNum = 0;
      let artDesc = "";
      let catCode = "";
      let catName = "";
      let subCode = "";
      let subName = "";
      let insumoDesc = "";
      let insumoType = "";
      let insumoUnit = "";
      let insumoId = pl.insumo_id;

      if (comp && comp.insumo) {
        const art = artMap.get(comp.articulo_id);
        const qlQty = artQlQuantity.get(comp.articulo_id) || 0;
        unitCost =
          Number(comp.quantity) *
          (1 + Number(comp.waste_pct) / 100) *
          (Number(comp.insumo.pu_usd) || 0) *
          (1 + Number(comp.margin_pct) / 100);
        quantity = qlQty;
        totalCost = unitCost * qlQty;
        artNum = art?.number || 0;
        artDesc = art?.description || "";
        insumoDesc = comp.insumo.description;
        insumoType = comp.insumo.type;
        insumoUnit = comp.insumo.unit;
        insumoId = comp.insumo_id;

        const artLines = artQlLines.get(comp.articulo_id) || [];
        if (artLines.length > 0) {
          const firstQl = artLines[0] as { category_id: string; subcategory_id: string };
          const cat = catMap.get(firstQl.category_id);
          const sub = subMap.get(firstQl.subcategory_id);
          if (cat) { catCode = cat.code; catName = cat.name; }
          if (sub) { subCode = sub.code; subName = sub.name; }
        }
      }

      const weekNum = compEarliestWeek.get(pl.composition_id || "");
      const needDate = weekNum !== undefined && startDate
        ? addWeeks(startOfWeek(new Date(startDate), { weekStartsOn: 1 }), weekNum)
        : null;
      const paymentDate = needDate
        ? new Date(needDate.getTime() - (pkg.advance_days || 0) * 24 * 60 * 60 * 1000)
        : null;

      cashItems.push({
        compositionId: pl.composition_id || pl.insumo_id,
        insumoId,
        insumoDescription: insumoDesc,
        insumoType,
        insumoUnit,
        packageId: pkg.id,
        packageName: pkg.name,
        purchaseType: pkg.purchase_type,
        catCode, catName, subCode, subName,
        artNumber: artNum,
        artDescription: artDesc,
        quantity,
        unitCost,
        totalCost,
        needDate,
        paymentDate,
      });
    }

    setItems(cashItems);
    setPackages(pkgs);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── Computed: Monthly groups (for list) ── */
  const monthlyGroups = useMemo(() => {
    const groups = new Map<string, { label: string; date: Date; items: CashFlowItem[] }>();
    const undated: CashFlowItem[] = [];

    for (const item of items) {
      if (!item.paymentDate) {
        undated.push(item);
        continue;
      }
      const key = format(item.paymentDate, "yyyy-MM");
      if (!groups.has(key)) {
        groups.set(key, {
          label: format(item.paymentDate, "MMMM yyyy", { locale: es }),
          date: startOfMonth(item.paymentDate),
          items: [],
        });
      }
      groups.get(key)!.items.push(item);
    }

    // Sort by date
    const sorted = Array.from(groups.entries())
      .sort(([, a], [, b]) => a.date.getTime() - b.date.getTime())
      .map(([key, val]) => ({ key, ...val }));

    if (undated.length > 0) {
      sorted.push({ key: "sin-fecha", label: "Sin fecha asignada", date: new Date(9999, 0), items: undated });
    }

    return sorted;
  }, [items]);

  /* ── Computed: Period buckets (for chart) ── */
  const periodBuckets = useMemo(() => {
    const datedItems = items.filter((i) => i.paymentDate);
    if (datedItems.length === 0) return [];

    const dates = datedItems.map((i) => i.paymentDate!);
    const earliest = dates.reduce((min, d) => (isBefore(d, min) ? d : min), dates[0]);
    const latest = dates.reduce((max, d) => (isAfter(d, max) ? d : max), dates[0]);

    const buckets: PeriodBucket[] = [];

    if (periodMode === "month") {
      const totalMonths = differenceInCalendarMonths(latest, earliest) + 1;
      const start = startOfMonth(earliest);
      for (let i = 0; i < totalMonths; i++) {
        const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        buckets.push({
          key: format(d, "yyyy-MM"),
          label: format(d, "MMM yy", { locale: es }),
          start: d,
          end,
          amount: 0,
          cumulative: 0,
        });
      }
    } else if (periodMode === "biweekly") {
      // 1-15 and 16-end of month
      let current = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate() <= 15 ? 1 : 16);
      while (isBefore(current, latest) || current.getTime() === latest.getTime()) {
        const isFirstHalf = current.getDate() <= 15;
        const end = isFirstHalf
          ? new Date(current.getFullYear(), current.getMonth(), 15)
          : new Date(current.getFullYear(), current.getMonth() + 1, 0);
        const label = isFirstHalf
          ? `1-15 ${format(current, "MMM yy", { locale: es })}`
          : `16-${end.getDate()} ${format(current, "MMM yy", { locale: es })}`;
        buckets.push({
          key: format(current, "yyyy-MM") + (isFirstHalf ? "-a" : "-b"),
          label,
          start: new Date(current),
          end,
          amount: 0,
          cumulative: 0,
        });
        // Move to next half
        if (isFirstHalf) {
          current = new Date(current.getFullYear(), current.getMonth(), 16);
        } else {
          current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
        }
      }
    } else if (periodMode === "week") {
      let current = startOfWeek(earliest, { weekStartsOn: 1 });
      while (isBefore(current, latest) || current.getTime() === latest.getTime()) {
        const end = addDays(current, 6);
        buckets.push({
          key: format(current, "yyyy-MM-dd"),
          label: `${format(current, "dd MMM", { locale: es })}`,
          start: new Date(current),
          end,
          amount: 0,
          cumulative: 0,
        });
        current = addDays(current, 7);
      }
    }

    // Fill amounts
    for (const item of datedItems) {
      const d = item.paymentDate!;
      for (const bucket of buckets) {
        if ((isAfter(d, bucket.start) || d.getTime() === bucket.start.getTime()) &&
            (isBefore(d, bucket.end) || d.getTime() === bucket.end.getTime())) {
          bucket.amount += item.totalCost;
          break;
        }
      }
    }

    // Cumulative
    let cum = 0;
    for (const b of buckets) {
      cum += b.amount;
      b.cumulative = cum;
    }

    return buckets;
  }, [items, periodMode]);

  /* ── Helpers ── */
  function fmtUsd(v: number): string {
    return "$" + Math.round(v).toLocaleString("en-US");
  }

  function toggleMonth(key: string) {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const grandTotal = items.reduce((s, i) => s + i.totalCost, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "#E87722" }} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <DollarSign className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground text-sm">No hay insumos asignados a paquetes de compra.</p>
        <p className="text-muted-foreground text-xs mt-1">Asigne insumos en la seccion de Paquetes para generar el flujo de efectivo.</p>
      </div>
    );
  }

  // Chart data
  const chartData = periodBuckets.map((b) => ({
    name: b.label,
    egreso: Math.round(b.amount),
    acumulado: Math.round(b.cumulative),
  }));

  const maxEgreso = Math.max(...periodBuckets.map((b) => b.amount), 1);
  const maxCumulative = periodBuckets.length > 0 ? periodBuckets[periodBuckets.length - 1].cumulative : 1;

  return (
    <div className="space-y-8">
      {/* ── Monthly collapsible list ── */}
      <div className="space-y-0">
        {monthlyGroups.map((group) => {
          const isExpanded = expandedMonths.has(group.key);
          const groupTotal = group.items.reduce((s, i) => s + i.totalCost, 0);
          const isSinFecha = group.key === "sin-fecha";

          return (
            <div key={group.key} className={cn("border rounded-lg", isExpanded ? "mb-3" : "mb-2")}>
              {/* Month header row */}
              <div
                className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-muted/20 transition-colors"
                onClick={() => toggleMonth(group.key)}
              >
                <div className="flex items-center gap-3">
                  {isExpanded
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  }
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold text-sm capitalize">{group.label}</span>
                </div>
                <div className="flex items-center gap-6">
                  <span className="text-xs text-muted-foreground">{group.items.length} líneas</span>
                  <span className="text-base font-bold font-mono" style={{ color: isSinFecha ? "#D97706" : "#E87722" }}>
                    {fmtUsd(groupTotal)}
                  </span>
                </div>
              </div>

              {/* Expanded detail table */}
              {isExpanded && (
                <div className="border-t">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "#F5F5F5" }}>
                        <th className="text-left px-5 py-2 font-semibold text-[10px] uppercase tracking-wider w-[260px]">Actividad</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-wider">Insumo</th>
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-wider w-[90px]">Cantidad</th>
                        <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-wider w-[60px]">Unidad</th>
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-wider w-[90px]">P.U.</th>
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-wider w-[100px]">Total</th>
                        <th className="text-right px-5 py-2 font-semibold text-[10px] uppercase tracking-wider w-[100px]">Fecha necesidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items
                        .sort((a, b) => {
                          if (a.paymentDate && b.paymentDate) return a.paymentDate.getTime() - b.paymentDate.getTime();
                          if (a.paymentDate) return -1;
                          if (b.paymentDate) return 1;
                          return 0;
                        })
                        .map((item) => (
                          <tr key={item.compositionId} className="border-t hover:bg-muted/10 transition-colors">
                            <td className="px-5 py-2.5 text-xs">
                              <span className="text-muted-foreground">{item.catCode}.</span>{" "}
                              <span>{item.catName}</span>
                              <span className="text-muted-foreground"> – {item.subCode} {item.subName}</span>
                            </td>
                            <td className="px-3 py-2.5 text-xs">
                              <div className="flex items-center gap-1.5">
                                <span className={cn(
                                  "w-1.5 h-1.5 rounded-full shrink-0",
                                  item.insumoType === "material" ? "bg-neutral-700" :
                                  item.insumoType === "mano_de_obra" ? "bg-amber-400" :
                                  item.insumoType === "servicio" ? "bg-emerald-400" : "bg-gray-400"
                                )} />
                                {item.insumoDescription}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono">{formatNumber(item.quantity)}</td>
                            <td className="px-3 py-2.5 text-center text-muted-foreground">{item.insumoUnit}</td>
                            <td className="px-3 py-2.5 text-right font-mono">${formatNumber(item.unitCost)}</td>
                            <td className="px-3 py-2.5 text-right font-mono font-semibold">${formatNumber(item.totalCost)}</td>
                            <td className="px-5 py-2.5 text-right text-muted-foreground">
                              {item.needDate ? format(item.needDate, "dd MMM yy", { locale: es }) : "—"}
                            </td>
                          </tr>
                        ))}
                      {/* Subtotal */}
                      <tr className="border-t-2 font-bold" style={{ background: "#F5F5F5", borderColor: "#D4D4D4" }}>
                        <td colSpan={5} className="px-5 py-2 text-right text-[10px] uppercase tracking-wider">
                          Subtotal {group.label}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-sm" style={{ color: "#E87722" }}>
                          ${formatNumber(groupTotal, 2)}
                        </td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}

        {/* Grand total */}
        <div className="border rounded-lg px-5 py-3 flex items-center justify-between" style={{ background: "#F0F2F5" }}>
          <span className="font-bold text-sm uppercase tracking-wider">Total General</span>
          <span className="text-xl font-bold font-mono" style={{ color: "#E87722" }}>{fmtUsd(grandTotal)}</span>
        </div>
      </div>

      {/* ── Chart section ── */}
      {periodBuckets.length > 0 && (
        <div>
          {/* Chart header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" style={{ color: "#E87722" }} />
              <h2 className="text-lg font-bold">
                Flujo de Efectivo — {
                  periodMode === "week" ? "Por semana" :
                  periodMode === "biweekly" ? "Por 15 días" :
                  "Por mes"
                }
              </h2>
            </div>
            <div className="flex items-center gap-1 border rounded-lg overflow-hidden">
              {([
                { value: "week", label: "Semana", icon: "📆" },
                { value: "biweekly", label: "15 días", icon: "📆" },
                { value: "month", label: "Mes", icon: "📆" },
              ] as { value: PeriodMode; label: string; icon: string }[]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPeriodMode(opt.value)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
                    periodMode === opt.value
                      ? "bg-[#E87722] text-white"
                      : "hover:bg-muted/50 text-muted-foreground"
                  )}
                >
                  <Calendar className="h-3 w-3" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Chart */}
          <div className="border rounded-lg p-4" style={{ background: "#FAFBFC" }}>
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 60, left: 20, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 9, fill: "#6B7280" }}
                  angle={-45}
                  textAnchor="end"
                  interval={0}
                  height={70}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 10, fill: "#6B7280" }}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  width={65}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10, fill: "#6B7280" }}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  width={70}
                />
                <Tooltip
                  formatter={(value, name) => [
                    `$${Math.round(Number(value)).toLocaleString("en-US")}`,
                    name === "egreso" ? "Egreso" : "Acumulado",
                  ]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E5E7EB" }}
                />
                <Bar
                  yAxisId="left"
                  dataKey="egreso"
                  fill="#9CA3AF"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={40}
                  name="egreso"
                />
                <Line
                  yAxisId="right"
                  dataKey="acumulado"
                  stroke="#1F2937"
                  strokeWidth={2}
                  dot={{ fill: "#1F2937", r: 3 }}
                  name="acumulado"
                />
              </ComposedChart>
            </ResponsiveContainer>
            {/* Legend */}
            <div className="flex items-center justify-center gap-6 mt-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ background: "#9CA3AF" }} />
                Egreso del período
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-6 h-0.5 rounded" style={{ background: "#1F2937" }} />
                <div className="w-2 h-2 rounded-full" style={{ background: "#1F2937" }} />
                Acumulado
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
