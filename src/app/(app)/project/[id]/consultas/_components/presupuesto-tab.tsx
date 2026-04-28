"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { formatNumber, convertCurrency } from "@/lib/utils/formula";
import type { Project, Sector, Articulo } from "@/lib/types/database";
import { DollarSign, ChevronDown, ChevronRight, Package } from "lucide-react";
import { cn } from "@/lib/utils";

interface BudgetRow {
  category_id: string;
  category_code: string;
  category_name: string;
  subcategory_id: string;
  subcategory_code: string;
  subcategory_name: string;
  sector_id: string;
  sector_name: string;
  total_usd: number;
  // MAT/MO/GLO existen en la RPC pero ya no se muestran
  total_mat: number;
  total_mo: number;
  total_glo: number;
}

interface QLine {
  id: string;
  articulo_id: string | null;
  subcategory_id: string;
  sector_id: string;
  quantity: number | null;
}

interface ArticuloRollup {
  articuloId: string;
  number: number;
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  total: number;
}

interface SubAgg {
  code: string;
  name: string;
  total: number;
  bySector: Map<string, number>;
}
interface CatAgg {
  code: string;
  name: string;
  total: number;
  bySector: Map<string, number>;
  subs: Map<string, SubAgg>;
}

export function PresupuestoTab({ projectId }: { projectId: string }) {
  const [budgetData, setBudgetData] = useState<BudgetRow[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [qLines, setQLines] = useState<QLine[]>([]);
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [articuloCosts, setArticuloCosts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showLocal, setShowLocal] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // category ids con desglose visible
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set()); // subcategory ids con artículos visibles
  const supabase = createClient();

  const loadData = useCallback(async () => {
    const [projRes, sectorsRes, budgetRes, qlRes, artsRes, costsRes] = await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).single(),
      supabase.from("sectors").select("*").eq("project_id", projectId).order("order"),
      supabase.rpc("get_budget_summary", { p_project_id: projectId }),
      supabase
        .from("quantification_lines")
        .select("id, articulo_id, subcategory_id, sector_id, quantity")
        .eq("project_id", projectId)
        .is("deleted_at", null),
      supabase.from("articulos").select("*").eq("project_id", projectId).order("number"),
      supabase.rpc("get_project_articulo_totals", { p_project_id: projectId }),
    ]);
    if (projRes.data) setProject(projRes.data);
    setSectors(sectorsRes.data || []);
    setBudgetData((budgetRes.data || []).map((r: Record<string, unknown>) => ({
      ...r,
      total_usd: Number(r.total_usd),
      total_mat: Number(r.total_mat),
      total_mo: Number(r.total_mo),
      total_glo: Number(r.total_glo),
    })) as BudgetRow[]);
    setQLines(((qlRes.data || []) as QLine[]).map((q) => ({ ...q, quantity: q.quantity == null ? 0 : Number(q.quantity) })));
    setArticulos((artsRes.data || []) as Articulo[]);
    const costMap = new Map<string, number>();
    for (const r of (costsRes.data || []) as { articulo_id: string; pu_costo: number | string }[]) {
      costMap.set(r.articulo_id, Number(r.pu_costo) || 0);
    }
    setArticuloCosts(costMap);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  const tc = Number(project?.exchange_rate || 1);
  const fmt = (val: number) => showLocal
    ? formatNumber(convertCurrency(val, tc, "usd_to_local"), 0)
    : formatNumber(val);
  const currency = showLocal ? project?.local_currency || "LOCAL" : "USD";

  // Agregación por categoría (con desglose por sector y subcategorías)
  const categoryTotals = new Map<string, CatAgg>();
  for (const row of budgetData) {
    if (!categoryTotals.has(row.category_id)) {
      categoryTotals.set(row.category_id, {
        code: row.category_code,
        name: row.category_name,
        total: 0,
        bySector: new Map(),
        subs: new Map(),
      });
    }
    const cat = categoryTotals.get(row.category_id)!;
    cat.total += row.total_usd;
    cat.bySector.set(row.sector_id, (cat.bySector.get(row.sector_id) || 0) + row.total_usd);

    if (!cat.subs.has(row.subcategory_id)) {
      cat.subs.set(row.subcategory_id, {
        code: row.subcategory_code,
        name: row.subcategory_name,
        total: 0,
        bySector: new Map(),
      });
    }
    const sub = cat.subs.get(row.subcategory_id)!;
    sub.total += row.total_usd;
    sub.bySector.set(row.sector_id, (sub.bySector.get(row.sector_id) || 0) + row.total_usd);
  }

  const grandTotal = budgetData.reduce((s, r) => s + r.total_usd, 0);
  const grandBySector = new Map<string, number>();
  for (const r of budgetData) {
    grandBySector.set(r.sector_id, (grandBySector.get(r.sector_id) || 0) + r.total_usd);
  }
  const totalAreaM2 = sectors.reduce((s, sc) => s + Number(sc.area_m2 || 0), 0);
  const perM2 = (val: number) => (totalAreaM2 > 0 ? val / totalAreaM2 : 0);

  function toggleExpanded(catId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  }
  function toggleExpandedSub(subId: string) {
    setExpandedSubs((prev) => {
      const next = new Set(prev);
      if (next.has(subId)) next.delete(subId); else next.add(subId);
      return next;
    });
  }
  function expandAll() {
    setExpanded(new Set(Array.from(categoryTotals.keys())));
  }
  function collapseAll() {
    setExpanded(new Set());
    setExpandedSubs(new Set());
  }

  // Articulos agrupados por subcategoría — qty total y costo total
  const articulosBySub = (() => {
    const m = new Map<string, ArticuloRollup[]>();
    const artMap = new Map(articulos.map((a) => [a.id, a]));
    // Acumulado de qty por (subcategory_id, articulo_id)
    const qtyMap = new Map<string, Map<string, number>>();
    for (const ql of qLines) {
      if (!ql.articulo_id) continue;
      const subMap = qtyMap.get(ql.subcategory_id) || new Map<string, number>();
      subMap.set(ql.articulo_id, (subMap.get(ql.articulo_id) || 0) + Number(ql.quantity || 0));
      qtyMap.set(ql.subcategory_id, subMap);
    }
    for (const [subId, byArt] of qtyMap.entries()) {
      const list: ArticuloRollup[] = [];
      for (const [artId, qty] of byArt.entries()) {
        const art = artMap.get(artId);
        if (!art) continue;
        const unitCost = articuloCosts.get(artId) || 0;
        list.push({
          articuloId: artId,
          number: art.number,
          description: art.description,
          unit: art.unit,
          quantity: qty,
          unitCost,
          total: qty * unitCost,
        });
      }
      list.sort((a, b) => a.number - b.number);
      m.set(subId, list);
    }
    return m;
  })();

  if (loading) return <div className="animate-pulse h-96 bg-muted rounded-lg" />;

  // Sectores que efectivamente tienen al menos una línea de presupuesto
  const sectorsWithData = sectors.filter((s) => grandBySector.has(s.id));
  const sectorList = sectorsWithData.length > 0 ? sectorsWithData : sectors;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground mb-1">Total</p>
            <p className="text-2xl font-bold">
              {fmt(grandTotal)} <span className="text-sm font-normal">{currency}</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground mb-1">Área total</p>
            <p className="text-2xl font-bold">
              {totalAreaM2 > 0
                ? <>{formatNumber(totalAreaM2, 0)} <span className="text-sm font-normal">m²</span></>
                : <span className="text-muted-foreground text-base font-normal">— sin áreas cargadas</span>}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground mb-1">Costo por m²</p>
            <p className="text-2xl font-bold">
              {totalAreaM2 > 0
                ? <>{fmt(perM2(grandTotal))} <span className="text-sm font-normal">{currency}/m²</span></>
                : <span className="text-muted-foreground text-base font-normal">—</span>}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex gap-2 items-center flex-wrap">
        <Button variant="outline" size="sm" onClick={expandAll} disabled={categoryTotals.size === 0}>
          Expandir todo
        </Button>
        <Button variant="outline" size="sm" onClick={collapseAll} disabled={expanded.size === 0}>
          Colapsar todo
        </Button>
        <div className="flex items-center gap-2 ml-auto">
          <Label className="text-sm">USD</Label>
          <Switch checked={showLocal} onCheckedChange={setShowLocal} />
          <Label className="text-sm">{project?.local_currency}</Label>
        </div>
      </div>

      {/* Tabla */}
      {budgetData.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Sin datos de presupuesto</h3>
            <p className="text-muted-foreground">Agregá líneas de cuantificación para ver el presupuesto</p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-neutral-900 hover:bg-neutral-900">
                <TableHead className="w-[110px] text-white font-semibold">Código</TableHead>
                <TableHead className="text-white font-semibold">Descripción</TableHead>
                {sectorList.map((s) => {
                  const m2 = Number(s.area_m2 || 0);
                  return (
                    <TableHead key={s.id} className="text-right whitespace-nowrap text-white font-semibold">
                      <div className="leading-tight">
                        <div>{s.name}</div>
                        <div className="text-[10px] font-normal text-white/60">
                          {m2 > 0 ? `${formatNumber(m2, 0)} m²` : "sin m²"}
                        </div>
                      </div>
                    </TableHead>
                  );
                })}
                <TableHead className="text-right whitespace-nowrap text-white font-semibold">Total ({currency})</TableHead>
                <TableHead className="text-right whitespace-nowrap text-white font-semibold w-[80px]">%</TableHead>
                <TableHead className="text-right whitespace-nowrap text-white font-semibold">
                  <div className="leading-tight">
                    <div>{currency}/m²</div>
                    <div className="text-[10px] font-normal text-white/60">
                      {totalAreaM2 > 0 ? `${formatNumber(totalAreaM2, 0)} m² total` : "sin m²"}
                    </div>
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from(categoryTotals.entries()).map(([catId, cat]) => {
                const isOpen = expanded.has(catId);
                return (
                  <React.Fragment key={catId}>
                    <TableRow
                      className="font-semibold bg-neutral-100 cursor-pointer hover:bg-neutral-200/70 border-l-[3px] border-l-[#E87722]"
                      onClick={() => toggleExpanded(catId)}
                    >
                      <TableCell>
                        <span className="inline-flex items-center gap-1">
                          {isOpen
                            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          <span className="text-[#E87722] font-mono">{cat.code}</span>
                        </span>
                      </TableCell>
                      <TableCell>{cat.name}</TableCell>
                      {sectorList.map((s) => {
                        const v = cat.bySector.get(s.id) || 0;
                        return (
                          <TableCell key={s.id} className="text-right font-mono">
                            {v > 0 ? fmt(v) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right font-mono">{fmt(cat.total)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {grandTotal > 0 ? `${((cat.total / grandTotal) * 100).toFixed(1)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {totalAreaM2 > 0 ? fmt(perM2(cat.total)) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                    {isOpen && Array.from(cat.subs.entries()).map(([subId, sub]) => {
                      const subOpen = expandedSubs.has(subId);
                      const arts = articulosBySub.get(subId) || [];
                      const colSpanFull = 5 + sectorList.length; // toda la fila
                      return (
                        <React.Fragment key={subId}>
                          <TableRow
                            className="bg-background cursor-pointer hover:bg-muted/30"
                            onClick={() => toggleExpandedSub(subId)}
                          >
                            <TableCell className="pl-8 text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                {arts.length > 0
                                  ? (subOpen
                                    ? <ChevronDown className="h-3 w-3" />
                                    : <ChevronRight className="h-3 w-3" />)
                                  : <span className="inline-block w-3" />}
                                <span className="text-[#E87722] font-mono text-xs">{sub.code}</span>
                              </span>
                            </TableCell>
                            <TableCell className="pl-8">{sub.name}</TableCell>
                            {sectorList.map((s) => {
                              const v = sub.bySector.get(s.id) || 0;
                              return (
                                <TableCell key={s.id} className="text-right font-mono text-sm">
                                  {v > 0 ? fmt(v) : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                              );
                            })}
                            <TableCell className="text-right font-mono text-sm">{fmt(sub.total)}</TableCell>
                            <TableCell className="text-right font-mono text-sm text-muted-foreground">
                              {grandTotal > 0 ? `${((sub.total / grandTotal) * 100).toFixed(1)}%` : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {totalAreaM2 > 0 ? fmt(perM2(sub.total)) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                          </TableRow>
                          {subOpen && (
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableCell colSpan={colSpanFull} className="p-0">
                                <div className="px-10 py-3">
                                  <div className="flex items-center gap-2 mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                                    <Package className="h-3.5 w-3.5" />
                                    Artículos en {sub.code} {sub.name}
                                    <span className="text-[10px] normal-case text-muted-foreground/80">
                                      ({arts.length} {arts.length === 1 ? "artículo" : "artículos"})
                                    </span>
                                  </div>
                                  {arts.length === 0 ? (
                                    <p className="text-xs italic text-muted-foreground py-2">
                                      Esta subcategoría no tiene artículos cuantificados.
                                    </p>
                                  ) : (
                                    <div className="border rounded-md overflow-hidden bg-background">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="bg-neutral-900">
                                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-wider text-white w-[80px]">Cód.</th>
                                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-wider text-white">Artículo</th>
                                            <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-wider text-white w-[60px]">Unidad</th>
                                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-wider text-white w-[100px]">Cantidad</th>
                                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-wider text-white w-[110px]">P.U. ({currency})</th>
                                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-wider text-white w-[120px]">Total ({currency})</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {arts.map((a) => (
                                            <tr key={a.articuloId} className="border-t hover:bg-muted/10">
                                              <td className="px-3 py-2 font-mono text-muted-foreground">{a.number}</td>
                                              <td className="px-3 py-2">{a.description}</td>
                                              <td className="px-3 py-2 text-center text-muted-foreground">{a.unit}</td>
                                              <td className="px-3 py-2 text-right font-mono">{formatNumber(a.quantity)}</td>
                                              <td className="px-3 py-2 text-right font-mono">{fmt(a.unitCost)}</td>
                                              <td className="px-3 py-2 text-right font-mono font-semibold">{fmt(a.total)}</td>
                                            </tr>
                                          ))}
                                          <tr className="border-t-2 border-neutral-900 bg-neutral-900 font-bold">
                                            <td colSpan={5} className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-white">
                                              Subtotal
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono text-[#E87722]">
                                              {fmt(arts.reduce((s, a) => s + a.total, 0))}
                                            </td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
              {/* Fila TOTAL */}
              <TableRow className={cn("font-bold border-t-2 border-neutral-900 bg-neutral-900 hover:bg-neutral-900")}>
                <TableCell></TableCell>
                <TableCell className="text-white uppercase tracking-wider text-[11px]">Total</TableCell>
                {sectorList.map((s) => {
                  const v = grandBySector.get(s.id) || 0;
                  return (
                    <TableCell key={s.id} className="text-right font-mono text-white">
                      {v > 0 ? fmt(v) : <span className="text-white/40">—</span>}
                    </TableCell>
                  );
                })}
                <TableCell className="text-right font-mono text-[#E87722] text-[13px]">{fmt(grandTotal)}</TableCell>
                <TableCell className="text-right font-mono text-white">100.0%</TableCell>
                <TableCell className="text-right font-mono text-[#E87722]">
                  {totalAreaM2 > 0 ? fmt(perM2(grandTotal)) : <span className="text-white/40">—</span>}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
