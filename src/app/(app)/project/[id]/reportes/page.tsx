"use client";

import { useEffect, useState, useCallback, use } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  FileText,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { downloadBlob } from "@/lib/utils/excel";
import { getNumberLocale } from "@/lib/utils/number-format";
import { formatNumber, convertCurrency } from "@/lib/utils/formula";
import type {
  Project,
  Sector,
  EdtCategory,
  EdtSubcategory,
  Articulo,
  ArticuloComposition,
  Insumo,
  ProcurementPackage,
  ProcurementLine,
} from "@/lib/types/database";
import { cn } from "@/lib/utils";

/* ─────────────────────────── Types ─────────────────────────── */

interface QLine {
  id: string;
  articulo_id: string | null;
  category_id: string;
  subcategory_id: string;
  sector_id: string;
  quantity: number | null;
  line_number: number;
}

interface ScheduleConfig {
  id: string;
  start_date: string;
}

interface ScheduleWeek {
  id: string;
  quantification_line_id: string;
  week_number: number;
  active: boolean;
}

type Format = "excel" | "pdf";

interface ReportOptions {
  format: Format;
  includeHierarchy: boolean;
  includeComposition: boolean;
  includePackages: boolean;
  includeSchedule: boolean;
  showLocal: boolean;
}

interface ReportData {
  project: Project;
  sectors: Sector[];
  cats: EdtCategory[];
  subs: EdtSubcategory[];
  qLines: QLine[];
  articulos: Articulo[];
  comps: ArticuloComposition[];
  insumos: Insumo[];
  articuloCosts: Map<string, number>;
  packages: ProcurementPackage[];
  procLines: ProcurementLine[];
  schedConfig: ScheduleConfig | null;
  schedWeeks: ScheduleWeek[];
}

/* ─────────────────────────── Page ─────────────────────────── */

export default function ReportesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const supabase = createClient();
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const [options, setOptions] = useState<ReportOptions>({
    format: "excel",
    includeHierarchy: true,
    includeComposition: true,
    includePackages: false,
    includeSchedule: false,
    showLocal: false,
  });

  const loadData = useCallback(async () => {
    const [
      projRes, sectorsRes, catsRes, subsRes, qlRes,
      artsRes, compsRes, insumosRes, costsRes,
      packagesRes, plinesRes, schedConfigRes, schedWeeksRes,
    ] = await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).single(),
      supabase.from("sectors").select("*").eq("project_id", projectId).order("order"),
      supabase.from("edt_categories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("quantification_lines").select("id, articulo_id, category_id, subcategory_id, sector_id, quantity, line_number").eq("project_id", projectId).is("deleted_at", null).order("line_number"),
      supabase.from("articulos").select("*").eq("project_id", projectId).order("number"),
      supabase.from("articulo_compositions").select("*"),
      supabase.from("insumos").select("*").eq("project_id", projectId),
      supabase.rpc("get_project_articulo_totals", { p_project_id: projectId }),
      supabase.from("procurement_packages").select("*").eq("project_id", projectId).order("created_at"),
      supabase.from("procurement_lines").select("*"),
      supabase.from("schedule_config").select("*").eq("project_id", projectId).maybeSingle(),
      supabase.from("schedule_weeks").select("*").eq("active", true),
    ]);

    if (!projRes.data) {
      setLoading(false);
      return;
    }

    const articulos = (artsRes.data || []) as Articulo[];
    const projArtIds = new Set(articulos.map((a) => a.id));
    const comps = ((compsRes.data || []) as ArticuloComposition[]).filter((c) => projArtIds.has(c.articulo_id));

    const packages = (packagesRes.data || []) as ProcurementPackage[];
    const projPkgIds = new Set(packages.map((p) => p.id));
    const procLines = ((plinesRes.data || []) as ProcurementLine[]).filter((l) => projPkgIds.has(l.package_id));

    const qLines = ((qlRes.data || []) as QLine[]).map((q) => ({ ...q, quantity: q.quantity == null ? 0 : Number(q.quantity) }));
    const projQlIds = new Set(qLines.map((q) => q.id));
    const schedWeeks = ((schedWeeksRes.data || []) as ScheduleWeek[]).filter((w) => projQlIds.has(w.quantification_line_id));

    const articuloCosts = new Map<string, number>();
    for (const r of (costsRes.data || []) as { articulo_id: string; pu_costo: number | string }[]) {
      articuloCosts.set(r.articulo_id, Number(r.pu_costo) || 0);
    }

    setData({
      project: projRes.data as Project,
      sectors: (sectorsRes.data || []) as Sector[],
      cats: (catsRes.data || []) as EdtCategory[],
      subs: (subsRes.data || []) as EdtSubcategory[],
      qLines,
      articulos,
      comps,
      insumos: (insumosRes.data || []) as Insumo[],
      articuloCosts,
      packages,
      procLines,
      schedConfig: schedConfigRes.data as ScheduleConfig | null,
      schedWeeks,
    });
    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  function setOpt<K extends keyof ReportOptions>(key: K, value: ReportOptions[K]) {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }

  async function handleGenerate() {
    if (!data) return;
    if (!options.includeHierarchy && !options.includeComposition && !options.includePackages && !options.includeSchedule) {
      toast.error("Seleccioná al menos una sección para incluir en el reporte");
      return;
    }
    setGenerating(true);
    try {
      if (options.format === "excel") {
        await generateExcel(data, options);
        toast.success("Excel generado");
      } else {
        generatePdf(data, options);
        toast.success("Reporte abierto para imprimir/guardar como PDF");
      }
    } catch (err) {
      console.error(err);
      toast.error(`Error al generar: ${err instanceof Error ? err.message : "desconocido"}`);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Reportes</h1>
          <p className="text-muted-foreground text-sm mt-1">Cargando datos del proyecto…</p>
        </div>
        <div className="animate-pulse h-64 bg-muted rounded-lg" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Reportes</h1>
        <Card><CardContent className="py-12 text-center text-muted-foreground">No se pudo cargar el proyecto.</CardContent></Card>
      </div>
    );
  }

  const totalArticulos = data.articulos.length;
  const totalSubcategorias = data.subs.length;
  const totalCategorias = data.cats.length;
  const totalLineasCuantificacion = data.qLines.length;
  const totalPaquetes = data.packages.length;
  const tieneCronograma = !!data.schedConfig;

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-bold">Reportes</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Generá entregables del presupuesto en Excel o PDF, con secciones a elección.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
        {/* ── Form ── */}
        <Card>
          <CardContent className="p-6 space-y-6">
            {/* Format */}
            <div>
              <Label className="text-sm font-semibold mb-2 block">Formato</Label>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { value: "excel", label: "Excel (.xlsx)", icon: FileSpreadsheet, description: "Una hoja por sección, listo para editar" },
                  { value: "pdf", label: "PDF (vía impresión)", icon: FileText, description: "Abre la ventana de impresión, guardás como PDF" },
                ] as const).map((opt) => {
                  const Icon = opt.icon;
                  const active = options.format === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setOpt("format", opt.value as Format)}
                      className={cn(
                        "p-4 rounded-md border text-left transition-colors",
                        active ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                        <span className="text-sm font-medium">{opt.label}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{opt.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sections */}
            <div>
              <Label className="text-sm font-semibold mb-2 block">Secciones a incluir</Label>
              <div className="space-y-2">
                <SectionToggle
                  checked={options.includeHierarchy}
                  onChange={(v) => setOpt("includeHierarchy", v)}
                  title="Presupuesto jerarquizado"
                  description="Categorías → Subcategorías → Artículos con cantidades, precio unitario y total."
                />
                <SectionToggle
                  checked={options.includeComposition}
                  onChange={(v) => setOpt("includeComposition", v)}
                  title="Composición de artículos (APU)"
                  description="Cada artículo descompuesto en sus insumos: cantidad, desperdicio, margen, P.U. y subtotal."
                />
                <SectionToggle
                  checked={options.includePackages}
                  onChange={(v) => setOpt("includePackages", v)}
                  title="Paquetes de contratación"
                  description={`Listado de paquetes con sus líneas de insumos. ${totalPaquetes} paquete${totalPaquetes === 1 ? "" : "s"} en el proyecto.`}
                  disabled={totalPaquetes === 0}
                  disabledReason={totalPaquetes === 0 ? "El proyecto no tiene paquetes cargados todavía." : undefined}
                />
                <SectionToggle
                  checked={options.includeSchedule}
                  onChange={(v) => setOpt("includeSchedule", v)}
                  title="Cronograma"
                  description="Distribución por semana de las líneas cuantificadas."
                  disabled={!tieneCronograma}
                  disabledReason={!tieneCronograma ? "El cronograma no está configurado (definí la fecha de inicio en la pestaña Cronograma)." : undefined}
                />
              </div>
            </div>

            {/* Currency */}
            <div className="flex items-center justify-between p-3 border rounded-md">
              <div>
                <Label className="text-sm font-semibold">Moneda de los importes</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  USD usa el TC del proyecto para convertir desde moneda local.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">USD</Label>
                <Switch checked={options.showLocal} onCheckedChange={(v) => setOpt("showLocal", v)} />
                <Label className="text-xs">{data.project.local_currency}</Label>
              </div>
            </div>

            {/* Action */}
            <div className="flex justify-end pt-2 border-t">
              <Button onClick={handleGenerate} disabled={generating} size="lg">
                {generating
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generando…</>
                  : options.format === "excel"
                    ? <><FileSpreadsheet className="h-4 w-4 mr-2" /> Descargar Excel</>
                    : <><FileText className="h-4 w-4 mr-2" /> Abrir vista de impresión</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Preview / stats ── */}
        <Card>
          <CardContent className="p-6 space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Resumen del proyecto</h3>
              <p className="text-[11px] text-muted-foreground">{data.project.name}</p>
            </div>
            <div className="space-y-2 text-sm">
              <Stat label="Categorías" value={totalCategorias} />
              <Stat label="Subcategorías" value={totalSubcategorias} />
              <Stat label="Artículos (APU)" value={totalArticulos} />
              <Stat label="Líneas de cuantificación" value={totalLineasCuantificacion} />
              <Stat label="Paquetes" value={totalPaquetes} />
              <Stat label="Cronograma" value={tieneCronograma ? "configurado" : "—"} />
            </div>
            <div className="pt-3 border-t">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Va a incluir</h4>
              <ul className="text-xs space-y-1">
                {options.includeHierarchy && <li className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-emerald-600" />Presupuesto jerarquizado</li>}
                {options.includeComposition && <li className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-emerald-600" />Composición de artículos</li>}
                {options.includePackages && <li className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-emerald-600" />Paquetes de contratación</li>}
                {options.includeSchedule && <li className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-emerald-600" />Cronograma</li>}
                {!options.includeHierarchy && !options.includeComposition && !options.includePackages && !options.includeSchedule && (
                  <li className="text-muted-foreground italic">Ninguna sección seleccionada</li>
                )}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-semibold">{value}</span>
    </div>
  );
}

function SectionToggle({
  checked, onChange, title, description, disabled, disabledReason,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  description: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 p-3 border rounded-md transition-colors",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-muted/40",
        checked && !disabled && "border-primary bg-primary/5"
      )}
    >
      <Checkbox
        checked={checked && !disabled}
        onCheckedChange={(v) => !disabled && onChange(!!v)}
        disabled={disabled}
        className="mt-0.5"
      />
      <div className="flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-[11px] text-muted-foreground">{description}</p>
        {disabled && disabledReason && (
          <p className="text-[11px] text-amber-700 italic mt-1">{disabledReason}</p>
        )}
      </div>
    </label>
  );
}

/* ─────────────────────── Helpers ─────────────────────── */

function buildSubArticulos(d: ReportData) {
  const m = new Map<string, Map<string, number>>();
  for (const ql of d.qLines) {
    if (!ql.articulo_id) continue;
    const inner = m.get(ql.subcategory_id) || new Map<string, number>();
    inner.set(ql.articulo_id, (inner.get(ql.articulo_id) || 0) + Number(ql.quantity || 0));
    m.set(ql.subcategory_id, inner);
  }
  return m;
}

function escHtml(v: string | number | null | undefined): string {
  return (v == null ? "" : String(v)).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || "")
  );
}

/* ─────────────────────── Excel ─────────────────────── */

async function generateExcel(d: ReportData, opts: ReportOptions) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const cur = opts.showLocal ? d.project.local_currency : "USD";
  const subArtMap = buildSubArticulos(d);
  const artById = new Map(d.articulos.map((a) => [a.id, a]));
  const subById = new Map(d.subs.map((s) => [s.id, s]));
  const sectorById = new Map(d.sectors.map((s) => [s.id, s]));
  const insumoById = new Map(d.insumos.map((i) => [i.id, i]));

  function fmtMoney(usd: number): number {
    if (opts.showLocal) {
      const tc = Number(d.project.exchange_rate || 1);
      return Number(convertCurrency(usd, tc, "usd_to_local").toFixed(2));
    }
    return Number(usd.toFixed(2));
  }

  if (opts.includeHierarchy) {
    type Row = Record<string, string | number>;
    const rows: Row[] = [];
    const colCantidad = "Cantidad";
    const colPU = `P.U. (${cur})`;
    const colTotal = `Total (${cur})`;
    let grandTotal = 0;
    for (const cat of d.cats) {
      const catSubs = d.subs.filter((s) => s.category_id === cat.id);
      let catTotal = 0;
      for (const sub of catSubs) {
        const arts = subArtMap.get(sub.id);
        if (!arts) continue;
        for (const [artId, qty] of arts) {
          const pu = d.articuloCosts.get(artId) || 0;
          catTotal += pu * qty;
        }
      }
      grandTotal += catTotal;
      rows.push({
        Nivel: "CATEGORÍA",
        Código: cat.code,
        Descripción: cat.name,
        Unidad: "",
        [colCantidad]: "",
        [colPU]: "",
        [colTotal]: fmtMoney(catTotal),
      });
      for (const sub of catSubs) {
        const arts = subArtMap.get(sub.id);
        let subTotal = 0;
        if (arts) for (const [artId, qty] of arts) subTotal += (d.articuloCosts.get(artId) || 0) * qty;
        rows.push({
          Nivel: "  Subcategoría",
          Código: sub.code,
          Descripción: sub.name,
          Unidad: "",
          [colCantidad]: "",
          [colPU]: "",
          [colTotal]: fmtMoney(subTotal),
        });
        if (arts) {
          const sorted = Array.from(arts.entries())
            .map(([artId, qty]) => ({ art: artById.get(artId), qty }))
            .filter((x) => x.art)
            .sort((a, b) => (a.art!.number || 0) - (b.art!.number || 0));
          for (const { art, qty } of sorted) {
            const pu = d.articuloCosts.get(art!.id) || 0;
            rows.push({
              Nivel: "    Artículo",
              Código: String(art!.number),
              Descripción: art!.description,
              Unidad: art!.unit,
              [colCantidad]: Number(qty.toFixed(4)),
              [colPU]: fmtMoney(pu),
              [colTotal]: fmtMoney(pu * qty),
            });
          }
        }
      }
    }
    rows.push({
      Nivel: "TOTAL",
      Código: "",
      Descripción: "Total presupuesto",
      Unidad: "",
      [colCantidad]: "",
      [colPU]: "",
      [colTotal]: fmtMoney(grandTotal),
    });
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ["Nivel", "Código", "Descripción", "Unidad", colCantidad, colPU, colTotal],
    });
    ws["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 50 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, "Presupuesto");
  }

  if (opts.includeComposition) {
    type Row = Record<string, string | number>;
    const rows: Row[] = [];
    const sortedArts = [...d.articulos].sort((a, b) => (a.number || 0) - (b.number || 0));
    const colPU = `P.U. (${cur})`;
    const colSubtotal = `Subtotal (${cur})`;
    for (const art of sortedArts) {
      const artComps = d.comps.filter((c) => c.articulo_id === art.id);
      const puArt = d.articuloCosts.get(art.id) || 0;
      rows.push({
        Nivel: "ARTÍCULO",
        Código: String(art.number),
        Descripción: art.description,
        Unidad: art.unit,
        Cantidad: "",
        "Desperdicio %": "",
        "Margen %": "",
        [colPU]: "",
        [colSubtotal]: fmtMoney(puArt),
      });
      for (const c of artComps) {
        const insumo = insumoById.get(c.insumo_id);
        const insumoPuUsd = Number(insumo?.pu_usd || 0);
        const lineSubtotal = Number(c.quantity || 0) * (1 + Number(c.waste_pct || 0) / 100) * insumoPuUsd * (1 + Number(c.margin_pct || 0) / 100);
        rows.push({
          Nivel: "  Insumo",
          Código: insumo?.code != null ? String(insumo.code) : "",
          Descripción: insumo?.description || "(insumo no encontrado)",
          Unidad: insumo?.unit || "",
          Cantidad: Number(Number(c.quantity || 0).toFixed(4)),
          "Desperdicio %": Number(c.waste_pct || 0),
          "Margen %": Number(c.margin_pct || 0),
          [colPU]: fmtMoney(insumoPuUsd),
          [colSubtotal]: fmtMoney(lineSubtotal),
        });
      }
    }
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ["Nivel", "Código", "Descripción", "Unidad", "Cantidad", "Desperdicio %", "Margen %", colPU, colSubtotal],
    });
    ws["!cols"] = [
      { wch: 12 }, { wch: 12 }, { wch: 50 }, { wch: 10 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Composición");
  }

  if (opts.includePackages && d.packages.length > 0) {
    type Row = Record<string, string | number>;
    const rows: Row[] = [];
    for (const pkg of d.packages) {
      rows.push({
        Nivel: "PAQUETE",
        Paquete: pkg.name,
        "Tipo compra": pkg.purchase_type,
        Estado: pkg.status,
        "Días anticipo": Number(pkg.advance_days || 0),
        Insumo: "",
        Unidad: "",
        Cantidad: "",
        "Fecha necesidad": "",
      });
      const lines = d.procLines.filter((l) => l.package_id === pkg.id);
      for (const l of lines) {
        const ins = insumoById.get(l.insumo_id);
        rows.push({
          Nivel: "  Línea",
          Paquete: "",
          "Tipo compra": "",
          Estado: "",
          "Días anticipo": "",
          Insumo: ins?.description || "(no encontrado)",
          Unidad: ins?.unit || "",
          Cantidad: Number(Number(l.quantity || 0).toFixed(4)),
          "Fecha necesidad": l.need_date || "",
        });
      }
    }
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ["Nivel", "Paquete", "Tipo compra", "Estado", "Días anticipo", "Insumo", "Unidad", "Cantidad", "Fecha necesidad"],
    });
    ws["!cols"] = [
      { wch: 14 }, { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
      { wch: 40 }, { wch: 10 }, { wch: 12 }, { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Paquetes");
  }

  if (opts.includeSchedule && d.schedConfig && d.schedWeeks.length > 0) {
    const weeksByLine = new Map<string, Set<number>>();
    let maxWeek = 0;
    for (const w of d.schedWeeks) {
      if (!w.active) continue;
      const set = weeksByLine.get(w.quantification_line_id) || new Set<number>();
      set.add(w.week_number);
      weeksByLine.set(w.quantification_line_id, set);
      if (w.week_number > maxWeek) maxWeek = w.week_number;
    }
    type Row = Record<string, string | number>;
    const rows: Row[] = [];
    const headers = ["EDT", "Sector", "Artículo", "Cantidad", "Unidad", ...Array.from({ length: maxWeek + 1 }, (_, i) => `Semana ${i}`)];
    for (const ql of d.qLines) {
      const sub = subById.get(ql.subcategory_id);
      const sector = sectorById.get(ql.sector_id);
      const art = ql.articulo_id ? artById.get(ql.articulo_id) : null;
      const row: Row = {
        EDT: sub ? `${sub.code} ${sub.name}` : "",
        Sector: sector?.name || "",
        Artículo: art ? `${art.number} ${art.description}` : "(sin artículo)",
        Cantidad: Number(Number(ql.quantity || 0).toFixed(4)),
        Unidad: art?.unit || "",
      };
      const weeks = weeksByLine.get(ql.id) || new Set();
      for (let w = 0; w <= maxWeek; w++) row[`Semana ${w}`] = weeks.has(w) ? "✓" : "";
      rows.push(row);
    }
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    ws["!cols"] = [
      { wch: 28 }, { wch: 12 }, { wch: 36 }, { wch: 10 }, { wch: 8 },
      ...Array.from({ length: maxWeek + 1 }, () => ({ wch: 9 })),
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Cronograma");
  }

  if (wb.SheetNames.length === 0) throw new Error("Ninguna hoja generada");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const date = new Date().toISOString().slice(0, 10);
  const safeName = d.project.name.replace(/[^a-zA-Z0-9_-]+/g, "_");
  downloadBlob(buf, `presupuesto_${safeName}_${date}.xlsx`);
}

/* ─────────────────────── PDF (HTML print) ─────────────────────── */

function generatePdf(d: ReportData, opts: ReportOptions) {
  const html = buildReportHtml(d, opts);
  const w = window.open("", "_blank", "width=1024,height=768");
  if (!w) {
    toast.error("El navegador bloqueó la ventana de impresión. Permití pop-ups e intentá de nuevo.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function buildReportHtml(d: ReportData, opts: ReportOptions): string {
  const locale = getNumberLocale();
  const today = new Date().toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  const cur = opts.showLocal ? d.project.local_currency : "USD";
  const subArtMap = buildSubArticulos(d);
  const artById = new Map(d.articulos.map((a) => [a.id, a]));
  const subById = new Map(d.subs.map((s) => [s.id, s]));
  const sectorById = new Map(d.sectors.map((s) => [s.id, s]));
  const insumoById = new Map(d.insumos.map((i) => [i.id, i]));

  function fm(usd: number, dec = 2): string {
    if (opts.showLocal) {
      const tc = Number(d.project.exchange_rate || 1);
      return formatNumber(convertCurrency(usd, tc, "usd_to_local"), 0);
    }
    return formatNumber(usd, dec);
  }

  let hierarchyHtml = "";
  if (opts.includeHierarchy) {
    let grandTotal = 0;
    const rows: string[] = [];
    for (const cat of d.cats) {
      const catSubs = d.subs.filter((s) => s.category_id === cat.id);
      let catTotal = 0;
      const subBlocks: string[] = [];
      for (const sub of catSubs) {
        const arts = subArtMap.get(sub.id);
        let subTotal = 0;
        const artRows: string[] = [];
        if (arts) {
          const sorted = Array.from(arts.entries())
            .map(([artId, qty]) => ({ art: artById.get(artId), qty }))
            .filter((x) => x.art)
            .sort((a, b) => (a.art!.number || 0) - (b.art!.number || 0));
          for (const { art, qty } of sorted) {
            const pu = d.articuloCosts.get(art!.id) || 0;
            const total = pu * qty;
            subTotal += total;
            artRows.push(`<tr class="art-row">
              <td class="code">${escHtml(String(art!.number))}</td>
              <td class="desc">${escHtml(art!.description)}</td>
              <td>${escHtml(art!.unit)}</td>
              <td class="num">${formatNumber(qty, 2)}</td>
              <td class="num">${fm(pu)}</td>
              <td class="num">${fm(total)}</td>
            </tr>`);
          }
        }
        catTotal += subTotal;
        subBlocks.push(`<tr class="sub-row"><td colspan="5">${escHtml(sub.code)} · ${escHtml(sub.name)}</td><td class="num">${fm(subTotal)}</td></tr>`);
        subBlocks.push(...artRows);
      }
      grandTotal += catTotal;
      rows.push(`<tr class="cat-row"><td colspan="5">${escHtml(cat.code)} · ${escHtml(cat.name)}</td><td class="num">${fm(catTotal)}</td></tr>`);
      rows.push(...subBlocks);
    }
    rows.push(`<tr class="grand-total"><td colspan="5" class="num">TOTAL</td><td class="num">${fm(grandTotal)}</td></tr>`);
    hierarchyHtml = `
      <h2 class="sec-title">Presupuesto jerarquizado</h2>
      <table class="report-table">
        <thead><tr>
          <th>Código</th><th>Descripción</th><th>Unidad</th>
          <th class="num">Cantidad</th><th class="num">P.U. (${escHtml(cur)})</th><th class="num">Total (${escHtml(cur)})</th>
        </tr></thead>
        <tbody>${rows.join("\n")}</tbody>
      </table>
    `;
  }

  let compositionHtml = "";
  if (opts.includeComposition) {
    const sortedArts = [...d.articulos].sort((a, b) => (a.number || 0) - (b.number || 0));
    const blocks: string[] = [];
    for (const art of sortedArts) {
      const artComps = d.comps.filter((c) => c.articulo_id === art.id);
      const puArt = d.articuloCosts.get(art.id) || 0;
      const compRows: string[] = [];
      for (const c of artComps) {
        const insumo = insumoById.get(c.insumo_id);
        const insumoPuUsd = Number(insumo?.pu_usd || 0);
        const subtotal = Number(c.quantity || 0) * (1 + Number(c.waste_pct || 0) / 100) * insumoPuUsd * (1 + Number(c.margin_pct || 0) / 100);
        compRows.push(`<tr>
          <td>${escHtml(insumo?.code != null ? String(insumo.code) : "")}</td>
          <td>${escHtml(insumo?.description || "(no encontrado)")}</td>
          <td>${escHtml(insumo?.unit || "")}</td>
          <td class="num">${formatNumber(Number(c.quantity || 0), 4)}</td>
          <td class="num">${formatNumber(Number(c.waste_pct || 0), 1)}%</td>
          <td class="num">${formatNumber(Number(c.margin_pct || 0), 1)}%</td>
          <td class="num">${fm(insumoPuUsd)}</td>
          <td class="num">${fm(subtotal)}</td>
        </tr>`);
      }
      if (compRows.length === 0) compRows.push(`<tr><td colspan="8" class="muted-italic">Sin insumos cargados</td></tr>`);
      blocks.push(`
        <div class="art-block">
          <div class="art-header">
            <span class="art-num">N° ${escHtml(String(art.number))}</span>
            <span class="art-desc">${escHtml(art.description)}</span>
            <span class="art-unit">${escHtml(art.unit)}</span>
            <span class="art-pu">P.U. ${fm(puArt)} ${escHtml(cur)}</span>
          </div>
          <table class="report-table compact">
            <thead><tr>
              <th>Cód.</th><th>Insumo</th><th>Unidad</th>
              <th class="num">Cantidad</th><th class="num">Desperdicio</th><th class="num">Margen</th>
              <th class="num">P.U.</th><th class="num">Subtotal</th>
            </tr></thead>
            <tbody>${compRows.join("\n")}</tbody>
          </table>
        </div>
      `);
    }
    compositionHtml = `
      <h2 class="sec-title">Composición de artículos (Análisis de Precios Unitarios)</h2>
      ${blocks.join("\n")}
    `;
  }

  let packagesHtml = "";
  if (opts.includePackages && d.packages.length > 0) {
    const blocks: string[] = [];
    for (const pkg of d.packages) {
      const lines = d.procLines.filter((l) => l.package_id === pkg.id);
      const lineRows = lines.map((l) => {
        const ins = insumoById.get(l.insumo_id);
        return `<tr>
          <td>${escHtml(ins?.description || "(no encontrado)")}</td>
          <td>${escHtml(ins?.unit || "")}</td>
          <td class="num">${formatNumber(Number(l.quantity || 0), 4)}</td>
          <td>${escHtml(l.need_date || "—")}</td>
        </tr>`;
      }).join("\n") || `<tr><td colspan="4" class="muted-italic">Sin líneas en este paquete</td></tr>`;
      blocks.push(`
        <div class="pkg-block">
          <div class="pkg-header">
            <span class="pkg-name">${escHtml(pkg.name)}</span>
            <span class="pkg-meta">${escHtml(pkg.purchase_type)} · ${escHtml(pkg.status)}${pkg.advance_days ? ` · ${pkg.advance_days} días anticipo` : ""}</span>
          </div>
          <table class="report-table compact">
            <thead><tr><th>Insumo</th><th>Unidad</th><th class="num">Cantidad</th><th>Fecha necesidad</th></tr></thead>
            <tbody>${lineRows}</tbody>
          </table>
        </div>
      `);
    }
    packagesHtml = `<h2 class="sec-title">Paquetes de contratación</h2>${blocks.join("\n")}`;
  }

  let scheduleHtml = "";
  if (opts.includeSchedule && d.schedConfig && d.schedWeeks.length > 0) {
    const weeksByLine = new Map<string, Set<number>>();
    let maxWeek = 0;
    for (const w of d.schedWeeks) {
      const set = weeksByLine.get(w.quantification_line_id) || new Set<number>();
      set.add(w.week_number);
      weeksByLine.set(w.quantification_line_id, set);
      if (w.week_number > maxWeek) maxWeek = w.week_number;
    }
    const headerCols = ["EDT", "Sector", "Artículo", "Cant.", "Un.", ...Array.from({ length: maxWeek + 1 }, (_, i) => `S${i}`)];
    const headerRow = headerCols.map((h) => `<th class="${h.startsWith("S") && h !== "Sector" ? "wk" : ""}">${escHtml(h)}</th>`).join("");
    const dataRows = d.qLines.map((ql) => {
      const sub = subById.get(ql.subcategory_id);
      const sector = sectorById.get(ql.sector_id);
      const art = ql.articulo_id ? artById.get(ql.articulo_id) : null;
      const weeks = weeksByLine.get(ql.id) || new Set();
      const weekCells = Array.from({ length: maxWeek + 1 }, (_, i) => weeks.has(i) ? `<td class="wk on">●</td>` : `<td class="wk"></td>`).join("");
      return `<tr>
        <td>${escHtml(sub ? `${sub.code} ${sub.name}` : "")}</td>
        <td>${escHtml(sector?.name || "")}</td>
        <td>${escHtml(art ? `${art.number} ${art.description}` : "(sin artículo)")}</td>
        <td class="num">${formatNumber(Number(ql.quantity || 0), 2)}</td>
        <td>${escHtml(art?.unit || "")}</td>
        ${weekCells}
      </tr>`;
    }).join("\n");
    scheduleHtml = `
      <h2 class="sec-title">Cronograma — fecha de inicio ${escHtml(d.schedConfig.start_date)}</h2>
      <table class="report-table compact schedule">
        <thead><tr>${headerRow}</tr></thead>
        <tbody>${dataRows}</tbody>
      </table>
    `;
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Reporte presupuesto — ${escHtml(d.project.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; margin: 0; padding: 24px 32px; color: #0A0A0A; font-size: 11px; background: #fff; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2.sec-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #B85A0F; margin: 26px 0 10px; padding-bottom: 4px; border-bottom: 2px solid #FCE8D6; }
  .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #E87722; padding-bottom: 12px; margin-bottom: 4px; }
  .header .meta { text-align: right; font-size: 10px; color: #737373; }
  .summary { font-size: 11px; color: #737373; margin-top: 4px; }
  table.report-table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 8px; }
  table.report-table th { background: #FEF3E8; color: #B85A0F; text-align: left; text-transform: uppercase; font-size: 9px; letter-spacing: 0.04em; padding: 6px 8px; border-bottom: 1px solid #E5E5E5; }
  table.report-table td { padding: 4px 8px; border-bottom: 1px solid #EFEFEF; }
  table.report-table .num { text-align: right; font-family: "SF Mono", Menlo, Consolas, monospace; }
  table.report-table.compact th, table.report-table.compact td { padding: 3px 6px; font-size: 9.5px; }
  tr.cat-row td { background: #FFF7ED; font-weight: 700; border-top: 1px solid #FCE8D6; border-bottom: 1px solid #FCE8D6; color: #0A0A0A; }
  tr.sub-row td { background: #FAFAFA; font-weight: 600; color: #444; }
  tr.art-row td { color: #555; }
  tr.art-row td.code { font-family: "SF Mono", Menlo, monospace; color: #737373; }
  tr.grand-total td { background: #FCE8D6; font-weight: 800; border-top: 2px solid #E87722; border-bottom: 1px solid #E87722; color: #0A0A0A; }
  .art-block { margin-bottom: 14px; page-break-inside: avoid; }
  .art-header { display: flex; gap: 12px; align-items: baseline; padding: 4px 8px; background: #F5F5F5; border-left: 3px solid #E87722; }
  .art-header .art-num { font-family: "SF Mono", Menlo, monospace; font-weight: 700; }
  .art-header .art-desc { flex: 1; font-weight: 600; }
  .art-header .art-unit { color: #737373; font-size: 9px; text-transform: uppercase; }
  .art-header .art-pu { font-family: "SF Mono", Menlo, monospace; font-weight: 700; color: #B85A0F; }
  .pkg-block { margin-bottom: 12px; page-break-inside: avoid; }
  .pkg-header { display: flex; gap: 12px; align-items: baseline; padding: 4px 8px; background: #F5F5F5; border-left: 3px solid #737373; }
  .pkg-header .pkg-name { font-weight: 700; flex: 1; }
  .pkg-header .pkg-meta { color: #737373; font-size: 9px; text-transform: uppercase; }
  .schedule .wk { width: 18px; text-align: center; padding: 2px 0; }
  .schedule .wk.on { color: #E87722; font-weight: 700; }
  .muted-italic { color: #737373; font-style: italic; }
  .footer { margin-top: 28px; padding-top: 8px; border-top: 1px solid #E5E5E5; font-size: 9px; color: #A3A3A3; display: flex; justify-content: space-between; }
  @page { size: A4; margin: 12mm; }
  @media print { body { padding: 0; } h2.sec-title { page-break-after: avoid; } table.report-table tr { page-break-inside: avoid; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${escHtml(d.project.name)}</h1>
      <div class="summary">Reporte de presupuesto · Generado el ${escHtml(today)}</div>
    </div>
    <div class="meta">
      <div>${escHtml(d.project.name)}</div>
      <div>TC ${formatNumber(Number(d.project.exchange_rate || 0), 0)} ${escHtml(d.project.local_currency || "")}</div>
      <div>Importes en ${escHtml(cur)}</div>
    </div>
  </div>
  ${hierarchyHtml}
  ${compositionHtml}
  ${packagesHtml}
  ${scheduleHtml}
  <div class="footer">
    <span>${escHtml(d.project.name)} · MasterPlan Connect</span>
    <span>${escHtml(today)}</span>
  </div>
  <script>
    window.addEventListener("load", () => { setTimeout(() => window.print(), 100); });
    window.addEventListener("afterprint", () => window.close());
  </script>
</body>
</html>`;
}
