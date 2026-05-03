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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatNumber, convertCurrency } from "@/lib/utils/formula";
import type { Project, Sector, Articulo } from "@/lib/types/database";
import { DollarSign, ChevronDown, ChevronRight, Package, Boxes, Filter } from "lucide-react";
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
  qtyBySector: Map<string, number>;   // sector_id → cantidad ejecutada
  costBySector: Map<string, number>;  // sector_id → costo (qty × unitCost)
}

interface InsumoCompRow {
  insumoId: string;
  insumoCode: number | null;
  description: string;
  type: string;
  unit: string;
  compQuantity: number;   // cantidad de insumo por unidad de articulo (con waste aplicado)
  totalQuantity: number;  // compQuantity × cantidad total del articulo
  unitCost: number;       // P.U. del insumo en USD
  total: number;          // totalQuantity × unitCost
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

type DisplayMode = "abs" | "per_m2";

export function PresupuestoTab({
  projectId,
}: {
  projectId: string;
}) {
  // Modo de visualización: absoluto vs por m². Antes era una pestaña
  // separada en /consultas, ahora es un toggle interno acá. Manteniéndolo
  // como state local en lugar de prop preserva los filtros y expansiones
  // al cambiar de modo (mejor UX que tabs separadas con `key` distinto).
  const [mode, setMode] = useState<DisplayMode>("abs");
  const isPerM2 = mode === "per_m2";
  const [budgetData, setBudgetData] = useState<BudgetRow[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [qLines, setQLines] = useState<QLine[]>([]);
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [articuloCosts, setArticuloCosts] = useState<Map<string, number>>(new Map());
  const [compsByArticulo, setCompsByArticulo] = useState<Map<string, Omit<InsumoCompRow, "totalQuantity" | "total">[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showLocal, setShowLocal] = useState(false);
  const [viewMode, setViewMode] = useState<"simple" | "detailed">("detailed"); // default: vista detallada con columnas por sector
  // Filtro multi-selección. Set vacío = todos los sectores (sin filtro).
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());
  const [sectorPickerOpen, setSectorPickerOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // category ids con desglose visible
  /** Subcategoría cuyos artículos están mostrados en el modal flotante.
   *  Reemplaza al expandedSubs anterior — antes los artículos se desplegaban
   *  inline dentro de la tabla (overflow horizontal feo); ahora viven en
   *  un Dialog dedicado con espacio propio. */
  const [openSubArticles, setOpenSubArticles] = useState<{ subId: string; subCode: string; subName: string } | null>(null);
  const [selectedArt, setSelectedArt] = useState<ArticuloRollup | null>(null); // articulo abierto en el modal
  const supabase = createClient();

  const loadData = useCallback(async () => {
    const [projRes, sectorsRes, budgetRes, qlRes, artsRes, costsRes, compsRes] = await Promise.all([
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
      // composiciones con info del insumo, filtradas por proyecto vía join con articulos
      supabase
        .from("articulo_compositions")
        .select("articulo_id, quantity, waste_pct, articulo:articulos!inner(project_id), insumo:insumos(id, code, description, type, unit, pu_usd)")
        .eq("articulo.project_id", projectId),
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
    // Composiciones agrupadas por articulo. Supabase puede devolver `insumo` como objeto
    // único o como array de un sólo elemento según la inferencia del esquema; manejamos ambos.
    type InsumoLite = { id: string; code: number | null; description: string; type: string; unit: string; pu_usd: number | string | null };
    type CompRaw = {
      articulo_id: string;
      quantity: number | string;
      waste_pct: number | string | null;
      insumo: InsumoLite | InsumoLite[] | null;
    };
    const compsMap = new Map<string, Omit<InsumoCompRow, "totalQuantity" | "total">[]>();
    for (const c of (compsRes.data || []) as unknown as CompRaw[]) {
      const ins = Array.isArray(c.insumo) ? c.insumo[0] : c.insumo;
      if (!ins) continue;
      const waste = Number(c.waste_pct || 0) / 100;
      const compQty = Number(c.quantity || 0) * (1 + waste);
      const list = compsMap.get(c.articulo_id) || [];
      list.push({
        insumoId: ins.id,
        insumoCode: ins.code,
        description: ins.description,
        type: ins.type,
        unit: ins.unit,
        compQuantity: compQty,
        unitCost: Number(ins.pu_usd || 0),
      });
      compsMap.set(c.articulo_id, list);
    }
    setCompsByArticulo(compsMap);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  const tc = Number(project?.exchange_rate || 1);
  // Sin decimales para que el reporte quede limpio.
  const fmt = (val: number) => showLocal
    ? formatNumber(convertCurrency(val, tc, "usd_to_local"), 0)
    : formatNumber(val, 0);
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

  // Total general (sin filtros)
  const grandBySector = new Map<string, number>();
  for (const r of budgetData) {
    grandBySector.set(r.sector_id, (grandBySector.get(r.sector_id) || 0) + r.total_usd);
  }

  // Aplicar filtro multi-sector. Si selectedSectors está vacío => sin filtro (todos).
  const isFiltered = selectedSectors.size > 0;
  const filteredTotal = (byMap: Map<string, number>) => {
    if (!isFiltered) return Array.from(byMap.values()).reduce((s, v) => s + v, 0);
    let sum = 0;
    for (const id of selectedSectors) sum += byMap.get(id) || 0;
    return sum;
  };

  const grandTotal = isFiltered
    ? Array.from(selectedSectors).reduce((s, id) => s + (grandBySector.get(id) || 0), 0)
    : budgetData.reduce((s, r) => s + r.total_usd, 0);

  // Área total de construcción: sólo sectores marcados como is_construction.
  // Si hay filtro, sólo los seleccionados que sean construcción.
  const totalAreaM2 = (() => {
    const target = isFiltered ? sectors.filter((s) => selectedSectors.has(s.id)) : sectors;
    return target.filter((s) => s.is_construction).reduce((acc, sc) => acc + Number(sc.area_m2 || 0), 0);
  })();
  // Área total del proyecto (sin filtro). La uso para dividir el costo de los
  // sectores tipo "gastos_generales" — su costo aplica a todo el proyecto.
  const projectAreaM2 = sectors
    .filter((s) => s.is_construction)
    .reduce((acc, sc) => acc + Number(sc.area_m2 || 0), 0);
  const perM2 = (val: number) => (totalAreaM2 > 0 ? val / totalAreaM2 : 0);

  /**
   * Formatea una celda de monto respetando el modo (abs vs per_m2).
   * - Si sector está provisto: la celda corresponde a un sector específico.
   *   En per_m2 divide por su área (físico) o por la del proyecto (gastos_generales).
   * - Si sector NO está provisto: es una celda Total (cat/sub/art/grandTotal).
   *   En per_m2 divide por totalAreaM2 (m² de construcción del proyecto/filtro).
   */
  const fmtAmount = (value: number, sector?: Sector): string => {
    if (!isPerM2) return fmt(value);
    let area = 0;
    if (sector) {
      area = sector.type === "fisico" ? Number(sector.area_m2 || 0) : projectAreaM2;
    } else {
      area = totalAreaM2;
    }
    return area > 0 ? fmt(value / area) : "—";
  };

  function toggleExpanded(catId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  }
  function expandAll() {
    setExpanded(new Set(Array.from(categoryTotals.keys())));
  }
  function collapseAll() {
    setExpanded(new Set());
  }

  // Articulos agrupados por subcategoría — qty/costo total y desglose por sector
  const articulosBySub = (() => {
    const m = new Map<string, ArticuloRollup[]>();
    const artMap = new Map(articulos.map((a) => [a.id, a]));
    // Acumulado de qty por (subcategory_id, articulo_id, sector_id)
    const qtyMap = new Map<string, Map<string, Map<string, number>>>();
    for (const ql of qLines) {
      if (!ql.articulo_id) continue;
      const subMap = qtyMap.get(ql.subcategory_id) || new Map<string, Map<string, number>>();
      const artMap2 = subMap.get(ql.articulo_id) || new Map<string, number>();
      artMap2.set(ql.sector_id, (artMap2.get(ql.sector_id) || 0) + Number(ql.quantity || 0));
      subMap.set(ql.articulo_id, artMap2);
      qtyMap.set(ql.subcategory_id, subMap);
    }
    for (const [subId, byArt] of qtyMap.entries()) {
      const list: ArticuloRollup[] = [];
      for (const [artId, bySector] of byArt.entries()) {
        const art = artMap.get(artId);
        if (!art) continue;
        const unitCost = articuloCosts.get(artId) || 0;
        const qtyBySector = new Map<string, number>();
        const costBySector = new Map<string, number>();
        let totalQty = 0;
        for (const [secId, qty] of bySector.entries()) {
          qtyBySector.set(secId, qty);
          costBySector.set(secId, qty * unitCost);
          totalQty += qty;
        }
        list.push({
          articuloId: artId,
          number: art.number,
          description: art.description,
          unit: art.unit,
          quantity: totalQty,
          unitCost,
          total: totalQty * unitCost,
          qtyBySector,
          costBySector,
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
  // Cuando viewMode = "detailed" mostramos columnas por sector. Si hay filtro, sólo el sector seleccionado.
  const displayedSectors = isFiltered ? sectorList.filter((s) => selectedSectors.has(s.id)) : sectorList;
  const showSectorCols = viewMode === "detailed";
  const filterLabel = (() => {
    if (!isFiltered) return "";
    const names = sectorList.filter((s) => selectedSectors.has(s.id)).map((s) => s.name);
    if (names.length === 1) return names[0];
    return `${names.length} sectores`;
  })();

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {/* En modo per_m2 la card principal es el costo por m² (orange highlight),
            y la secundaria es el monto absoluto. En modo abs es al revés. */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground mb-1">
              {isPerM2 ? "Costo por m²" : "Total"}
              {isFiltered && <span className="font-medium text-foreground"> · {filterLabel}</span>}
            </p>
            <p className="text-3xl font-bold leading-tight">
              {isPerM2 ? (
                totalAreaM2 > 0
                  ? <>{fmt(perM2(grandTotal))} <span className="text-base font-normal text-muted-foreground">{currency}/m²</span></>
                  : <span className="text-muted-foreground text-lg font-normal">—</span>
              ) : (
                <>{fmt(grandTotal)} <span className="text-base font-normal text-muted-foreground">{currency}</span></>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground mb-1">
              Área {isFiltered ? "del sector" : "total del proyecto"}
            </p>
            <p className="text-3xl font-bold leading-tight">
              {totalAreaM2 > 0
                ? <>{formatNumber(totalAreaM2, 0)} <span className="text-base font-normal text-muted-foreground">m²</span></>
                : <span className="text-muted-foreground text-lg font-normal">— sin áreas</span>}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground mb-1">{isPerM2 ? "Total" : "Costo por m²"}</p>
            <p className="text-3xl font-bold leading-tight">
              {isPerM2 ? (
                <>{fmt(grandTotal)} <span className="text-base font-normal text-muted-foreground">{currency}</span></>
              ) : (
                totalAreaM2 > 0
                  ? <>{fmt(perM2(grandTotal))} <span className="text-base font-normal text-muted-foreground">{currency}/m²</span></>
                  : <span className="text-muted-foreground text-lg font-normal">—</span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex gap-2 items-center flex-wrap">
        {/* Modo de visualización: absoluto vs por m² */}
        <div className="inline-flex rounded-md border bg-background overflow-hidden">
          <button
            type="button"
            onClick={() => setMode("abs")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium transition-colors",
              mode === "abs" ? "bg-neutral-900 text-white" : "text-muted-foreground hover:bg-muted"
            )}
          >
            Absoluto
          </button>
          <button
            type="button"
            onClick={() => setMode("per_m2")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium transition-colors border-l",
              mode === "per_m2" ? "bg-neutral-900 text-white" : "text-muted-foreground hover:bg-muted"
            )}
          >
            Por m²
          </button>
        </div>

        {/* View mode toggle */}
        <div className="inline-flex rounded-md border bg-background overflow-hidden">
          <button
            type="button"
            onClick={() => setViewMode("simple")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium transition-colors",
              viewMode === "simple" ? "bg-neutral-900 text-white" : "text-muted-foreground hover:bg-muted"
            )}
          >
            Simplificado
          </button>
          <button
            type="button"
            onClick={() => setViewMode("detailed")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium transition-colors border-l",
              viewMode === "detailed" ? "bg-neutral-900 text-white" : "text-muted-foreground hover:bg-muted"
            )}
          >
            Detallado por sector
          </button>
        </div>

        {/* Sector multi-filter */}
        <div className="flex items-center gap-2">
          <Label className="text-sm">Sectores:</Label>
          <Popover open={sectorPickerOpen} onOpenChange={setSectorPickerOpen}>
            <PopoverTrigger
              render={
                <Button variant="outline" className="w-[240px] h-9 justify-between font-normal">
                  <span className="flex items-center gap-2 truncate">
                    <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {!isFiltered
                        ? "Todos los sectores"
                        : selectedSectors.size === 1
                          ? filterLabel
                          : `${selectedSectors.size} de ${sectorList.length} sectores`}
                    </span>
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </Button>
              }
            />
            <PopoverContent align="start" className="w-[280px] p-0">
              <div className="flex items-center justify-between p-2 border-b text-xs">
                <button
                  type="button"
                  className="text-foreground hover:underline"
                  onClick={() => setSelectedSectors(new Set(sectorList.map((s) => s.id)))}
                >
                  Seleccionar todos
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:underline"
                  onClick={() => setSelectedSectors(new Set())}
                >
                  Limpiar (todos)
                </button>
              </div>
              <div className="max-h-[320px] overflow-y-auto p-1">
                {sectorList.map((s) => {
                  const checked = selectedSectors.has(s.id);
                  return (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setSelectedSectors((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(s.id); else next.delete(s.id);
                            return next;
                          });
                        }}
                      />
                      <span className="flex-1 truncate">{s.name}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">
                        {s.type === "fisico" ? "FIS" : "GG"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>

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
        <div className="border rounded-lg overflow-hidden w-fit max-w-full">
          {/*
            w-fit max-w-full: la tabla crece sólo lo necesario para acomodar el
            contenido (no se estira a la pantalla cuando hay pocas columnas) y
            queda topada al ancho de la pantalla cuando el contenido es mayor
            (en ese caso el scroll horizontal del Table interior maneja el
            overflow).
          */}
          <Table className="w-auto border-separate border-spacing-0 [&_tr]:border-b-0 [&_td]:border-b [&_td]:border-border [&_th]:border-b [&_th]:border-border">
            <TableHeader>
              <TableRow className="bg-neutral-900 hover:bg-neutral-900">
                <TableHead className="w-[110px] min-w-[110px] max-w-[110px] text-white font-semibold text-sm sticky left-0 z-30 bg-neutral-900">Código</TableHead>
                <TableHead className="text-white font-semibold text-sm sticky left-[110px] z-30 bg-neutral-900 min-w-[260px] border-r-2 border-r-white/40">Descripción</TableHead>
                {showSectorCols && displayedSectors.map((s) => {
                  const m2 = Number(s.area_m2 || 0);
                  return (
                    <TableHead key={s.id} className="text-center w-[130px] min-w-[130px] max-w-[130px] text-white font-semibold text-sm align-middle">
                      <div className="leading-tight whitespace-normal break-words">
                        <div>{s.name}</div>
                        <div className="text-[11px] font-normal text-white/60">
                          {s.type === "fisico" && m2 > 0 ? `${formatNumber(m2, 0)} m²` : s.type === "gastos_generales" ? "GG" : "sin m²"}
                        </div>
                      </div>
                    </TableHead>
                  );
                })}
                <TableHead className="text-center w-[130px] min-w-[130px] max-w-[130px] text-white font-semibold text-sm align-middle border-l-2 border-l-white/40">
                  {isPerM2 ? (
                    <div className="leading-tight whitespace-normal break-words">
                      <div>Total {currency}/m²</div>
                      <div className="text-[11px] font-normal text-white/60">
                        {totalAreaM2 > 0 ? `${formatNumber(totalAreaM2, 0)} m²` : "sin m²"}
                      </div>
                    </div>
                  ) : (
                    <div className="leading-tight whitespace-normal break-words">Total ({currency})</div>
                  )}
                </TableHead>
                {!isPerM2 && (
                  <TableHead className="text-center w-[130px] min-w-[130px] max-w-[130px] text-white font-semibold text-sm align-middle">
                    <div className="leading-tight whitespace-normal break-words">
                      <div>{currency}/m²</div>
                      <div className="text-[11px] font-normal text-white/60">
                        {totalAreaM2 > 0 ? `${formatNumber(totalAreaM2, 0)} m²` : "sin m²"}
                      </div>
                    </div>
                  </TableHead>
                )}
                <TableHead className="text-center w-[80px] min-w-[80px] max-w-[80px] text-white font-semibold text-sm align-middle">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from(categoryTotals.entries()).map(([catId, cat]) => {
                const isOpen = expanded.has(catId);
                const catTotal = filteredTotal(cat.bySector);
                if (isFiltered && catTotal === 0) return null; // ocultar categorías sin datos en el sector
                return (
                  <React.Fragment key={catId}>
                    <TableRow
                      className="font-semibold bg-neutral-100 cursor-pointer hover:bg-neutral-200/70 border-l-[3px] border-l-[#E87722] text-[15px]"
                      onClick={() => toggleExpanded(catId)}
                    >
                      <TableCell className="sticky left-0 z-20 bg-neutral-100 w-[110px] min-w-[110px] max-w-[110px]">
                        <span className="inline-flex items-center gap-1">
                          {isOpen
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          <span className="text-[#E87722] font-mono">{cat.code}</span>
                        </span>
                      </TableCell>
                      <TableCell className="sticky left-[110px] z-20 bg-neutral-100 min-w-[260px] border-r-2 border-r-neutral-300">{cat.name}</TableCell>
                      {showSectorCols && displayedSectors.map((s) => {
                        const v = cat.bySector.get(s.id) || 0;
                        return (
                          <TableCell key={s.id} className="text-center font-mono w-[130px]">
                            {v > 0 ? fmtAmount(v, s) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center font-mono w-[130px] border-l-2 border-l-neutral-300">{fmtAmount(catTotal)}</TableCell>
                      {!isPerM2 && (
                        <TableCell className="text-center font-mono w-[130px]">
                          {totalAreaM2 > 0 ? fmt(perM2(catTotal)) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      )}
                      <TableCell className="text-center font-mono w-[80px] text-muted-foreground">
                        {grandTotal > 0 ? `${((catTotal / grandTotal) * 100).toFixed(1)}%` : "—"}
                      </TableCell>
                    </TableRow>
                    {isOpen && Array.from(cat.subs.entries()).map(([subId, sub]) => {
                      const arts = articulosBySub.get(subId) || [];
                      const subTotal = filteredTotal(sub.bySector);
                      if (isFiltered && subTotal === 0) return null;
                      return (
                        <React.Fragment key={subId}>
                          <TableRow
                            className="bg-background cursor-pointer hover:bg-muted/30 text-sm"
                            onClick={() => arts.length > 0 && setOpenSubArticles({ subId, subCode: sub.code, subName: sub.name })}
                            title={arts.length > 0 ? "Ver artículos en esta subcategoría" : "Sin artículos"}
                          >
                            <TableCell className="pl-4 text-muted-foreground sticky left-0 z-20 bg-background w-[110px] min-w-[110px] max-w-[110px]">
                              <span className="inline-flex items-center gap-1">
                                {arts.length > 0
                                  ? <Boxes className="h-3.5 w-3.5 text-[#E87722]" />
                                  : <span className="inline-block w-3.5" />}
                                <span className="text-[#E87722] font-mono">{sub.code}</span>
                              </span>
                            </TableCell>
                            <TableCell className="pl-8 sticky left-[110px] z-20 bg-background min-w-[260px] border-r-2 border-r-neutral-300">
                              {sub.name}
                              {arts.length > 0 && (
                                <span className="ml-2 text-[10px] text-muted-foreground">
                                  · {arts.length} {arts.length === 1 ? "artículo" : "artículos"}
                                </span>
                              )}
                            </TableCell>
                            {showSectorCols && displayedSectors.map((s) => {
                              const v = sub.bySector.get(s.id) || 0;
                              return (
                                <TableCell key={s.id} className="text-center font-mono w-[130px]">
                                  {v > 0 ? fmtAmount(v, s) : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                              );
                            })}
                            <TableCell className="text-center font-mono w-[130px] border-l-2 border-l-neutral-300">{fmtAmount(subTotal)}</TableCell>
                            {!isPerM2 && (
                              <TableCell className="text-center font-mono w-[130px]">
                                {totalAreaM2 > 0 ? fmt(perM2(subTotal)) : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            )}
                            <TableCell className="text-center font-mono w-[80px] text-muted-foreground">
                              {grandTotal > 0 ? `${((subTotal / grandTotal) * 100).toFixed(1)}%` : "—"}
                            </TableCell>
                          </TableRow>
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
              {/* Fila TOTAL */}
              <TableRow className={cn("font-bold border-t-2 border-neutral-900 bg-neutral-900 hover:bg-neutral-900")}>
                <TableCell className="sticky left-0 z-20 bg-neutral-900 w-[110px] min-w-[110px] max-w-[110px]"></TableCell>
                <TableCell className="text-white uppercase tracking-wider text-xs sticky left-[110px] z-20 bg-neutral-900 min-w-[260px] border-r-2 border-r-white/40">Total{isFiltered && <span className="normal-case ml-2">· {filterLabel}</span>}</TableCell>
                {showSectorCols && displayedSectors.map((s) => {
                  const v = grandBySector.get(s.id) || 0;
                  return (
                    <TableCell key={s.id} className="text-center font-mono text-white w-[130px]">
                      {v > 0 ? fmtAmount(v, s) : <span className="text-white/40">—</span>}
                    </TableCell>
                  );
                })}
                <TableCell className="text-center font-mono text-[#E87722] text-base w-[130px] border-l-2 border-l-white/40">{fmtAmount(grandTotal)}</TableCell>
                {!isPerM2 && (
                  <TableCell className="text-center font-mono text-[#E87722] w-[130px]">
                    {totalAreaM2 > 0 ? fmt(perM2(grandTotal)) : <span className="text-white/40">—</span>}
                  </TableCell>
                )}
                <TableCell className="text-center font-mono text-white w-[80px]">100.0%</TableCell>
              </TableRow>

              {/* Fila USD/m² por sector — sólo en vista detallada Y modo absoluto.
                  En modo per_m2 toda la tabla ya muestra USD/m² así que esta fila
                  es redundante y se omite. */}
              {showSectorCols && !isPerM2 && (() => {
                return (
                  <TableRow className="bg-background hover:bg-background text-sm">
                    <TableCell className="sticky left-0 z-20 bg-background w-[110px] min-w-[110px] max-w-[110px]"></TableCell>
                    <TableCell className="text-muted-foreground uppercase tracking-wider text-xs sticky left-[110px] z-20 bg-background min-w-[260px] border-r-2 border-r-neutral-300">{currency}/m² por sector</TableCell>
                    {displayedSectors.map((s) => {
                      const cost = grandBySector.get(s.id) || 0;
                      const m2 = s.type === "fisico" ? Number(s.area_m2 || 0) : projectAreaM2;
                      const valuePerM2 = m2 > 0 ? cost / m2 : 0;
                      return (
                        <TableCell key={s.id} className="text-center font-mono text-muted-foreground w-[130px]">
                          {m2 > 0
                            ? fmt(valuePerM2)
                            : <span className="text-muted-foreground/50 text-xs italic">sin m²</span>}
                        </TableCell>
                      );
                    })}
                    <TableCell className="w-[130px] border-l-2 border-l-neutral-300"></TableCell>
                    <TableCell className="w-[130px]"></TableCell>
                    <TableCell className="w-[80px]"></TableCell>
                  </TableRow>
                );
              })()}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Modal: artículos de la subcategoría seleccionada (caja flotante).
          Reemplaza al despliegue inline anterior — la caja tiene espacio
          propio y no rompe el layout horizontal de la tabla principal. */}
      <Dialog open={!!openSubArticles} onOpenChange={(open) => { if (!open) setOpenSubArticles(null); }}>
        <DialogContent className="sm:max-w-5xl max-h-[92vh] overflow-y-auto">
          {openSubArticles && (() => {
            const arts = articulosBySub.get(openSubArticles.subId) || [];
            const subTotal = arts.reduce((s, a) => s + filteredTotal(a.costBySector), 0);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Boxes className="h-5 w-5 text-[#E87722]" />
                    Artículos en {openSubArticles.subCode} {openSubArticles.subName}
                  </DialogTitle>
                  <DialogDescription>
                    {arts.length} {arts.length === 1 ? "artículo" : "artículos"}
                    {isFiltered && filterLabel && <> · filtrado por {filterLabel}</>}
                    {" · Click en un artículo para ver sus insumos"}
                  </DialogDescription>
                </DialogHeader>

                {arts.length === 0 ? (
                  <p className="text-sm italic text-muted-foreground py-6 text-center">
                    Esta subcategoría no tiene artículos cuantificados.
                  </p>
                ) : (
                  <div className="border rounded-md overflow-hidden bg-background">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-neutral-900">
                          <th className="text-center px-3 py-2 font-semibold text-xs uppercase tracking-wider text-white w-[80px]">Cód.</th>
                          <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wider text-white">Artículo</th>
                          <th className="text-center px-3 py-2 font-semibold text-xs uppercase tracking-wider text-white w-[70px]">Unidad</th>
                          {showSectorCols && displayedSectors.map((s) => (
                            <th key={s.id} className="text-center px-2 py-2 font-semibold text-xs uppercase tracking-wider text-white w-[130px] min-w-[130px] max-w-[130px] align-middle">
                              <div className="leading-tight whitespace-normal break-words">{s.name}</div>
                            </th>
                          ))}
                          <th className="text-center px-3 py-2 font-semibold text-xs uppercase tracking-wider text-white w-[130px] min-w-[130px] max-w-[130px] align-middle">
                            <div className="leading-tight whitespace-normal break-words">{isPerM2 ? `Total ${currency}/m²` : `Total (${currency})`}</div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {arts.map((a) => {
                          const aTotal = filteredTotal(a.costBySector);
                          if (isFiltered && aTotal === 0) return null;
                          return (
                            <tr
                              key={a.articuloId}
                              className="border-t hover:bg-muted/10 cursor-pointer"
                              onClick={() => setSelectedArt(a)}
                              title="Ver insumos del artículo"
                            >
                              <td className="px-3 py-2 text-center font-mono text-muted-foreground w-[80px]">{a.number}</td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1.5">
                                  <Boxes className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                                  {a.description}
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  Cant. total: <span className="font-mono">{formatNumber(a.quantity)}</span> {a.unit} · P.U. <span className="font-mono">{fmt(a.unitCost)}</span> {currency}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-center text-muted-foreground w-[70px]">{a.unit}</td>
                              {showSectorCols && displayedSectors.map((s) => {
                                const v = a.costBySector.get(s.id) || 0;
                                return (
                                  <td key={s.id} className="px-2 py-2 text-center font-mono w-[130px]">
                                    {v > 0
                                      ? fmtAmount(v, s)
                                      : <span className="text-muted-foreground">—</span>}
                                  </td>
                                );
                              })}
                              <td className="px-2 py-2 text-center font-mono font-semibold w-[130px]">{fmtAmount(aTotal)}</td>
                            </tr>
                          );
                        })}
                        <tr className="border-t-2 border-neutral-900 bg-neutral-900 font-bold">
                          <td colSpan={3} className="px-3 py-2 text-right text-xs uppercase tracking-wider text-white">
                            Subtotal
                          </td>
                          {showSectorCols && displayedSectors.map((s) => {
                            const v = arts.reduce((sum, a) => sum + (a.costBySector.get(s.id) || 0), 0);
                            return (
                              <td key={s.id} className="px-2 py-2 text-center font-mono text-white w-[130px]">
                                {v > 0 ? fmtAmount(v, s) : <span className="text-white/40">—</span>}
                              </td>
                            );
                          })}
                          <td className="px-2 py-2 text-center font-mono text-[#E87722] w-[130px]">
                            {fmtAmount(subTotal)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Modal: insumos del artículo seleccionado */}
      <Dialog open={!!selectedArt} onOpenChange={(open) => { if (!open) setSelectedArt(null); }}>
        <DialogContent className="sm:max-w-3xl">
          {selectedArt && (() => {
            const comps = compsByArticulo.get(selectedArt.articuloId) || [];
            const totalCompCost = comps.reduce((s, c) => s + c.compQuantity * selectedArt.quantity * c.unitCost, 0);
            const sectorEntries = sectorList
              .map((s) => ({ s, qty: selectedArt.qtyBySector.get(s.id) || 0, cost: selectedArt.costBySector.get(s.id) || 0 }))
              .filter((e) => e.qty > 0);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Boxes className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-muted-foreground text-sm">#{selectedArt.number}</span>
                    {selectedArt.description}
                  </DialogTitle>
                  <DialogDescription>
                    Composición y cantidades del artículo en este proyecto.
                  </DialogDescription>
                </DialogHeader>

                {/* KPIs */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Cantidad total</p>
                    <p className="text-lg font-bold leading-tight">
                      {formatNumber(selectedArt.quantity)} <span className="text-xs font-normal text-muted-foreground">{selectedArt.unit}</span>
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Costo unitario</p>
                    <p className="text-lg font-bold leading-tight">
                      {fmt(selectedArt.unitCost)} <span className="text-xs font-normal text-muted-foreground">{currency}</span>
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Costo total</p>
                    <p className="text-lg font-bold leading-tight" style={{ color: "#E87722" }}>
                      {fmt(selectedArt.total)} <span className="text-xs font-normal text-muted-foreground">{currency}</span>
                    </p>
                  </div>
                </div>

                {/* Distribución por sector */}
                {sectorEntries.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Distribución por sector</p>
                    <div className="border rounded-md overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-neutral-100">
                            <th className="text-left px-3 py-1.5 font-semibold">Sector</th>
                            <th className="text-right px-3 py-1.5 font-semibold">Cantidad</th>
                            <th className="text-right px-3 py-1.5 font-semibold">Costo ({currency})</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sectorEntries.map((e) => (
                            <tr key={e.s.id} className="border-t">
                              <td className="px-3 py-1.5">{e.s.name}</td>
                              <td className="px-3 py-1.5 text-right font-mono">{formatNumber(e.qty)} {selectedArt.unit}</td>
                              <td className="px-3 py-1.5 text-right font-mono">{fmt(e.cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Insumos */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                    Insumos del artículo
                    {comps.length > 0 && <span className="text-muted-foreground/70 normal-case"> · {comps.length} {comps.length === 1 ? "insumo" : "insumos"}</span>}
                  </p>
                  {comps.length === 0 ? (
                    <p className="text-xs italic text-muted-foreground py-3 text-center border rounded-md">
                      Este artículo no tiene insumos en su composición.
                    </p>
                  ) : (
                    <div className="border rounded-md overflow-hidden max-h-[40vh] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 z-10">
                          <tr className="bg-neutral-900 text-white">
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-wider">Insumo</th>
                            <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-wider w-[60px]">Unidad</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-wider w-[100px]">Cant. p/u</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-wider w-[120px]">Cant. total</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-wider w-[100px]">P.U. ({currency})</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-wider w-[120px]">Total ({currency})</th>
                          </tr>
                        </thead>
                        <tbody>
                          {comps.map((c, idx) => {
                            const totalQty = c.compQuantity * selectedArt.quantity;
                            const totalCost = totalQty * c.unitCost;
                            return (
                              <tr key={`${c.insumoId}-${idx}`} className="border-t hover:bg-muted/10">
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-1.5">
                                    <span className={cn(
                                      "w-1.5 h-1.5 rounded-full shrink-0",
                                      c.type === "material" ? "bg-neutral-700" :
                                      c.type === "mano_de_obra" ? "bg-amber-400" :
                                      c.type === "servicio" ? "bg-emerald-400" : "bg-gray-400"
                                    )} />
                                    {c.insumoCode != null && <span className="font-mono text-muted-foreground text-[10px]">{c.insumoCode}</span>}
                                    <span>{c.description}</span>
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-center text-muted-foreground">{c.unit}</td>
                                <td className="px-3 py-2 text-right font-mono">{formatNumber(c.compQuantity, 4)}</td>
                                <td className="px-3 py-2 text-right font-mono">{formatNumber(totalQty)}</td>
                                <td className="px-3 py-2 text-right font-mono">{fmt(c.unitCost)}</td>
                                <td className="px-3 py-2 text-right font-mono font-medium">{fmt(totalCost)}</td>
                              </tr>
                            );
                          })}
                          <tr className="border-t-2 border-neutral-900 bg-neutral-900 font-bold">
                            <td colSpan={5} className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-white">
                              Total composición
                            </td>
                            <td className="px-3 py-2 text-right font-mono" style={{ color: "#E87722" }}>{fmt(totalCompCost)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
