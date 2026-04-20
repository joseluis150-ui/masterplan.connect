"use client";

import React, { useEffect, useState, useCallback, use } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { DEFAULT_UNITS, DEFAULT_INSUMO_TYPES } from "@/lib/constants/units";
import { formatNumber, evaluateFormula, convertCurrency } from "@/lib/utils/formula";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { FormulaInput } from "@/components/shared/formula-input";
import type { Articulo, ArticuloComposition, Insumo, Project } from "@/lib/types/database";
import { Plus, Trash2, Puzzle, Search, Copy, ChevronDown, ChevronRight, Upload, Download, Pencil, X, Flag, FolderInput, Check } from "lucide-react";
import { parseArticuloExcel, downloadBlob } from "@/lib/utils/excel";
import type { ArticuloImportResult } from "@/lib/utils/excel";
import { ColumnFilter, type SortDirection } from "@/components/shared/column-filter";

type SortConfig = { key: string; dir: SortDirection };
import { toast } from "sonner";

interface ArticuloWithComps extends Articulo {
  compositions: (ArticuloComposition & { insumo: Insumo })[];
  pu_mat: number;
  pu_mo: number;
  pu_glo: number;
  pu_costo: number;
  pu_venta: number;
}

function calcArticuloTotals(compositions: (ArticuloComposition & { insumo: Insumo })[], profitPct: number) {
  let pu_mat = 0, pu_mo = 0, pu_glo = 0;
  for (const comp of compositions) {
    const qtyTotal = comp.quantity * (1 + comp.waste_pct / 100);
    const lineTotal = qtyTotal * Number(comp.insumo.pu_usd || 0) * (1 + comp.margin_pct / 100);
    if (comp.insumo.type === "material") pu_mat += lineTotal;
    else if (comp.insumo.type === "mano_de_obra") pu_mo += lineTotal;
    else pu_glo += lineTotal;
  }
  const pu_costo = pu_mat + pu_mo + pu_glo;
  return { pu_mat, pu_mo, pu_glo, pu_costo, pu_venta: pu_costo * (1 + profitPct / 100) };
}

export default function ArticulosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const [articulos, setArticulos] = useState<ArticuloWithComps[]>([]);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterUnit, setFilterUnit] = useState<Set<string>>(new Set());
  const [filterReview, setFilterReview] = useState<string>("all");
  const [sort, setSort] = useState<SortConfig>({ key: "", dir: null });
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingArticulo, setEditingArticulo] = useState<Partial<Articulo> | null>(null);
  const [addCompDialogOpen, setAddCompDialogOpen] = useState(false);
  const [compArticuloId, setCompArticuloId] = useState<string | null>(null);
  const [newComp, setNewComp] = useState({ insumo_id: "", quantity: "1", waste_pct: "0", margin_pct: "0" });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importResult, setImportResult] = useState<ArticuloImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  // Import from project
  const [importProjectDialogOpen, setImportProjectDialogOpen] = useState(false);
  const [importProjects, setImportProjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedSourceProject, setSelectedSourceProject] = useState<string>("");
  const [sourceArticulos, setSourceArticulos] = useState<(Articulo & { compositions: (ArticuloComposition & { insumo: Insumo })[] })[]>([]);
  const [sourceSearch, setSourceSearch] = useState("");
  const [selectedSourceArts, setSelectedSourceArts] = useState<Set<string>>(new Set());
  const [importingFromProject, setImportingFromProject] = useState(false);
  const [loadingSourceArts, setLoadingSourceArts] = useState(false);
  // Insumo edit with impact
  const [insumoEditOpen, setInsumoEditOpen] = useState(false);
  const [editInsumo, setEditInsumo] = useState<Insumo | null>(null);
  const [insumoPriceInput, setInsumoPriceInput] = useState("");
  const [insumoCurrencyMode, setInsumoCurrencyMode] = useState<"LOCAL" | "USD">("USD");
  const [impactData, setImpactData] = useState<{
    articuloId: string;
    description: string;
    unit: string;
    currentPU: number;
    newPU: number;
    quantityTotal: number;
  }[]>([]);
  const supabase = createClient();

  const loadData = useCallback(async () => {
    const [artRes, compRes, insRes, projRes] = await Promise.all([
      supabase.from("articulos").select("*").eq("project_id", projectId).order("number"),
      supabase.from("articulo_compositions").select("*, insumo:insumos(*)").eq("articulo_id", projectId ? undefined as never : ""),
      supabase.from("insumos").select("*").eq("project_id", projectId).order("description"),
      supabase.from("projects").select("*").eq("id", projectId).single(),
    ]);

    // Load compositions for all articulos
    const artIds = (artRes.data || []).map((a) => a.id);
    let allComps: (ArticuloComposition & { insumo: Insumo })[] = [];
    if (artIds.length > 0) {
      const { data } = await supabase
        .from("articulo_compositions")
        .select("*, insumo:insumos(*)")
        .in("articulo_id", artIds);
      allComps = (data || []) as (ArticuloComposition & { insumo: Insumo })[];
    }

    const arts = (artRes.data || []).map((art) => {
      const comps = allComps.filter((c) => c.articulo_id === art.id);
      const totals = calcArticuloTotals(comps, Number(art.profit_pct));
      return { ...art, compositions: comps, ...totals };
    });

    setArticulos(arts);
    setInsumos(insRes.data || []);
    if (projRes.data) setProject(projRes.data);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  const uniqueUnits = Array.from(new Set(articulos.map((a) => a.unit)));
  const hasColumnFilter = filterUnit.size > 0 || filterReview !== "all";
  const reviewCount = articulos.filter((a) => a.needs_review).length;

  const filtered = articulos.filter((a) => {
    const matchSearch = !search || a.description.toLowerCase().includes(search.toLowerCase());
    const matchUnit = filterUnit.size === 0 || filterUnit.has(a.unit);
    const matchReview = filterReview === "all" || (filterReview === "review" ? a.needs_review : !a.needs_review);
    return matchSearch && matchUnit && matchReview;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (!sort.dir || !sort.key) return 0;
    const mult = sort.dir === "asc" ? 1 : -1;
    switch (sort.key) {
      case "number": return mult * (a.number - b.number);
      case "description": return mult * a.description.localeCompare(b.description, "es");
      case "unit": return mult * a.unit.localeCompare(b.unit, "es");
      case "pu_mat": return mult * (a.pu_mat - b.pu_mat);
      case "pu_mo": return mult * (a.pu_mo - b.pu_mo);
      case "pu_glo": return mult * (a.pu_glo - b.pu_glo);
      case "pu_costo": return mult * (a.pu_costo - b.pu_costo);
      case "pu_venta": return mult * (a.pu_venta - b.pu_venta);
      default: return 0;
    }
  });

  function handleSort(key: string) {
    return (dir: SortDirection) => setSort(dir ? { key, dir } : { key: "", dir: null });
  }

  async function toggleArticuloReview(art: ArticuloWithComps) {
    const newVal = !art.needs_review;
    await supabase.from("articulos").update({ needs_review: newVal }).eq("id", art.id);
    setArticulos((prev) => prev.map((a) => a.id === art.id ? { ...a, needs_review: newVal } : a));
    toast.success(newVal ? "Marcado para revisión" : "Revisión completada");
  }

  function openNew() {
    setEditingArticulo({ description: "", unit: "U", profit_pct: 0, comment: "" });
    setEditDialogOpen(true);
  }

  function openEdit(art: Articulo) {
    setEditingArticulo({ ...art });
    setEditDialogOpen(true);
  }

  async function saveArticulo() {
    if (!editingArticulo) return;
    const record = {
      project_id: projectId,
      description: editingArticulo.description || "",
      unit: editingArticulo.unit || "U",
      profit_pct: Number(editingArticulo.profit_pct) || 0,
      comment: editingArticulo.comment || null,
    };
    if (editingArticulo.id) {
      await supabase.from("articulos").update(record).eq("id", editingArticulo.id);
      toast.success("Artículo actualizado");
    } else {
      await supabase.from("articulos").insert(record);
      toast.success("Artículo creado");
    }
    setEditDialogOpen(false);
    loadData();
  }

  async function duplicateArticulo(art: ArticuloWithComps) {
    const { data: newArt } = await supabase
      .from("articulos")
      .insert({ project_id: projectId, description: `${art.description} (copia)`, unit: art.unit, profit_pct: art.profit_pct, comment: art.comment })
      .select().single();
    if (newArt && art.compositions.length > 0) {
      await supabase.from("articulo_compositions").insert(
        art.compositions.map((c) => ({ articulo_id: newArt.id, insumo_id: c.insumo_id, quantity: c.quantity, waste_pct: c.waste_pct, margin_pct: c.margin_pct }))
      );
    }
    toast.success("Artículo duplicado");
    loadData();
  }

  async function deleteArticulo(id: string) {
    if (!confirm("¿Eliminar este artículo?")) return;
    const { error } = await supabase.from("articulos").delete().eq("id", id);
    if (error) toast.error("No se puede eliminar: el artículo está en uso");
    else { toast.success("Artículo eliminado"); loadData(); }
  }

  function openAddComp(articuloId: string) {
    setCompArticuloId(articuloId);
    setNewComp({ insumo_id: "", quantity: "1", waste_pct: "0", margin_pct: "0" });
    setAddCompDialogOpen(true);
  }

  async function addComposition() {
    if (!compArticuloId || !newComp.insumo_id) return;
    await supabase.from("articulo_compositions").insert({
      articulo_id: compArticuloId,
      insumo_id: newComp.insumo_id,
      quantity: Number(newComp.quantity) || 1,
      waste_pct: Number(newComp.waste_pct) || 0,
      margin_pct: Number(newComp.margin_pct) || 0,
    });
    setAddCompDialogOpen(false);
    toast.success("Insumo agregado al artículo");
    loadData();
  }

  async function updateComposition(compId: string, field: string, value: number) {
    await supabase.from("articulo_compositions").update({ [field]: value }).eq("id", compId);
    loadData();
  }

  async function deleteComposition(compId: string) {
    await supabase.from("articulo_compositions").delete().eq("id", compId);
    toast.success("Línea eliminada");
    loadData();
  }

  /* ── Import from other project ── */
  async function openImportFromProject() {
    // Load all other projects
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name")
      .neq("id", projectId)
      .order("name");
    setImportProjects(projects || []);
    setSelectedSourceProject("");
    setSourceArticulos([]);
    setSourceSearch("");
    setSelectedSourceArts(new Set());
    setImportProjectDialogOpen(true);
  }

  async function loadSourceArticulos(sourceProjectId: string) {
    setSelectedSourceProject(sourceProjectId);
    setLoadingSourceArts(true);
    setSelectedSourceArts(new Set());
    setSourceSearch("");

    const [artRes] = await Promise.all([
      supabase.from("articulos").select("*").eq("project_id", sourceProjectId).order("number"),
    ]);
    const arts = (artRes.data || []) as Articulo[];
    const artIds = arts.map((a) => a.id);

    let allComps: (ArticuloComposition & { insumo: Insumo })[] = [];
    if (artIds.length > 0) {
      const { data } = await supabase
        .from("articulo_compositions")
        .select("*, insumo:insumos(*)")
        .in("articulo_id", artIds);
      allComps = (data || []) as (ArticuloComposition & { insumo: Insumo })[];
    }

    const artsWithComps = arts.map((art) => ({
      ...art,
      compositions: allComps.filter((c) => c.articulo_id === art.id),
    }));

    setSourceArticulos(artsWithComps);
    setLoadingSourceArts(false);
  }

  function toggleSourceArt(artId: string) {
    setSelectedSourceArts((prev) => {
      const next = new Set(prev);
      if (next.has(artId)) next.delete(artId);
      else next.add(artId);
      return next;
    });
  }

  function toggleAllSourceArts() {
    const filteredIds = filteredSourceArts.map((a) => a.id);
    const allSelected = filteredIds.every((id) => selectedSourceArts.has(id));
    if (allSelected) {
      setSelectedSourceArts((prev) => {
        const next = new Set(prev);
        for (const id of filteredIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedSourceArts((prev) => {
        const next = new Set(prev);
        for (const id of filteredIds) next.add(id);
        return next;
      });
    }
  }

  const filteredSourceArts = sourceArticulos.filter((a) =>
    !sourceSearch || a.description.toLowerCase().includes(sourceSearch.toLowerCase())
  );

  async function executeImportFromProject() {
    if (selectedSourceArts.size === 0) return;
    setImportingFromProject(true);

    try {
      const tc = Number(project?.exchange_rate || 1);

      // Get existing insumos in current project by description (for dedup)
      const { data: existingInsumos } = await supabase
        .from("insumos")
        .select("id, description")
        .eq("project_id", projectId);
      const existingMap = new Map<string, string>();
      for (const ins of existingInsumos || []) {
        existingMap.set(ins.description.toLowerCase().trim(), ins.id);
      }

      // Map: source insumo_id → target insumo_id
      const insumoIdMap = new Map<string, string>();

      const selectedArts = sourceArticulos.filter((a) => selectedSourceArts.has(a.id));

      // Collect all unique insumos needed
      const neededInsumos = new Map<string, Insumo>();
      for (const art of selectedArts) {
        for (const comp of art.compositions) {
          if (comp.insumo && !insumoIdMap.has(comp.insumo_id)) {
            neededInsumos.set(comp.insumo_id, comp.insumo);
          }
        }
      }

      // Create or map insumos
      let newInsumoCount = 0;
      for (const [sourceId, ins] of neededInsumos) {
        const key = ins.description.toLowerCase().trim();
        if (existingMap.has(key)) {
          insumoIdMap.set(sourceId, existingMap.get(key)!);
        } else {
          const { data: newIns } = await supabase
            .from("insumos")
            .insert({
              project_id: projectId,
              description: ins.description,
              unit: ins.unit,
              type: ins.type,
              family: ins.family || null,
              pu_usd: ins.pu_usd,
              pu_local: ins.pu_local,
              tc_used: ins.tc_used || tc,
              currency_input: ins.currency_input || "USD",
              code: ins.code,
              reference: ins.reference,
            })
            .select("id")
            .single();
          if (newIns) {
            insumoIdMap.set(sourceId, newIns.id);
            existingMap.set(key, newIns.id);
            newInsumoCount++;
          }
        }
      }

      // Create articulos and compositions
      let artCount = 0;
      let compCount = 0;
      for (const art of selectedArts) {
        const { data: newArt } = await supabase
          .from("articulos")
          .insert({
            project_id: projectId,
            description: art.description,
            unit: art.unit,
            profit_pct: art.profit_pct,
            comment: art.comment,
          })
          .select("id")
          .single();

        if (newArt) {
          artCount++;
          const comps = art.compositions
            .map((c) => {
              const targetInsumoId = insumoIdMap.get(c.insumo_id);
              if (!targetInsumoId) return null;
              return {
                articulo_id: newArt.id,
                insumo_id: targetInsumoId,
                quantity: c.quantity,
                waste_pct: c.waste_pct,
                margin_pct: c.margin_pct,
              };
            })
            .filter(Boolean);

          if (comps.length > 0) {
            await supabase.from("articulo_compositions").insert(comps);
            compCount += comps.length;
          }
        }
      }

      toast.success(`Importados: ${artCount} artículos, ${compCount} composiciones, ${newInsumoCount} insumos nuevos`);
    } catch (err) {
      toast.error("Error durante la importación");
      console.error(err);
    }

    setImportProjectDialogOpen(false);
    setImportingFromProject(false);
    loadData();
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = ev.target?.result as ArrayBuffer;
      const result = parseArticuloExcel(data, 1); // Sheet index 1 = "Desglose Insumos"
      setImportResult(result);
      setImportDialogOpen(true);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  async function executeArticuloImport() {
    if (!importResult || !project) return;
    setImporting(true);
    const tc = Number(project.exchange_rate);

    try {
      // Step 1: Create missing insumos — match by description to avoid duplicates
      const existingInsumos = await supabase
        .from("insumos")
        .select("id, description")
        .eq("project_id", projectId);
      const existingMap = new Map<string, string>();
      for (const ins of existingInsumos.data || []) {
        existingMap.set(ins.description.toLowerCase().trim(), ins.id);
      }

      // Map ext_id -> supabase UUID
      const insumoIdMap = new Map<number, string>();

      // Create new insumos that don't exist
      for (const [extId, ins] of importResult.insumos) {
        const key = ins.description.toLowerCase().trim();
        if (existingMap.has(key)) {
          insumoIdMap.set(extId, existingMap.get(key)!);
        } else {
          const puLocal = ins.pu_usd * (ins.tc || tc);
          const { data: newIns } = await supabase
            .from("insumos")
            .insert({
              project_id: projectId,
              description: ins.description,
              unit: ins.unit,
              type: ins.type,
              family: ins.family || null,
              pu_usd: ins.pu_usd,
              pu_local: puLocal,
              tc_used: ins.tc || tc,
              currency_input: "USD",
            })
            .select("id")
            .single();
          if (newIns) {
            insumoIdMap.set(extId, newIns.id);
            existingMap.set(key, newIns.id);
          }
        }
      }

      // Step 2: Create articulos and compositions
      let artCount = 0;
      let compCount = 0;
      for (const art of importResult.articulos) {
        const { data: newArt } = await supabase
          .from("articulos")
          .insert({
            project_id: projectId,
            description: art.description,
            unit: art.unit,
            profit_pct: 0,
          })
          .select("id")
          .single();

        if (newArt) {
          artCount++;
          const comps = art.compositions
            .map((c) => {
              // Try to resolve insumo by ext_id first, then by description
              let insumoId = insumoIdMap.get(c.insumo_ext_id);
              if (!insumoId) {
                insumoId = existingMap.get(c.insumo_description.toLowerCase().trim());
              }
              if (!insumoId) return null;
              return {
                articulo_id: newArt.id,
                insumo_id: insumoId,
                quantity: c.quantity,
                waste_pct: c.waste_pct,
                margin_pct: c.margin_pct,
              };
            })
            .filter(Boolean);

          if (comps.length > 0) {
            await supabase.from("articulo_compositions").insert(comps);
            compCount += comps.length;
          }
        }
      }

      toast.success(`Importados: ${artCount} artículos, ${compCount} composiciones, ${insumoIdMap.size} insumos`);
    } catch (err) {
      toast.error("Error durante la importación");
      console.error(err);
    }

    setImportDialogOpen(false);
    setImportResult(null);
    setImporting(false);
    loadData();
  }

  // --- Insumo edit with impact analysis ---
  async function openInsumoEdit(insumo: Insumo) {
    setEditInsumo(insumo);
    const mode = insumo.currency_input || "USD";
    setInsumoPriceInput(mode === "LOCAL" ? String(insumo.pu_local || "") : String(insumo.pu_usd || ""));
    setInsumoCurrencyMode(mode);
    setInsumoEditOpen(true);

    // Find all articulos using this insumo
    const { data: comps } = await supabase
      .from("articulo_compositions")
      .select("*, articulo:articulos(*)")
      .eq("insumo_id", insumo.id);

    // Get quantification totals per articulo
    const { data: qLines } = await supabase
      .from("quantification_lines")
      .select("articulo_id, quantity")
      .eq("project_id", projectId);

    const qtyMap = new Map<string, number>();
    for (const ql of qLines || []) {
      if (ql.articulo_id) {
        qtyMap.set(ql.articulo_id, (qtyMap.get(ql.articulo_id) || 0) + Number(ql.quantity || 0));
      }
    }

    // Calculate current PU for each affected articulo
    const affected: typeof impactData = [];
    const artIds = new Set<string>();
    for (const comp of comps || []) {
      const art = comp.articulo as Articulo;
      if (!art || artIds.has(art.id)) continue;
      artIds.add(art.id);

      const artObj = articulos.find((a) => a.id === art.id);
      if (artObj) {
        affected.push({
          articuloId: art.id,
          description: art.description,
          unit: art.unit,
          currentPU: artObj.pu_costo,
          newPU: artObj.pu_costo, // will update on price change
          quantityTotal: qtyMap.get(art.id) || 0,
        });
      }
    }
    setImpactData(affected);
  }

  function recalcImpact(rawPrice: string) {
    setInsumoPriceInput(rawPrice);
    if (!editInsumo || !project) return;

    const evaluated = evaluateFormula(rawPrice);
    if (evaluated == null) return;

    const tc = Number(project.exchange_rate);
    const newPuUsd = insumoCurrencyMode === "USD" ? evaluated : evaluated / tc;
    const oldPuUsd = Number(editInsumo.pu_usd || 0);

    // Recalculate each affected articulo
    setImpactData((prev) =>
      prev.map((item) => {
        const artObj = articulos.find((a) => a.id === item.articuloId);
        if (!artObj) return item;

        // Recalculate with the new insumo price
        let newPU = 0;
        for (const comp of artObj.compositions) {
          const qtyTotal = comp.quantity * (1 + comp.waste_pct / 100);
          const puToUse = comp.insumo_id === editInsumo.id ? newPuUsd : Number(comp.insumo.pu_usd || 0);
          newPU += qtyTotal * puToUse * (1 + comp.margin_pct / 100);
        }

        return { ...item, newPU };
      })
    );
  }

  async function saveInsumoFromArticulo() {
    if (!editInsumo || !project) return;
    const tc = Number(project.exchange_rate);
    const evaluated = evaluateFormula(insumoPriceInput);
    if (evaluated == null) return;

    let pu_usd: number | null = null;
    let pu_local: number | null = null;
    if (insumoCurrencyMode === "USD") {
      pu_usd = evaluated;
      pu_local = convertCurrency(evaluated, tc, "usd_to_local");
    } else {
      pu_local = evaluated;
      pu_usd = convertCurrency(evaluated, tc, "local_to_usd");
    }

    // Price history
    if (editInsumo.pu_usd !== pu_usd || editInsumo.pu_local !== pu_local) {
      await supabase.from("insumo_price_history").insert({
        insumo_id: editInsumo.id,
        pu_local_old: editInsumo.pu_local,
        pu_local_new: pu_local,
        pu_usd_old: editInsumo.pu_usd,
        pu_usd_new: pu_usd,
        tc_used: tc,
      });
    }

    await supabase.from("insumos").update({
      pu_usd,
      pu_local,
      tc_used: tc,
      currency_input: insumoCurrencyMode,
    }).eq("id", editInsumo.id);

    toast.success("Insumo actualizado");
    setInsumoEditOpen(false);
    setEditInsumo(null);
    loadData();
  }

  function toggleExpanded(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  }

  const typeLabel = (type: string) => DEFAULT_INSUMO_TYPES.find((t) => t.value === type)?.label || type;
  const isVenta = project?.project_type === "venta";

  if (loading) return <div className="animate-pulse h-96 bg-muted rounded-lg" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Artículos (APU)</h1>
          <p className="text-muted-foreground">Paso 4: Crea artículos compuestos por insumos</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={openImportFromProject}>
            <FolderInput className="h-4 w-4 mr-1" /> Importar de Proyecto
          </Button>
          <Button variant="outline" size="sm" onClick={() => document.getElementById("articulo-file-input")?.click()}>
            <Upload className="h-4 w-4 mr-1" /> Importar Excel
          </Button>
          <input id="articulo-file-input" type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" />
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Nuevo Artículo</Button>
        </div>
      </div>

      <div className="flex gap-4 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar artículos..." className="pl-9" />
        </div>
        <span className="text-sm text-muted-foreground">{filtered.length} artículos</span>
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
        {hasColumnFilter && (
          <Button variant="ghost" size="sm" className="text-xs text-destructive hover:text-destructive" onClick={() => { setFilterUnit(new Set()); setFilterReview("all"); }}>
            <X className="h-3 w-3 mr-1" /> Limpiar filtros
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Puzzle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{articulos.length === 0 ? "Sin artículos" : "Sin resultados"}</h3>
            {articulos.length === 0 && <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Nuevo Artículo</Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="brand-table w-full text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "28px" }} />
                <col style={{ width: "28px" }} />
                <col style={{ width: "50px" }} />
                <col />
                <col style={{ width: "55px" }} />
                <col style={{ width: "80px" }} />
                <col style={{ width: "80px" }} />
                <col style={{ width: "80px" }} />
                <col style={{ width: "95px" }} />
                {isVenta && <col style={{ width: "95px" }} />}
                <col style={{ width: "90px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="px-1 py-2"></th>
                  <th className="px-1 py-2 text-center" title="Marcador de revisión">
                    <Flag className="h-3 w-3 mx-auto text-muted-foreground/50" />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="#" values={[]} activeValues={new Set()} onChange={() => {}} sortDirection={sort.key === "number" ? sort.dir : null} onSort={handleSort("number")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Descripción" values={[]} activeValues={new Set()} onChange={() => {}} sortDirection={sort.key === "description" ? sort.dir : null} onSort={handleSort("description")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Und" values={uniqueUnits} activeValues={filterUnit} onChange={setFilterUnit} align="center" sortDirection={sort.key === "unit" ? sort.dir : null} onSort={handleSort("unit")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="MAT" values={[]} activeValues={new Set()} onChange={() => {}} align="right" sortDirection={sort.key === "pu_mat" ? sort.dir : null} onSort={handleSort("pu_mat")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="MO" values={[]} activeValues={new Set()} onChange={() => {}} align="right" sortDirection={sort.key === "pu_mo" ? sort.dir : null} onSort={handleSort("pu_mo")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="GLO" values={[]} activeValues={new Set()} onChange={() => {}} align="right" sortDirection={sort.key === "pu_glo" ? sort.dir : null} onSort={handleSort("pu_glo")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="PU USD" values={[]} activeValues={new Set()} onChange={() => {}} align="right" sortDirection={sort.key === "pu_costo" ? sort.dir : null} onSort={handleSort("pu_costo")} />
                  </th>
                  {isVenta && <th className="px-2 py-2">
                    <ColumnFilter label="PV USD" values={[]} activeValues={new Set()} onChange={() => {}} align="right" sortDirection={sort.key === "pu_venta" ? sort.dir : null} onSort={handleSort("pu_venta")} />
                  </th>}
                  <th className="px-2 py-2 text-center uppercase text-[11px] font-semibold tracking-wider">Acc.</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((art) => (
                  <React.Fragment key={art.id}>
                      {/* Main row */}
                      <tr
                        className="cursor-pointer hover:bg-muted/50"
                        style={{ borderBottom: expanded.has(art.id) ? "none" : "1px solid #F1F5F9" }}
                        onClick={() => toggleExpanded(art.id)}
                      >
                        <td className="px-1 py-1.5 text-center">
                          {expanded.has(art.id) ? <ChevronDown className="h-3.5 w-3.5 mx-auto text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 mx-auto text-muted-foreground" />}
                        </td>
                        <td className="px-1 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => toggleArticuloReview(art)}
                            className="cursor-pointer hover:scale-110 transition-transform"
                            title={art.needs_review ? "Quitar marca de revisión" : "Marcar para revisión"}
                          >
                            <Flag
                              className={`h-3.5 w-3.5 mx-auto transition-colors ${
                                art.needs_review
                                  ? "text-amber-500 fill-amber-500"
                                  : "text-gray-200 hover:text-amber-300"
                              }`}
                            />
                          </button>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-xs font-bold" style={{ color: "#E87722" }}>{art.number}</td>
                        <td className="px-2 py-1.5 font-medium overflow-hidden text-ellipsis whitespace-nowrap" title={art.description}>{art.description}</td>
                        <td className="px-2 py-1.5 text-center text-xs">{art.unit}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs" style={{ color: "#525252" }}>{formatNumber(art.pu_mat)}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs" style={{ color: "#525252" }}>{formatNumber(art.pu_mo)}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs" style={{ color: "#525252" }}>{formatNumber(art.pu_glo)}</td>
                        <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap" style={{ fontWeight: 600 }}>{formatNumber(art.pu_costo)}</td>
                        {isVenta && <td className="px-2 py-1.5 text-right font-mono text-green-600 whitespace-nowrap" style={{ fontWeight: 500 }}>{formatNumber(art.pu_venta)}</td>}
                        <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-0.5 justify-center">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(art)}><Pencil className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => duplicateArticulo(art)}><Copy className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteArticulo(art.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                          </div>
                        </td>
                      </tr>
                      {/* Expanded composition */}
                      {expanded.has(art.id) && (
                        <tr style={{ borderBottom: "1px solid #F1F5F9" }}>
                          <td colSpan={isVenta ? 11 : 10} className="p-0">
                            <div className="px-4 py-3" style={{ background: "#FAFAFA" }}>
                              {art.compositions.length > 0 ? (
                                <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
                                  <colgroup>
                                    <col style={{ width: "75px" }} />
                                    <col />
                                    <col style={{ width: "50px" }} />
                                    <col style={{ width: "85px" }} />
                                    <col style={{ width: "70px" }} />
                                    <col style={{ width: "70px" }} />
                                    <col style={{ width: "80px" }} />
                                    <col style={{ width: "85px" }} />
                                    <col style={{ width: "32px" }} />
                                  </colgroup>
                                  <thead>
                                    <tr style={{ borderBottom: "1px solid #E5E5E5" }}>
                                      <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tipo</th>
                                      <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Insumo</th>
                                      <th className="px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Und</th>
                                      <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cantidad</th>
                                      <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Desp.%</th>
                                      <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Marg.%</th>
                                      <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">PU USD</th>
                                      <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total</th>
                                      <th className="px-1 py-1.5"></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {art.compositions.map((comp) => {
                                      const qtyTotal = comp.quantity * (1 + comp.waste_pct / 100);
                                      const lineTotal = qtyTotal * Number(comp.insumo.pu_usd || 0) * (1 + comp.margin_pct / 100);
                                      return (
                                        <tr key={comp.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                                          <td className="px-2 py-1">
                                            <Badge variant="secondary" className="text-[10px]">{typeLabel(comp.insumo.type)}</Badge>
                                          </td>
                                          <td className="px-2 py-1 overflow-hidden text-ellipsis whitespace-nowrap">
                                            <button
                                              type="button"
                                              onClick={() => openInsumoEdit(comp.insumo)}
                                              className="text-left hover:text-[#E87722] hover:underline transition-colors cursor-pointer text-xs"
                                              title={comp.insumo.description}
                                            >
                                              {comp.insumo.description}
                                            </button>
                                          </td>
                                          <td className="px-2 py-1 text-center text-xs">{comp.insumo.unit}</td>
                                          <td className="px-2 py-1 text-right">
                                            <FormulaInput
                                              value={comp.quantity}
                                              onValueChange={(v) => updateComposition(comp.id, "quantity", v)}
                                              className="h-6 w-full text-xs"
                                            />
                                          </td>
                                          <td className="px-2 py-1 text-right">
                                            <FormulaInput
                                              value={comp.waste_pct}
                                              onValueChange={(v) => updateComposition(comp.id, "waste_pct", v)}
                                              className="h-6 w-full text-xs"
                                              step="0.01"
                                            />
                                          </td>
                                          <td className="px-2 py-1 text-right">
                                            <FormulaInput
                                              value={comp.margin_pct}
                                              onValueChange={(v) => updateComposition(comp.id, "margin_pct", v)}
                                              className="h-6 w-full text-xs"
                                              step="0.01"
                                            />
                                          </td>
                                          <td className="px-2 py-1 text-right font-mono text-xs">{formatNumber(Number(comp.insumo.pu_usd || 0))}</td>
                                          <td className="px-2 py-1 text-right font-mono text-xs font-bold">{formatNumber(lineTotal)}</td>
                                          <td className="px-1 py-1">
                                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => deleteComposition(comp.id)}>
                                              <Trash2 className="h-2.5 w-2.5 text-destructive" />
                                            </Button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              ) : (
                                <p className="text-xs text-muted-foreground text-center py-3">Sin insumos asignados</p>
                              )}
                              <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={() => openAddComp(art.id)}>
                                <Plus className="h-3 w-3 mr-1" /> Agregar Insumo
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Articulo Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingArticulo?.id ? "Editar" : "Nuevo"} Artículo</DialogTitle></DialogHeader>
          {editingArticulo && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Descripción</Label>
                <Input value={editingArticulo.description || ""} onChange={(e) => setEditingArticulo({ ...editingArticulo, description: e.target.value })} placeholder="Ej: Zapata 1.5x1.5x0.4m" required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Unidad</Label>
                  <Select value={editingArticulo.unit || "U"} onValueChange={(v) => v && setEditingArticulo({ ...editingArticulo, unit: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{DEFAULT_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {isVenta && (
                  <div className="space-y-2">
                    <Label>% Ganancia</Label>
                    <Input type="number" step="0.01" value={editingArticulo.profit_pct || 0} onChange={(e) => setEditingArticulo({ ...editingArticulo, profit_pct: Number(e.target.value) })} />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Comentario</Label>
                <Input value={editingArticulo.comment || ""} onChange={(e) => setEditingArticulo({ ...editingArticulo, comment: e.target.value })} placeholder="Notas" />
              </div>
              <Button onClick={saveArticulo} className="w-full" disabled={!editingArticulo.description}>{editingArticulo.id ? "Actualizar" : "Crear"}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Composition Dialog */}
      <Dialog open={addCompDialogOpen} onOpenChange={setAddCompDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Agregar Insumo al Artículo</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Insumo</Label>
              <SearchableSelect
                options={insumos.map((i) => ({
                  value: i.id,
                  label: i.description,
                  sublabel: `${i.unit} - ${formatNumber(Number(i.pu_usd || 0))} USD`,
                }))}
                value={newComp.insumo_id}
                onChange={(v) => setNewComp({ ...newComp, insumo_id: v })}
                placeholder="Buscar insumo..."
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2"><Label>Cantidad</Label><Input type="number" step="any" value={newComp.quantity} onChange={(e) => setNewComp({ ...newComp, quantity: e.target.value })} /></div>
              <div className="space-y-2"><Label>% Desperdicio</Label><Input type="number" step="0.01" value={newComp.waste_pct} onChange={(e) => setNewComp({ ...newComp, waste_pct: e.target.value })} /></div>
              <div className="space-y-2"><Label>% Margen</Label><Input type="number" step="0.01" value={newComp.margin_pct} onChange={(e) => setNewComp({ ...newComp, margin_pct: e.target.value })} /></div>
            </div>
            <Button onClick={addComposition} className="w-full" disabled={!newComp.insumo_id}>Agregar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Articulos Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Importar Artículos desde Excel</DialogTitle>
          </DialogHeader>
          {importResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="border rounded-lg p-3">
                  <p className="text-2xl font-bold" style={{ color: "#E87722" }}>{importResult.articulos.length}</p>
                  <p className="text-xs text-muted-foreground">Artículos</p>
                </div>
                <div className="border rounded-lg p-3">
                  <p className="text-2xl font-bold" style={{ color: "#166534" }}>{importResult.insumos.size}</p>
                  <p className="text-xs text-muted-foreground">Insumos nuevos</p>
                </div>
                <div className="border rounded-lg p-3">
                  <p className="text-2xl font-bold text-destructive">{importResult.errors.length}</p>
                  <p className="text-xs text-muted-foreground">Errores</p>
                </div>
              </div>

              {importResult.errors.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="max-h-32 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-red-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium w-16">Fila</th>
                          <th className="px-3 py-2 text-left font-medium">Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.errors.slice(0, 20).map((err, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-1.5 font-mono text-xs">{err.row}</td>
                            <td className="px-3 py-1.5 text-xs text-destructive">{err.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {importResult.articulos.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="max-h-52 overflow-auto">
                    <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
                      <colgroup>
                        <col style={{ width: "50px" }} />
                        <col />
                        <col style={{ width: "55px" }} />
                        <col style={{ width: "60px" }} />
                      </colgroup>
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-xs uppercase">#</th>
                          <th className="px-3 py-2 text-left font-medium text-xs uppercase">Artículo</th>
                          <th className="px-3 py-2 text-center font-medium text-xs uppercase">Und</th>
                          <th className="px-3 py-2 text-right font-medium text-xs uppercase">Ins.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.articulos.slice(0, 25).map((art, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-1.5 font-mono text-xs">{art.number}</td>
                            <td className="px-3 py-1.5 truncate" title={art.description}>{art.description}</td>
                            <td className="px-3 py-1.5 text-center text-xs">{art.unit}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-xs">{art.compositions.length}</td>
                          </tr>
                        ))}
                        {importResult.articulos.length > 25 && (
                          <tr className="border-t">
                            <td colSpan={4} className="px-3 py-2 text-center text-xs text-muted-foreground">
                              ...y {importResult.articulos.length - 25} artículos más
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Se crearán automáticamente los insumos que no existan en la base de datos del proyecto.
              </p>

              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => { setImportDialogOpen(false); setImportResult(null); }}>
                  Cancelar
                </Button>
                {importResult.articulos.length > 0 && (
                  <Button onClick={executeArticuloImport} disabled={importing}>
                    {importing ? "Importando..." : `Importar ${importResult.articulos.length} artículos`}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Import from Project Dialog */}
      <Dialog open={importProjectDialogOpen} onOpenChange={setImportProjectDialogOpen}>
        <DialogContent className="sm:max-w-[800px] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Importar Artículos de otro Proyecto</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
            {/* Project selector */}
            <div className="space-y-2">
              <Label>Proyecto origen</Label>
              <Select value={selectedSourceProject} onValueChange={(v) => v && loadSourceArticulos(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un proyecto..." />
                </SelectTrigger>
                <SelectContent>
                  {importProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Source articulos */}
            {selectedSourceProject && (
              <>
                {loadingSourceArts ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: "#E87722" }} />
                  </div>
                ) : sourceArticulos.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Este proyecto no tiene artículos</p>
                ) : (
                  <>
                    {/* Search + select all */}
                    <div className="flex items-center gap-3">
                      <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Buscar artículo..."
                          value={sourceSearch}
                          onChange={(e) => setSourceSearch(e.target.value)}
                          className="pl-9 h-9"
                        />
                      </div>
                      <Button variant="outline" size="sm" onClick={toggleAllSourceArts}>
                        <Check className="h-3.5 w-3.5 mr-1" />
                        {filteredSourceArts.every((a) => selectedSourceArts.has(a.id))
                          ? "Deseleccionar"
                          : "Seleccionar todos"}
                      </Button>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {selectedSourceArts.size} de {sourceArticulos.length}
                      </span>
                    </div>

                    {/* Articulos list */}
                    <div className="border rounded-lg overflow-hidden flex-1 min-h-0">
                      <div className="max-h-[380px] overflow-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50 sticky top-0 z-10">
                            <tr>
                              <th className="px-3 py-2 w-10"></th>
                              <th className="px-3 py-2 text-left font-medium text-xs uppercase w-12">#</th>
                              <th className="px-3 py-2 text-left font-medium text-xs uppercase">Artículo</th>
                              <th className="px-3 py-2 text-center font-medium text-xs uppercase w-14">Und</th>
                              <th className="px-3 py-2 text-right font-medium text-xs uppercase w-16">Ins.</th>
                              <th className="px-3 py-2 text-right font-medium text-xs uppercase w-24">PU USD</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredSourceArts.map((art) => {
                              const totals = calcArticuloTotals(art.compositions, Number(art.profit_pct));
                              const isSelected = selectedSourceArts.has(art.id);
                              return (
                                <tr
                                  key={art.id}
                                  className={`border-t cursor-pointer transition-colors ${isSelected ? "bg-[#E87722]/5" : "hover:bg-muted/30"}`}
                                  onClick={() => toggleSourceArt(art.id)}
                                >
                                  <td className="px-3 py-1.5 text-center">
                                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? "bg-[#E87722] border-[#E87722]" : "border-muted-foreground/30"}`}>
                                      {isSelected && <Check className="h-3 w-3 text-white" />}
                                    </div>
                                  </td>
                                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{art.number}</td>
                                  <td className="px-3 py-1.5 truncate" title={art.description}>{art.description}</td>
                                  <td className="px-3 py-1.5 text-center text-xs text-muted-foreground">{art.unit}</td>
                                  <td className="px-3 py-1.5 text-right font-mono text-xs">{art.compositions.length}</td>
                                  <td className="px-3 py-1.5 text-right font-mono text-xs">{formatNumber(totals.pu_costo)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Summary + actions */}
                    {selectedSourceArts.size > 0 && (() => {
                      // Count unique insumos that would be imported
                      const neededInsumos = new Set<string>();
                      const existingDescs = new Set(insumos.map((i) => i.description.toLowerCase().trim()));
                      for (const art of sourceArticulos) {
                        if (!selectedSourceArts.has(art.id)) continue;
                        for (const comp of art.compositions) {
                          if (comp.insumo && !existingDescs.has(comp.insumo.description.toLowerCase().trim())) {
                            neededInsumos.add(comp.insumo_id);
                          }
                        }
                      }
                      return (
                        <div className="flex items-center justify-between pt-1">
                          <p className="text-xs text-muted-foreground">
                            <strong>{selectedSourceArts.size}</strong> artículos
                            {neededInsumos.size > 0 && <> + <strong className="text-amber-600">{neededInsumos.size}</strong> insumos nuevos</>}
                          </p>
                          <Button onClick={executeImportFromProject} disabled={importingFromProject}>
                            {importingFromProject ? "Importando..." : `Importar ${selectedSourceArts.size} artículos`}
                          </Button>
                        </div>
                      );
                    })()}
                  </>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Insumo Edit with Impact Dialog */}
      <Dialog open={insumoEditOpen} onOpenChange={setInsumoEditOpen}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Editar Insumo</DialogTitle>
          </DialogHeader>
          {editInsumo && (
            <div className="space-y-4">
              {/* Insumo info */}
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs block">Descripción</span>
                  <span className="font-medium">{editInsumo.description}</span>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs block">Tipo / Familia</span>
                  <span>{editInsumo.type} &middot; {editInsumo.family || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs block">Unidad</span>
                  <span>{editInsumo.unit}</span>
                </div>
              </div>

              {/* Price edit */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Precio actual</Label>
                  <p className="font-mono text-lg font-bold">
                    {formatNumber(Number(editInsumo.pu_usd || 0))} USD
                    <span className="text-sm text-muted-foreground ml-2">
                      ({formatNumber(Number(editInsumo.pu_local || 0), 0)} {project?.local_currency})
                    </span>
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Nuevo precio ({insumoCurrencyMode === "USD" ? "USD" : project?.local_currency})</Label>
                  <div className="flex gap-2">
                    <Input
                      value={insumoPriceInput}
                      onChange={(e) => recalcImpact(e.target.value)}
                      placeholder="Ej: 150000/50"
                      className="font-mono"
                    />
                    <Select value={insumoCurrencyMode} onValueChange={(v) => v && setInsumoCurrencyMode(v as "LOCAL" | "USD")}>
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="LOCAL">{project?.local_currency || "Local"}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {insumoPriceInput && evaluateFormula(insumoPriceInput) != null && (
                    <p className="text-xs text-muted-foreground font-mono">
                      = {formatNumber(evaluateFormula(insumoPriceInput)!)} {insumoCurrencyMode === "USD" ? "USD" : project?.local_currency}
                    </p>
                  )}
                </div>
              </div>

              {/* Impact analysis */}
              {impactData.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider" style={{ background: "#F5F5F5" }}>
                    Artículos afectados ({impactData.length})
                  </div>
                  <div className="max-h-48 overflow-auto">
                    <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
                      <colgroup>
                        <col />
                        <col style={{ width: "90px" }} />
                        <col style={{ width: "90px" }} />
                        <col style={{ width: "80px" }} />
                      </colgroup>
                      <thead className="bg-muted/30 sticky top-0">
                        <tr>
                          <th className="px-3 py-1.5 text-left text-xs font-medium">Artículo</th>
                          <th className="px-3 py-1.5 text-right text-xs font-medium">PU Actual</th>
                          <th className="px-3 py-1.5 text-right text-xs font-medium">PU Nuevo</th>
                          <th className="px-3 py-1.5 text-right text-xs font-medium">Var. %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {impactData.map((item) => {
                          const diff = item.newPU - item.currentPU;
                          const pct = item.currentPU > 0 ? (diff / item.currentPU) * 100 : 0;
                          return (
                            <tr key={item.articuloId} className="border-t">
                              <td className="px-3 py-1.5 truncate" title={item.description}>{item.description}</td>
                              <td className="px-3 py-1.5 text-right font-mono text-xs">{formatNumber(item.currentPU)}</td>
                              <td className="px-3 py-1.5 text-right font-mono text-xs font-bold">{formatNumber(item.newPU)}</td>
                              <td className={`px-3 py-1.5 text-right font-mono text-xs font-bold ${diff > 0 ? "text-destructive" : diff < 0 ? "text-green-600" : ""}`}>
                                {diff !== 0 ? `${diff > 0 ? "+" : ""}${pct.toFixed(1)}%` : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Total budget impact */}
                  {(() => {
                    const totalImpact = impactData.reduce((sum, item) => sum + (item.newPU - item.currentPU) * item.quantityTotal, 0);
                    const totalBudgetCurrent = impactData.reduce((sum, item) => sum + item.currentPU * item.quantityTotal, 0);
                    const pct = totalBudgetCurrent > 0 ? (totalImpact / totalBudgetCurrent) * 100 : 0;
                    return totalImpact !== 0 ? (
                      <div className="px-3 py-2 border-t flex justify-between items-center text-sm" style={{ background: totalImpact > 0 ? "#FEF2F2" : "#F0FDF4" }}>
                        <span className="font-medium">Impacto en presupuesto</span>
                        <span className={`font-mono font-bold ${totalImpact > 0 ? "text-destructive" : "text-green-600"}`}>
                          {totalImpact > 0 ? "+" : ""}{formatNumber(totalImpact)} USD ({pct > 0 ? "+" : ""}{pct.toFixed(1)}%)
                        </span>
                      </div>
                    ) : null;
                  })()}
                </div>
              )}

              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setInsumoEditOpen(false)}>Cancelar</Button>
                <Button
                  onClick={saveInsumoFromArticulo}
                  disabled={!insumoPriceInput || evaluateFormula(insumoPriceInput) == null}
                >
                  Guardar Cambio
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
