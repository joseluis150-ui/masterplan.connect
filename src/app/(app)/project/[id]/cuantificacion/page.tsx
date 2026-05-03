"use client";

import React, { useEffect, useState, useCallback, use } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { evaluateFormula, formatNumber, convertCurrency } from "@/lib/utils/formula";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { FormulaInput } from "@/components/shared/formula-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { parseCuantificacionExcel, generateCuantificacionTemplate, downloadBlob } from "@/lib/utils/excel";
import type { CuantificacionImportResult } from "@/lib/utils/excel";
import type { Articulo, EdtCategory, EdtSubcategory, Sector, Insumo, Project } from "@/lib/types/database";
import { Plus, Trash2, Calculator, Upload, Download, Flag, X, Layers, ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { ColumnFilter, type SortDirection } from "@/components/shared/column-filter";

type SortConfig = { key: string; dir: SortDirection };
import { toast } from "sonner";
import { ArticuloCompositionDialog } from "./_components/articulo-composition-dialog";

// Batch colors for import tracking — brand-aligned palette (Ash + Amber + allowed accents)
const BATCH_COLORS = [
  "#E87722", "#B85A0F", "#FDB67A", "#0A0A0A", "#3D3D3D",
  "#737373", "#166534", "#991B1B", "#FACC15", "#BFBFBF",
];

/**
 * Hook genérico que envuelve useState con persistencia automática en
 * localStorage. Misma API que useState, sólo agrega `key` (única por
 * proyecto) y opcionalmente `toJSON`/`fromJSON` para tipos no-JSON-nativos
 * como `Set`. Si window no existe (SSR) o el JSON está corrupto, cae al
 * `defaultValue`.
 *
 * Uso:
 *   const [open, setOpen] = usePersistedState("foo:open:" + id, false);
 *   const [tags, setTags] = usePersistedState<Set<string>>("foo:tags:" + id, new Set(), {
 *     toJSON: (s) => Array.from(s),
 *     fromJSON: (raw) => new Set(Array.isArray(raw) ? raw as string[] : []),
 *   });
 */
function usePersistedState<T>(
  key: string,
  defaultValue: T,
  options?: {
    toJSON?: (v: T) => unknown;
    fromJSON?: (raw: unknown) => T;
  }
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const toJSON = options?.toJSON ?? ((v: T) => v);
  const fromJSON = options?.fromJSON ?? ((raw: unknown) => raw as T);

  const [value, _setValue] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return defaultValue;
      return fromJSON(JSON.parse(raw));
    } catch {
      return defaultValue;
    }
  });

  const setValue: React.Dispatch<React.SetStateAction<T>> = (action) => {
    _setValue((prev) => {
      const next = typeof action === "function"
        ? (action as (p: T) => T)(prev)
        : action;
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(key, JSON.stringify(toJSON(next)));
        } catch {
          // localStorage lleno o bloqueado — silencioso
        }
      }
      return next;
    });
  };

  return [value, setValue];
}

// Helpers de serialización para Sets (re-usable en el componente).
const SET_PERSIST_OPTS = {
  toJSON: (s: Set<string>) => Array.from(s),
  fromJSON: (raw: unknown) => new Set<string>(Array.isArray(raw) ? raw as string[] : []),
};

interface QuantLine {
  id: string;
  articulo_id: string | null;
  quantity: number | null;
  quantity_formula: string | null;
  category_id: string;
  subcategory_id: string;
  sector_id: string;
  line_number: number;
  comment: string | null;
  import_batch: string | null;
  import_batch_date: string | null;
  needs_review: boolean;
  // enriched
  articulo_desc: string;
  articulo_unit: string;
  articulo_pu: number;
}

export default function CuantificacionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const [lines, setLines] = useState<QuantLine[]>([]);
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [categories, setCategories] = useState<EdtCategory[]>([]);
  const [subcategories, setSubcategories] = useState<EdtSubcategory[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  /** Catálogo de insumos del proyecto — usado por ArticuloCompositionDialog
   *  para poblar el SearchableSelect de "agregar insumo". */
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  /** Proyecto — necesario para TC y moneda local del toggle USD/PYG. */
  const [project, setProject] = useState<Project | null>(null);
  /** Toggle USD ↔ moneda local. Persistido por proyecto, mismo patrón que
   *  presupuesto-tab. Convierte PU, Total, subtotales y grand total. */
  const [showLocal, setShowLocal] = usePersistedState<boolean>(`cuant:showLocal:${projectId}`, false);
  const [loading, setLoading] = useState(true);
  // Filtros, sort y agrupamiento — persisten en localStorage por proyecto
  // para que al volver a Cuantificación encuentres todo como lo dejaste.
  const [filterArticulo, setFilterArticulo]       = usePersistedState<Set<string>>(`cuant:filterArticulo:${projectId}`,    new Set(), SET_PERSIST_OPTS);
  const [filterUnit, setFilterUnit]               = usePersistedState<Set<string>>(`cuant:filterUnit:${projectId}`,        new Set(), SET_PERSIST_OPTS);
  const [filterCategory, setFilterCategory]       = usePersistedState<Set<string>>(`cuant:filterCategory:${projectId}`,    new Set(), SET_PERSIST_OPTS);
  const [filterSubcategory, setFilterSubcategory] = usePersistedState<Set<string>>(`cuant:filterSubcategory:${projectId}`, new Set(), SET_PERSIST_OPTS);
  const [filterSector, setFilterSector]           = usePersistedState<Set<string>>(`cuant:filterSector:${projectId}`,      new Set(), SET_PERSIST_OPTS);
  const [filterReview, setFilterReview]           = usePersistedState<string>(`cuant:filterReview:${projectId}`,           "all");
  const [sort, setSort]                           = usePersistedState<SortConfig>(`cuant:sort:${projectId}`,               { key: "", dir: null });
  /** Modo de agrupamiento. Sólo dos opciones jerárquicas:
   *   - "sector-category" → 2 niveles: Sector → Categoría
   *   - "sector-category-subcategory" → 3 niveles: Sector → Categoría → Subcategoría
   *  Cada nivel respeta el orden de su tabla (sectors.order, categories.order,
   *  edt_subcategories.order). Las líneas dentro del último nivel conservan
   *  el sort por columna activo. */
  const [groupBy, setGroupBy]                     = usePersistedState<"sector-category" | "sector-category-subcategory">(`cuant:groupBy:${projectId}`, "sector-category");
  /** Set de group_ids cuyo grupo está contraído. Las keys son sector_id o
   *  category_id según el modo activo — como son UUIDs no chocan entre
   *  sí, podemos compartir una sola Set para ambos modos sin perder estado
   *  al alternar. El valor "__none__" representa el grupo de líneas sin
   *  el campo correspondiente asignado. */
  const [collapsedGroups, setCollapsedGroups]     = usePersistedState<Set<string>>(`cuant:collapsedGroups:${projectId}`, new Set(), SET_PERSIST_OPTS);
  const [artPUs, setArtPUs] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  /** Articulo abierto en el modal de composición (click en celda PU USD). */
  const [composicionArticuloId, setComposicionArticuloId] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<CuantificacionImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const supabase = createClient();

  const loadData = useCallback(async () => {
    // All 6 queries in parallel — single round trip
    const [linesRes, artsRes, catsRes, subsRes, sectorsRes, puRes, insRes, projRes] = await Promise.all([
      supabase.from("quantification_lines").select("*").eq("project_id", projectId).is("deleted_at", null).order("line_number"),
      supabase.from("articulos").select("*").eq("project_id", projectId).order("number"),
      supabase.from("edt_categories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("sectors").select("*").eq("project_id", projectId).order("order"),
      supabase.rpc("get_project_articulo_totals", { p_project_id: projectId }),
      supabase.from("insumos").select("*").eq("project_id", projectId).order("description"),
      supabase.from("projects").select("*").eq("id", projectId).single(),
    ]);

    const arts = artsRes.data || [];
    const cats = catsRes.data || [];
    const subs = subsRes.data || [];
    const sects = sectorsRes.data || [];
    const inss = insRes.data || [];

    // Build PU map from single batch query (was N+1 sequential calls before)
    const pus: Record<string, number> = {};
    for (const row of (puRes.data || [])) {
      pus[row.articulo_id] = Number(row.pu_costo);
    }

    const enriched: QuantLine[] = (linesRes.data || []).map((line) => {
      const art = arts.find((a) => a.id === line.articulo_id);
      return {
        ...line,
        articulo_desc: art?.description || "",
        articulo_unit: art?.unit || "",
        articulo_pu: line.articulo_id ? (pus[line.articulo_id] || 0) : 0,
      };
    });

    setLines(enriched);
    setArticulos(arts);
    setCategories(cats);
    setSubcategories(subs);
    setSectors(sects);
    setArtPUs(pus);
    setInsumos(inss);
    if (projRes.data) setProject(projRes.data as Project);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Collect unique batches for filter and color assignment
  const batchList = Array.from(new Set(lines.filter((l) => l.import_batch).map((l) => l.import_batch!)));
  const batchColorMap = new Map<string, string>();
  batchList.forEach((b, i) => batchColorMap.set(b, BATCH_COLORS[i % BATCH_COLORS.length]));

  const reviewCount = lines.filter((l) => l.needs_review).length;

  // Unique values for column filters
  const uniqueArticulos = Array.from(new Set(lines.map((l) => l.articulo_desc || "(Sin artículo)")));
  const uniqueUnits = Array.from(new Set(lines.map((l) => l.articulo_unit || "(Vacío)")));
  const uniqueCategories = Array.from(new Set(lines.map((l) => {
    const cat = categories.find((c) => c.id === l.category_id);
    return cat ? `${cat.code} ${cat.name}` : "(Vacío)";
  })));
  const uniqueSubcategories = Array.from(new Set(lines.map((l) => {
    const sub = subcategories.find((s) => s.id === l.subcategory_id);
    return sub ? `${sub.code} ${sub.name}` : "(Vacío)";
  })));
  const uniqueSectors = Array.from(new Set(lines.map((l) => {
    const sec = sectors.find((s) => s.id === l.sector_id);
    return sec?.name || "(Vacío)";
  })));

  const hasAnyColumnFilter = filterArticulo.size > 0 || filterUnit.size > 0 || filterCategory.size > 0 || filterSubcategory.size > 0 || filterSector.size > 0 || filterReview !== "all";

  const filtered = lines.filter((l) => {
    const artLabel = l.articulo_desc || "(Sin artículo)";
    const unitLabel = l.articulo_unit || "(Vacío)";
    const catLabel = (() => { const c = categories.find((c) => c.id === l.category_id); return c ? `${c.code} ${c.name}` : "(Vacío)"; })();
    const subLabel = (() => { const s = subcategories.find((s) => s.id === l.subcategory_id); return s ? `${s.code} ${s.name}` : "(Vacío)"; })();
    const secLabel = (() => { const s = sectors.find((s) => s.id === l.sector_id); return s?.name || "(Vacío)"; })();

    const matchArt = filterArticulo.size === 0 || filterArticulo.has(artLabel);
    const matchUnit = filterUnit.size === 0 || filterUnit.has(unitLabel);
    const matchCat = filterCategory.size === 0 || filterCategory.has(catLabel);
    const matchSub = filterSubcategory.size === 0 || filterSubcategory.has(subLabel);
    const matchSector = filterSector.size === 0 || filterSector.has(secLabel);
    const matchReview = filterReview === "all" || (filterReview === "review" ? l.needs_review : !l.needs_review);
    return matchArt && matchUnit && matchCat && matchSub && matchSector && matchReview;
  });

  const grandTotal = filtered.reduce((sum, l) => sum + (Number(l.quantity) || 0) * l.articulo_pu, 0);

  // Formato monetario sensible al toggle USD/local. Misma lógica que en
  // presupuesto-tab. Si showLocal está activo y hay TC>0, multiplica el
  // valor USD por el TC. Etiqueta de moneda dinámica para columnas/total.
  // En moneda local SIEMPRE forzamos 0 decimales (PYG son montos grandes;
  // los decimales son ruido).
  const tc = Number(project?.exchange_rate || 0);
  const fmtMoney = (val: number, decimals = 2) => showLocal && tc > 0
    ? formatNumber(convertCurrency(val, tc, "usd_to_local"), 0)
    : formatNumber(val, decimals);
  const moneyCurrency = showLocal ? (project?.local_currency || "LOCAL") : "USD";

  const sorted = [...filtered].sort((a, b) => {
    if (!sort.dir || !sort.key) return 0;
    const mult = sort.dir === "asc" ? 1 : -1;
    switch (sort.key) {
      case "articulo": return mult * a.articulo_desc.localeCompare(b.articulo_desc, "es");
      case "unit": return mult * a.articulo_unit.localeCompare(b.articulo_unit, "es");
      case "pu": return mult * (a.articulo_pu - b.articulo_pu);
      case "quantity": return mult * ((Number(a.quantity) || 0) - (Number(b.quantity) || 0));
      case "total": return mult * (((Number(a.quantity) || 0) * a.articulo_pu) - ((Number(b.quantity) || 0) * b.articulo_pu));
      case "category": {
        const catA = categories.find((c) => c.id === a.category_id);
        const catB = categories.find((c) => c.id === b.category_id);
        return mult * (catA?.name || "").localeCompare(catB?.name || "", "es");
      }
      case "subcategory": {
        const subA = subcategories.find((s) => s.id === a.subcategory_id);
        const subB = subcategories.find((s) => s.id === b.subcategory_id);
        return mult * (subA?.name || "").localeCompare(subB?.name || "", "es");
      }
      case "sector": {
        const secA = sectors.find((s) => s.id === a.sector_id);
        const secB = sectors.find((s) => s.id === b.sector_id);
        return mult * (secA?.name || "").localeCompare(secB?.name || "", "es");
      }
      default: return 0;
    }
  });

  function handleSort(key: string) {
    return (dir: SortDirection) => setSort(dir ? { key, dir } : { key: "", dir: null });
  }

  /** Toggle collapse de un grupo. Click en el header del grupo o en los
   *  botones expandir/colapsar todo. */
  function toggleGroupCollapse(groupKey: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }
  /** Colapsa todos los grupos visibles del modo activo. Como ahora ambos
   *  modos son jerárquicos, contraemos el ÚLTIMO nivel para que el
   *  usuario vea los headers de los niveles superiores expandidos con
   *  los hijos plegados adentro:
   *   - sector-category               → contrae las categorías
   *   - sector-category-subcategory   → contrae las subcategorías
   *  Si colapsáramos los niveles superiores, los headers de hijos
   *  quedarían ocultos y el efecto sería confuso. */
  function collapseAllGroups() {
    const allKeys = new Set<string>();
    for (const l of filtered) {
      const sec = l.sector_id || "__none__";
      const cat = l.category_id || "__none__";
      const sub = l.subcategory_id || "__none__";
      if (groupBy === "sector-category-subcategory") {
        allKeys.add(`${sec}::${cat}::${sub}`);
      } else {
        // sector-category
        allKeys.add(`${sec}::${cat}`);
      }
    }
    setCollapsedGroups(allKeys);
  }
  /** Expande todos los grupos del modo activo. */
  function expandAllGroups() {
    setCollapsedGroups(new Set());
  }

  async function toggleLineReview(lineId: string) {
    const line = lines.find((l) => l.id === lineId);
    if (!line) return;
    const newVal = !line.needs_review;
    await supabase.from("quantification_lines").update({ needs_review: newVal }).eq("id", lineId);
    setLines((prev) => prev.map((l) => l.id === lineId ? { ...l, needs_review: newVal } : l));
    toast.success(newVal ? "Marcado para revisión" : "Revisión completada");
  }

  /** Crea una línea nueva. Si se pasan overrides (sector_id, category_id,
   *  subcategory_id) los usa en lugar de los defaults — útil para los
   *  botones "+" en los headers de grupo, que crean la línea ya con su
   *  contexto correcto. */
  async function addNewLine(overrides?: {
    sector_id?: string;
    category_id?: string;
    subcategory_id?: string;
  }) {
    const lineNumber = lines.length + 1;
    const defaultCat = overrides?.category_id || categories[0]?.id || "";
    // Si pasaron una categoría específica, la subcategoría debe pertenecer
    // a esa categoría — sino caemos a la primera de la categoría elegida.
    const defaultSub =
      overrides?.subcategory_id ||
      subcategories.find((s) => s.category_id === defaultCat)?.id ||
      "";
    const defaultSector = overrides?.sector_id || sectors[0]?.id || "";

    if (!defaultCat || !defaultSub || !defaultSector) {
      toast.error("Necesitas al menos una categoría, subcategoría y sector definidos");
      return;
    }

    const { data, error } = await supabase
      .from("quantification_lines")
      .insert({
        project_id: projectId,
        articulo_id: null,
        quantity: null,
        quantity_formula: null,
        category_id: defaultCat,
        subcategory_id: defaultSub,
        sector_id: defaultSector,
        line_number: lineNumber,
        comment: null,
      })
      .select()
      .single();

    if (!error && data) {
      const newLine: QuantLine = {
        ...data,
        articulo_desc: "",
        articulo_unit: "",
        articulo_pu: 0,
      };
      setLines([...lines, newLine]);
    }
  }

  async function updateLineField(lineId: string, field: string, value: unknown) {
    await supabase.from("quantification_lines").update({ [field]: value }).eq("id", lineId);

    // If articulo changed, update enriched data
    if (field === "articulo_id") {
      const art = articulos.find((a) => a.id === value);
      setLines((prev) =>
        prev.map((l) =>
          l.id === lineId
            ? {
                ...l,
                articulo_id: (value as string) || null,
                articulo_desc: art?.description || "",
                articulo_unit: art?.unit || "",
                articulo_pu: value ? (artPUs[value as string] || 0) : 0,
              }
            : l
        )
      );
    } else if (field === "quantity") {
      setLines((prev) =>
        prev.map((l) => (l.id === lineId ? { ...l, quantity: value as number } : l))
      );
    } else if (field === "quantity_formula") {
      const qty = evaluateFormula(value as string);
      await supabase.from("quantification_lines").update({ quantity: qty }).eq("id", lineId);
      setLines((prev) =>
        prev.map((l) => (l.id === lineId ? { ...l, quantity_formula: value as string, quantity: qty } : l))
      );
    } else {
      setLines((prev) =>
        prev.map((l) => (l.id === lineId ? { ...l, [field]: value } : l))
      );
    }
  }

  async function deleteLine(id: string) {
    if (!confirm("¿Eliminar esta línea?")) return;
    await supabase.from("quantification_lines").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    setLines(lines.filter((l) => l.id !== id));
    setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
    toast.success("Línea eliminada");
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`¿Eliminar ${selected.size} líneas seleccionadas?`)) return;
    const ids = Array.from(selected);
    await supabase.from("quantification_lines").update({ deleted_at: new Date().toISOString() }).in("id", ids);
    setLines(lines.filter((l) => !selected.has(l.id)));
    setSelected(new Set());
    toast.success(`${ids.length} líneas eliminadas`);
  }

  async function deleteAll() {
    if (!confirm(`¿Eliminar TODAS las ${lines.length} líneas de cuantificación?\n\nLos datos del cronograma y paquetes asociados se conservarán y podrán restaurarse.`)) return;
    await supabase.from("quantification_lines").update({ deleted_at: new Date().toISOString() }).eq("project_id", projectId).is("deleted_at", null);
    setLines([]);
    setSelected(new Set());
    toast.success("Todas las líneas eliminadas (soft-delete)");
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((l) => l.id)));
    }
  }

  const getSubsForCategory = (catId: string) => subcategories.filter((s) => s.category_id === catId);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = ev.target?.result as ArrayBuffer;
      const result = parseCuantificacionExcel(data);
      setImportResult(result);
      setImportDialogOpen(true);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  async function executeCuantImport() {
    if (!importResult) return;
    setImporting(true);
    const batchId = `import-${Date.now()}`;
    const batchDate = new Date().toISOString();

    try {
      // Step 1: Ensure all categories/subcategories exist
      const catIdMap = new Map<string, string>(); // catKey -> uuid
      const subIdMap = new Map<string, string>(); // subKey -> uuid

      // Match existing categories by code or name
      for (const cat of categories) {
        catIdMap.set(cat.code, cat.id);
        catIdMap.set(cat.name.toLowerCase(), cat.id);
      }
      for (const sub of subcategories) {
        subIdMap.set(sub.code, sub.id);
        subIdMap.set(sub.name.toLowerCase(), sub.id);
      }

      // Create missing categories and subcategories
      let catOrder = categories.length;
      for (const [, catInfo] of importResult.categoriesNeeded) {
        const catKey = catInfo.code || catInfo.name.toLowerCase();
        if (!catIdMap.has(catKey)) {
          const newCode = String(catOrder + 1);
          const { data: newCat } = await supabase
            .from("edt_categories")
            .insert({ project_id: projectId, code: newCode, name: catInfo.name, order: catOrder })
            .select().single();
          if (newCat) {
            catIdMap.set(catKey, newCat.id);
            catIdMap.set(catInfo.name.toLowerCase(), newCat.id);
            catIdMap.set(newCode, newCat.id);
            catOrder++;

            // Create subcategories for this new category
            let subOrder = 0;
            for (const [, subInfo] of catInfo.subs) {
              const subCode = `${newCode}.${subOrder + 1}`;
              const { data: newSub } = await supabase
                .from("edt_subcategories")
                .insert({ category_id: newCat.id, project_id: projectId, code: subCode, name: subInfo.name, order: subOrder })
                .select().single();
              if (newSub) {
                subIdMap.set(subInfo.code || subInfo.name.toLowerCase(), newSub.id);
                subIdMap.set(subCode, newSub.id);
                subIdMap.set(subInfo.name.toLowerCase(), newSub.id);
              }
              subOrder++;
            }
          }
        } else {
          // Category exists, check subcategories
          const catId = catIdMap.get(catKey)!;
          const existingSubs = subcategories.filter((s) => s.category_id === catId);
          let subOrder = existingSubs.length;
          for (const [, subInfo] of catInfo.subs) {
            const subKey = subInfo.code || subInfo.name.toLowerCase();
            if (!subIdMap.has(subKey)) {
              const parentCat = categories.find((c) => c.id === catId);
              const subCode = `${parentCat?.code || catOrder}.${subOrder + 1}`;
              const { data: newSub } = await supabase
                .from("edt_subcategories")
                .insert({ category_id: catId, project_id: projectId, code: subCode, name: subInfo.name, order: subOrder })
                .select().single();
              if (newSub) {
                subIdMap.set(subKey, newSub.id);
                subIdMap.set(subCode, newSub.id);
                subIdMap.set(subInfo.name.toLowerCase(), newSub.id);
              }
              subOrder++;
            }
          }
        }
      }

      // Step 2: Ensure all sectors exist
      const sectorIdMap = new Map<string, string>();
      for (const s of sectors) {
        sectorIdMap.set(s.name.toLowerCase(), s.id);
      }
      let sectorOrder = sectors.length;
      for (const sectorName of importResult.sectorsNeeded) {
        if (!sectorIdMap.has(sectorName.toLowerCase())) {
          const { data: newSector } = await supabase
            .from("sectors")
            .insert({ project_id: projectId, name: sectorName, type: "fisico", order: sectorOrder })
            .select().single();
          if (newSector) {
            sectorIdMap.set(sectorName.toLowerCase(), newSector.id);
            sectorOrder++;
          }
        }
      }

      // Step 3: Match articulos by number
      const artIdMap = new Map<number, string>();
      for (const art of articulos) {
        artIdMap.set(art.number, art.id);
      }

      // Step 4: Insert quantification lines in batch
      const baseLineNum = lines.length;
      const rowsToInsert = [];
      for (let i = 0; i < importResult.valid.length; i++) {
        const row = importResult.valid[i];
        const catKey = row.cat_code || row.cat_name.toLowerCase();
        const subKey = row.sub_code || row.sub_name.toLowerCase();
        const catId = catIdMap.get(catKey);
        const subId = subIdMap.get(subKey);
        const sectorId = sectorIdMap.get(row.sector_name.toLowerCase());
        const artId = row.art_number ? artIdMap.get(row.art_number) || null : null;

        if (!catId || !subId || !sectorId) continue;

        rowsToInsert.push({
          project_id: projectId,
          articulo_id: artId,
          quantity: row.cantidad,
          quantity_formula: row.cantidad_formula || null,
          category_id: catId,
          subcategory_id: subId,
          sector_id: sectorId,
          line_number: baseLineNum + i + 1,
          comment: row.comentario || null,
          import_batch: batchId,
          import_batch_date: batchDate,
        });
      }

      // Insert in batches of 500 rows
      for (let i = 0; i < rowsToInsert.length; i += 500) {
        const batch = rowsToInsert.slice(i, i + 500);
        await supabase.from("quantification_lines").insert(batch);
      }
      const count = rowsToInsert.length;

      toast.success(`Importadas ${count} líneas de cuantificación`);
    } catch (err) {
      toast.error("Error durante la importación");
      console.error(err);
    }

    setImportDialogOpen(false);
    setImportResult(null);
    setImporting(false);
    loadData();
  }

  if (loading) return <div className="animate-pulse h-96 bg-muted rounded-lg" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cuantificación</h1>
          <p className="text-muted-foreground">Paso 5: Asigna artículos al EDT con cantidades</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { const d = generateCuantificacionTemplate(); downloadBlob(d, "plantilla_cuantificacion.xlsx"); toast.success("Plantilla descargada"); }}>
            <Download className="h-4 w-4 mr-1" /> Plantilla
          </Button>
          <Button variant="outline" size="sm" onClick={() => document.getElementById("cuant-file-input")?.click()}>
            <Upload className="h-4 w-4 mr-1" /> Importar Excel
          </Button>
          <input id="cuant-file-input" type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" />
          {selected.size > 0 && (
            <Button variant="outline" size="sm" onClick={deleteSelected} className="text-destructive hover:bg-destructive hover:text-white">
              <Trash2 className="h-4 w-4 mr-1" /> Eliminar ({selected.size})
            </Button>
          )}
          {lines.length > 0 && (
            <Button variant="outline" size="sm" onClick={deleteAll} className="text-destructive hover:bg-destructive hover:text-white">
              <Trash2 className="h-4 w-4 mr-1" /> Eliminar todo
            </Button>
          )}
        </div>
      </div>

      {/* Summary bar */}
      <div className="flex gap-4 items-center flex-wrap">
        <span className="text-sm text-muted-foreground">{filtered.length} líneas</span>
        {/* Segmented control: sólo dos vistas jerárquicas */}
        <div className="inline-flex rounded-md border bg-background overflow-hidden">
          <span className="px-2 py-1.5 text-xs text-muted-foreground border-r inline-flex items-center gap-1">
            <Layers className="h-3 w-3" /> Agrupar:
          </span>
          {([
            { v: "sector-category",              label: "Sector → Categoría" },
            { v: "sector-category-subcategory",  label: "Sector → Categoría → Subcategoría" },
          ] as const).map((opt, i) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setGroupBy(opt.v)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                i > 0 && "border-l",
                groupBy === opt.v
                  ? "bg-[#E87722] text-white"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={expandAllGroups}
          disabled={collapsedGroups.size === 0}
          title="Expandir todos los grupos"
        >
          <ChevronDown className="h-3 w-3 mr-1" />
          Expandir todo
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={collapseAllGroups}
          title="Contraer todos los grupos"
        >
          <ChevronRight className="h-3 w-3 mr-1" />
          Contraer todo
        </Button>
        {reviewCount > 0 && (
          <Button
            variant={filterReview === "review" ? "default" : "outline"}
            size="sm"
            className={filterReview === "review" ? "text-xs bg-amber-500 hover:bg-amber-600 text-white" : "text-xs text-amber-600 border-amber-300 hover:bg-amber-50"}
            onClick={() => setFilterReview(filterReview === "review" ? "all" : "review")}
          >
            <Flag className="h-3 w-3 mr-1" /> {reviewCount} por revisar
          </Button>
        )}
        {hasAnyColumnFilter && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-destructive hover:text-destructive"
            onClick={() => {
              setFilterArticulo(new Set()); setFilterUnit(new Set());
              setFilterCategory(new Set()); setFilterSubcategory(new Set());
              setFilterSector(new Set()); setFilterReview("all");
            }}
          >
            <X className="h-3 w-3 mr-1" /> Limpiar filtros
          </Button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {/* Toggle USD ↔ moneda local */}
          <Label className="text-xs text-muted-foreground">USD</Label>
          <Switch checked={showLocal} onCheckedChange={setShowLocal} />
          <Label className="text-xs text-muted-foreground">{project?.local_currency || "LOCAL"}</Label>
          <span className="text-sm font-medium ml-3">
            Total: {fmtMoney(grandTotal, 0)} <span className="text-xs text-muted-foreground">{moneyCurrency}</span>
          </span>
        </div>
      </div>

      {/* Inline table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="brand-table w-full text-sm" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "32px" }} />
              <col style={{ width: "28px" }} />
              <col style={{ width: "40px" }} />
              <col style={{ width: "260px" }} />
              <col style={{ width: "45px" }} />
              <col style={{ width: "75px" }} />
              <col style={{ width: "85px" }} />
              <col style={{ width: "85px" }} />
              <col style={{ width: "115px" }} />
              <col style={{ width: "115px" }} />
              <col style={{ width: "100px" }} />
              <col style={{ width: "70px" }} />
            </colgroup>
            <thead>
              <tr>
                <th className="px-1 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 rounded cursor-pointer accent-[#E87722]"
                  />
                </th>
                <th className="px-1 py-2 text-center" title="Marcador de revisión">
                  <Flag className="h-3 w-3 mx-auto text-muted-foreground/50" />
                </th>
                <th className="px-2 py-2 text-left uppercase text-[11px] font-semibold tracking-wider">#</th>
                <th className="px-2 py-2">
                  <ColumnFilter label="Artículo" values={uniqueArticulos} activeValues={filterArticulo} onChange={setFilterArticulo} sortDirection={sort.key === "articulo" ? sort.dir : null} onSort={handleSort("articulo")} />
                </th>
                <th className="px-2 py-2">
                  <ColumnFilter label="Und" values={uniqueUnits} activeValues={filterUnit} onChange={setFilterUnit} align="center" sortDirection={sort.key === "unit" ? sort.dir : null} onSort={handleSort("unit")} />
                </th>
                <th className="px-2 py-2">
                  <ColumnFilter label={`PU ${moneyCurrency}`} values={[]} activeValues={new Set()} onChange={() => {}} align="right" sortDirection={sort.key === "pu" ? sort.dir : null} onSort={handleSort("pu")} />
                </th>
                <th className="px-2 py-2">
                  <ColumnFilter label="Cantidad" values={[]} activeValues={new Set()} onChange={() => {}} align="right" sortDirection={sort.key === "quantity" ? sort.dir : null} onSort={handleSort("quantity")} />
                </th>
                <th className="px-2 py-2">
                  <ColumnFilter label={`Total ${moneyCurrency}`} values={[]} activeValues={new Set()} onChange={() => {}} align="right" sortDirection={sort.key === "total" ? sort.dir : null} onSort={handleSort("total")} />
                </th>
                <th className="px-2 py-2">
                  <ColumnFilter label="Categoría" values={uniqueCategories} activeValues={filterCategory} onChange={setFilterCategory} sortDirection={sort.key === "category" ? sort.dir : null} onSort={handleSort("category")} />
                </th>
                <th className="px-2 py-2">
                  <ColumnFilter label="Subcat." values={uniqueSubcategories} activeValues={filterSubcategory} onChange={setFilterSubcategory} sortDirection={sort.key === "subcategory" ? sort.dir : null} onSort={handleSort("subcategory")} />
                </th>
                <th className="px-2 py-2">
                  <ColumnFilter label="Sector" values={uniqueSectors} activeValues={filterSector} onChange={setFilterSector} sortDirection={sort.key === "sector" ? sort.dir : null} onSort={handleSort("sector")} />
                </th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && lines.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center">
                    <Calculator className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                    <p className="text-muted-foreground mb-1">Sin líneas de cuantificación</p>
                    <p className="text-xs text-muted-foreground">Agrega la primera línea abajo</p>
                  </td>
                </tr>
              ) : (
                // Construimos un array de RenderItem (header nivel 0 / header nivel 1
                // / data line) y lo mappeamos al final. Esto soporta limpiamente la
                // jerarquía sector→categoría sin tener que intercalar headers en
                // un map de líneas.
                (() => {
                  type RenderItem =
                    | { kind: "header"; level: 0 | 1 | 2; key: string; label: string; total: number; count: number; collapsed: boolean }
                    | { kind: "line";   line: QuantLine; idx: number };

                  const items: RenderItem[] = [];

                  // Helpers locales para totales y subtotales
                  const sumLines = (ls: typeof sorted) =>
                    ls.reduce((s, l) => s + (Number(l.quantity) || 0) * l.articulo_pu, 0);

                  // Orden de sectores / categorías
                  const sectorOrderVal = (id: string) => {
                    if (id === "__none__") return Number.MAX_SAFE_INTEGER;
                    return sectors.find((s) => s.id === id)?.order ?? Number.MAX_SAFE_INTEGER;
                  };
                  const catOrderVal = (id: string) => {
                    if (id === "__none__") return Number.MAX_SAFE_INTEGER;
                    return categories.find((c) => c.id === id)?.order ?? Number.MAX_SAFE_INTEGER;
                  };
                  const subOrderVal = (id: string) => {
                    if (id === "__none__") return Number.MAX_SAFE_INTEGER;
                    return subcategories.find((s) => s.id === id)?.order ?? Number.MAX_SAFE_INTEGER;
                  };
                  const sectorLabel = (id: string) => id === "__none__" ? "(Sin sector)" : (sectors.find((s) => s.id === id)?.name ?? "(Sin sector)");
                  const catLabel = (id: string) => {
                    if (id === "__none__") return "(Sin categoría)";
                    const c = categories.find((x) => x.id === id);
                    return c ? `${c.code} ${c.name}` : "(Sin categoría)";
                  };
                  const subLabel = (id: string) => {
                    if (id === "__none__") return "(Sin subcategoría)";
                    const s = subcategories.find((x) => x.id === id);
                    return s ? `${s.code} ${s.name}` : "(Sin subcategoría)";
                  };

                  // Agrupar siempre por sector como nivel 0. Las dos vistas
                  // soportadas:
                  //   "sector-category"               → 2 niveles (sector → categoría)
                  //   "sector-category-subcategory"   → 3 niveles (sector → cat → subcat)
                  const sectorGroups = new Map<string, typeof sorted>();
                  for (const l of sorted) {
                    const k = l.sector_id || "__none__";
                    if (!sectorGroups.has(k)) sectorGroups.set(k, []);
                    sectorGroups.get(k)!.push(l);
                  }
                  const orderedSectors = Array.from(sectorGroups.keys()).sort((a, b) => sectorOrderVal(a) - sectorOrderVal(b));
                  let runningIdx = 0;
                  for (const sKey of orderedSectors) {
                    const sLines = sectorGroups.get(sKey)!;
                    const sCollapsed = collapsedGroups.has(sKey);
                    items.push({
                      kind: "header", level: 0, key: sKey,
                      label: sectorLabel(sKey),
                      total: sumLines(sLines), count: sLines.length, collapsed: sCollapsed,
                    });
                    if (sCollapsed) continue;

                    // Sub-agrupar por categoría dentro del sector
                    const catGroups = new Map<string, typeof sorted>();
                    for (const l of sLines) {
                      const k = l.category_id || "__none__";
                      if (!catGroups.has(k)) catGroups.set(k, []);
                      catGroups.get(k)!.push(l);
                    }
                    const orderedCats = Array.from(catGroups.keys()).sort((a, b) => catOrderVal(a) - catOrderVal(b));
                    for (const cKey of orderedCats) {
                      const cLines = catGroups.get(cKey)!;
                      const cKeyComposite = `${sKey}::${cKey}`;
                      const cCollapsed = collapsedGroups.has(cKeyComposite);
                      items.push({
                        kind: "header", level: 1, key: cKeyComposite,
                        label: catLabel(cKey),
                        total: sumLines(cLines), count: cLines.length, collapsed: cCollapsed,
                      });
                      if (cCollapsed) continue;

                      if (groupBy === "sector-category-subcategory") {
                        // Tercer nivel: sub-agrupar por subcategoría dentro de la categoría
                        const subGroups = new Map<string, typeof sorted>();
                        for (const l of cLines) {
                          const k = l.subcategory_id || "__none__";
                          if (!subGroups.has(k)) subGroups.set(k, []);
                          subGroups.get(k)!.push(l);
                        }
                        const orderedSubs = Array.from(subGroups.keys()).sort((a, b) => subOrderVal(a) - subOrderVal(b));
                        for (const subKey of orderedSubs) {
                          const subLines = subGroups.get(subKey)!;
                          const subKeyComposite = `${sKey}::${cKey}::${subKey}`;
                          const subCollapsed = collapsedGroups.has(subKeyComposite);
                          items.push({
                            kind: "header", level: 2, key: subKeyComposite,
                            label: subLabel(subKey),
                            total: sumLines(subLines), count: subLines.length, collapsed: subCollapsed,
                          });
                          if (subCollapsed) continue;
                          for (const l of subLines) items.push({ kind: "line", line: l, idx: runningIdx++ });
                        }
                      } else {
                        // sector-category: las líneas van directo bajo la categoría
                        for (const l of cLines) items.push({ kind: "line", line: l, idx: runningIdx++ });
                      }
                    }
                  }

                  return items.map((item) => {
                    if (item.kind === "header") {
                      const lvl = item.level;
                      // Estilos por nivel — sector (0) más prominente, subcategoría (2) más sutil
                      const bg     = lvl === 0 ? "#FFF7ED" : lvl === 1 ? "#FAFAFA" : "#F8FAFC";
                      const border = lvl === 0 ? "2px solid #FED7AA" : "1px solid #F1F5F9";
                      const padding = lvl === 0 ? "px-3 py-2" : lvl === 1 ? "px-3 py-1.5 pl-10" : "px-3 py-1 pl-16";
                      const textCls = lvl === 0
                        ? "text-xs text-[#E87722]"
                        : lvl === 1
                          ? "text-[11px] text-neutral-700"
                          : "text-[10px] text-neutral-600";
                      const iconSize = lvl === 0 ? "h-3.5 w-3.5" : "h-3 w-3";
                      return (
                        <tr
                          key={`hdr-${lvl}-${item.key}`}
                          style={{ background: bg, cursor: "pointer", borderTop: border }}
                          onClick={() => toggleGroupCollapse(item.key)}
                        >
                          <td colSpan={12} className={padding}>
                            <div className="flex items-center justify-between">
                              <span className={cn("inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider", textCls)}>
                                {item.collapsed
                                  ? <ChevronRight className={iconSize} />
                                  : <ChevronDown  className={iconSize} />}
                                {lvl === 0 && <Layers className="h-3.5 w-3.5" />}
                                {item.label}
                                <span className="text-muted-foreground font-normal normal-case ml-1">
                                  · {item.count} {item.count === 1 ? "línea" : "líneas"}
                                </span>
                              </span>
                              <span className="inline-flex items-center gap-2">
                                {/* Botón "+" sólo en nivel 2 (subcategoría) en
                                    modo 3-niveles. Crea una línea con el
                                    sector / categoría / subcategoría del grupo
                                    ya pre-llenados. No aparece si alguno de
                                    los IDs es "__none__" (no tendría sentido
                                    crear una línea en un grupo sin asignar). */}
                                {lvl === 2 && (() => {
                                  const [sId, cId, subId] = item.key.split("::");
                                  if (!sId || !cId || !subId) return null;
                                  if (sId === "__none__" || cId === "__none__" || subId === "__none__") return null;
                                  return (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-[10px] text-[#E87722] hover:bg-[#E87722]/10"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        addNewLine({ sector_id: sId, category_id: cId, subcategory_id: subId });
                                      }}
                                      title={`Agregar línea en ${item.label}`}
                                    >
                                      <Plus className="h-3 w-3 mr-0.5" />
                                      Línea
                                    </Button>
                                  );
                                })()}
                                <span className={cn("font-mono font-semibold", textCls)}>
                                  Subtotal: {fmtMoney(item.total, 0)} {moneyCurrency}
                                </span>
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    const { line, idx } = item;
                    return (
                  <tr key={line.id} style={{ borderBottom: "1px solid #F1F5F9", background: selected.has(line.id) ? "#EFF6FF" : undefined }}>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="checkbox"
                        checked={selected.has(line.id)}
                        onChange={() => toggleSelect(line.id)}
                        className="h-3.5 w-3.5 rounded cursor-pointer accent-[#E87722]"
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => toggleLineReview(line.id)}
                        className="cursor-pointer hover:scale-110 transition-transform"
                        title={line.needs_review ? "Quitar marca de revisión" : "Marcar para revisión"}
                      >
                        <Flag
                          className={`h-3.5 w-3.5 mx-auto transition-colors ${
                            line.needs_review
                              ? "text-amber-500 fill-amber-500"
                              : "text-gray-200 hover:text-amber-300"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-2 py-1 font-mono text-xs text-muted-foreground">{idx + 1}</td>
                    <td className="px-2 py-1">
                      <SearchableSelect
                        options={articulos.map((a) => ({
                          value: a.id,
                          label: `#${a.number} ${a.description}`,
                          sublabel: a.unit,
                        }))}
                        value={line.articulo_id || ""}
                        onChange={(v) => updateLineField(line.id, "articulo_id", v || null)}
                        placeholder="Seleccionar..."
                        allowEmpty
                        emptyLabel="(Provisional)"
                        emptyValue=""
                        multiline
                      />
                    </td>
                    <td className="px-2 py-1 text-center text-xs">{line.articulo_unit}</td>
                    <td className="px-2 py-1 text-right font-mono text-xs">
                      {line.articulo_id ? (
                        <button
                          type="button"
                          onClick={() => setComposicionArticuloId(line.articulo_id)}
                          className="hover:bg-[#E87722]/10 hover:text-[#E87722] rounded px-1.5 py-0.5 transition-colors cursor-pointer underline decoration-dotted underline-offset-2"
                          title="Ver y editar composición del artículo"
                        >
                          {line.articulo_pu > 0 ? fmtMoney(line.articulo_pu) : "—"}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <FormulaInput
                        value={Number(line.quantity) || 0}
                        onValueChange={(v) => {
                          updateLineField(line.id, "quantity", v);
                        }}
                        className="h-7 w-full"
                      />
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-xs font-bold">
                      {line.articulo_pu > 0 && line.quantity ? fmtMoney(Number(line.quantity) * line.articulo_pu) : "—"}
                    </td>
                    <td className="px-2 py-1">
                      <SearchableSelect
                        options={categories.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))}
                        value={line.category_id}
                        onChange={(v) => {
                          updateLineField(line.id, "category_id", v);
                          const firstSub = getSubsForCategory(v)[0];
                          if (firstSub) updateLineField(line.id, "subcategory_id", firstSub.id);
                        }}
                        placeholder="Cat..."
                      />
                    </td>
                    <td className="px-2 py-1">
                      <SearchableSelect
                        options={getSubsForCategory(line.category_id).map((s) => ({ value: s.id, label: `${s.code} ${s.name}` }))}
                        value={line.subcategory_id}
                        onChange={(v) => updateLineField(line.id, "subcategory_id", v)}
                        placeholder="Sub..."
                      />
                    </td>
                    <td className="px-2 py-1">
                      <SearchableSelect
                        options={sectors.map((s) => ({ value: s.id, label: s.name }))}
                        value={line.sector_id}
                        onChange={(v) => updateLineField(line.id, "sector_id", v)}
                        placeholder="Sector..."
                      />
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex items-center justify-center gap-0.5">
                        <CommentPopover
                          comment={line.comment}
                          onSave={(value) => updateLineField(line.id, "comment", value || null)}
                        />
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteLine(line.id)} title="Eliminar línea">
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                    );
                  });
                })()
              )}
              {/* Add new line row */}
              <tr style={{ borderTop: "2px solid #E5E5E5" }}>
                <td colSpan={12} className="px-2 py-2">
                  <Button variant="outline" size="sm" onClick={() => addNewLine()} className="w-full">
                    <Plus className="h-4 w-4 mr-1" /> Nueva Línea
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Importar Cuantificación desde Excel</DialogTitle>
          </DialogHeader>
          {importResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="border rounded-lg p-3">
                  <p className="text-2xl font-bold text-green-600">{importResult.valid.length}</p>
                  <p className="text-xs text-muted-foreground">Líneas válidas</p>
                </div>
                <div className="border rounded-lg p-3">
                  <p className="text-2xl font-bold" style={{ color: "#E87722" }}>{importResult.categoriesNeeded.size}</p>
                  <p className="text-xs text-muted-foreground">Categorías</p>
                </div>
                <div className="border rounded-lg p-3">
                  <p className="text-2xl font-bold text-destructive">{importResult.errors.length}</p>
                  <p className="text-xs text-muted-foreground">Errores</p>
                </div>
              </div>

              {importResult.errors.length > 0 && (
                <div className="border rounded-lg overflow-hidden max-h-32 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-red-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium w-16">Fila</th>
                        <th className="px-3 py-2 text-left font-medium">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.errors.slice(0, 15).map((err, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1.5 font-mono text-xs">{err.row}</td>
                          <td className="px-3 py-1.5 text-xs text-destructive">{err.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {importResult.valid.length > 0 && (
                <div className="border rounded-lg overflow-hidden max-h-52 overflow-auto">
                  <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
                    <colgroup>
                      <col style={{ width: "45px" }} />
                      <col />
                      <col style={{ width: "60px" }} />
                      <col style={{ width: "80px" }} />
                      <col style={{ width: "80px" }} />
                    </colgroup>
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left text-xs font-medium uppercase">#Art</th>
                        <th className="px-2 py-2 text-left text-xs font-medium uppercase">Descripción</th>
                        <th className="px-2 py-2 text-right text-xs font-medium uppercase">Cant.</th>
                        <th className="px-2 py-2 text-left text-xs font-medium uppercase">Cat.</th>
                        <th className="px-2 py-2 text-left text-xs font-medium uppercase">Sector</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.valid.slice(0, 25).map((row, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-2 py-1 font-mono text-xs">{row.art_number || "—"}</td>
                          <td className="px-2 py-1 text-xs truncate" title={row.descripcion}>{row.descripcion}</td>
                          <td className="px-2 py-1 text-right font-mono text-xs">{row.cantidad != null ? row.cantidad : "—"}</td>
                          <td className="px-2 py-1 text-xs truncate">{row.cat_name}</td>
                          <td className="px-2 py-1 text-xs truncate">{row.sector_name}</td>
                        </tr>
                      ))}
                      {importResult.valid.length > 25 && (
                        <tr className="border-t">
                          <td colSpan={5} className="px-2 py-2 text-center text-xs text-muted-foreground">
                            ...y {importResult.valid.length - 25} líneas más
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Se crearán automáticamente las categorías, subcategorías y sectores que no existan.
                Los artículos se vinculan por su número (No.Art).
              </p>

              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => { setImportDialogOpen(false); setImportResult(null); }}>
                  Cancelar
                </Button>
                {importResult.valid.length > 0 && (
                  <Button onClick={executeCuantImport} disabled={importing}>
                    {importing ? "Importando..." : `Importar ${importResult.valid.length} líneas`}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal de composición de artículo (click sobre PU USD) */}
      {composicionArticuloId && (
        <ArticuloCompositionDialog
          articuloId={composicionArticuloId}
          insumos={insumos}
          showLocal={showLocal}
          exchangeRate={tc}
          localCurrencyCode={project?.local_currency || "LOCAL"}
          onClose={() => setComposicionArticuloId(null)}
          onChanged={async () => {
            // Re-fetch PUs y propagar a las líneas existentes. No re-fetcheamos
            // toda la página — solo el RPC barato `get_project_articulo_totals`.
            const { data: puRes } = await supabase.rpc("get_project_articulo_totals", { p_project_id: projectId });
            const pus: Record<string, number> = {};
            for (const row of (puRes || [])) {
              pus[row.articulo_id] = Number(row.pu_costo);
            }
            setArtPUs(pus);
            // Refrescamos también enriched articulo_pu en cada línea para
            // que el sort y los totales reflejen el nuevo PU.
            setLines((prev) => prev.map((l) => ({
              ...l,
              articulo_pu: l.articulo_id ? (pus[l.articulo_id] || 0) : 0,
            })));
          }}
        />
      )}
    </div>
  );
}

/**
 * Popover compacto para editar el comentario de una línea de cuantificación.
 * Ícono cambia de color cuando ya hay comentario guardado, así el usuario
 * ve de un vistazo cuáles líneas tienen notas. Guardado on-blur del textarea.
 */
function CommentPopover({
  comment,
  onSave,
}: {
  comment: string | null;
  onSave: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Draft local — sólo se persiste al cerrar el popover (o on-blur)
  const [draft, setDraft] = useState(comment || "");
  // Sincronizar draft cuando cambia el comentario externo (ej. recarga)
  useEffect(() => { setDraft(comment || ""); }, [comment]);
  const hasComment = !!(comment && comment.trim());

  function commit() {
    if (draft !== (comment || "")) onSave(draft);
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) commit(); }}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title={hasComment ? `Comentario: ${comment}` : "Agregar comentario"}
          >
            <MessageSquare
              className={`h-3 w-3 ${hasComment ? "text-[#E87722] fill-[#E87722]/20" : "text-muted-foreground"}`}
            />
          </Button>
        }
      />
      <PopoverContent className="w-[280px] p-2" align="end">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Comentario de la línea
        </Label>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          placeholder="Notas, justificación, recordatorio…"
          rows={4}
          className="mt-1 text-xs resize-none"
          autoFocus
        />
        <div className="flex items-center justify-between mt-2">
          {hasComment && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] text-destructive hover:text-destructive"
              onClick={() => { setDraft(""); onSave(""); setOpen(false); }}
            >
              <X className="h-2.5 w-2.5 mr-1" />
              Borrar
            </Button>
          )}
          <Button
            size="sm"
            className="h-6 text-[10px] ml-auto bg-[#E87722] hover:bg-[#E87722]/90 text-white"
            onClick={() => { commit(); setOpen(false); }}
          >
            Guardar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
