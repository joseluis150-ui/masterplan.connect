"use client";

import { useEffect, useState, useCallback, use, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ColumnFilter, type SortDirection } from "@/components/shared/column-filter";
import {
  ArrowLeft, Package, Loader2, Truck, ShoppingCart, Lock,
  PackagePlus, X, ChevronDown, ChevronRight, Layers, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { formatNumber } from "@/lib/utils/formula";
import type {
  ProcurementPackage, ProcurementLine, Insumo, Articulo, ArticuloComposition,
  EdtCategory, EdtSubcategory, Sector, QuantificationLine,
} from "@/lib/types/database";

type TabKey = "insumos" | "asignar";

/** Línea enriquecida para la tabla de "Asignar líneas". Contiene labels
 *  de articulo/sector/cat/subcat ya resueltos para evitar lookups en
 *  cada render — mismo patrón que cuantificacion/page.tsx. */
interface AssignableLine {
  id: string;
  articulo_id: string | null;
  articulo_desc: string;
  articulo_unit: string;
  articulo_pu: number;
  articulo_number: number | null;
  quantity: number | null;
  category_id: string;
  subcategory_id: string;
  sector_id: string;
  /** Si es null → no asignada a ningún paquete. Si es el packageId
   *  actual → asignada acá. Si es otro id → asignada a otro paquete. */
  assigned_to_package_id: string | null;
}

/**
 * Vista de detalle de un paquete de procurement. Reemplaza la pantalla
 * monolítica anterior con dos tabs:
 *   - "Insumos asignados": tabla read-only con los procurement_lines
 *     del paquete (descripción del insumo, unidad, artículo origen).
 *   - "Asignar líneas": tabla tipo cuantificación read-only con
 *     checkboxes, filtros multi-select por columna, y botón para
 *     asignar las seleccionadas a este paquete vía RPC.
 */
export default function PackageDetailPage({
  params,
}: {
  params: Promise<{ id: string; packageId: string }>;
}) {
  const { id: projectId, packageId } = use(params);
  const router = useRouter();
  const supabase = createClient();

  const [pkg, setPkg] = useState<ProcurementPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("insumos");

  // Datos para tab 1 (Insumos asignados)
  const [pkgLines, setPkgLines] = useState<(ProcurementLine & {
    insumo?: Insumo;
    composition?: ArticuloComposition;
    articulo?: Articulo;
  })[]>([]);

  // Datos para tab 2 (Asignar líneas)
  const [allLines, setAllLines] = useState<AssignableLine[]>([]);
  const [allArticulos, setAllArticulos] = useState<Articulo[]>([]);
  const [categories, setCategories] = useState<EdtCategory[]>([]);
  const [subcategories, setSubcategories] = useState<EdtSubcategory[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [allPackages, setAllPackages] = useState<ProcurementPackage[]>([]);

  // Selección + filtros del tab "Asignar"
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterArticulo, setFilterArticulo] = useState<Set<string>>(new Set());
  const [filterUnit, setFilterUnit] = useState<Set<string>>(new Set());
  const [filterCategory, setFilterCategory] = useState<Set<string>>(new Set());
  const [filterSubcategory, setFilterSubcategory] = useState<Set<string>>(new Set());
  const [filterSector, setFilterSector] = useState<Set<string>>(new Set());
  /** "all" | "unassigned" | "assigned_here" | "assigned_other" — útil
   *  para filtrar rápido las líneas que faltan asignar a este paquete. */
  const [filterAssigned, setFilterAssigned] = useState<"all" | "unassigned" | "here" | "other">("all");
  const [sort, setSort] = useState<{ key: string; dir: SortDirection }>({ key: "", dir: null });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [
      pkgRes, plRes, qlRes, artsRes, catsRes, subsRes, sectsRes, puRes, allPkgRes,
    ] = await Promise.all([
      supabase.from("procurement_packages").select("*").eq("id", packageId).single(),
      supabase.from("procurement_lines")
        .select("*, insumo:insumos(*), composition:articulo_compositions(*)")
        .eq("package_id", packageId),
      supabase.from("quantification_lines").select("*").eq("project_id", projectId).is("deleted_at", null).order("line_number"),
      supabase.from("articulos").select("*").eq("project_id", projectId).order("number"),
      supabase.from("edt_categories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("sectors").select("*").eq("project_id", projectId).order("order"),
      supabase.rpc("get_project_articulo_totals", { p_project_id: projectId }),
      supabase.from("procurement_packages").select("*").eq("project_id", projectId),
    ]);

    if (pkgRes.error || !pkgRes.data) {
      toast.error("Paquete no encontrado");
      router.push(`/project/${projectId}/paquetes`);
      return;
    }
    setPkg(pkgRes.data as ProcurementPackage);

    const arts = (artsRes.data ?? []) as Articulo[];
    setAllArticulos(arts);
    setCategories((catsRes.data ?? []) as EdtCategory[]);
    setSubcategories((subsRes.data ?? []) as EdtSubcategory[]);
    setSectors((sectsRes.data ?? []) as Sector[]);
    setAllPackages((allPkgRes.data ?? []) as ProcurementPackage[]);

    // PU map: articulo_id → costo unitario
    const pus: Record<string, number> = {};
    for (const row of (puRes.data ?? []) as { articulo_id: string; pu_costo: number }[]) {
      pus[row.articulo_id] = Number(row.pu_costo);
    }

    // Para conocer asignaciones de cada articulo a packages — hacemos
    // una query: composition_id pertenece a articulo_id, y procurement_lines
    // referencia composition_id. Cargamos TODAS las procurement_lines de
    // los packages del proyecto para construir el map articulo_id → package_id.
    const { data: allPlData } = await supabase
      .from("procurement_lines")
      .select("package_id, composition_id, insumo_id");
    const allCompsRes = await supabase
      .from("articulo_compositions")
      .select("id, articulo_id")
      .in("articulo_id", arts.map((a) => a.id).length > 0 ? arts.map((a) => a.id) : ["__none__"]);
    const compToArticulo = new Map<string, string>();
    for (const c of (allCompsRes.data ?? []) as { id: string; articulo_id: string }[]) {
      compToArticulo.set(c.id, c.articulo_id);
    }
    // articulo_id → package_id (si CUALQUIER comp del articulo está en
    // un package, marcamos todo el articulo como asignado a ese package)
    const articuloToPkg = new Map<string, string>();
    const projectPkgIds = new Set(((allPkgRes.data ?? []) as ProcurementPackage[]).map((p) => p.id));
    for (const pl of (allPlData ?? []) as { package_id: string; composition_id: string | null }[]) {
      if (!projectPkgIds.has(pl.package_id) || !pl.composition_id) continue;
      const artId = compToArticulo.get(pl.composition_id);
      if (artId && !articuloToPkg.has(artId)) {
        articuloToPkg.set(artId, pl.package_id);
      }
    }

    // Enriquecer lineas para tab "Asignar"
    const enriched: AssignableLine[] = ((qlRes.data ?? []) as QuantificationLine[]).map((line) => {
      const art = arts.find((a) => a.id === line.articulo_id);
      return {
        id: line.id,
        articulo_id: line.articulo_id,
        articulo_desc: art?.description ?? "",
        articulo_unit: art?.unit ?? "",
        articulo_pu: line.articulo_id ? (pus[line.articulo_id] ?? 0) : 0,
        articulo_number: art?.number ?? null,
        quantity: line.quantity,
        category_id: line.category_id,
        subcategory_id: line.subcategory_id,
        sector_id: line.sector_id,
        assigned_to_package_id: line.articulo_id
          ? (articuloToPkg.get(line.articulo_id) ?? null)
          : null,
      };
    });
    setAllLines(enriched);

    // procurement_lines del paquete actual con join a articulo (vía composition)
    const pkgLinesRaw = (plRes.data ?? []) as (ProcurementLine & {
      insumo?: Insumo;
      composition?: ArticuloComposition;
    })[];
    const enrichedPkgLines = pkgLinesRaw.map((pl) => ({
      ...pl,
      articulo: pl.composition?.articulo_id
        ? arts.find((a) => a.id === pl.composition!.articulo_id)
        : undefined,
    }));
    setPkgLines(enrichedPkgLines);

    setLoading(false);
  }, [projectId, packageId, supabase, router]);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── Asignar líneas seleccionadas al paquete actual ── */
  async function assignSelectedLines() {
    if (selected.size === 0) return;
    if (pkg?.status === "aprobado") {
      toast.error("Paquete aprobado — no se puede modificar");
      return;
    }
    setAssigning(true);
    const { data, error } = await supabase.rpc("assign_lines_to_package", {
      p_project_id: projectId,
      p_line_ids: Array.from(selected),
      p_package_id: packageId,
    });
    setAssigning(false);
    if (error) { toast.error(`Error: ${error.message}`); return; }
    const r = (data ?? {}) as {
      assigned: number;
      already_in_package: number;
      conflicts: number;
      skipped_no_articulo: number;
      conflict_packages: { name: string; count: number }[];
    };
    if (r.assigned > 0) toast.success(`${r.assigned} insumo${r.assigned === 1 ? "" : "s"} asignado${r.assigned === 1 ? "" : "s"}`);
    if (r.already_in_package > 0) toast.info(`${r.already_in_package} ya estaban en este paquete`);
    if (r.conflicts > 0 && r.conflict_packages.length > 0) {
      const breakdown = r.conflict_packages.map((p) => `"${p.name}" (${p.count})`).join(", ");
      toast.warning(`${r.conflicts} ya en otros: ${breakdown}`, { duration: 6000 });
    }
    if (r.skipped_no_articulo > 0) toast.info(`${r.skipped_no_articulo} línea${r.skipped_no_articulo === 1 ? "" : "s"} sin artículo (skip)`);
    if (r.assigned === 0 && r.already_in_package === 0 && r.conflicts === 0) {
      toast.info("Nada que asignar");
    }
    setSelected(new Set());
    await loadData();
  }

  /* ── Quitar una línea de procurement (insumo) del paquete ── */
  async function removePkgLine(plId: string) {
    if (pkg?.status === "aprobado") return;
    if (!confirm("¿Quitar este insumo del paquete?")) return;
    const { error } = await supabase.from("procurement_lines").delete().eq("id", plId);
    if (error) { toast.error(error.message); return; }
    toast.success("Insumo removido del paquete");
    await loadData();
  }

  /* ── Filtros y derivados para tab "Asignar" ── */
  const filtered = useMemo(() => {
    return allLines.filter((l) => {
      const artLabel = l.articulo_desc || "(Sin artículo)";
      const unitLabel = l.articulo_unit || "(Vacío)";
      const cat = categories.find((c) => c.id === l.category_id);
      const catLabel = cat ? `${cat.code} ${cat.name}` : "(Vacío)";
      const sub = subcategories.find((s) => s.id === l.subcategory_id);
      const subLabel = sub ? `${sub.code} ${sub.name}` : "(Vacío)";
      const sec = sectors.find((s) => s.id === l.sector_id);
      const secLabel = sec?.name ?? "(Vacío)";

      if (filterArticulo.size > 0 && !filterArticulo.has(artLabel)) return false;
      if (filterUnit.size > 0 && !filterUnit.has(unitLabel)) return false;
      if (filterCategory.size > 0 && !filterCategory.has(catLabel)) return false;
      if (filterSubcategory.size > 0 && !filterSubcategory.has(subLabel)) return false;
      if (filterSector.size > 0 && !filterSector.has(secLabel)) return false;
      if (filterAssigned !== "all") {
        if (filterAssigned === "unassigned" && l.assigned_to_package_id !== null) return false;
        if (filterAssigned === "here" && l.assigned_to_package_id !== packageId) return false;
        if (filterAssigned === "other" && (l.assigned_to_package_id === null || l.assigned_to_package_id === packageId)) return false;
      }
      return true;
    });
  }, [allLines, categories, subcategories, sectors, filterArticulo, filterUnit, filterCategory, filterSubcategory, filterSector, filterAssigned, packageId]);

  const sorted = useMemo(() => {
    if (!sort.dir) return filtered;
    const mult = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "articulo": return mult * a.articulo_desc.localeCompare(b.articulo_desc, "es");
        case "unit": return mult * a.articulo_unit.localeCompare(b.articulo_unit, "es");
        case "pu": return mult * (a.articulo_pu - b.articulo_pu);
        case "quantity": return mult * ((Number(a.quantity) || 0) - (Number(b.quantity) || 0));
        case "total": return mult * (((Number(a.quantity) || 0) * a.articulo_pu) - ((Number(b.quantity) || 0) * b.articulo_pu));
        default: return 0;
      }
    });
  }, [filtered, sort]);

  // Únicos para los ColumnFilter
  const uniqueArticulos = useMemo(() => Array.from(new Set(allLines.map((l) => l.articulo_desc || "(Sin artículo)"))), [allLines]);
  const uniqueUnits = useMemo(() => Array.from(new Set(allLines.map((l) => l.articulo_unit || "(Vacío)"))), [allLines]);
  const uniqueCategories = useMemo(() => Array.from(new Set(allLines.map((l) => {
    const c = categories.find((c) => c.id === l.category_id);
    return c ? `${c.code} ${c.name}` : "(Vacío)";
  }))), [allLines, categories]);
  const uniqueSubcategories = useMemo(() => Array.from(new Set(allLines.map((l) => {
    const s = subcategories.find((s) => s.id === l.subcategory_id);
    return s ? `${s.code} ${s.name}` : "(Vacío)";
  }))), [allLines, subcategories]);
  const uniqueSectors = useMemo(() => Array.from(new Set(allLines.map((l) => {
    const s = sectors.find((s) => s.id === l.sector_id);
    return s?.name ?? "(Vacío)";
  }))), [allLines, sectors]);

  // Conteos para los filter chips de "Asignación"
  const counts = useMemo(() => ({
    total: allLines.length,
    unassigned: allLines.filter((l) => l.assigned_to_package_id === null).length,
    here: allLines.filter((l) => l.assigned_to_package_id === packageId).length,
    other: allLines.filter((l) => l.assigned_to_package_id !== null && l.assigned_to_package_id !== packageId).length,
  }), [allLines, packageId]);

  // Agrupar visualmente por sector → categoría → subcategoría (mismo
  // patrón que cuantificacion). Las líneas dentro del último nivel
  // respetan el sort actual.
  type GroupRow =
    | { kind: "header"; level: number; key: string; label: string; count: number; collapsed: boolean }
    | { kind: "line"; line: AssignableLine };

  const groupedRows: GroupRow[] = useMemo(() => {
    const rows: GroupRow[] = [];
    const bySector = new Map<string, AssignableLine[]>();
    for (const l of sorted) {
      const k = l.sector_id;
      if (!bySector.has(k)) bySector.set(k, []);
      bySector.get(k)!.push(l);
    }
    // Iterar respetando orden de sectors
    const sectorOrdered = sectors.map((s) => s.id).filter((id) => bySector.has(id));
    for (const secId of sectorOrdered) {
      const sec = sectors.find((s) => s.id === secId);
      const lines = bySector.get(secId)!;
      const secKey = `sec::${secId}`;
      const secCollapsed = collapsedGroups.has(secKey);
      rows.push({ kind: "header", level: 0, key: secKey, label: sec?.name ?? "(Sin sector)", count: lines.length, collapsed: secCollapsed });
      if (secCollapsed) continue;

      // Por categoría
      const byCat = new Map<string, AssignableLine[]>();
      for (const l of lines) {
        if (!byCat.has(l.category_id)) byCat.set(l.category_id, []);
        byCat.get(l.category_id)!.push(l);
      }
      const catOrdered = categories.map((c) => c.id).filter((id) => byCat.has(id));
      for (const catId of catOrdered) {
        const cat = categories.find((c) => c.id === catId);
        const catLines = byCat.get(catId)!;
        const catKey = `cat::${secId}::${catId}`;
        const catCollapsed = collapsedGroups.has(catKey);
        rows.push({ kind: "header", level: 1, key: catKey, label: cat ? `${cat.code} ${cat.name}` : "(Sin categoría)", count: catLines.length, collapsed: catCollapsed });
        if (catCollapsed) continue;

        // Por subcategoría
        const bySub = new Map<string, AssignableLine[]>();
        for (const l of catLines) {
          if (!bySub.has(l.subcategory_id)) bySub.set(l.subcategory_id, []);
          bySub.get(l.subcategory_id)!.push(l);
        }
        const subOrdered = subcategories.map((s) => s.id).filter((id) => bySub.has(id));
        for (const subId of subOrdered) {
          const sub = subcategories.find((s) => s.id === subId);
          const subLines = bySub.get(subId)!;
          const subKey = `sub::${secId}::${catId}::${subId}`;
          const subCollapsed = collapsedGroups.has(subKey);
          rows.push({ kind: "header", level: 2, key: subKey, label: sub ? `${sub.code} ${sub.name}` : "(Sin subcategoría)", count: subLines.length, collapsed: subCollapsed });
          if (subCollapsed) continue;
          for (const l of subLines) rows.push({ kind: "line", line: l });
        }
      }
    }
    return rows;
  }, [sorted, sectors, categories, subcategories, collapsedGroups]);

  const visibleLineIds = useMemo(() =>
    new Set(groupedRows.filter((r) => r.kind === "line").map((r) => (r as { kind: "line"; line: AssignableLine }).line.id))
  , [groupedRows]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === visibleLineIds.size && visibleLineIds.size > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleLineIds));
    }
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleSort(key: string) {
    return () => {
      setSort((prev) => {
        if (prev.key !== key) return { key, dir: "asc" };
        if (prev.dir === "asc") return { key, dir: "desc" };
        return { key: "", dir: null };
      });
    };
  }

  if (loading) {
    return <div className="p-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!pkg) return null;

  const isApproved = pkg.status === "aprobado";

  return (
    <div className="p-6 space-y-4">
      {/* Header con breadcrumb / volver y datos del paquete */}
      <div className="flex items-start gap-3">
        <Button variant="outline" size="sm" onClick={() => router.push(`/project/${projectId}/paquetes`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Paquetes
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Package className="h-5 w-5 text-[#E87722]" />
            {pkg.name}
          </h1>
          <div className="flex flex-wrap gap-1.5 mt-1">
            <Badge variant="outline" className={pkg.purchase_type === "licitacion"
              ? "text-xs border-[#E87722]/30 text-[#E87722] bg-[#E87722]/5"
              : "text-xs"}>
              {pkg.purchase_type === "licitacion" ? <Truck className="h-3 w-3 mr-0.5" /> : <ShoppingCart className="h-3 w-3 mr-0.5" />}
              {pkg.purchase_type === "licitacion" ? "Licitación" : "Compra directa"}
            </Badge>
            {isApproved ? (
              <Badge className="text-xs bg-emerald-600 text-white"><Lock className="h-3 w-3 mr-0.5" /> Aprobado</Badge>
            ) : (
              <Badge variant="outline" className="text-xs text-muted-foreground">Borrador</Badge>
            )}
            <Badge variant="outline" className="text-xs">
              <Package className="h-3 w-3 mr-0.5" /> {pkgLines.length} insumo{pkgLines.length === 1 ? "" : "s"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {[
          { key: "insumos" as const, label: "Insumos asignados", count: pkgLines.length },
          { key: "asignar" as const, label: "Asignar líneas", count: counts.total },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab.key
                ? "border-[#E87722] text-[#E87722]"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            <span className="ml-1.5 text-[10px] font-mono text-muted-foreground">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* Tab 1: Insumos asignados */}
      {activeTab === "insumos" && (
        <div>
          {pkgLines.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center space-y-3">
                <Package className="h-10 w-10 mx-auto text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Este paquete aún no tiene insumos asignados.
                </p>
                <Button onClick={() => setActiveTab("asignar")} className="bg-[#E87722] hover:bg-[#E87722]/90 text-white">
                  <PackagePlus className="h-4 w-4 mr-2" /> Asignar líneas
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 260px)" }}>
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background border-b">
                  <tr>
                    <th className="px-2 py-2 text-left text-[11px] uppercase tracking-wider font-semibold w-16">#</th>
                    <th className="px-2 py-2 text-left text-[11px] uppercase tracking-wider font-semibold">Insumo</th>
                    <th className="px-2 py-2 text-center text-[11px] uppercase tracking-wider font-semibold w-24">Unidad</th>
                    <th className="px-2 py-2 text-left text-[11px] uppercase tracking-wider font-semibold">Artículo origen</th>
                    <th className="px-2 py-2 text-right text-[11px] uppercase tracking-wider font-semibold w-24">PU USD</th>
                    {!isApproved && <th className="w-12"></th>}
                  </tr>
                </thead>
                <tbody>
                  {pkgLines.map((pl) => (
                    <tr key={pl.id} className="border-b hover:bg-muted/30">
                      <td className="px-2 py-1.5 text-xs font-mono text-muted-foreground">{pl.insumo?.code ?? "—"}</td>
                      <td className="px-2 py-1.5">{pl.insumo?.description ?? "(insumo no encontrado)"}</td>
                      <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">{pl.insumo?.unit ?? ""}</td>
                      <td className="px-2 py-1.5 text-xs">
                        {pl.articulo
                          ? <span><span className="font-mono text-muted-foreground">#{pl.articulo.number}</span> {pl.articulo.description}</span>
                          : <span className="text-muted-foreground italic">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs">
                        {pl.insumo?.pu_usd ? formatNumber(Number(pl.insumo.pu_usd), 2) : "—"}
                      </td>
                      {!isApproved && (
                        <td className="px-2 py-1.5 text-center">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removePkgLine(pl.id)} title="Quitar del paquete">
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Asignar líneas — tabla cuantificación read-only con
          checkboxes, filtros multi-select y botón asignar */}
      {activeTab === "asignar" && (
        <div className="space-y-3">
          {/* Toolbar: chips de asignación + barra de bulk + limpiar */}
          <div className="flex items-center gap-2 flex-wrap">
            {([
              { v: "all", label: "Todas", count: counts.total },
              { v: "unassigned", label: "Sin asignar", count: counts.unassigned },
              { v: "here", label: "En este paquete", count: counts.here },
              { v: "other", label: "En otros paquetes", count: counts.other },
            ] as const).map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setFilterAssigned(opt.v)}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-md border transition-colors",
                  filterAssigned === opt.v
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "bg-background text-muted-foreground hover:bg-muted"
                )}
              >
                {opt.label} <span className="ml-1 font-mono text-[10px] opacity-70">{opt.count}</span>
              </button>
            ))}
            {(filterArticulo.size + filterUnit.size + filterCategory.size + filterSubcategory.size + filterSector.size > 0) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-destructive hover:text-destructive"
                onClick={() => {
                  setFilterArticulo(new Set()); setFilterUnit(new Set());
                  setFilterCategory(new Set()); setFilterSubcategory(new Set());
                  setFilterSector(new Set());
                }}
              >
                <X className="h-3 w-3 mr-1" /> Limpiar filtros de columna
              </Button>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {filtered.length} línea{filtered.length === 1 ? "" : "s"} visible{filtered.length === 1 ? "" : "s"}
            </span>
          </div>

          {/* Barra contextual de bulk: aparece cuando hay líneas seleccionadas */}
          {selected.size > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[#0A0A0A] text-white shadow-md">
              <span className="text-sm font-medium">
                {selected.size} línea{selected.size === 1 ? "" : "s"} seleccionada{selected.size === 1 ? "" : "s"}
              </span>
              <span className="h-4 w-px bg-white/20 mx-1" />
              <Button
                size="sm"
                variant="ghost"
                onClick={assignSelectedLines}
                disabled={assigning || isApproved}
                className="text-xs h-7 text-white hover:bg-white/10 hover:text-white"
                title={isApproved
                  ? "Paquete aprobado — no se puede modificar"
                  : `Asignar ${selected.size} a "${pkg.name}"`}
              >
                {assigning
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Asignando...</>
                  : <><PackagePlus className="h-3.5 w-3.5 mr-1" />Asignar a "{pkg.name}"</>}
              </Button>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(new Set())}
                  className="text-xs h-7 text-white/70 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Deseleccionar
                </Button>
              </div>
            </div>
          )}

          {/* Tabla read-only tipo cuantificación */}
          <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
            <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "32px" }} />
                <col style={{ width: "40px" }} />
                <col style={{ width: "260px" }} />
                <col style={{ width: "60px" }} />
                <col style={{ width: "100px" }} />
                <col style={{ width: "100px" }} />
                <col style={{ width: "115px" }} />
                <col style={{ width: "115px" }} />
                <col style={{ width: "100px" }} />
                <col style={{ width: "120px" }} />
              </colgroup>
              <thead className="sticky top-0 z-30 bg-background shadow-sm">
                <tr>
                  <th className="px-1 py-2 text-center bg-background">
                    <input
                      type="checkbox"
                      checked={visibleLineIds.size > 0 && selected.size === visibleLineIds.size}
                      onChange={toggleSelectAll}
                      className="h-3.5 w-3.5 rounded cursor-pointer accent-[#E87722]"
                    />
                  </th>
                  <th className="px-2 py-2 text-left uppercase text-[11px] font-semibold tracking-wider">#</th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Artículo" values={uniqueArticulos} activeValues={filterArticulo} onChange={setFilterArticulo} sortDirection={sort.key === "articulo" ? sort.dir : null} onSort={handleSort("articulo")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Und" values={uniqueUnits} activeValues={filterUnit} onChange={setFilterUnit} align="center" sortDirection={sort.key === "unit" ? sort.dir : null} onSort={handleSort("unit")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="PU USD" values={[]} activeValues={new Set()} onChange={() => {}} align="right" sortDirection={sort.key === "pu" ? sort.dir : null} onSort={handleSort("pu")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Cantidad" values={[]} activeValues={new Set()} onChange={() => {}} align="right" sortDirection={sort.key === "quantity" ? sort.dir : null} onSort={handleSort("quantity")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Categoría" values={uniqueCategories} activeValues={filterCategory} onChange={setFilterCategory} sortDirection={null} onSort={() => {}} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Subcat." values={uniqueSubcategories} activeValues={filterSubcategory} onChange={setFilterSubcategory} sortDirection={null} onSort={() => {}} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Sector" values={uniqueSectors} activeValues={filterSector} onChange={setFilterSector} sortDirection={null} onSort={() => {}} />
                  </th>
                  <th className="px-2 py-2 text-left uppercase text-[11px] font-semibold tracking-wider">Asignación</th>
                </tr>
              </thead>
              <tbody>
                {groupedRows.map((row) => {
                  if (row.kind === "header") {
                    const headerStyles = [
                      { bg: "#404040", color: "#fff", weight: "font-bold", border: "3px solid #0A0A0A" },
                      { bg: "#A3A3A3", color: "#fff", weight: "font-semibold", border: "1px solid #737373" },
                      { bg: "#E5E5E5", color: "#0A0A0A", weight: "font-semibold", border: "1px solid #BFBFBF" },
                    ][row.level] ?? { bg: "#F5F5F5", color: "#0A0A0A", weight: "font-medium", border: "1px solid #D4D4D4" };
                    return (
                      <tr key={row.key} style={{ background: headerStyles.bg, color: headerStyles.color, borderTop: headerStyles.border }}>
                        <td colSpan={10} className={cn("px-2 py-1.5 text-xs", headerStyles.weight)}>
                          <button
                            type="button"
                            onClick={() => toggleGroup(row.key)}
                            className="flex items-center gap-1.5 hover:opacity-80"
                          >
                            {row.collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            {row.level === 0 && <Layers className="h-3 w-3" />}
                            <span>{row.label}</span>
                            <span className="opacity-70 font-mono text-[10px]">({row.count})</span>
                          </button>
                        </td>
                      </tr>
                    );
                  }
                  // line row
                  const l = row.line;
                  const isHere = l.assigned_to_package_id === packageId;
                  const otherPkg = l.assigned_to_package_id && l.assigned_to_package_id !== packageId
                    ? allPackages.find((p) => p.id === l.assigned_to_package_id)
                    : null;
                  return (
                    <tr
                      key={l.id}
                      style={{ borderBottom: "1px solid #F1F5F9", background: selected.has(l.id) ? "#EFF6FF" : (isHere ? "#ECFDF5" : undefined) }}
                    >
                      <td className="px-1 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={selected.has(l.id)}
                          onChange={() => toggleSelect(l.id)}
                          className="h-3.5 w-3.5 rounded cursor-pointer accent-[#E87722]"
                        />
                      </td>
                      <td className="px-2 py-1 text-xs font-mono text-muted-foreground">
                        {l.articulo_number ?? ""}
                      </td>
                      <td className="px-2 py-1 truncate" title={l.articulo_desc}>
                        {l.articulo_desc || <span className="text-muted-foreground italic">(Sin artículo)</span>}
                      </td>
                      <td className="px-2 py-1 text-center text-xs text-muted-foreground">{l.articulo_unit}</td>
                      <td className="px-2 py-1 text-right font-mono text-xs">
                        {l.articulo_pu > 0 ? formatNumber(l.articulo_pu, 2) : "—"}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-xs">
                        {l.quantity != null ? formatNumber(Number(l.quantity), 2) : "—"}
                      </td>
                      <td className="px-2 py-1 text-xs truncate">
                        {(() => { const c = categories.find((c) => c.id === l.category_id); return c ? `${c.code} ${c.name}` : ""; })()}
                      </td>
                      <td className="px-2 py-1 text-xs truncate">
                        {(() => { const s = subcategories.find((s) => s.id === l.subcategory_id); return s ? `${s.code} ${s.name}` : ""; })()}
                      </td>
                      <td className="px-2 py-1 text-xs truncate">
                        {sectors.find((s) => s.id === l.sector_id)?.name ?? ""}
                      </td>
                      <td className="px-2 py-1">
                        {isHere ? (
                          <Badge className="text-[10px] bg-emerald-600 text-white">En este paquete</Badge>
                        ) : otherPkg ? (
                          <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50" title={`En "${otherPkg.name}"`}>
                            En "{otherPkg.name}"
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground italic">Sin asignar</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {groupedRows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">
                      No hay líneas que coincidan con los filtros.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
