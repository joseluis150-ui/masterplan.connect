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
import { DEFAULT_UNITS, DEFAULT_INSUMO_TYPES } from "@/lib/constants/units";
import { evaluateFormula, formatNumber, convertCurrency } from "@/lib/utils/formula";
import type { Insumo, Project, InsumoPriceHistory } from "@/lib/types/database";
import { Plus, Trash2, Package, History, Pencil, Search, Upload, Download, FileSpreadsheet, X, Flag } from "lucide-react";
import { toast } from "sonner";
import { generateInsumoTemplate, parseInsumoExcel, downloadBlob } from "@/lib/utils/excel";
import type { InsumoImportResult } from "@/lib/utils/excel";
import { ColumnFilter, type SortDirection } from "@/components/shared/column-filter";

type SortConfig = { key: string; dir: SortDirection };

export default function InsumosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortConfig>({ key: "", dir: null });
  const [filterType, setFilterType] = useState<string>("all");
  // Column filters (empty Set = all, non-empty = only those values)
  const [filterFamily, setFilterFamily] = useState<Set<string>>(new Set());
  const [filterTypeCol, setFilterTypeCol] = useState<Set<string>>(new Set());
  const [filterUnit, setFilterUnit] = useState<Set<string>>(new Set());
  const [filterReview, setFilterReview] = useState<string>("all"); // "all" | "review" | "ok"
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [editingInsumo, setEditingInsumo] = useState<Partial<Insumo> | null>(null);
  const [priceHistory, setPriceHistory] = useState<InsumoPriceHistory[]>([]);
  const [priceInput, setPriceInput] = useState("");
  const [currencyMode, setCurrencyMode] = useState<"LOCAL" | "USD">("USD");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importResult, setImportResult] = useState<InsumoImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const supabase = createClient();

  const loadData = useCallback(async () => {
    const [insRes, projRes] = await Promise.all([
      supabase.from("insumos").select("*").eq("project_id", projectId).order("code"),
      supabase.from("projects").select("*").eq("id", projectId).single(),
    ]);
    setInsumos(insRes.data || []);
    if (projRes.data) setProject(projRes.data);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  const typeBadgeColor = (type: string) => {
    switch (type) {
      case "material": return "default";
      case "mano_de_obra": return "secondary";
      case "servicio": return "outline";
      default: return "destructive";
    }
  };

  const typeLabel = (type: string) => DEFAULT_INSUMO_TYPES.find((t) => t.value === type)?.label || type;

  // Extract unique values for column filters
  const uniqueFamilies = Array.from(new Set(insumos.map((i) => i.family || "(Vacío)")));
  const uniqueTypes = Array.from(new Set(insumos.map((i) => typeLabel(i.type))));
  const uniqueUnits = Array.from(new Set(insumos.map((i) => i.unit)));

  const hasAnyColumnFilter = filterFamily.size > 0 || filterTypeCol.size > 0 || filterUnit.size > 0 || filterReview !== "all";

  const reviewCount = insumos.filter((i) => i.needs_review).length;

  const filtered = insumos.filter((i) => {
    const matchSearch = !search || i.description.toLowerCase().includes(search.toLowerCase()) || (i.family || "").toLowerCase().includes(search.toLowerCase());
    const matchType = filterType === "all" || i.type === filterType;
    const matchFamilyCol = filterFamily.size === 0 || filterFamily.has(i.family || "(Vacío)");
    const matchTypeCol = filterTypeCol.size === 0 || filterTypeCol.has(typeLabel(i.type));
    const matchUnitCol = filterUnit.size === 0 || filterUnit.has(i.unit);
    const matchReview = filterReview === "all" || (filterReview === "review" ? i.needs_review : !i.needs_review);
    return matchSearch && matchType && matchFamilyCol && matchTypeCol && matchUnitCol && matchReview;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (!sort.dir || !sort.key) return 0;
    const mult = sort.dir === "asc" ? 1 : -1;
    switch (sort.key) {
      case "code": return mult * (a.code - b.code);
      case "family": return mult * (a.family || "").localeCompare(b.family || "", "es");
      case "type": return mult * typeLabel(a.type).localeCompare(typeLabel(b.type), "es");
      case "description": return mult * a.description.localeCompare(b.description, "es");
      case "unit": return mult * a.unit.localeCompare(b.unit, "es");
      case "pu_usd": return mult * (Number(a.pu_usd || 0) - Number(b.pu_usd || 0));
      case "pu_local": return mult * (Number(a.pu_local || 0) - Number(b.pu_local || 0));
      default: return 0;
    }
  });

  function handleSort(key: string) {
    return (dir: SortDirection) => setSort(dir ? { key, dir } : { key: "", dir: null });
  }

  async function toggleReview(insumo: Insumo) {
    const newVal = !insumo.needs_review;
    await supabase.from("insumos").update({ needs_review: newVal }).eq("id", insumo.id);
    setInsumos((prev) => prev.map((i) => i.id === insumo.id ? { ...i, needs_review: newVal } : i));
    toast.success(newVal ? "Marcado para revisión" : "Revisión completada");
  }

  function openNew() {
    setEditingInsumo({
      description: "",
      unit: "U",
      type: "material",
      family: "",
      pu_usd: undefined,
      pu_local: undefined,
      comment: "",
      reference: "",
    });
    setPriceInput("");
    setCurrencyMode("USD");
    setEditDialogOpen(true);
  }

  function openEdit(insumo: Insumo) {
    setEditingInsumo({ ...insumo });
    const mode = insumo.currency_input || "USD";
    // Show price in the currency it was originally entered
    if (mode === "LOCAL") {
      setPriceInput(insumo.pu_local != null ? String(insumo.pu_local) : "");
    } else {
      setPriceInput(insumo.pu_usd != null ? String(insumo.pu_usd) : "");
    }
    setCurrencyMode(mode);
    setEditDialogOpen(true);
  }

  async function saveInsumo() {
    if (!editingInsumo || !project) return;
    const tc = Number(project.exchange_rate);
    const evaluated = evaluateFormula(priceInput);

    let pu_usd: number | null = null;
    let pu_local: number | null = null;

    if (evaluated != null) {
      if (currencyMode === "USD") {
        pu_usd = evaluated;
        pu_local = convertCurrency(evaluated, tc, "usd_to_local");
      } else {
        pu_local = evaluated;
        pu_usd = convertCurrency(evaluated, tc, "local_to_usd");
      }
    }

    const record = {
      project_id: projectId,
      description: editingInsumo.description || "",
      unit: editingInsumo.unit || "U",
      type: editingInsumo.type || "material",
      family: editingInsumo.family || null,
      pu_usd,
      pu_local,
      tc_used: tc,
      currency_input: currencyMode,
      comment: editingInsumo.comment || null,
      reference: editingInsumo.reference || null,
    };

    if (editingInsumo.id) {
      // Existing — create price history if price changed
      const old = insumos.find((i) => i.id === editingInsumo.id);
      if (old && (old.pu_usd !== pu_usd || old.pu_local !== pu_local)) {
        await supabase.from("insumo_price_history").insert({
          insumo_id: editingInsumo.id,
          pu_local_old: old.pu_local,
          pu_local_new: pu_local,
          pu_usd_old: old.pu_usd,
          pu_usd_new: pu_usd,
          tc_used: tc,
        });
      }
      const { error } = await supabase.from("insumos").update(record).eq("id", editingInsumo.id);
      if (!error) toast.success("Insumo actualizado");
    } else {
      const { error } = await supabase.from("insumos").insert(record);
      if (!error) toast.success("Insumo creado");
    }

    setEditDialogOpen(false);
    loadData();
  }

  async function deleteInsumo(id: string) {
    if (!confirm("¿Eliminar este insumo?")) return;
    const { error } = await supabase.from("insumos").delete().eq("id", id);
    if (error) {
      toast.error("No se puede eliminar: el insumo está en uso");
    } else {
      setInsumos(insumos.filter((i) => i.id !== id));
      toast.success("Insumo eliminado");
    }
  }

  async function showHistory(insumoId: string) {
    const { data } = await supabase
      .from("insumo_price_history")
      .select("*")
      .eq("insumo_id", insumoId)
      .order("created_at", { ascending: false });
    setPriceHistory(data || []);
    setHistoryDialogOpen(true);
  }

  function handleDownloadTemplate() {
    const data = generateInsumoTemplate();
    downloadBlob(data, "plantilla_insumos.xlsx");
    toast.success("Plantilla descargada");
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = ev.target?.result as ArrayBuffer;
      const result = parseInsumoExcel(data);
      setImportResult(result);
      setImportDialogOpen(true);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  async function executeImport(onlyValid: boolean) {
    if (!importResult || !project) return;
    setImporting(true);
    const tc = Number(project.exchange_rate);
    const rows = onlyValid ? importResult.valid : importResult.valid;

    const records = rows.map((row) => {
      let pu_usd: number | null = null;
      let pu_local: number | null = null;
      const rowTc = row.tc_usado || tc;

      if (row.pu_local != null) {
        pu_local = row.pu_local;
        pu_usd = row.pu_local / rowTc;
      }

      return {
        project_id: projectId,
        description: row.descripcion,
        unit: row.unidad,
        type: row.tipo,
        family: row.familia || null,
        pu_local,
        pu_usd,
        tc_used: rowTc,
        currency_input: "LOCAL" as const,
        comment: row.comentario || null,
        reference: row.referencia || null,
      };
    });

    if (records.length === 0) {
      toast.error("No hay registros válidos para importar");
      setImporting(false);
      return;
    }

    // Insert in batches of 50
    let inserted = 0;
    for (let i = 0; i < records.length; i += 50) {
      const batch = records.slice(i, i + 50);
      const { error } = await supabase.from("insumos").insert(batch);
      if (error) {
        toast.error(`Error en lote ${Math.floor(i / 50) + 1}: ${error.message}`);
        break;
      }
      inserted += batch.length;
    }

    toast.success(`${inserted} insumos importados`);
    setImportDialogOpen(false);
    setImportResult(null);
    setImporting(false);
    loadData();
  }

  async function deleteAllInsumos() {
    if (!confirm(`¿Estás seguro de eliminar TODOS los ${insumos.length} insumos del proyecto?\n\nEsta acción no se puede deshacer.`)) return;
    const { error } = await supabase.from("insumos").delete().eq("project_id", projectId);
    if (error) {
      toast.error("No se pudieron eliminar: algunos insumos están en uso en artículos o paquetes");
    } else {
      toast.success(`${insumos.length} insumos eliminados`);
      loadData();
    }
  }

  async function handleExportExcel() {
    const XLSX = await import("xlsx");
    const data = filtered.map((i) => ({
      Código: i.code,
      Familia: i.family || "",
      Tipo: i.type,
      Descripción: i.description,
      Unidad: i.unit,
      "PU USD": i.pu_usd != null ? Number(i.pu_usd) : "",
      "PU Local": i.pu_local != null ? Number(i.pu_local) : "",
      "TC Usado": i.tc_used != null ? Number(i.tc_used) : "",
      Comentario: i.comment || "",
      Referencia: i.reference || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [
      { wch: 8 }, { wch: 15 }, { wch: 15 }, { wch: 35 }, { wch: 10 },
      { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 20 }, { wch: 20 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Insumos");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    downloadBlob(buf, `insumos_${project?.name || "proyecto"}.xlsx`);
    toast.success("Insumos exportados");
  }

  // (typeBadgeColor and typeLabel moved above filtered)

  if (loading) return <div className="animate-pulse h-96 bg-muted rounded-lg" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Base de Datos de Insumos</h1>
          <p className="text-muted-foreground">Paso 3: Registra materiales, mano de obra y servicios</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
            <Download className="h-4 w-4 mr-1" /> Plantilla
          </Button>
          <Button variant="outline" size="sm" onClick={() => document.getElementById("insumo-file-input")?.click()}>
            <Upload className="h-4 w-4 mr-1" /> Importar Excel
          </Button>
          <input id="insumo-file-input" type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" />
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={filtered.length === 0}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Exportar
          </Button>
          {insumos.length > 0 && (
            <Button variant="outline" size="sm" onClick={deleteAllInsumos} className="text-destructive hover:bg-destructive hover:text-white">
              <Trash2 className="h-4 w-4 mr-1" /> Eliminar todos
            </Button>
          )}
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> Nuevo Insumo
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por descripción o familia..." className="pl-9" />
        </div>
        <Select value={filterType} onValueChange={(v) => v && setFilterType(v)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            {DEFAULT_INSUMO_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filtered.length} insumos</span>
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
            onClick={() => { setFilterFamily(new Set()); setFilterTypeCol(new Set()); setFilterUnit(new Set()); setFilterReview("all"); }}
          >
            <X className="h-3 w-3 mr-1" /> Limpiar filtros
          </Button>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{insumos.length === 0 ? "Sin insumos" : "Sin resultados"}</h3>
            <p className="text-muted-foreground mb-4">{insumos.length === 0 ? "Agrega tu primer insumo" : "Ajusta los filtros de búsqueda"}</p>
            {insumos.length === 0 && <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Nuevo Insumo</Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="brand-table w-full text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "28px" }} />
                <col style={{ width: "45px" }} />
                <col style={{ width: "95px" }} />
                <col style={{ width: "85px" }} />
                <col />
                <col style={{ width: "50px" }} />
                <col style={{ width: "95px" }} />
                <col style={{ width: "105px" }} />
                <col style={{ width: "80px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="px-1 py-2 text-center" title="Marcador de revisión">
                    <Flag className="h-3 w-3 mx-auto text-muted-foreground/50" />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="#" values={[]} activeValues={new Set()} onChange={() => {}} sortDirection={sort.key === "code" ? sort.dir : null} onSort={handleSort("code")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Familia" values={uniqueFamilies} activeValues={filterFamily} onChange={setFilterFamily} sortDirection={sort.key === "family" ? sort.dir : null} onSort={handleSort("family")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Tipo" values={uniqueTypes} activeValues={filterTypeCol} onChange={setFilterTypeCol} sortDirection={sort.key === "type" ? sort.dir : null} onSort={handleSort("type")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Descripción" values={[]} activeValues={new Set()} onChange={() => {}} sortDirection={sort.key === "description" ? sort.dir : null} onSort={handleSort("description")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="Und" values={uniqueUnits} activeValues={filterUnit} onChange={setFilterUnit} align="center" sortDirection={sort.key === "unit" ? sort.dir : null} onSort={handleSort("unit")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label="PU USD" values={[]} activeValues={new Set()} onChange={() => {}} align="right" sortDirection={sort.key === "pu_usd" ? sort.dir : null} onSort={handleSort("pu_usd")} />
                  </th>
                  <th className="px-2 py-2">
                    <ColumnFilter label={"PU " + (project?.local_currency || "Local")} values={[]} activeValues={new Set()} onChange={() => {}} align="right" sortDirection={sort.key === "pu_local" ? sort.dir : null} onSort={handleSort("pu_local")} />
                  </th>
                  <th className="px-2 py-2 text-center uppercase text-[11px] font-semibold tracking-wider">Acc.</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((insumo) => (
                  <tr key={insumo.id} className="cursor-pointer" style={{ borderBottom: "1px solid #F1F5F9" }} onDoubleClick={() => openEdit(insumo)}>
                    <td className="px-1 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleReview(insumo); }}
                        className="cursor-pointer hover:scale-110 transition-transform"
                        title={insumo.needs_review ? "Quitar marca de revisión" : "Marcar para revisión"}
                      >
                        <Flag
                          className={`h-3.5 w-3.5 mx-auto transition-colors ${
                            insumo.needs_review
                              ? "text-amber-500 fill-amber-500"
                              : "text-gray-200 hover:text-amber-300"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-xs" style={{ color: "#525252" }}>{insumo.code}</td>
                    <td className="px-2 py-1.5 text-xs overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: "#525252" }}>{insumo.family || "—"}</td>
                    <td className="px-2 py-1.5">
                      <Badge variant={typeBadgeColor(insumo.type) as "default" | "secondary" | "outline" | "destructive"} className="text-[10px]">
                        {typeLabel(insumo.type)}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 font-medium overflow-hidden text-ellipsis whitespace-nowrap" title={insumo.description}>{insumo.description}</td>
                    <td className="px-2 py-1.5 text-center">{insumo.unit}</td>
                    <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap" style={{ fontWeight: 500 }}>{insumo.pu_usd != null ? formatNumber(Number(insumo.pu_usd)) : "—"}</td>
                    <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap" style={{ fontWeight: 500 }}>{insumo.pu_local != null ? formatNumber(Number(insumo.pu_local), 0) : "—"}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex gap-0.5 justify-center">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(insumo)}><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => showHistory(insumo.id)}><History className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteInsumo(insumo.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit/Create Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingInsumo?.id ? "Editar Insumo" : "Nuevo Insumo"}</DialogTitle>
          </DialogHeader>
          {editingInsumo && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={editingInsumo.type || "material"} onValueChange={(v) => v && setEditingInsumo({ ...editingInsumo, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DEFAULT_INSUMO_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Familia</Label>
                  <Input value={editingInsumo.family || ""} onChange={(e) => setEditingInsumo({ ...editingInsumo, family: e.target.value })} placeholder="Ej: Aglomerantes" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Descripción</Label>
                <Input value={editingInsumo.description || ""} onChange={(e) => setEditingInsumo({ ...editingInsumo, description: e.target.value })} placeholder="Ej: Cemento Portland tipo I" required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Unidad</Label>
                  <Select value={editingInsumo.unit || "U"} onValueChange={(v) => v && setEditingInsumo({ ...editingInsumo, unit: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DEFAULT_UNITS.map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Moneda de ingreso</Label>
                  <Select value={currencyMode} onValueChange={(v) => v && setCurrencyMode(v as "LOCAL" | "USD")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="LOCAL">{project?.local_currency || "Local"}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Precio Unitario ({currencyMode === "USD" ? "USD" : project?.local_currency})</Label>
                <Input value={priceInput} onChange={(e) => setPriceInput(e.target.value)} placeholder="Ej: 150000/50 o 28.75" />
                {priceInput && evaluateFormula(priceInput) != null && (
                  <p className="text-xs text-muted-foreground">
                    = {formatNumber(evaluateFormula(priceInput)!, currencyMode === "USD" ? 2 : 0)} {currencyMode === "USD" ? "USD" : project?.local_currency}
                    {project && evaluateFormula(priceInput) != null && (
                      <> &rarr; {formatNumber(
                        convertCurrency(evaluateFormula(priceInput)!, Number(project.exchange_rate), currencyMode === "USD" ? "usd_to_local" : "local_to_usd"),
                        currencyMode === "USD" ? 0 : 2
                      )} {currencyMode === "USD" ? project.local_currency : "USD"}</>
                    )}
                  </p>
                )}
                {priceInput && evaluateFormula(priceInput) == null && (
                  <p className="text-xs text-destructive">Fórmula inválida</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Referencia</Label>
                  <Input value={editingInsumo.reference || ""} onChange={(e) => setEditingInsumo({ ...editingInsumo, reference: e.target.value })} placeholder="Proveedor o cotización" />
                </div>
                <div className="space-y-2">
                  <Label>Comentario</Label>
                  <Input value={editingInsumo.comment || ""} onChange={(e) => setEditingInsumo({ ...editingInsumo, comment: e.target.value })} placeholder="Notas" />
                </div>
              </div>
              <Button onClick={saveInsumo} className="w-full" disabled={!editingInsumo.description}>
                {editingInsumo.id ? "Actualizar" : "Crear"} Insumo
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Price History Dialog */}
      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Historial de Precios</DialogTitle></DialogHeader>
          {priceHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Sin cambios de precio registrados</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">PU USD Ant.</TableHead>
                  <TableHead className="text-right">PU USD Nuevo</TableHead>
                  <TableHead className="text-right">TC</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {priceHistory.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="text-sm">{new Date(h.created_at).toLocaleDateString("es")}</TableCell>
                    <TableCell className="text-right font-mono">{h.pu_usd_old != null ? formatNumber(Number(h.pu_usd_old)) : "—"}</TableCell>
                    <TableCell className="text-right font-mono">{h.pu_usd_new != null ? formatNumber(Number(h.pu_usd_new)) : "—"}</TableCell>
                    <TableCell className="text-right font-mono">{h.tc_used != null ? formatNumber(Number(h.tc_used), 0) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Importar Insumos desde Excel</DialogTitle>
          </DialogHeader>
          {importResult && (
            <div className="space-y-4">
              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="border rounded-lg p-3">
                  <p className="text-2xl font-bold text-green-600">{importResult.valid.length}</p>
                  <p className="text-xs text-muted-foreground">Registros válidos</p>
                </div>
                <div className="border rounded-lg p-3">
                  <p className="text-2xl font-bold text-destructive">{importResult.errors.length}</p>
                  <p className="text-xs text-muted-foreground">Errores</p>
                </div>
              </div>

              {/* Errors table */}
              {importResult.errors.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="max-h-36 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-red-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium w-16">Fila</th>
                          <th className="px-3 py-2 text-left font-medium">Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.errors.map((err, i) => (
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

              {/* Valid records preview */}
              {importResult.valid.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="max-h-52 overflow-auto">
                    <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
                      <colgroup>
                        <col style={{ width: "70px" }} />
                        <col />
                        <col style={{ width: "55px" }} />
                        <col style={{ width: "100px" }} />
                      </colgroup>
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-xs uppercase">Tipo</th>
                          <th className="px-3 py-2 text-left font-medium text-xs uppercase">Descripción</th>
                          <th className="px-3 py-2 text-center font-medium text-xs uppercase">Und</th>
                          <th className="px-3 py-2 text-right font-medium text-xs uppercase">PU Local</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.valid.slice(0, 20).map((row, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-1.5"><Badge variant="secondary" className="text-[10px]">{row.tipo}</Badge></td>
                            <td className="px-3 py-1.5 text-sm truncate" title={row.descripcion}>{row.descripcion}</td>
                            <td className="px-3 py-1.5 text-center text-xs">{row.unidad}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-xs">{row.pu_local != null ? formatNumber(row.pu_local, 0) : "—"}</td>
                          </tr>
                        ))}
                        {importResult.valid.length > 20 && (
                          <tr className="border-t">
                            <td colSpan={4} className="px-3 py-2 text-center text-xs text-muted-foreground">
                              ...y {importResult.valid.length - 20} registros más
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => { setImportDialogOpen(false); setImportResult(null); }}>
                  Cancelar
                </Button>
                {importResult.valid.length > 0 && (
                  <Button onClick={() => executeImport(true)} disabled={importing}>
                    {importing ? "Importando..." : `Importar ${importResult.valid.length} insumos`}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
