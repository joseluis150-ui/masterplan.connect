"use client";

import { useEffect, useState, useCallback, use, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ColumnFilter, type SortDirection } from "@/components/shared/column-filter";
import {
  ArrowLeft, Package, Loader2, Truck, ShoppingCart, Lock,
  PackagePlus, X, Trash2, Search,
} from "lucide-react";
import { toast } from "sonner";
import { formatNumber } from "@/lib/utils/formula";
import type {
  ProcurementPackage, ProcurementLine, Insumo, Articulo, ArticuloComposition,
  EdtCategory, EdtSubcategory, Sector, QuantificationLine,
} from "@/lib/types/database";

type TabKey = "insumos" | "asignar";

/** Insumo enriquecido para el tab "Asignar". Agregamos cuántas
 *  composiciones tiene en artículos cuantificados (uses_count) y a
 *  qué paquete está asignado (si está en alguno — un insumo puede
 *  estar dividido entre composiciones de distintos paquetes pero
 *  por simplicidad mostramos UNO; si está en varios usamos "multiple"). */
interface AssignableInsumo {
  id: string;
  code: number;
  description: string;
  unit: string;
  type: string;
  pu_usd: number;
  /** Cantidad de articulo_compositions del insumo cuyos artículos
   *  aparecen en alguna línea de cuantificación. Si es 0, no se puede
   *  asignar (el insumo no se usa en el proyecto). */
  uses_count: number;
  /** Estado de asignación: null = ninguna composición asignada,
   *  packageId = TODAS las composiciones del insumo están en este paquete,
   *  "multiple" = está en varios paquetes (caso edge), "partial" = algunas
   *  asignadas y otras no. */
  assignment: { kind: "none" } | { kind: "all_here"; packageId: string } | { kind: "all_other"; packageId: string; packageName: string } | { kind: "mixed"; details: string };
  /** Categorías y subcategorías donde aparece (para filtros).
   *  Almacenamos labels concatenadas. */
  category_labels: string[];
  subcategory_labels: string[];
}

/**
 * Vista de detalle de un paquete. Tab principal "Insumos asignados"
 * muestra los insumos del paquete (1 fila por insumo único, agregando
 * todas sus composiciones). Tab "Asignar insumos" muestra los insumos
 * disponibles del proyecto con checkboxes, filtros por tipo / categoría
 * / subcategoría / nombre y botón de asignación bulk.
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

  // Datos para tab "Insumos asignados" — agrupado por insumo
  const [pkgInsumos, setPkgInsumos] = useState<{
    insumo: Insumo;
    composition_ids: string[]; // todas las composiciones del insumo en este paquete
    procurement_line_ids: string[]; // para poder remover
    articulos: Articulo[]; // de qué artículos viene
  }[]>([]);

  // Datos para tab "Asignar"
  const [assignableInsumos, setAssignableInsumos] = useState<AssignableInsumo[]>([]);
  const [allPackages, setAllPackages] = useState<ProcurementPackage[]>([]);

  // Filtros + selección tab "Asignar"
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState("");
  const [filterType, setFilterType] = useState<Set<string>>(new Set());
  const [filterCategory, setFilterCategory] = useState<Set<string>>(new Set());
  const [filterSubcategory, setFilterSubcategory] = useState<Set<string>>(new Set());
  const [filterAssigned, setFilterAssigned] = useState<"all" | "unassigned" | "here" | "other">("all");
  const [sort, setSort] = useState<{ key: string; dir: SortDirection }>({ key: "", dir: null });
  const [assigning, setAssigning] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [
      pkgRes, plRes, qlRes, artsRes, insRes, compsRes,
      catsRes, subsRes, sectsRes, allPkgRes, allPlRes,
    ] = await Promise.all([
      supabase.from("procurement_packages").select("*").eq("id", packageId).single(),
      supabase.from("procurement_lines").select("*").eq("package_id", packageId),
      supabase.from("quantification_lines")
        .select("id, articulo_id, category_id, subcategory_id, sector_id")
        .eq("project_id", projectId).is("deleted_at", null),
      supabase.from("articulos").select("*").eq("project_id", projectId).order("number"),
      supabase.from("insumos").select("*").eq("project_id", projectId).order("code"),
      supabase.from("articulo_compositions").select("id, articulo_id, insumo_id"),
      supabase.from("edt_categories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("sectors").select("*").eq("project_id", projectId).order("order"),
      supabase.from("procurement_packages").select("*").eq("project_id", projectId),
      // Todas las procurement_lines del proyecto (por compositions de artículos del proyecto)
      supabase.from("procurement_lines").select("package_id, composition_id, insumo_id"),
    ]);

    if (pkgRes.error || !pkgRes.data) {
      toast.error("Paquete no encontrado");
      router.push(`/project/${projectId}/paquetes`);
      return;
    }
    setPkg(pkgRes.data as ProcurementPackage);

    const arts = (artsRes.data ?? []) as Articulo[];
    const insumos = (insRes.data ?? []) as Insumo[];
    const comps = (compsRes.data ?? []) as { id: string; articulo_id: string; insumo_id: string }[];
    const cats = (catsRes.data ?? []) as EdtCategory[];
    const subs = (subsRes.data ?? []) as EdtSubcategory[];
    const projPkgs = (allPkgRes.data ?? []) as ProcurementPackage[];
    setAllPackages(projPkgs);

    // Set de articulo_ids cuantificados en el proyecto
    const qLines = (qlRes.data ?? []) as Pick<QuantificationLine, "id" | "articulo_id" | "category_id" | "subcategory_id" | "sector_id">[];
    const quantifiedArtIds = new Set(qLines.filter((q) => q.articulo_id).map((q) => q.articulo_id!));
    const projPkgIds = new Set(projPkgs.map((p) => p.id));

    // Map: composition_id → articulo_id (para ver dónde aparece)
    const compById = new Map<string, { articulo_id: string; insumo_id: string }>();
    for (const c of comps) compById.set(c.id, { articulo_id: c.articulo_id, insumo_id: c.insumo_id });

    // Map: insumo_id → set de articulo_ids con composición de ese insumo (sólo
    // de artículos cuantificados — si el insumo está en una composición de
    // un artículo que no se usa en el proyecto, no nos sirve)
    const insumoToArticulos = new Map<string, Set<string>>();
    const insumoToCompIds = new Map<string, Set<string>>();
    for (const c of comps) {
      if (!quantifiedArtIds.has(c.articulo_id)) continue;
      if (!insumoToArticulos.has(c.insumo_id)) insumoToArticulos.set(c.insumo_id, new Set());
      insumoToArticulos.get(c.insumo_id)!.add(c.articulo_id);
      if (!insumoToCompIds.has(c.insumo_id)) insumoToCompIds.set(c.insumo_id, new Set());
      insumoToCompIds.get(c.insumo_id)!.add(c.id);
    }

    // Asignaciones globales: composition_id → package_id
    const compToPkg = new Map<string, string>();
    for (const pl of (allPlRes.data ?? []) as { package_id: string; composition_id: string | null }[]) {
      if (!projPkgIds.has(pl.package_id) || !pl.composition_id) continue;
      compToPkg.set(pl.composition_id, pl.package_id);
    }

    // Map: articulo_id → set de category_ids/subcategory_ids donde aparece
    // (vía quantification_lines)
    const artToCatIds = new Map<string, Set<string>>();
    const artToSubIds = new Map<string, Set<string>>();
    for (const ql of qLines) {
      if (!ql.articulo_id) continue;
      if (!artToCatIds.has(ql.articulo_id)) artToCatIds.set(ql.articulo_id, new Set());
      artToCatIds.get(ql.articulo_id)!.add(ql.category_id);
      if (!artToSubIds.has(ql.articulo_id)) artToSubIds.set(ql.articulo_id, new Set());
      artToSubIds.get(ql.articulo_id)!.add(ql.subcategory_id);
    }

    // Construir AssignableInsumos
    const result: AssignableInsumo[] = [];
    for (const ins of insumos) {
      const compsOfInsumo = insumoToCompIds.get(ins.id) ?? new Set();
      if (compsOfInsumo.size === 0) continue; // Insumo no se usa en el proyecto

      // ¿Cuáles de esas composiciones están asignadas? ¿A qué paquete?
      const pkgIdsOfThisInsumo = new Set<string>();
      let assignedCount = 0;
      for (const cid of compsOfInsumo) {
        const pkgId = compToPkg.get(cid);
        if (pkgId) {
          pkgIdsOfThisInsumo.add(pkgId);
          assignedCount++;
        }
      }
      let assignment: AssignableInsumo["assignment"];
      if (pkgIdsOfThisInsumo.size === 0) {
        assignment = { kind: "none" };
      } else if (pkgIdsOfThisInsumo.size === 1) {
        const onlyPkgId = [...pkgIdsOfThisInsumo][0];
        if (assignedCount === compsOfInsumo.size) {
          if (onlyPkgId === packageId) {
            assignment = { kind: "all_here", packageId: onlyPkgId };
          } else {
            const op = projPkgs.find((p) => p.id === onlyPkgId);
            assignment = { kind: "all_other", packageId: onlyPkgId, packageName: op?.name ?? "?" };
          }
        } else {
          // Algunas asignadas a este pkg, otras sin asignar
          const op = projPkgs.find((p) => p.id === onlyPkgId);
          assignment = { kind: "mixed", details: `Parcial en "${op?.name ?? "?"}"` };
        }
      } else {
        assignment = { kind: "mixed", details: "En varios paquetes" };
      }

      // Categorías y subcategorías donde aparece (vía sus artículos)
      const catIdSet = new Set<string>();
      const subIdSet = new Set<string>();
      for (const artId of (insumoToArticulos.get(ins.id) ?? new Set())) {
        for (const cid of (artToCatIds.get(artId) ?? new Set())) catIdSet.add(cid);
        for (const sid of (artToSubIds.get(artId) ?? new Set())) subIdSet.add(sid);
      }
      const category_labels = [...catIdSet].map((cid) => {
        const c = cats.find((c) => c.id === cid);
        return c ? `${c.code} ${c.name}` : "(?)";
      });
      const subcategory_labels = [...subIdSet].map((sid) => {
        const s = subs.find((s) => s.id === sid);
        return s ? `${s.code} ${s.name}` : "(?)";
      });

      result.push({
        id: ins.id,
        code: ins.code,
        description: ins.description,
        unit: ins.unit,
        type: ins.type,
        pu_usd: Number(ins.pu_usd ?? 0),
        uses_count: compsOfInsumo.size,
        assignment,
        category_labels,
        subcategory_labels,
      });
    }
    // sort by code asc default
    result.sort((a, b) => a.code - b.code);
    setAssignableInsumos(result);

    // Construir pkgInsumos: agrupar las procurement_lines del paquete por insumo
    const pkgLines = (plRes.data ?? []) as ProcurementLine[];
    const grouped = new Map<string, {
      composition_ids: string[];
      procurement_line_ids: string[];
      articulo_ids: Set<string>;
    }>();
    for (const pl of pkgLines) {
      if (!grouped.has(pl.insumo_id)) grouped.set(pl.insumo_id, {
        composition_ids: [], procurement_line_ids: [], articulo_ids: new Set(),
      });
      const g = grouped.get(pl.insumo_id)!;
      g.procurement_line_ids.push(pl.id);
      if (pl.composition_id) {
        g.composition_ids.push(pl.composition_id);
        const comp = compById.get(pl.composition_id);
        if (comp) g.articulo_ids.add(comp.articulo_id);
      }
    }
    const pkgInsumosList = [...grouped.entries()].map(([insId, g]) => ({
      insumo: insumos.find((i) => i.id === insId)!,
      composition_ids: g.composition_ids,
      procurement_line_ids: g.procurement_line_ids,
      articulos: [...g.articulo_ids].map((aid) => arts.find((a) => a.id === aid)).filter(Boolean) as Articulo[],
    })).filter((g) => g.insumo);
    pkgInsumosList.sort((a, b) => a.insumo.code - b.insumo.code);
    setPkgInsumos(pkgInsumosList);

    setLoading(false);
  }, [projectId, packageId, supabase, router]);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── Asignar insumos seleccionados al paquete ── */
  async function assignSelectedInsumos() {
    if (selected.size === 0) return;
    if (pkg?.status === "aprobado") {
      toast.error("Paquete aprobado — no se puede modificar");
      return;
    }
    setAssigning(true);
    const { data, error } = await supabase.rpc("assign_insumos_to_package", {
      p_project_id: projectId,
      p_insumo_ids: Array.from(selected),
      p_package_id: packageId,
    });
    setAssigning(false);
    if (error) { toast.error(`Error: ${error.message}`); return; }
    const r = (data ?? {}) as {
      assigned: number;
      already_in_package: number;
      conflicts: number;
      skipped_no_usage: number;
      conflict_packages: { name: string; count: number }[];
    };
    if (r.assigned > 0) toast.success(`${r.assigned} composición${r.assigned === 1 ? "" : "es"} asignada${r.assigned === 1 ? "" : "s"}`);
    if (r.already_in_package > 0) toast.info(`${r.already_in_package} ya estaban en este paquete`);
    if (r.conflicts > 0 && r.conflict_packages.length > 0) {
      const breakdown = r.conflict_packages.map((p) => `"${p.name}" (${p.count})`).join(", ");
      toast.warning(`${r.conflicts} ya en otros: ${breakdown}`, { duration: 6000 });
    }
    if (r.skipped_no_usage > 0) toast.info(`${r.skipped_no_usage} insumo${r.skipped_no_usage === 1 ? "" : "s"} sin uso en el proyecto (skip)`);
    if (r.assigned === 0 && r.already_in_package === 0 && r.conflicts === 0) {
      toast.info("Nada que asignar");
    }
    setSelected(new Set());
    await loadData();
  }

  /* ── Quitar todas las composiciones de un insumo del paquete ── */
  async function removeInsumoFromPackage(plIds: string[], insumoDesc: string) {
    if (pkg?.status === "aprobado") return;
    if (!confirm(`¿Quitar "${insumoDesc}" del paquete? (${plIds.length} composición${plIds.length === 1 ? "" : "es"})`)) return;
    const { error } = await supabase.from("procurement_lines").delete().in("id", plIds);
    if (error) { toast.error(error.message); return; }
    toast.success("Insumo removido del paquete");
    await loadData();
  }

  /* ── Filtros para tab "Asignar" ── */
  const filtered = useMemo(() => {
    const text = searchText.trim().toLowerCase();
    return assignableInsumos.filter((i) => {
      if (text && !i.description.toLowerCase().includes(text) && !String(i.code).includes(text)) return false;
      if (filterType.size > 0 && !filterType.has(i.type)) return false;
      if (filterCategory.size > 0 && !i.category_labels.some((l) => filterCategory.has(l))) return false;
      if (filterSubcategory.size > 0 && !i.subcategory_labels.some((l) => filterSubcategory.has(l))) return false;
      if (filterAssigned !== "all") {
        const k = i.assignment.kind;
        if (filterAssigned === "unassigned" && k !== "none") return false;
        if (filterAssigned === "here" && !(k === "all_here" || (k === "mixed" && i.assignment.details.includes("Parcial")))) return false;
        if (filterAssigned === "other" && k !== "all_other") return false;
      }
      return true;
    });
  }, [assignableInsumos, searchText, filterType, filterCategory, filterSubcategory, filterAssigned]);

  const sorted = useMemo(() => {
    if (!sort.dir) return filtered;
    const mult = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "code": return mult * (a.code - b.code);
        case "description": return mult * a.description.localeCompare(b.description, "es");
        case "unit": return mult * a.unit.localeCompare(b.unit, "es");
        case "type": return mult * a.type.localeCompare(b.type, "es");
        case "pu": return mult * (a.pu_usd - b.pu_usd);
        case "uses": return mult * (a.uses_count - b.uses_count);
        default: return 0;
      }
    });
  }, [filtered, sort]);

  const uniqueTypes = useMemo(() => Array.from(new Set(assignableInsumos.map((i) => i.type))).sort(), [assignableInsumos]);
  const uniqueCategories = useMemo(() => Array.from(new Set(assignableInsumos.flatMap((i) => i.category_labels))).sort(), [assignableInsumos]);
  const uniqueSubcategories = useMemo(() => Array.from(new Set(assignableInsumos.flatMap((i) => i.subcategory_labels))).sort(), [assignableInsumos]);

  const counts = useMemo(() => {
    const total = assignableInsumos.length;
    const unassigned = assignableInsumos.filter((i) => i.assignment.kind === "none").length;
    const here = assignableInsumos.filter((i) => i.assignment.kind === "all_here" || (i.assignment.kind === "mixed" && i.assignment.details.includes("Parcial"))).length;
    const other = assignableInsumos.filter((i) => i.assignment.kind === "all_other").length;
    return { total, unassigned, here, other };
  }, [assignableInsumos]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    const visible = new Set(sorted.map((i) => i.id));
    if (selected.size === visible.size && visible.size > 0) {
      setSelected(new Set());
    } else {
      setSelected(visible);
    }
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
      {/* Header */}
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
              <Package className="h-3 w-3 mr-0.5" /> {pkgInsumos.length} insumo{pkgInsumos.length === 1 ? "" : "s"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {[
          { key: "insumos" as const, label: "Insumos asignados", count: pkgInsumos.length },
          { key: "asignar" as const, label: "Asignar insumos", count: counts.total },
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

      {/* Tab: Insumos asignados */}
      {activeTab === "insumos" && (
        <div>
          {pkgInsumos.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center space-y-3">
                <Package className="h-10 w-10 mx-auto text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Este paquete aún no tiene insumos asignados.
                </p>
                <Button onClick={() => setActiveTab("asignar")} className="bg-[#E87722] hover:bg-[#E87722]/90 text-white">
                  <PackagePlus className="h-4 w-4 mr-2" /> Asignar insumos
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
                    <th className="px-2 py-2 text-center text-[11px] uppercase tracking-wider font-semibold w-20">Unidad</th>
                    <th className="px-2 py-2 text-center text-[11px] uppercase tracking-wider font-semibold w-28">Tipo</th>
                    <th className="px-2 py-2 text-right text-[11px] uppercase tracking-wider font-semibold w-24">PU USD</th>
                    <th className="px-2 py-2 text-left text-[11px] uppercase tracking-wider font-semibold">Aparece en (artículos)</th>
                    {!isApproved && <th className="w-12"></th>}
                  </tr>
                </thead>
                <tbody>
                  {pkgInsumos.map((g) => (
                    <tr key={g.insumo.id} className="border-b hover:bg-muted/30">
                      <td className="px-2 py-1.5 text-xs font-mono text-muted-foreground">{g.insumo.code}</td>
                      <td className="px-2 py-1.5">{g.insumo.description}</td>
                      <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">{g.insumo.unit}</td>
                      <td className="px-2 py-1.5 text-center text-[11px] text-muted-foreground capitalize">{g.insumo.type.replace(/_/g, " ")}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs">
                        {g.insumo.pu_usd ? formatNumber(Number(g.insumo.pu_usd), 2) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground">
                        {g.articulos.length === 0 ? <span className="italic">—</span> :
                          <span className="line-clamp-1" title={g.articulos.map((a) => `#${a.number} ${a.description}`).join(", ")}>
                            {g.articulos.length === 1
                              ? `#${g.articulos[0].number} ${g.articulos[0].description}`
                              : `${g.articulos.length} artículos`}
                          </span>}
                      </td>
                      {!isApproved && (
                        <td className="px-2 py-1.5 text-center">
                          <Button variant="ghost" size="icon" className="h-6 w-6"
                            onClick={() => removeInsumoFromPackage(g.procurement_line_ids, g.insumo.description)}
                            title="Quitar insumo del paquete">
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

      {/* Tab: Asignar insumos */}
      {activeTab === "asignar" && (
        <div className="space-y-3">
          {/* Buscador + chips de asignación */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Buscar por código o descripción..."
                className="pl-8 h-8 w-72 text-sm"
              />
            </div>
            {([
              { v: "all", label: "Todos", count: counts.total },
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
            {(filterType.size + filterCategory.size + filterSubcategory.size > 0) && (
              <Button
                variant="ghost" size="sm"
                className="text-xs text-destructive hover:text-destructive"
                onClick={() => { setFilterType(new Set()); setFilterCategory(new Set()); setFilterSubcategory(new Set()); }}
              >
                <X className="h-3 w-3 mr-1" /> Limpiar filtros de columna
              </Button>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {filtered.length} insumo{filtered.length === 1 ? "" : "s"} visible{filtered.length === 1 ? "" : "s"}
            </span>
          </div>

          {/* Barra contextual bulk */}
          {selected.size > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[#0A0A0A] text-white shadow-md">
              <span className="text-sm font-medium">
                {selected.size} insumo{selected.size === 1 ? "" : "s"} seleccionado{selected.size === 1 ? "" : "s"}
              </span>
              <span className="h-4 w-px bg-white/20 mx-1" />
              <Button
                size="sm" variant="ghost"
                onClick={assignSelectedInsumos}
                disabled={assigning || isApproved}
                className="text-xs h-7 text-white hover:bg-white/10 hover:text-white"
                title={isApproved ? "Paquete aprobado" : `Asignar ${selected.size} a "${pkg.name}"`}
              >
                {assigning
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Asignando...</>
                  : <><PackagePlus className="h-3.5 w-3.5 mr-1" />Asignar a "{pkg.name}"</>}
              </Button>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  size="sm" variant="ghost"
                  onClick={() => setSelected(new Set())}
                  className="text-xs h-7 text-white/70 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Deseleccionar
                </Button>
              </div>
            </div>
          )}

          {/* Tabla de insumos */}
          <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
            <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "32px" }} />
                <col style={{ width: "60px" }} />
                <col style={{ width: "300px" }} />
                <col style={{ width: "70px" }} />
                <col style={{ width: "110px" }} />
                <col style={{ width: "90px" }} />
                <col style={{ width: "70px" }} />
                <col style={{ width: "180px" }} />
                <col style={{ width: "180px" }} />
                <col style={{ width: "150px" }} />
              </colgroup>
              <thead className="sticky top-0 z-30 bg-background shadow-sm">
                <tr>
                  <th className="px-1 py-2 text-center bg-background">
                    <input
                      type="checkbox"
                      checked={sorted.length > 0 && selected.size === sorted.length}
                      onChange={toggleSelectAll}
                      className="h-3.5 w-3.5 rounded cursor-pointer accent-[#E87722]"
                    />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Código" values={[]} activeValues={new Set()} onChange={() => {}} sortDirection={sort.key === "code" ? sort.dir : null} onSort={handleSort("code")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Descripción" values={[]} activeValues={new Set()} onChange={() => {}} sortDirection={sort.key === "description" ? sort.dir : null} onSort={handleSort("description")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Und" values={[]} activeValues={new Set()} onChange={() => {}} align="center" sortDirection={sort.key === "unit" ? sort.dir : null} onSort={handleSort("unit")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Tipo" values={uniqueTypes} activeValues={filterType} onChange={setFilterType} align="center" sortDirection={sort.key === "type" ? sort.dir : null} onSort={handleSort("type")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="PU USD" values={[]} activeValues={new Set()} onChange={() => {}} align="right" sortDirection={sort.key === "pu" ? sort.dir : null} onSort={handleSort("pu")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Usos" values={[]} activeValues={new Set()} onChange={() => {}} align="right" sortDirection={sort.key === "uses" ? sort.dir : null} onSort={handleSort("uses")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Categorías" values={uniqueCategories} activeValues={filterCategory} onChange={setFilterCategory} sortDirection={null} onSort={() => {}} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Subcategorías" values={uniqueSubcategories} activeValues={filterSubcategory} onChange={setFilterSubcategory} sortDirection={null} onSort={() => {}} />
                  </th>
                  <th className="px-2 py-2 text-left uppercase text-[11px] font-semibold tracking-wider">Asignación</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((i) => {
                  const isHere = i.assignment.kind === "all_here";
                  const isOther = i.assignment.kind === "all_other";
                  const isMixed = i.assignment.kind === "mixed";
                  return (
                    <tr
                      key={i.id}
                      style={{
                        borderBottom: "1px solid #F1F5F9",
                        background: selected.has(i.id) ? "#EFF6FF" : (isHere ? "#ECFDF5" : undefined),
                      }}
                    >
                      <td className="px-1 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={selected.has(i.id)}
                          onChange={() => toggleSelect(i.id)}
                          className="h-3.5 w-3.5 rounded cursor-pointer accent-[#E87722]"
                        />
                      </td>
                      <td className="px-2 py-1 text-xs font-mono text-muted-foreground">{i.code}</td>
                      <td className="px-2 py-1 truncate" title={i.description}>{i.description}</td>
                      <td className="px-2 py-1 text-center text-xs text-muted-foreground">{i.unit}</td>
                      <td className="px-2 py-1 text-center text-[11px] text-muted-foreground capitalize">{i.type.replace(/_/g, " ")}</td>
                      <td className="px-2 py-1 text-right font-mono text-xs">
                        {i.pu_usd > 0 ? formatNumber(i.pu_usd, 2) : "—"}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-xs">{i.uses_count}</td>
                      <td className="px-2 py-1 text-xs truncate" title={i.category_labels.join(", ")}>
                        {i.category_labels.length === 0 ? "—" : i.category_labels.length === 1 ? i.category_labels[0] : `${i.category_labels.length} categorías`}
                      </td>
                      <td className="px-2 py-1 text-xs truncate" title={i.subcategory_labels.join(", ")}>
                        {i.subcategory_labels.length === 0 ? "—" : i.subcategory_labels.length === 1 ? i.subcategory_labels[0] : `${i.subcategory_labels.length} subcategorías`}
                      </td>
                      <td className="px-2 py-1">
                        {isHere && <Badge className="text-[10px] bg-emerald-600 text-white">En este paquete</Badge>}
                        {isOther && i.assignment.kind === "all_other" && (
                          <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50">
                            En "{i.assignment.packageName}"
                          </Badge>
                        )}
                        {isMixed && i.assignment.kind === "mixed" && (
                          <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50">
                            {i.assignment.details}
                          </Badge>
                        )}
                        {i.assignment.kind === "none" && (
                          <span className="text-[10px] text-muted-foreground italic">Sin asignar</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">
                      {assignableInsumos.length === 0
                        ? "No hay insumos disponibles. Asegurate de tener artículos cuantificados con composiciones."
                        : "No hay insumos que coincidan con los filtros."}
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
