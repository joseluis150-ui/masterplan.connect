"use client";

import { useEffect, useState, useCallback, use } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { evaluateFormula, formatNumber } from "@/lib/utils/formula";
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
import type { Articulo, EdtCategory, EdtSubcategory, Sector } from "@/lib/types/database";
import { Plus, Trash2, Calculator, Upload, Download } from "lucide-react";
import { toast } from "sonner";

// Batch colors for import tracking
const BATCH_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
];

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
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterSector, setFilterSector] = useState("all");
  const [filterBatch, setFilterBatch] = useState("all");
  const [artPUs, setArtPUs] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importResult, setImportResult] = useState<CuantificacionImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const supabase = createClient();

  const loadData = useCallback(async () => {
    const [linesRes, artsRes, catsRes, subsRes, sectorsRes] = await Promise.all([
      supabase.from("quantification_lines").select("*").eq("project_id", projectId).order("line_number"),
      supabase.from("articulos").select("*").eq("project_id", projectId).order("number"),
      supabase.from("edt_categories").select("*").eq("project_id", projectId).order("order"),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).order("order"),
      supabase.from("sectors").select("*").eq("project_id", projectId).order("order"),
    ]);

    const arts = artsRes.data || [];
    const cats = catsRes.data || [];
    const subs = subsRes.data || [];
    const sects = sectorsRes.data || [];

    const pus: Record<string, number> = {};
    for (const art of arts) {
      const { data } = await supabase.rpc("get_articulo_totals", { p_articulo_id: art.id });
      if (data && data[0]) pus[art.id] = Number(data[0].pu_costo);
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
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Collect unique batches for filter and color assignment
  const batchList = Array.from(new Set(lines.filter((l) => l.import_batch).map((l) => l.import_batch!)));
  const batchColorMap = new Map<string, string>();
  batchList.forEach((b, i) => batchColorMap.set(b, BATCH_COLORS[i % BATCH_COLORS.length]));

  const filtered = lines.filter((l) => {
    const matchCat = filterCategory === "all" || l.category_id === filterCategory;
    const matchSector = filterSector === "all" || l.sector_id === filterSector;
    const matchBatch = filterBatch === "all" || (filterBatch === "manual" ? !l.import_batch : l.import_batch === filterBatch);
    return matchCat && matchSector && matchBatch;
  });

  const grandTotal = filtered.reduce((sum, l) => sum + (Number(l.quantity) || 0) * l.articulo_pu, 0);

  async function addNewLine() {
    const lineNumber = lines.length + 1;
    const defaultCat = categories[0]?.id || "";
    const defaultSub = subcategories.find((s) => s.category_id === defaultCat)?.id || "";
    const defaultSector = sectors[0]?.id || "";

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
    await supabase.from("quantification_lines").delete().eq("id", id);
    setLines(lines.filter((l) => l.id !== id));
    setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
    toast.success("Línea eliminada");
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`¿Eliminar ${selected.size} líneas seleccionadas?\n\nEsta acción no se puede deshacer.`)) return;
    const ids = Array.from(selected);
    await supabase.from("quantification_lines").delete().in("id", ids);
    setLines(lines.filter((l) => !selected.has(l.id)));
    setSelected(new Set());
    toast.success(`${ids.length} líneas eliminadas`);
  }

  async function deleteAll() {
    if (!confirm(`¿Eliminar TODAS las ${lines.length} líneas de cuantificación?\n\nEsta acción no se puede deshacer.`)) return;
    await supabase.from("quantification_lines").delete().eq("project_id", projectId);
    setLines([]);
    setSelected(new Set());
    toast.success("Todas las líneas eliminadas");
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

      // Step 4: Insert quantification lines
      let count = 0;
      const baseLineNum = lines.length;
      for (let i = 0; i < importResult.valid.length; i++) {
        const row = importResult.valid[i];
        const catKey = row.cat_code || row.cat_name.toLowerCase();
        const subKey = row.sub_code || row.sub_name.toLowerCase();
        const catId = catIdMap.get(catKey);
        const subId = subIdMap.get(subKey);
        const sectorId = sectorIdMap.get(row.sector_name.toLowerCase());
        const artId = row.art_number ? artIdMap.get(row.art_number) || null : null;

        if (!catId || !subId || !sectorId) continue;

        await supabase.from("quantification_lines").insert({
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
        count++;
      }

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

      {/* Filters */}
      <div className="flex gap-4 items-center flex-wrap">
        <SearchableSelect
          options={[
            { value: "all", label: "Todas las categorías" },
            ...categories.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` })),
          ]}
          value={filterCategory}
          onChange={setFilterCategory}
          placeholder="Categoría"
          className="w-48"
        />
        <SearchableSelect
          options={[
            { value: "all", label: "Todos los sectores" },
            ...sectors.map((s) => ({ value: s.id, label: s.name })),
          ]}
          value={filterSector}
          onChange={setFilterSector}
          placeholder="Sector"
          className="w-48"
        />
        {batchList.length > 0 && (
          <SearchableSelect
            options={[
              { value: "all", label: "Todas las fuentes" },
              { value: "manual", label: "Ingreso manual" },
              ...batchList.map((b, i) => ({
                value: b,
                label: `Importación ${i + 1} (${new Date(lines.find((l) => l.import_batch === b)?.import_batch_date || "").toLocaleDateString("es")})`,
              })),
            ]}
            value={filterBatch}
            onChange={setFilterBatch}
            placeholder="Fuente"
            className="w-56"
          />
        )}
        <span className="text-sm text-muted-foreground">{filtered.length} líneas</span>
        <span className="text-sm font-medium ml-auto">Total: {formatNumber(grandTotal)} USD</span>
      </div>

      {/* Inline table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="brand-table w-full text-sm" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "32px" }} />
              <col style={{ width: "28px" }} />
              <col style={{ width: "40px" }} />
              <col style={{ width: "190px" }} />
              <col style={{ width: "45px" }} />
              <col style={{ width: "75px" }} />
              <col style={{ width: "85px" }} />
              <col style={{ width: "85px" }} />
              <col style={{ width: "115px" }} />
              <col style={{ width: "115px" }} />
              <col style={{ width: "100px" }} />
              <col style={{ width: "36px" }} />
            </colgroup>
            <thead>
              <tr>
                <th className="px-1 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 rounded cursor-pointer accent-[#1E3A8A]"
                  />
                </th>
                <th className="px-1 py-2 text-center" title="Origen"></th>
                <th className="px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">Artículo</th>
                <th className="px-2 py-2 text-center">Und</th>
                <th className="px-2 py-2 text-right">PU USD</th>
                <th className="px-2 py-2 text-right">Cantidad</th>
                <th className="px-2 py-2 text-right">Total USD</th>
                <th className="px-2 py-2 text-left">Categoría</th>
                <th className="px-2 py-2 text-left">Subcategoría</th>
                <th className="px-2 py-2 text-left">Sector</th>
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
                filtered.map((line, idx) => (
                  <tr key={line.id} style={{ borderBottom: "1px solid #F1F5F9", background: selected.has(line.id) ? "#EFF6FF" : undefined }}>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="checkbox"
                        checked={selected.has(line.id)}
                        onChange={() => toggleSelect(line.id)}
                        className="h-3.5 w-3.5 rounded cursor-pointer accent-[#1E3A8A]"
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      {line.import_batch ? (
                        <div
                          className="w-3 h-3 rounded-full mx-auto"
                          style={{ background: batchColorMap.get(line.import_batch) || "#94A3B8" }}
                          title={`Importación ${batchList.indexOf(line.import_batch) + 1} — ${new Date(line.import_batch_date || "").toLocaleDateString("es")}`}
                        />
                      ) : (
                        <div className="w-3 h-3 rounded-full mx-auto border-2" style={{ borderColor: "#CBD5E1" }} title="Ingreso manual" />
                      )}
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
                      />
                    </td>
                    <td className="px-2 py-1 text-center text-xs">{line.articulo_unit}</td>
                    <td className="px-2 py-1 text-right font-mono text-xs">{line.articulo_pu > 0 ? formatNumber(line.articulo_pu) : "—"}</td>
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
                      {line.articulo_pu > 0 && line.quantity ? formatNumber(Number(line.quantity) * line.articulo_pu) : "—"}
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
                    <td className="px-2 py-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteLine(line.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
              {/* Add new line row */}
              <tr style={{ borderTop: "2px solid #E5E5E5" }}>
                <td colSpan={12} className="px-2 py-2">
                  <Button variant="outline" size="sm" onClick={addNewLine} className="w-full">
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
                  <p className="text-2xl font-bold" style={{ color: "#1E3A8A" }}>{importResult.categoriesNeeded.size}</p>
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
    </div>
  );
}
