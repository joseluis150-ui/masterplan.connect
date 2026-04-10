"use client";

import { useEffect, useState, useCallback, use } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EdtCategory, EdtSubcategory } from "@/lib/types/database";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  FolderTree,
  Save,
  Upload,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";
import { generateEdtTemplate, parseEdtExcel, downloadBlob } from "@/lib/utils/excel";
import type { EdtImportResult } from "@/lib/utils/excel";

interface CategoryWithSubs extends EdtCategory {
  subcategories: EdtSubcategory[];
}

export default function EdtPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const [categories, setCategories] = useState<CategoryWithSubs[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [templateName, setTemplateName] = useState("");
  const supabase = createClient();

  const loadData = useCallback(async () => {
    const [catsRes, subsRes] = await Promise.all([
      supabase.from("edt_categories").select("*").eq("project_id", projectId).order("order"),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).order("order"),
    ]);
    const cats = (catsRes.data || []).map((cat) => ({
      ...cat,
      subcategories: (subsRes.data || []).filter((s) => s.category_id === cat.id),
    }));
    setCategories(cats);
    setExpanded(new Set(cats.map((c) => c.id)));
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadData(); loadTemplates(); }, [loadData]);

  async function loadTemplates() {
    const { data } = await supabase.from("edt_templates").select("id, name").order("created_at", { ascending: false });
    setTemplates(data || []);
  }

  async function addCategory() {
    const newOrder = categories.length;
    const { data, error } = await supabase
      .from("edt_categories")
      .insert({ project_id: projectId, code: String(newOrder + 1), name: "", order: newOrder })
      .select().single();
    if (!error && data) {
      const newCat: CategoryWithSubs = { ...data, subcategories: [] };
      setCategories([...categories, newCat]);
      setExpanded(new Set([...expanded, data.id]));
    }
  }

  async function updateCategory(catId: string, name: string) {
    await supabase.from("edt_categories").update({ name }).eq("id", catId);
  }

  async function deleteCategory(catId: string) {
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return;
    if (cat.subcategories.length > 0 && !confirm(`¿Eliminar "${cat.name}"? Tiene ${cat.subcategories.length} subcategoría(s).`)) return;
    const { error } = await supabase.from("edt_categories").delete().eq("id", catId);
    if (!error) {
      const updated = categories.filter((c) => c.id !== catId);
      await recalculateCodes(updated);
      toast.success("Categoría eliminada");
    }
  }

  async function addSubcategory(catId: string) {
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return;
    const newOrder = cat.subcategories.length;
    const { data, error } = await supabase
      .from("edt_subcategories")
      .insert({ category_id: catId, project_id: projectId, code: `${cat.code}.${newOrder + 1}`, name: "", order: newOrder })
      .select().single();
    if (!error && data) {
      setCategories(categories.map((c) => c.id === catId ? { ...c, subcategories: [...c.subcategories, data] } : c));
    }
  }

  async function updateSubcategory(subId: string, name: string) {
    await supabase.from("edt_subcategories").update({ name }).eq("id", subId);
  }

  async function deleteSubcategory(catId: string, subId: string) {
    const { error } = await supabase.from("edt_subcategories").delete().eq("id", subId);
    if (!error) {
      const updated = categories.map((c) => c.id === catId ? { ...c, subcategories: c.subcategories.filter((s) => s.id !== subId) } : c);
      await recalculateCodes(updated);
      toast.success("Subcategoría eliminada");
    }
  }

  async function recalculateCodes(cats: CategoryWithSubs[]) {
    const updates: PromiseLike<unknown>[] = [];
    cats.forEach((cat, catIdx) => {
      const newCode = String(catIdx + 1);
      updates.push(supabase.from("edt_categories").update({ code: newCode, order: catIdx }).eq("id", cat.id).then());
      cat.subcategories.forEach((sub, subIdx) => {
        updates.push(supabase.from("edt_subcategories").update({ code: `${newCode}.${subIdx + 1}`, order: subIdx }).eq("id", sub.id).then());
      });
    });
    await Promise.all(updates);
    setCategories(cats.map((cat, catIdx) => ({
      ...cat, code: String(catIdx + 1), order: catIdx,
      subcategories: cat.subcategories.map((sub, subIdx) => ({ ...sub, code: `${catIdx + 1}.${subIdx + 1}`, order: subIdx })),
    })));
  }

  async function moveCategory(catIdx: number, direction: "up" | "down") {
    const newIdx = direction === "up" ? catIdx - 1 : catIdx + 1;
    if (newIdx < 0 || newIdx >= categories.length) return;
    const updated = [...categories];
    [updated[catIdx], updated[newIdx]] = [updated[newIdx], updated[catIdx]];
    await recalculateCodes(updated);
  }

  async function moveSubcategory(catId: string, subIdx: number, direction: "up" | "down") {
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return;
    const newIdx = direction === "up" ? subIdx - 1 : subIdx + 1;
    if (newIdx < 0 || newIdx >= cat.subcategories.length) return;
    const subs = [...cat.subcategories];
    [subs[subIdx], subs[newIdx]] = [subs[newIdx], subs[subIdx]];
    const updated = categories.map((c) => c.id === catId ? { ...c, subcategories: subs } : c);
    await recalculateCodes(updated);
  }

  async function saveAsTemplate() {
    if (!templateName.trim()) return;
    const data = categories.map((cat) => ({ name: cat.name, subcategories: cat.subcategories.map((s) => s.name) }));
    const { error } = await supabase.from("edt_templates").insert({ name: templateName, data });
    if (!error) { toast.success("Template guardado"); setTemplateName(""); setTemplateDialogOpen(false); loadTemplates(); }
  }

  async function loadTemplate(templateId: string) {
    const { data: template } = await supabase.from("edt_templates").select("*").eq("id", templateId).single();
    if (!template) return;
    await supabase.from("edt_categories").delete().eq("project_id", projectId);
    const tplData = template.data as { name: string; subcategories: string[] }[];
    for (let ci = 0; ci < tplData.length; ci++) {
      const { data: newCat } = await supabase.from("edt_categories").insert({ project_id: projectId, code: String(ci + 1), name: tplData[ci].name, order: ci }).select().single();
      if (newCat) {
        for (let si = 0; si < tplData[ci].subcategories.length; si++) {
          await supabase.from("edt_subcategories").insert({ category_id: newCat.id, project_id: projectId, code: `${ci + 1}.${si + 1}`, name: tplData[ci].subcategories[si], order: si });
        }
      }
    }
    await loadData();
    setTemplateDialogOpen(false);
    toast.success("Template aplicado");
  }

  function handleDownloadTemplate() {
    const data = generateEdtTemplate();
    downloadBlob(data, "plantilla_edt.xlsx");
    toast.success("Plantilla descargada");
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const data = ev.target?.result as ArrayBuffer;
      const result = parseEdtExcel(data);
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} errores encontrados. Revisa la plantilla.`);
        return;
      }
      if (result.valid.length === 0) {
        toast.error("No hay datos válidos para importar");
        return;
      }
      // Group by category
      const catMap = new Map<string, string[]>();
      for (const row of result.valid) {
        if (!catMap.has(row.categoria)) catMap.set(row.categoria, []);
        catMap.get(row.categoria)!.push(row.subcategoria);
      }
      // Delete existing
      await supabase.from("edt_categories").delete().eq("project_id", projectId);
      // Insert
      let catIdx = 0;
      for (const [catName, subs] of catMap) {
        const { data: newCat } = await supabase
          .from("edt_categories")
          .insert({ project_id: projectId, code: String(catIdx + 1), name: catName, order: catIdx })
          .select().single();
        if (newCat) {
          for (let si = 0; si < subs.length; si++) {
            await supabase.from("edt_subcategories").insert({
              category_id: newCat.id, project_id: projectId,
              code: `${catIdx + 1}.${si + 1}`, name: subs[si], order: si,
            });
          }
        }
        catIdx++;
      }
      await loadData();
      toast.success(`EDT importado: ${catMap.size} categorías, ${result.valid.length} subcategorías`);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  async function handleExportExcel() {
    const XLSX = await import("xlsx");
    const data: { Categoria: string; Subcategoria: string }[] = [];
    for (const cat of categories) {
      for (const sub of cat.subcategories) {
        data.push({ Categoria: cat.name, Subcategoria: sub.name });
      }
    }
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 30 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "EDT");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    downloadBlob(buf, "edt_export.xlsx");
    toast.success("EDT exportado");
  }

  function toggleExpanded(catId: string) {
    const next = new Set(expanded);
    if (next.has(catId)) next.delete(catId); else next.add(catId);
    setExpanded(next);
  }

  if (loading) return <div className="animate-pulse h-96 bg-muted rounded-lg" />;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">EDT - Estructura de Desglose</h1>
          <p className="text-muted-foreground">Paso 2: Define categorías y subcategorías</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
            <Download className="h-4 w-4 mr-1" /> Plantilla
          </Button>
          <Button variant="outline" size="sm" onClick={() => document.getElementById("edt-file-input")?.click()}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Importar
          </Button>
          <input id="edt-file-input" type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" />
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={categories.length === 0}>
            <Upload className="h-4 w-4 mr-1" /> Exportar
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTemplateDialogOpen(true)}>
            <Save className="h-4 w-4 mr-1" /> Templates
          </Button>
          <Button size="sm" onClick={addCategory}>
            <Plus className="h-4 w-4 mr-1" /> Categoría
          </Button>
        </div>
      </div>

      {categories.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <FolderTree className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">EDT vacío</h3>
            <p className="text-muted-foreground mb-4">Agrega categorías o carga un template</p>
            <div className="flex gap-2 justify-center">
              <Button onClick={addCategory}><Plus className="h-4 w-4 mr-1" /> Nueva Categoría</Button>
              <Button variant="outline" onClick={() => setTemplateDialogOpen(true)}><Upload className="h-4 w-4 mr-1" /> Usar Template</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {categories.map((cat, catIdx) => (
            <Card key={cat.id}>
              <div className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-muted/50" onClick={() => toggleExpanded(cat.id)}>
                <div className="flex flex-col">
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); moveCategory(catIdx, "up"); }} disabled={catIdx === 0}><span className="text-[10px]">▲</span></Button>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); moveCategory(catIdx, "down"); }} disabled={catIdx === categories.length - 1}><span className="text-[10px]">▼</span></Button>
                </div>
                {expanded.has(cat.id) ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                <span className="font-mono text-sm font-bold text-primary min-w-[2rem]">{cat.code}</span>
                <Input
                  value={cat.name}
                  onChange={(e) => setCategories(categories.map((c) => c.id === cat.id ? { ...c, name: e.target.value } : c))}
                  onBlur={() => updateCategory(cat.id, cat.name)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Nombre de la categoría"
                  className="flex-1 font-medium"
                />
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); addSubcategory(cat.id); }}><Plus className="h-4 w-4 mr-1" /> Sub</Button>
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); deleteCategory(cat.id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
              {expanded.has(cat.id) && cat.subcategories.length > 0 && (
                <>
                  <Separator />
                  <div className="px-4 pb-3 space-y-1">
                    {cat.subcategories.map((sub, subIdx) => (
                      <div key={sub.id} className="flex items-center gap-2 pl-12 py-1">
                        <div className="flex flex-col">
                          <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => moveSubcategory(cat.id, subIdx, "up")} disabled={subIdx === 0}><span className="text-[9px]">▲</span></Button>
                          <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => moveSubcategory(cat.id, subIdx, "down")} disabled={subIdx === cat.subcategories.length - 1}><span className="text-[9px]">▼</span></Button>
                        </div>
                        <span className="font-mono text-sm text-muted-foreground min-w-[3rem]">{sub.code}</span>
                        <Input
                          value={sub.name}
                          onChange={(e) => setCategories(categories.map((c) => c.id === cat.id ? { ...c, subcategories: c.subcategories.map((s) => s.id === sub.id ? { ...s, name: e.target.value } : s) } : c))}
                          onBlur={() => updateSubcategory(sub.id, sub.name)}
                          placeholder="Nombre de la subcategoría"
                          className="flex-1 text-sm"
                        />
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteSubcategory(cat.id, sub.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      )}

      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Templates EDT</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {categories.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Guardar EDT actual como template</h4>
                <div className="flex gap-2">
                  <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Nombre del template" />
                  <Button onClick={saveAsTemplate} disabled={!templateName.trim()}><Save className="h-4 w-4 mr-1" /> Guardar</Button>
                </div>
              </div>
            )}
            {templates.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Cargar template</h4>
                  {templates.map((t) => (
                    <Button key={t.id} variant="outline" className="w-full justify-start" onClick={() => loadTemplate(t.id)}>
                      <FolderTree className="h-4 w-4 mr-2" /> {t.name}
                    </Button>
                  ))}
                </div>
              </>
            )}
            {templates.length === 0 && categories.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No hay templates. Crea un EDT y guárdalo como template.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
