"use client";

import { useEffect, useState, useCallback, use } from "react";
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
import { Plus, Trash2, Puzzle, Search, Copy, ChevronDown, ChevronRight, Upload, Download } from "lucide-react";
import { parseArticuloExcel, downloadBlob } from "@/lib/utils/excel";
import type { ArticuloImportResult } from "@/lib/utils/excel";
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
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingArticulo, setEditingArticulo] = useState<Partial<Articulo> | null>(null);
  const [addCompDialogOpen, setAddCompDialogOpen] = useState(false);
  const [compArticuloId, setCompArticuloId] = useState<string | null>(null);
  const [newComp, setNewComp] = useState({ insumo_id: "", quantity: "1", waste_pct: "0", margin_pct: "0" });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importResult, setImportResult] = useState<ArticuloImportResult | null>(null);
  const [importing, setImporting] = useState(false);
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

  const filtered = articulos.filter((a) => !search || a.description.toLowerCase().includes(search.toLowerCase()));

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
        <div className="space-y-2">
          {filtered.map((art) => (
            <Card key={art.id}>
              <Collapsible open={expanded.has(art.id)} onOpenChange={() => toggleExpanded(art.id)}>
                <div
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer"
                  onClick={() => toggleExpanded(art.id)}
                >
                  {expanded.has(art.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="font-mono text-sm font-bold text-primary">#{art.number}</span>
                  <span className="flex-1 text-left font-medium">{art.description}</span>
                  <Badge variant="outline">{art.unit}</Badge>
                  <span className="font-mono text-sm">{formatNumber(art.pu_costo)} USD</span>
                  {isVenta && <span className="font-mono text-sm text-green-600">{formatNumber(art.pu_venta)} USD ({Number(art.profit_pct)}%)</span>}
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(art)}><Search className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => duplicateArticulo(art)}><Copy className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteArticulo(art.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                </div>
                <CollapsibleContent>
                  <Separator />
                  <div className="p-4">
                    <div className="flex gap-4 mb-3 text-xs">
                      <span>MAT: <strong>{formatNumber(art.pu_mat)}</strong></span>
                      <span>MO: <strong>{formatNumber(art.pu_mo)}</strong></span>
                      <span>GLO: <strong>{formatNumber(art.pu_glo)}</strong></span>
                    </div>
                    {art.compositions.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Insumo</TableHead>
                            <TableHead>Unidad</TableHead>
                            <TableHead className="text-right">Cantidad</TableHead>
                            <TableHead className="text-right">Desp. %</TableHead>
                            <TableHead className="text-right">Margen %</TableHead>
                            <TableHead className="text-right">PU USD</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {art.compositions.map((comp) => {
                            const qtyTotal = comp.quantity * (1 + comp.waste_pct / 100);
                            const lineTotal = qtyTotal * Number(comp.insumo.pu_usd || 0) * (1 + comp.margin_pct / 100);
                            return (
                              <TableRow key={comp.id}>
                                <TableCell><Badge variant="secondary" className="text-[10px]">{typeLabel(comp.insumo.type)}</Badge></TableCell>
                                <TableCell className="text-sm">
                                  <button
                                    type="button"
                                    onClick={() => openInsumoEdit(comp.insumo)}
                                    className="text-left hover:text-[#1E3A8A] hover:underline transition-colors cursor-pointer"
                                  >
                                    {comp.insumo.description}
                                  </button>
                                </TableCell>
                                <TableCell className="text-sm">{comp.insumo.unit}</TableCell>
                                <TableCell className="text-right">
                                  <FormulaInput
                                    value={comp.quantity}
                                    onValueChange={(v) => updateComposition(comp.id, "quantity", v)}
                                    className="h-7 w-20 ml-auto"
                                  />
                                </TableCell>
                                <TableCell className="text-right">
                                  <FormulaInput
                                    value={comp.waste_pct}
                                    onValueChange={(v) => updateComposition(comp.id, "waste_pct", v)}
                                    className="h-7 w-16 ml-auto"
                                    step="0.01"
                                  />
                                </TableCell>
                                <TableCell className="text-right">
                                  <FormulaInput
                                    value={comp.margin_pct}
                                    onValueChange={(v) => updateComposition(comp.id, "margin_pct", v)}
                                    className="h-7 w-16 ml-auto"
                                    step="0.01"
                                  />
                                </TableCell>
                                <TableCell className="text-right font-mono">{formatNumber(Number(comp.insumo.pu_usd || 0))}</TableCell>
                                <TableCell className="text-right font-mono font-medium">{formatNumber(lineTotal)}</TableCell>
                                <TableCell><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteComposition(comp.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button></TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">Sin insumos asignados</p>
                    )}
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => openAddComp(art.id)}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Agregar Insumo
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))}
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
                  <p className="text-2xl font-bold" style={{ color: "#1E3A8A" }}>{importResult.articulos.length}</p>
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
