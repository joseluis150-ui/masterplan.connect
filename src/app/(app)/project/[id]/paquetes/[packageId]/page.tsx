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
  PackagePlus, X, Trash2, Search, Layers, ChevronDown, ChevronRight, Folder,
} from "lucide-react";
import { toast } from "sonner";
import { formatNumber } from "@/lib/utils/formula";
import type {
  ProcurementPackage, ProcurementLine, Insumo, Articulo,
  EdtCategory, EdtSubcategory, Sector, SectorGroup, QuantificationLine,
} from "@/lib/types/database";
import { InsumoCompositionDialog, type QlineCompEntry } from "./_components/insumo-composition-dialog";

type TabKey = "insumos" | "asignar";

/** Composición de artículo + insumo con cantidades. Shape completo de
 *  `articulo_compositions` que necesitamos para el cálculo de cantidad
 *  total proyectada y para el modal de selección por composición. */
interface CompFull {
  id: string;
  articulo_id: string;
  insumo_id: string;
  quantity: number;
  waste_pct: number;
  margin_pct: number;
}

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
  /** Cantidad total proyectada del insumo: suma sobre todas las
   *  quantification_lines del proyecto de (qty_line × qty_composición
   *  × (1+waste_pct/100) × (1+margin_pct/100)). Es lo que realmente se
   *  necesita comprar en el proyecto entero. */
  total_quantity: number;
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
  // Datos extra para vista jerárquica
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [sectorGroups, setSectorGroups] = useState<SectorGroup[]>([]);
  const [allCategories, setAllCategories] = useState<EdtCategory[]>([]);
  const [allSubcategories, setAllSubcategories] = useState<EdtSubcategory[]>([]);
  const [allArticulos, setAllArticulos] = useState<Articulo[]>([]);
  const [allInsumos, setAllInsumos] = useState<Insumo[]>([]);
  /** Composiciones del proyecto (cargadas en round 2). Las usamos para
   *  expandir cada articulo cuantificado a sus insumos en la vista
   *  agrupada. */
  const [allComps, setAllComps] = useState<{ id: string; articulo_id: string; insumo_id: string }[]>([]);
  /** Composiciones con quantity/waste/margin. Usado en el modal de
   *  detalle (selección granular por composición) y en el cálculo de
   *  `total_quantity` por insumo. */
  const [allCompsFull, setAllCompsFull] = useState<CompFull[]>([]);
  /** Mapa articulo_id → set de quantification_lines que usan ese
   *  articulo (con sector/categoría/subcategoría). Usado para construir
   *  los breadcrumbs en la jerarquía. */
  const [qLinesByArt, setQLinesByArt] = useState<Map<string, { qline_id: string; sector_id: string; category_id: string; subcategory_id: string; quantity: number }[]>>(new Map());

  // Filtros + selección tab "Asignar"
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState("");
  const [filterType, setFilterType] = useState<Set<string>>(new Set());
  const [filterCategory, setFilterCategory] = useState<Set<string>>(new Set());
  const [filterSubcategory, setFilterSubcategory] = useState<Set<string>>(new Set());
  const [filterAssigned, setFilterAssigned] = useState<"all" | "unassigned" | "here" | "other">("all");
  const [sort, setSort] = useState<{ key: string; dir: SortDirection }>({ key: "", dir: null });
  const [assigning, setAssigning] = useState(false);
  /** Modo de vista: lista plana (1 fila por insumo) o agrupada
   *  jerárquica (Grupo → Sector → Categoría → Subcat → Artículo →
   *  Insumos). En agrupada, el mismo insumo puede aparecer en varias
   *  ramas; la selección sigue siendo por insumo (todas las apariciones
   *  comparten el checkbox). */
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("flat");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  /** Insumo cuyo modal de detalle está abierto. Null = modal cerrado. */
  const [detailInsumoId, setDetailInsumoId] = useState<string | null>(null);
  /** Mapa global composition_id → paquete donde está asignada (id + name).
   *  Sólo para asignaciones LEGACY sin qline_id. */
  const [globalCompToPkg, setGlobalCompToPkg] = useState<Map<string, { packageId: string; packageName: string }>>(new Map());
  /** Mapa global (qline_id, comp_id) → paquete. Key = `${qline}::${comp}`.
   *  Para las asignaciones nuevas a nivel quantification_line. */
  const [globalQlineCompToPkg, setGlobalQlineCompToPkg] = useState<Map<string, { packageId: string; packageName: string }>>(new Map());

  const loadData = useCallback(async () => {
    setLoading(true);
    // Round 1: queries que NO necesitan IDs de otras queries.
    // Importante: articulo_compositions y procurement_lines son tablas
    // GLOBALES (sin project_id propio). Si pedimos sin filtro, Supabase
    // devuelve max 1000 rows por defecto, lo que rompe proyectos grandes.
    // Por eso primero traemos articulos/packages del proyecto y después
    // filtramos compositions/procurement_lines por esos IDs.
    const [
      pkgRes, plRes, qlRes, artsRes, insRes,
      catsRes, subsRes, sectsRes, sectGroupsRes, allPkgRes,
    ] = await Promise.all([
      supabase.from("procurement_packages").select("*").eq("id", packageId).single(),
      supabase.from("procurement_lines").select("*").eq("package_id", packageId),
      // Traer también `quantity` de las quantification_lines — la usamos
      // para calcular cantidad total proyectada de cada insumo.
      supabase.from("quantification_lines")
        .select("id, articulo_id, category_id, subcategory_id, sector_id, quantity")
        .eq("project_id", projectId).is("deleted_at", null),
      supabase.from("articulos").select("*").eq("project_id", projectId).order("number"),
      supabase.from("insumos").select("*").eq("project_id", projectId).order("code"),
      supabase.from("edt_categories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("sectors").select("*").eq("project_id", projectId).order("order"),
      supabase.from("sector_groups").select("*").eq("project_id", projectId).order("order"),
      supabase.from("procurement_packages").select("*").eq("project_id", projectId),
    ]);

    if (pkgRes.error || !pkgRes.data) {
      toast.error("Paquete no encontrado");
      router.push(`/project/${projectId}/paquetes`);
      return;
    }
    setPkg(pkgRes.data as ProcurementPackage);

    const arts = (artsRes.data ?? []) as Articulo[];
    const insumos = (insRes.data ?? []) as Insumo[];
    const cats = (catsRes.data ?? []) as EdtCategory[];
    const subs = (subsRes.data ?? []) as EdtSubcategory[];
    const secs = (sectsRes.data ?? []) as Sector[];
    const sectGroups = (sectGroupsRes.data ?? []) as SectorGroup[];
    const projPkgs = (allPkgRes.data ?? []) as ProcurementPackage[];
    setAllPackages(projPkgs);
    setAllArticulos(arts);
    setAllInsumos(insumos);
    setAllCategories(cats);
    setAllSubcategories(subs);
    setSectors(secs);
    setSectorGroups(sectGroups);

    // Round 2: queries que dependen de los IDs del proyecto.
    // articulo_compositions filtrado por articulo del proyecto;
    // procurement_lines filtrado por paquete del proyecto. Esto
    // garantiza que cargamos TODAS las relevantes (sin hit del límite).
    const artIds = arts.map((a) => a.id);
    const projPkgIdList = projPkgs.map((p) => p.id);
    const [compsRes, allPlRes] = await Promise.all([
      artIds.length > 0
        // Necesitamos quantity / waste_pct / margin_pct para calcular
        // la cantidad total proyectada por insumo.
        ? supabase.from("articulo_compositions")
            .select("id, articulo_id, insumo_id, quantity, waste_pct, margin_pct")
            .in("articulo_id", artIds)
        : Promise.resolve({ data: [] as CompFull[] }),
      projPkgIdList.length > 0
        ? supabase.from("procurement_lines").select("package_id, composition_id, insumo_id, quantification_line_id").in("package_id", projPkgIdList)
        : Promise.resolve({ data: [] as { package_id: string; composition_id: string | null; insumo_id: string; quantification_line_id: string | null }[] }),
    ]);
    const compsFull = (compsRes.data ?? []) as CompFull[];
    // Mantenemos el shape simple para el árbol agrupado (que no necesita
    // quantities). El shape completo se guarda en allCompsFull.
    const comps = compsFull.map((c) => ({ id: c.id, articulo_id: c.articulo_id, insumo_id: c.insumo_id }));
    setAllComps(comps);
    setAllCompsFull(compsFull);

    // Set de articulo_ids cuantificados en el proyecto
    const qLines = (qlRes.data ?? []) as Pick<QuantificationLine, "id" | "articulo_id" | "category_id" | "subcategory_id" | "sector_id" | "quantity">[];
    const quantifiedArtIds = new Set(qLines.filter((q) => q.articulo_id).map((q) => q.articulo_id!));
    const projPkgIds = new Set(projPkgs.map((p) => p.id));

    // Map articulo_id → quantification_lines del articulo (qline_id + sector/cat/sub/qty).
    // Usado tanto por la vista jerárquica como por el modal de detalle
    // por línea de cuantificación.
    const qByArt = new Map<string, { qline_id: string; sector_id: string; category_id: string; subcategory_id: string; quantity: number }[]>();
    for (const ql of qLines) {
      if (!ql.articulo_id) continue;
      if (!qByArt.has(ql.articulo_id)) qByArt.set(ql.articulo_id, []);
      qByArt.get(ql.articulo_id)!.push({
        qline_id: ql.id,
        sector_id: ql.sector_id,
        category_id: ql.category_id,
        subcategory_id: ql.subcategory_id,
        quantity: Number(ql.quantity ?? 0),
      });
    }
    setQLinesByArt(qByArt);

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

    // Asignaciones globales:
    //  - compToPkg: para entradas legacy SIN qline_id (asignación de toda la composición)
    //  - qlineCompToPkg: para entradas NUEVAS con qline_id (granularidad qline)
    const compToPkg = new Map<string, string>();
    const compToPkgDetailed = new Map<string, { packageId: string; packageName: string }>();
    const qlineCompToPkg = new Map<string, { packageId: string; packageName: string }>();
    for (const pl of (allPlRes.data ?? []) as { package_id: string; composition_id: string | null; quantification_line_id: string | null }[]) {
      if (!projPkgIds.has(pl.package_id) || !pl.composition_id) continue;
      const pkg2 = projPkgs.find((p) => p.id === pl.package_id);
      const detail = { packageId: pl.package_id, packageName: pkg2?.name ?? "(?)" };
      if (pl.quantification_line_id) {
        qlineCompToPkg.set(`${pl.quantification_line_id}::${pl.composition_id}`, detail);
      } else {
        // Legacy: asignación de composición global (sin qline específica)
        compToPkg.set(pl.composition_id, pl.package_id);
        compToPkgDetailed.set(pl.composition_id, detail);
      }
    }
    setGlobalCompToPkg(compToPkgDetailed);
    setGlobalQlineCompToPkg(qlineCompToPkg);

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

    // Map composition_id → CompFull (para lookup rápido en cálculos)
    const compFullById = new Map<string, CompFull>();
    for (const c of compsFull) compFullById.set(c.id, c);

    /** Calcula la cantidad total proyectada de un insumo en TODO el proyecto:
     *  Σ por cada composición del insumo: Σ por cada qline del articulo:
     *    qty_qline × qty_composición × (1 + waste/100) × (1 + margin/100). */
    function computeTotalQuantity(insumoId: string): number {
      const compIds = insumoToCompIds.get(insumoId) ?? new Set<string>();
      let total = 0;
      for (const compId of compIds) {
        const comp = compFullById.get(compId);
        if (!comp) continue;
        const qlines = qByArt.get(comp.articulo_id) ?? [];
        const wasteFactor = 1 + Number(comp.waste_pct ?? 0) / 100;
        const marginFactor = 1 + Number(comp.margin_pct ?? 0) / 100;
        for (const ql of qlines) {
          total += ql.quantity * Number(comp.quantity ?? 0) * wasteFactor * marginFactor;
        }
      }
      return total;
    }

    // Construir AssignableInsumos
    const result: AssignableInsumo[] = [];
    for (const ins of insumos) {
      const compsOfInsumo = insumoToCompIds.get(ins.id) ?? new Set();
      if (compsOfInsumo.size === 0) continue; // Insumo no se usa en el proyecto

      // Calcular asignación a nivel (qline, comp). Iteramos sobre cada
      // par y vemos en qué paquete está. Esto soporta la granularidad:
      // un mismo insumo puede tener qlines en distintos paquetes.
      const pkgIdsOfThisInsumo = new Set<string>();
      let totalEntries = 0;
      let assignedEntries = 0;
      for (const cid of compsOfInsumo) {
        const comp = compFullById.get(cid);
        if (!comp) continue;
        const qlines = qByArt.get(comp.articulo_id) ?? [];
        for (const ql of qlines) {
          totalEntries++;
          // Primero buscar a nivel granular, sino legacy
          const granularPkg = qlineCompToPkg.get(`${ql.qline_id}::${cid}`)?.packageId;
          const legacyPkg = compToPkg.get(cid);
          const pkgId = granularPkg ?? legacyPkg;
          if (pkgId) {
            pkgIdsOfThisInsumo.add(pkgId);
            assignedEntries++;
          }
        }
      }
      let assignment: AssignableInsumo["assignment"];
      if (pkgIdsOfThisInsumo.size === 0) {
        assignment = { kind: "none" };
      } else if (pkgIdsOfThisInsumo.size === 1) {
        const onlyPkgId = [...pkgIdsOfThisInsumo][0];
        if (assignedEntries === totalEntries) {
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
        total_quantity: computeTotalQuantity(ins.id),
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

  /* ── Asignar selección al paquete ─────────────────────────────────
   *  En vista plana: `selected` contiene insumo_ids → asigna TODAS las
   *    composiciones de cada insumo seleccionado (comportamiento bulk).
   *  En vista agrupada: `selected` contiene entryKeys (`qline::comp`) →
   *    asigna SÓLO esos pares específicos (granularidad por línea).
   * ───────────────────────────────────────────────────────────────── */
  async function assignSelectedInsumos() {
    if (selected.size === 0) return;
    if (pkg?.status === "aprobado") {
      toast.error("Paquete aprobado — no se puede modificar");
      return;
    }
    setAssigning(true);

    try {
      if (viewMode === "grouped") {
        // Granular: convertir entryKeys a pairs {qline_id, comp_id}
        const pairs = Array.from(selected).map((key) => {
          const [qline_id, comp_id] = key.split("::");
          return { qline_id, comp_id };
        });
        const { data, error } = await supabase.rpc("assign_qline_compositions_to_package", {
          p_project_id: projectId,
          p_pairs: pairs,
          p_package_id: packageId,
        });
        if (error) throw error;
        const r = (data ?? {}) as { assigned: number; already_in_package: number; conflicts: number; conflict_packages: { name: string; count: number }[] };
        if (r.assigned > 0) toast.success(`${r.assigned} línea${r.assigned === 1 ? "" : "s"} asignada${r.assigned === 1 ? "" : "s"}`);
        if (r.already_in_package > 0) toast.info(`${r.already_in_package} ya estaban en este paquete`);
        if (r.conflicts > 0 && r.conflict_packages.length > 0) {
          const breakdown = r.conflict_packages.map((p) => `"${p.name}" (${p.count})`).join(", ");
          toast.warning(`${r.conflicts} ya en otros: ${breakdown}`, { duration: 6000 });
        }
        if (r.assigned === 0 && r.already_in_package === 0 && r.conflicts === 0) {
          toast.info("Nada que asignar");
        }
      } else {
        // Vista plana: bulk por insumo (asigna todas las composiciones de cada uno)
        const { data, error } = await supabase.rpc("assign_insumos_to_package", {
          p_project_id: projectId,
          p_insumo_ids: Array.from(selected),
          p_package_id: packageId,
        });
        if (error) throw error;
        const r = (data ?? {}) as {
          assigned: number; already_in_package: number; conflicts: number;
          skipped_no_usage: number; conflict_packages: { name: string; count: number }[];
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
      }
      setSelected(new Set());
      await loadData();
    } catch (e) {
      toast.error(`Error: ${(e as Error).message}`);
    }
    setAssigning(false);
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
        case "qty": return mult * (a.total_quantity - b.total_quantity);
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

  /* ── Vista jerárquica: Grupo → Sector → Cat → Subcat → Artículo → Insumos ──
     Construimos un árbol a partir de las quantification_lines del proyecto:
     cada qLine da una combinación (sector, cat, subcat, articulo). Para cada
     articulo, expandimos a sus composiciones (insumos). El mismo insumo puede
     aparecer en N nodos distintos del árbol — la selección sigue siendo por
     insumo_id (deduplicada), así que marcar 1 marca todas sus apariciones.

     Aplicamos los mismos filtros que en la lista plana (búsqueda, tipo, etc),
     pero al insumo, no al header. Si un grupo queda vacío después del filtro,
     lo ocultamos. */
  type GroupedRow =
    | { kind: "header"; level: 0|1|2|3|4; key: string; label: string; insumoCount: number; collapsed: boolean }
    /** Hoja: una entry única (qline + composición + insumo). La key es
     *  `${qline_id}::${comp_id}` para que cada aparición del insumo en
     *  un artículo distinto sea seleccionable independientemente. */
    | { kind: "entry"; key: string; entryKey: string; qline_id: string; comp_id: string; insumo: AssignableInsumo; quantity: number; assignedTo: { packageId: string; packageName: string } | null };

  const groupedRows = useMemo<GroupedRow[]>(() => {
    if (viewMode !== "grouped") return [];
    // Mapa rápido: insumoId → AssignableInsumo (con asignación, filtros aplicados)
    const insumoFilterPass = new Map<string, AssignableInsumo>();
    for (const i of filtered) insumoFilterPass.set(i.id, i);

    // Mapa articulo_id → composiciones COMPLETAS (con qty/waste/margin) del articulo
    const compsByArt = new Map<string, CompFull[]>();
    for (const c of allCompsFull) {
      if (!compsByArt.has(c.articulo_id)) compsByArt.set(c.articulo_id, []);
      compsByArt.get(c.articulo_id)!.push(c);
    }

    // Lookups de orden
    const sectorById = new Map(sectors.map((s) => [s.id, s]));
    const groupById = new Map(sectorGroups.map((g) => [g.id, g]));
    const catById = new Map(allCategories.map((c) => [c.id, c]));
    const subById = new Map(allSubcategories.map((s) => [s.id, s]));
    const artById = new Map(allArticulos.map((a) => [a.id, a]));

    /** Cada hoja del árbol es una entry (qline + composición). */
    type LeafEntry = { qline_id: string; comp: CompFull; insumo: AssignableInsumo; quantity: number };
    /** Map artId → array de entries (una por par (qline, comp) en ese articulo
     *  bajo este sector/cat/subcat). */
    type ArtMap = Map<string, LeafEntry[]>;
    type SubMap = Map<string, ArtMap>;
    type CatMap = Map<string, SubMap>;
    type SectorMap = Map<string, CatMap>;
    type GroupMap = Map<string, SectorMap>;
    const tree: GroupMap = new Map();

    const NO_GROUP = "__no_group__";

    // Para cada articulo cuantificado, iterar sus qlines × sus composiciones.
    // Cada combinación (qline, comp) genera una entry hoja independiente.
    for (const [artId, qLineList] of qLinesByArt.entries()) {
      const comps = compsByArt.get(artId);
      if (!comps || comps.length === 0) continue;
      for (const ql of qLineList) {
        const sec = sectorById.get(ql.sector_id);
        const groupId = sec?.sector_group_id || NO_GROUP;
        if (!tree.has(groupId)) tree.set(groupId, new Map());
        const sectMap = tree.get(groupId)!;
        if (!sectMap.has(ql.sector_id)) sectMap.set(ql.sector_id, new Map());
        const catMap = sectMap.get(ql.sector_id)!;
        if (!catMap.has(ql.category_id)) catMap.set(ql.category_id, new Map());
        const subMap = catMap.get(ql.category_id)!;
        if (!subMap.has(ql.subcategory_id)) subMap.set(ql.subcategory_id, new Map());
        const artMap = subMap.get(ql.subcategory_id)!;
        if (!artMap.has(artId)) artMap.set(artId, []);
        const leafList = artMap.get(artId)!;
        for (const comp of comps) {
          const insumo = insumoFilterPass.get(comp.insumo_id);
          if (!insumo) continue; // filtros aplicados
          const wasteFactor = 1 + Number(comp.waste_pct ?? 0) / 100;
          const marginFactor = 1 + Number(comp.margin_pct ?? 0) / 100;
          const qty = ql.quantity * Number(comp.quantity ?? 0) * wasteFactor * marginFactor;
          leafList.push({
            qline_id: ql.qline_id,
            comp,
            insumo,
            quantity: qty,
          });
        }
      }
    }

    const rows: GroupedRow[] = [];

    // Iterar respetando el orden de sector_groups, sectors, categories, etc.
    // Grupos: orden + "__no_group__" al final si tiene contenido.
    const orderedGroupIds = [
      ...sectorGroups.map((g) => g.id),
      NO_GROUP,
    ].filter((gid) => tree.has(gid));

    // Helper para contar entries dentro de cualquier subárbol
    const countLeafEntries = (sm: SectorMap): number => {
      let n = 0;
      for (const cm of sm.values()) for (const subM of cm.values()) for (const aL of subM.values()) for (const list of aL.values()) n += list.length;
      return n;
    };
    const countLeafEntriesCat = (cm: CatMap): number => {
      let n = 0;
      for (const subM of cm.values()) for (const aL of subM.values()) for (const list of aL.values()) n += list.length;
      return n;
    };
    const countLeafEntriesSub = (subM: SubMap): number => {
      let n = 0;
      for (const aL of subM.values()) for (const list of aL.values()) n += list.length;
      return n;
    };
    const countLeafEntriesArt = (aL: ArtMap): number => {
      let n = 0;
      for (const list of aL.values()) n += list.length;
      return n;
    };

    for (const gid of orderedGroupIds) {
      const sectMap = tree.get(gid)!;
      // Orden de sectores dentro del grupo: respetando sectors[].order
      const orderedSecIds = sectors.map((s) => s.id).filter((sid) => sectMap.has(sid));

      const groupCount = countLeafEntries(sectMap);
      if (groupCount === 0) continue;

      const groupLabel = gid === NO_GROUP ? "Sin grupo" : (groupById.get(gid)?.name ?? "(?)");
      const groupKey = `g::${gid}`;
      const groupCollapsed = collapsedGroups.has(groupKey);
      rows.push({ kind: "header", level: 0, key: groupKey, label: groupLabel, insumoCount: groupCount, collapsed: groupCollapsed });
      if (groupCollapsed) continue;

      for (const sid of orderedSecIds) {
        const catMap = sectMap.get(sid)!;
        const sec = sectorById.get(sid);
        const orderedCatIds = allCategories.map((c) => c.id).filter((cid) => catMap.has(cid));

        const sectorCount = countLeafEntriesCat(catMap);
        if (sectorCount === 0) continue;

        const sKey = `s::${gid}::${sid}`;
        const sCollapsed = collapsedGroups.has(sKey);
        rows.push({ kind: "header", level: 1, key: sKey, label: sec?.name ?? "(?)", insumoCount: sectorCount, collapsed: sCollapsed });
        if (sCollapsed) continue;

        for (const cid of orderedCatIds) {
          const subMap = catMap.get(cid)!;
          const cat = catById.get(cid);
          const orderedSubIds = allSubcategories.map((s) => s.id).filter((sid2) => subMap.has(sid2));

          const catCount = countLeafEntriesSub(subMap);
          if (catCount === 0) continue;

          const cKey = `c::${gid}::${sid}::${cid}`;
          const cCollapsed = collapsedGroups.has(cKey);
          rows.push({ kind: "header", level: 2, key: cKey, label: cat ? `${cat.code} ${cat.name}` : "(?)", insumoCount: catCount, collapsed: cCollapsed });
          if (cCollapsed) continue;

          for (const subId of orderedSubIds) {
            const artMap = subMap.get(subId)!;
            const sub = subById.get(subId);
            // Artículos en orden ascendente por number
            const orderedArtIds = [...artMap.keys()].sort((a, b) => {
              const an = artById.get(a)?.number ?? 0;
              const bn = artById.get(b)?.number ?? 0;
              return an - bn;
            });

            const subCount = countLeafEntriesArt(artMap);
            if (subCount === 0) continue;

            const subKey = `sb::${gid}::${sid}::${cid}::${subId}`;
            const subCollapsed = collapsedGroups.has(subKey);
            rows.push({ kind: "header", level: 3, key: subKey, label: sub ? `${sub.code} ${sub.name}` : "(?)", insumoCount: subCount, collapsed: subCollapsed });
            if (subCollapsed) continue;

            for (const aid of orderedArtIds) {
              const leafList = artMap.get(aid)!;
              if (leafList.length === 0) continue;
              const art = artById.get(aid);
              const aKey = `a::${gid}::${sid}::${cid}::${subId}::${aid}`;
              const aCollapsed = collapsedGroups.has(aKey);
              rows.push({
                kind: "header", level: 4, key: aKey,
                label: art ? `#${art.number} ${art.description}` : "(?)",
                insumoCount: leafList.length,
                collapsed: aCollapsed,
              });
              if (aCollapsed) continue;
              // Hojas: entries (qline, comp). Orden por código del insumo.
              const orderedEntries = [...leafList].sort((a, b) => a.insumo.code - b.insumo.code);
              for (const e of orderedEntries) {
                const entryKey = `${e.qline_id}::${e.comp.id}`;
                // Resolver assignment para esta entry específica
                const granular = globalQlineCompToPkg.get(entryKey);
                const legacy = globalCompToPkg.get(e.comp.id);
                const assignedTo = granular ?? legacy ?? null;
                rows.push({
                  kind: "entry",
                  key: `${aKey}::e::${entryKey}`,
                  entryKey,
                  qline_id: e.qline_id,
                  comp_id: e.comp.id,
                  insumo: e.insumo,
                  quantity: e.quantity,
                  assignedTo,
                });
              }
            }
          }
        }
      }
    }
    return rows;
  }, [viewMode, filtered, allCompsFull, qLinesByArt, sectors, sectorGroups, allCategories, allSubcategories, allArticulos, collapsedGroups, globalCompToPkg, globalQlineCompToPkg]);

  /* ── Helpers para vista agrupada ── */
  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function expandAll() { setCollapsedGroups(new Set()); }

  function collapseAll() {
    // Colapsamos sólo los headers visibles ahora — más simple iterar groupedRows
    const allKeys = new Set<string>();
    for (const r of groupedRows) if (r.kind === "header") allKeys.add(r.key);
    setCollapsedGroups(allKeys);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /** Keys visibles según el modo:
   *   - Lista plana: insumo_ids
   *   - Agrupada: entryKeys (qline::comp) — cada hoja es independiente
   *  Esto es lo que se usa para el "Seleccionar todos los visibles" del
   *  header de la tabla. */
  const visibleKeys = useMemo(() => {
    if (viewMode === "flat") return new Set(sorted.map((i) => i.id));
    const keys = new Set<string>();
    for (const r of groupedRows) {
      if (r.kind === "entry") {
        // Sólo seleccionables (no las que están en otro paquete)
        const inOther = r.assignedTo && r.assignedTo.packageId !== packageId;
        if (!inOther) keys.add(r.entryKey);
      }
    }
    return keys;
  }, [viewMode, sorted, groupedRows, packageId]);

  function toggleSelectAll() {
    if (selected.size === visibleKeys.size && visibleKeys.size > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleKeys));
    }
  }

  /** Resetear la selección al cambiar de viewMode — los identifiers son
   *  distintos (insumo_id vs entryKey) y no tiene sentido transportarlos. */
  useEffect(() => { setSelected(new Set()); }, [viewMode]);

  function handleSort(key: string) {
    return () => {
      setSort((prev) => {
        if (prev.key !== key) return { key, dir: "asc" };
        if (prev.dir === "asc") return { key, dir: "desc" };
        return { key: "", dir: null };
      });
    };
  }

  /** Render de una hoja del árbol agrupado: una entry específica
   *  (qline, comp). El checkbox usa `entryKey` (qline::comp), así cada
   *  aparición del mismo insumo en distintos artículos/sectores es
   *  seleccionable INDEPENDIENTEMENTE. */
  function renderEntryRow(row: Extract<GroupedRow, { kind: "entry" }>) {
    const i = row.insumo;
    const wasHere = row.assignedTo?.packageId === packageId;
    const inOther = row.assignedTo && row.assignedTo.packageId !== packageId;
    const checked = selected.has(row.entryKey);
    const disabled = !!inOther;
    return (
      <tr
        key={row.key}
        style={{
          borderBottom: "1px solid #F1F5F9",
          background: checked ? "#EFF6FF" : (wasHere ? "#ECFDF5" : (inOther ? "#FFFBEB" : undefined)),
          opacity: inOther ? 0.7 : 1,
        }}
      >
        <td className="px-1 py-1 text-center">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={() => toggleSelect(row.entryKey)}
            className="h-3.5 w-3.5 rounded cursor-pointer accent-[#E87722] disabled:cursor-not-allowed"
            title={inOther ? `En "${row.assignedTo!.packageName}"` : undefined}
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
        <td className="px-2 py-1 text-right font-mono text-xs" title={`${formatNumber(row.quantity, 4)} ${i.unit} (esta línea)`}>
          {row.quantity > 0 ? formatNumber(row.quantity, 2) : "—"}
        </td>
        <td className="px-2 py-1 text-xs truncate" title={i.category_labels.join(", ")}>
          {i.category_labels.length === 0 ? "—" : i.category_labels.length === 1 ? i.category_labels[0] : `${i.category_labels.length} categorías`}
        </td>
        <td className="px-2 py-1 text-xs truncate" title={i.subcategory_labels.join(", ")}>
          {i.subcategory_labels.length === 0 ? "—" : i.subcategory_labels.length === 1 ? i.subcategory_labels[0] : `${i.subcategory_labels.length} subcategorías`}
        </td>
        <td className="px-2 py-1">
          {wasHere && <Badge className="text-[10px] bg-emerald-600 text-white">En este paquete</Badge>}
          {inOther && row.assignedTo && (
            <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50">
              En "{row.assignedTo.packageName}"
            </Badge>
          )}
          {!wasHere && !inOther && (
            <span className="text-[10px] text-muted-foreground italic">Sin asignar</span>
          )}
        </td>
      </tr>
    );
  }

  /** Render de una fila de insumo (hoja) en vista plana. El checkbox
   *  state lee del Set `selected` por insumo.id; click en la fila abre
   *  el modal de detalle por composición. */
  function renderInsumoRow(i: AssignableInsumo, rowKey: string) {
    const isHere = i.assignment.kind === "all_here";
    const isOther = i.assignment.kind === "all_other";
    const isMixed = i.assignment.kind === "mixed";
    // En modo lista plana, click en la fila abre el modal de detalle
    // (selección granular por composición). En modo agrupado se usa el
    // checkbox directamente sobre cada composición y NO se abre modal.
    const clickable = viewMode === "flat";
    return (
      <tr
        key={rowKey}
        style={{
          borderBottom: "1px solid #F1F5F9",
          background: selected.has(i.id) ? "#EFF6FF" : (isHere ? "#ECFDF5" : undefined),
          cursor: clickable ? "pointer" : undefined,
        }}
        onClick={(e) => {
          if (!clickable) return;
          // No abrir el modal si el click fue sobre el checkbox
          if ((e.target as HTMLElement).closest("input[type='checkbox']")) return;
          setDetailInsumoId(i.id);
        }}
      >
        <td className="px-1 py-1 text-center">
          <input
            type="checkbox"
            checked={selected.has(i.id)}
            onChange={() => toggleSelect(i.id)}
            onClick={(e) => e.stopPropagation()}
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
        <td className="px-2 py-1 text-right font-mono text-xs" title={`${formatNumber(i.total_quantity, 4)} ${i.unit}`}>
          {i.total_quantity > 0 ? formatNumber(i.total_quantity, 2) : "—"}
        </td>
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
  }

  /** Construye las entries (qline × composition) para el modal del insumo
   *  activo. Cada entry es una línea de cuantificación individual donde
   *  aparece este insumo a través de un artículo. La granularidad permite
   *  asignar la misma composición en distintas qlines a paquetes distintos. */
  const detailEntries = useMemo<QlineCompEntry[]>(() => {
    if (!detailInsumoId) return [];
    const result: QlineCompEntry[] = [];
    const compsOfInsumo = allCompsFull.filter((c) => c.insumo_id === detailInsumoId);

    const artById = new Map(allArticulos.map((a) => [a.id, a]));
    const secById = new Map(sectors.map((s) => [s.id, s]));
    const catById = new Map(allCategories.map((c) => [c.id, c]));
    const subById = new Map(allSubcategories.map((s) => [s.id, s]));

    for (const comp of compsOfInsumo) {
      const qlines = qLinesByArt.get(comp.articulo_id) ?? [];
      if (qlines.length === 0) continue;

      const wasteFactor = 1 + Number(comp.waste_pct ?? 0) / 100;
      const marginFactor = 1 + Number(comp.margin_pct ?? 0) / 100;
      const compQty = Number(comp.quantity ?? 0);

      for (const ql of qlines) {
        // ¿Está asignada esta combinación específica (qline, comp)?
        // Primero buscamos a nivel granular; si no, fallback a la
        // asignación legacy de composición global.
        const granularKey = `${ql.qline_id}::${comp.id}`;
        const assigned = globalQlineCompToPkg.get(granularKey)
          ?? globalCompToPkg.get(comp.id)
          ?? null;

        result.push({
          qline_id: ql.qline_id,
          composition_id: comp.id,
          articulo: artById.get(comp.articulo_id) ?? null,
          sector: secById.get(ql.sector_id) ?? null,
          category: catById.get(ql.category_id) ?? null,
          subcategory: subById.get(ql.subcategory_id) ?? null,
          quantity: ql.quantity * compQty * wasteFactor * marginFactor,
          assigned_to: assigned,
        });
      }
    }
    // Orden por sector (ya lo hace el agrupador), luego por código de articulo
    result.sort((a, b) => (a.articulo?.number ?? 0) - (b.articulo?.number ?? 0));
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailInsumoId, allCompsFull, allArticulos, sectors, allCategories, allSubcategories, qLinesByArt, globalCompToPkg, globalQlineCompToPkg]);

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

          {/* Segunda fila: toggle de vista + botones de expandir/colapsar
              (sólo en modo agrupado). Misma estética que el segmented
              control de cuantificación. */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-md border bg-background overflow-hidden">
              <span className="px-2 py-1.5 text-xs text-muted-foreground border-r inline-flex items-center gap-1">
                <Layers className="h-3 w-3" /> Vista:
              </span>
              {([
                { v: "flat", label: "Lista" },
                { v: "grouped", label: "Agrupada (Grupo → Sector → Cat → Subcat → Art → Insumos)" },
              ] as const).map((opt, i) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setViewMode(opt.v)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-colors",
                    i > 0 && "border-l",
                    viewMode === opt.v
                      ? "bg-[#E87722] text-white"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {viewMode === "grouped" && (
              <>
                <Button
                  variant="ghost" size="sm"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={expandAll}
                  disabled={collapsedGroups.size === 0}
                >
                  <ChevronDown className="h-3 w-3 mr-1" /> Expandir todo
                </Button>
                <Button
                  variant="ghost" size="sm"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={collapseAll}
                >
                  <ChevronRight className="h-3 w-3 mr-1" /> Contraer todo
                </Button>
              </>
            )}
          </div>

          {/* Barra contextual bulk */}
          {selected.size > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[#0A0A0A] text-white shadow-md">
              <span className="text-sm font-medium">
                {viewMode === "grouped"
                  ? `${selected.size} línea${selected.size === 1 ? "" : "s"} seleccionada${selected.size === 1 ? "" : "s"}`
                  : `${selected.size} insumo${selected.size === 1 ? "" : "s"} seleccionado${selected.size === 1 ? "" : "s"}`}
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
                <col style={{ width: "280px" }} />
                <col style={{ width: "60px" }} />
                <col style={{ width: "100px" }} />
                <col style={{ width: "80px" }} />
                <col style={{ width: "60px" }} />
                <col style={{ width: "100px" }} />
                <col style={{ width: "160px" }} />
                <col style={{ width: "160px" }} />
                <col style={{ width: "140px" }} />
              </colgroup>
              <thead className="sticky top-0 z-30 bg-background shadow-sm">
                <tr>
                  <th className="px-1 py-2 text-center bg-background">
                    <input
                      type="checkbox"
                      checked={visibleKeys.size > 0 && selected.size === visibleKeys.size}
                      onChange={toggleSelectAll}
                      className="h-3.5 w-3.5 rounded cursor-pointer accent-[#E87722]"
                      title="Seleccionar/deseleccionar todos los visibles"
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
                    <ColumnFilter label="Cant. total" values={[]} activeValues={new Set()} onChange={() => {}} align="right" sortDirection={sort.key === "qty" ? sort.dir : null} onSort={handleSort("qty")} />
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
                {/* Render por modo. Lista plana: 1 fila por insumo único.
                    Agrupada: árbol de headers + insumos como hojas (un mismo
                    insumo puede aparecer varias veces, pero el checkbox es
                    compartido — la selección es por insumo_id). */}
                {viewMode === "flat" && sorted.map((i) => renderInsumoRow(i, i.id))}
                {viewMode === "grouped" && groupedRows.map((row) => {
                  if (row.kind === "header") {
                    // Estilos por nivel — degradé de gris oscuro a claro.
                    // 0=Grupo, 1=Sector, 2=Categoría, 3=Subcategoría, 4=Artículo.
                    const headerStyles = [
                      { bg: "#262626", color: "#fff", weight: "font-bold", border: "3px solid #0A0A0A", icon: <Folder className="h-3 w-3" /> },
                      { bg: "#525252", color: "#fff", weight: "font-bold", border: "2px solid #262626", icon: <Layers className="h-3 w-3" /> },
                      { bg: "#A3A3A3", color: "#fff", weight: "font-semibold", border: "1px solid #737373", icon: null },
                      { bg: "#D4D4D4", color: "#0A0A0A", weight: "font-semibold", border: "1px solid #BFBFBF", icon: null },
                      { bg: "#F5F5F5", color: "#0A0A0A", weight: "font-medium", border: "1px solid #E5E5E5", icon: null },
                    ][row.level];
                    return (
                      <tr key={row.key} style={{ background: headerStyles.bg, color: headerStyles.color, borderTop: headerStyles.border }}>
                        <td colSpan={11} className={cn("px-2 py-1.5 text-xs", headerStyles.weight)} style={{ paddingLeft: `${8 + row.level * 16}px` }}>
                          <button
                            type="button"
                            onClick={() => toggleGroup(row.key)}
                            className="flex items-center gap-1.5 hover:opacity-80"
                          >
                            {row.collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            {headerStyles.icon}
                            <span>{row.label}</span>
                            <span className="opacity-70 font-mono text-[10px]">({row.insumoCount} línea{row.insumoCount === 1 ? "" : "s"})</span>
                          </button>
                        </td>
                      </tr>
                    );
                  }
                  // row.kind === "entry": una hoja granular (qline + comp)
                  return renderEntryRow(row);
                })}
                {(viewMode === "flat" ? sorted.length === 0 : groupedRows.length === 0) && (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-sm text-muted-foreground">
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

      {/* Modal de detalle del insumo (selección granular por composición).
          Sólo se monta cuando hay un insumo activo. Pasa todas las
          composiciones del insumo con sus ubicaciones en el proyecto. */}
      <InsumoCompositionDialog
        open={detailInsumoId != null}
        onClose={() => setDetailInsumoId(null)}
        insumo={detailInsumoId ? (allInsumos.find((i) => i.id === detailInsumoId) ?? null) : null}
        entries={detailEntries}
        currentPackage={pkg}
        supabase={supabase}
        projectId={projectId}
        onApplied={async () => {
          // Recargar datos tras aplicar cambios — actualiza assignments
          // en la lista plana, agrupada y "Insumos asignados".
          await loadData();
        }}
      />
    </div>
  );
}
