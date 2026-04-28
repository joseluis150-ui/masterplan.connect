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
        await generatePdf(data, options);
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

/**
 * Calcula los datos derivados de cada procurement_line en USD:
 *   - quantity: suma de quantification_lines de la articulo de la composición
 *               (ó l.quantity si la línea no tiene composition_id).
 *   - unitCost: composición × insumo.pu_usd × (1+waste) × (1+margin)
 *               (ó simplemente insumo.pu_usd si no hay composición).
 *   - totalCost: unitCost × quantity.
 *   - needDate:  fecha calculada como inicio del cronograma + earliest week
 *               del articulo, restando advance_days del paquete (si hay
 *               cronograma cargado y la articulo está cuantificada con
 *               semana asignada). Si no, null.
 */
interface ProcurementRollup {
  insumoDescription: string;
  insumoUnit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  needDate: Date | null;
  needDateLabel: string;
}

function buildProcurementRollup(d: ReportData): Map<string, ProcurementRollup> {
  const result = new Map<string, ProcurementRollup>();
  const compById = new Map(d.comps.map((c) => [c.id, c]));
  const insumoById = new Map(d.insumos.map((i) => [i.id, i]));
  const pkgById = new Map(d.packages.map((p) => [p.id, p]));

  // articulo → suma de cantidades cuantificadas
  const artQty = new Map<string, number>();
  for (const ql of d.qLines) {
    if (!ql.articulo_id) continue;
    artQty.set(ql.articulo_id, (artQty.get(ql.articulo_id) || 0) + Number(ql.quantity || 0));
  }
  // articulo → earliest semana asignada en cronograma (vía qLine + schedule_weeks)
  const qlEarliestWeek = new Map<string, number>();
  for (const sw of d.schedWeeks) {
    if (!sw.active) continue;
    const prev = qlEarliestWeek.get(sw.quantification_line_id);
    if (prev === undefined || sw.week_number < prev) {
      qlEarliestWeek.set(sw.quantification_line_id, sw.week_number);
    }
  }
  const artEarliestWeek = new Map<string, number>();
  for (const ql of d.qLines) {
    if (!ql.articulo_id) continue;
    const w = qlEarliestWeek.get(ql.id);
    if (w === undefined) continue;
    const prev = artEarliestWeek.get(ql.articulo_id);
    if (prev === undefined || w < prev) artEarliestWeek.set(ql.articulo_id, w);
  }
  const startDate = d.schedConfig ? new Date(d.schedConfig.start_date) : null;
  // start of week (lunes)
  function startOfMonday(date: Date): Date {
    const d2 = new Date(date);
    const day = d2.getUTCDay();
    const diff = (day + 6) % 7; // domingo=0 → 6, lunes=1 → 0
    d2.setUTCDate(d2.getUTCDate() - diff);
    return d2;
  }
  function addDays(date: Date, days: number): Date {
    const d2 = new Date(date);
    d2.setUTCDate(d2.getUTCDate() + days);
    return d2;
  }

  for (const pl of d.procLines) {
    const insumo = insumoById.get(pl.insumo_id);
    const pkg = pkgById.get(pl.package_id);
    let quantity = Number(pl.quantity || 0);
    const insumoPu = Number(insumo?.pu_usd || 0);
    let unitCost = insumoPu;

    const comp = pl.composition_id ? compById.get(pl.composition_id) : null;
    if (comp && insumo) {
      const qlQty = artQty.get(comp.articulo_id) || 0;
      const compQty = Number(comp.quantity || 0);
      const waste = Number(comp.waste_pct || 0);
      // Cantidad de INSUMO a comprar = comp.quantity × (1+waste) × qlQty.
      // Ej: si comp dice "7 bolsas de cemento por m³ de hormigón con 8 % de
      // desperdicio" y la cuantificación tiene 100 m³ de ese hormigón,
      // necesitamos 7 × 1.08 × 100 = 756 bolsas.
      // Margin no aplica acá: es markup para precio al cliente, no para
      // procurement (paga el costo al proveedor sin marcado).
      quantity = compQty * (1 + waste / 100) * qlQty;
      unitCost = insumoPu; // P.U. siempre es el del insumo (por bolsa, kg, etc.)
    }

    const totalCost = unitCost * quantity;

    // Fecha de necesidad: si hay cronograma + articulo con semana, calcular
    let needDate: Date | null = null;
    let needDateLabel = "";
    if (comp && startDate && pkg) {
      const earliestWeek = artEarliestWeek.get(comp.articulo_id);
      if (earliestWeek !== undefined) {
        const monday = startOfMonday(startDate);
        const weekStart = addDays(monday, earliestWeek * 7);
        needDate = addDays(weekStart, -(Number(pkg.advance_days || 0)));
      }
    }
    if (needDate) {
      needDateLabel = needDate.toISOString().slice(0, 10);
    }

    result.set(pl.id, {
      insumoDescription: insumo?.description || "(insumo no encontrado)",
      insumoUnit: insumo?.unit || "",
      quantity,
      unitCost,
      totalCost,
      needDate,
      needDateLabel,
    });
  }
  return result;
}

/* ─────────────────────── Excel (exceljs) ─────────────────────── */

// ExcelJS usa ARGB (alfa por delante). Mantengo los seis dígitos brand
// y los prefijo con FF (alfa 100 %).
const COLOR = {
  ink: "FF0A0A0A",
  inkSoft: "FF404040",
  ash: "FF737373",
  ashLight: "FFA3A3A3",
  grayLight: "FFF5F5F5",
  grayFaint: "FFFAFAFA",
  borderSoft: "FFD4D4D4",
  borderFaint: "FFEFEFEF",
  orangeSignal: "FFE87722",
  white: "FFFFFFFF",
};

const NUM_2D = "#,##0.00";
const NUM_0 = "#,##0";
const NUM_PCT = "0.0%";

function thinBorder(argb: string) {
  return {
    top: { style: "thin" as const, color: { argb } },
    right: { style: "thin" as const, color: { argb } },
    bottom: { style: "thin" as const, color: { argb } },
    left: { style: "thin" as const, color: { argb } },
  };
}

// Convierte un data URI o URL a un ArrayBuffer PNG usando canvas. Acepta
// SVG/PNG/JPG/WebP — todo lo que el browser pueda renderizar como imagen.
async function imageToPngBuffer(src: string, maxWidth = 600): Promise<ArrayBuffer | null> {
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
      img.src = src;
    });
    const canvas = document.createElement("canvas");
    const intrinsicW = img.width || maxWidth;
    const intrinsicH = img.height || Math.round(maxWidth * 0.3);
    const aspect = intrinsicH / Math.max(intrinsicW, 1);
    const w = Math.min(intrinsicW, maxWidth);
    canvas.width = w;
    canvas.height = Math.max(1, Math.round(w * aspect));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("toBlob failed"));
        blob.arrayBuffer().then(resolve).catch(reject);
      }, "image/png");
    });
  } catch {
    return null;
  }
}

async function fetchSvgAsDataUri(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const text = await resp.text();
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
  } catch {
    return null;
  }
}

type ExcelJSWorkbook = import("exceljs").Workbook;
type ExcelJSWorksheet = import("exceljs").Worksheet;
type ExcelJSAnchor = { col: number; row: number };

async function generateExcel(d: ReportData, opts: ReportOptions) {
  const ExcelJS = await import("exceljs");
  const wb: ExcelJSWorkbook = new ExcelJS.Workbook();
  wb.creator = "MasterPlan Connect";
  wb.created = new Date();

  const cur = opts.showLocal ? d.project.local_currency : "USD";
  const tc = Number(d.project.exchange_rate || 1);
  const totalAreaM2 = d.sectors.reduce((s, sc) => s + Number(sc.area_m2 || 0), 0);
  const subArtMap = buildSubArticulos(d);
  const artById = new Map(d.articulos.map((a) => [a.id, a]));
  const subById = new Map(d.subs.map((s) => [s.id, s]));
  const sectorById = new Map(d.sectors.map((s) => [s.id, s]));
  const insumoById = new Map(d.insumos.map((i) => [i.id, i]));

  function fm(usd: number): number {
    if (opts.showLocal) return Number(convertCurrency(usd, tc, "usd_to_local").toFixed(2));
    return Number(usd.toFixed(2));
  }

  // Logos: el de MasterPlan se baja del SVG público; el del cliente
  // viene como data URI (cargado en Settings). Ambos se re-renderean a
  // PNG via canvas porque exceljs no soporta SVG/WebP.
  const mpSvgUri = await fetchSvgAsDataUri("/logo-horizontal.svg");
  const mpPng = mpSvgUri ? await imageToPngBuffer(mpSvgUri, 600) : null;
  const clientPng = d.project.client_logo_data
    ? await imageToPngBuffer(d.project.client_logo_data, 400)
    : null;

  const mpImageId = mpPng ? wb.addImage({ buffer: mpPng, extension: "png" }) : null;
  const clientImageId = clientPng ? wb.addImage({ buffer: clientPng, extension: "png" }) : null;

  // Pre-cómputo de jerarquía
  type SubAgg = { sub: EdtSubcategory; total: number };
  type CatAgg = { cat: EdtCategory; total: number; subs: SubAgg[] };
  const catAggs: CatAgg[] = d.cats.map((cat) => {
    const subs: SubAgg[] = d.subs
      .filter((s) => s.category_id === cat.id)
      .map((sub) => {
        const arts = subArtMap.get(sub.id);
        let total = 0;
        if (arts) for (const [artId, qty] of arts) total += (d.articuloCosts.get(artId) || 0) * qty;
        return { sub, total };
      });
    const total = subs.reduce((s, x) => s + x.total, 0);
    return { cat, total, subs };
  });
  const grandTotal = catAggs.reduce((s, c) => s + c.total, 0);

  /* ── Estilos de celda reutilizables ── */
  const S = {
    title: {
      font: { name: "Calibri", size: 16, bold: true, color: { argb: COLOR.white } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.ink } } as const,
      alignment: { vertical: "middle" as const, horizontal: "center" as const },
    },
    subtitle: {
      font: { name: "Calibri", size: 10, italic: true, color: { argb: COLOR.ash } },
      alignment: { vertical: "middle" as const, horizontal: "center" as const },
    },
    header: {
      font: { name: "Calibri", size: 10, bold: true, color: { argb: COLOR.white } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.ink } } as const,
      alignment: { vertical: "middle" as const, horizontal: "center" as const, wrapText: true },
      border: thinBorder(COLOR.ink),
    },
    catLeft: {
      font: { name: "Calibri", size: 11, bold: true, color: { argb: COLOR.ink } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.grayLight } } as const,
      alignment: { vertical: "middle" as const, horizontal: "left" as const, indent: 1 },
      border: {
        top: { style: "thin" as const, color: { argb: COLOR.borderSoft } },
        bottom: { style: "thin" as const, color: { argb: COLOR.borderSoft } },
        right: { style: "thin" as const, color: { argb: COLOR.borderSoft } },
      },
    },
    catFirst: {
      font: { name: "Calibri", size: 11, bold: true, color: { argb: COLOR.ink } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.grayLight } } as const,
      alignment: { vertical: "middle" as const, horizontal: "left" as const, indent: 1 },
      border: {
        top: { style: "thin" as const, color: { argb: COLOR.borderSoft } },
        bottom: { style: "thin" as const, color: { argb: COLOR.borderSoft } },
        right: { style: "thin" as const, color: { argb: COLOR.borderSoft } },
        left: { style: "medium" as const, color: { argb: COLOR.orangeSignal } },
      },
    },
    catRight: {
      font: { name: "Calibri", size: 11, bold: true, color: { argb: COLOR.ink } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.grayLight } } as const,
      alignment: { vertical: "middle" as const, horizontal: "right" as const },
      border: {
        top: { style: "thin" as const, color: { argb: COLOR.borderSoft } },
        bottom: { style: "thin" as const, color: { argb: COLOR.borderSoft } },
        right: { style: "thin" as const, color: { argb: COLOR.borderSoft } },
      },
      numFmt: NUM_2D,
    },
    subLeft: {
      font: { name: "Calibri", size: 10, bold: true, color: { argb: COLOR.ink } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.white } } as const,
      alignment: { vertical: "middle" as const, horizontal: "left" as const, indent: 2 },
      border: thinBorder(COLOR.borderFaint),
    },
    subRight: {
      font: { name: "Calibri", size: 10, bold: true, color: { argb: COLOR.ink } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.white } } as const,
      alignment: { vertical: "middle" as const, horizontal: "right" as const },
      border: thinBorder(COLOR.borderFaint),
      numFmt: NUM_2D,
    },
    artLeft: {
      font: { name: "Calibri", size: 10, color: { argb: COLOR.inkSoft } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.grayFaint } } as const,
      alignment: { vertical: "middle" as const, horizontal: "left" as const, indent: 3, wrapText: true },
      border: thinBorder(COLOR.borderFaint),
    },
    artRight: {
      font: { name: "Calibri", size: 10, color: { argb: COLOR.inkSoft } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.grayFaint } } as const,
      alignment: { vertical: "middle" as const, horizontal: "right" as const },
      border: thinBorder(COLOR.borderFaint),
      numFmt: NUM_2D,
    },
    totalLeft: {
      font: { name: "Calibri", size: 12, bold: true, color: { argb: COLOR.white } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.ink } } as const,
      alignment: { vertical: "middle" as const, horizontal: "left" as const, indent: 1 },
      border: thinBorder(COLOR.ink),
    },
    totalRight: {
      font: { name: "Calibri", size: 13, bold: true, color: { argb: COLOR.orangeSignal } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.ink } } as const,
      alignment: { vertical: "middle" as const, horizontal: "right" as const },
      border: thinBorder(COLOR.ink),
      numFmt: NUM_2D,
    },
    totalRightLabel: {
      font: { name: "Calibri", size: 12, bold: true, color: { argb: COLOR.white } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.ink } } as const,
      alignment: { vertical: "middle" as const, horizontal: "right" as const },
      border: thinBorder(COLOR.ink),
    },
  };

  // Helper genérico para asignar valor + estilo a una celda
  function setCell(ws: ExcelJSWorksheet, row: number, col: number, value: string | number | null, style: object) {
    const cell = ws.getCell(row, col);
    cell.value = value === null || value === undefined || value === "" ? null : value;
    Object.assign(cell, style);
  }

  // Helper para banner: agrega logos + título + subtítulo en filas 1-3.
  // Retorna la fila siguiente disponible (1-indexada).
  function addBranding(
    ws: ExcelJSWorksheet,
    title: string,
    subtitle: string,
    lastCol: number
  ): number {
    // Fila 1: logos (con fila vacía detrás de las imágenes)
    ws.getRow(1).height = 38;
    if (mpImageId !== null) {
      ws.addImage(mpImageId, {
        tl: { col: 0.1, row: 0.15 } as ExcelJSAnchor,
        ext: { width: 170, height: 42 },
        editAs: "oneCell",
      });
    }
    if (clientImageId !== null) {
      const rightAnchor = Math.max(lastCol - 2, 2);
      ws.addImage(clientImageId, {
        tl: { col: rightAnchor + 0.2, row: 0.15 } as ExcelJSAnchor,
        ext: { width: 140, height: 42 },
        editAs: "oneCell",
      });
    }
    // Borde inferior negro de toda la fila 1 → simula la línea bajo el header
    for (let c = 1; c <= lastCol; c++) {
      ws.getCell(1, c).border = { bottom: { style: "thin", color: { argb: COLOR.ink } } };
    }

    // Fila 2: título (merged)
    ws.getRow(2).height = 28;
    ws.mergeCells(2, 1, 2, lastCol);
    setCell(ws, 2, 1, title, S.title);

    // Fila 3: subtítulo (merged)
    ws.getRow(3).height = 18;
    ws.mergeCells(3, 1, 3, lastCol);
    setCell(ws, 3, 1, subtitle, S.subtitle);

    // Fila 4: spacing vacío
    ws.getRow(4).height = 6;

    return 5; // siguiente fila libre (1-indexed)
  }

  function metaText(): string {
    const parts = [
      `Cliente: ${d.project.client || "—"}`,
      `TC: ${formatNumber(tc, 0)}${d.project.local_currency ? " " + d.project.local_currency : ""}`,
      `Importes en ${cur}`,
    ];
    if (totalAreaM2 > 0) parts.push(`Área ${formatNumber(totalAreaM2, 0)} m²`);
    parts.push(`Generado el ${new Date().toLocaleDateString(getNumberLocale(), { year: "numeric", month: "long", day: "numeric" })}`);
    return parts.join("  ·  ");
  }

  function applyHeader(ws: ExcelJSWorksheet, row: number, headers: string[]) {
    for (let i = 0; i < headers.length; i++) setCell(ws, row, i + 1, headers[i], S.header);
    ws.getRow(row).height = 24;
  }

  function freezeAfterHeader(ws: ExcelJSWorksheet, headerRow: number) {
    ws.views = [{ state: "frozen", xSplit: 0, ySplit: headerRow }];
  }

  function setColWidths(ws: ExcelJSWorksheet, widths: number[]) {
    for (let i = 0; i < widths.length; i++) ws.getColumn(i + 1).width = widths[i];
  }

  function setupPrint(ws: ExcelJSWorksheet, landscape = false) {
    ws.pageSetup = {
      paperSize: 9, // A4
      orientation: landscape ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
      horizontalCentered: true,
    };
    ws.headerFooter = {
      oddHeader: `&L&"Calibri,Italic"&9${d.project.name}&R&"Calibri,Italic"&9MasterPlan Connect`,
      oddFooter: `&L&"Calibri,Italic"&9Importes en ${cur}&R&"Calibri,Italic"&9Página &P de &N`,
    };
  }

  // ────────────────── Hoja 1 — Resumen ──────────────────
  if (opts.includeHierarchy) {
    const ws = wb.addWorksheet("Resumen");
    const lastCol = 5;
    setColWidths(ws, [16, 56, 18, 14, 16]);
    let r = addBranding(ws, `PRESUPUESTO RESUMEN — ${d.project.name}`, metaText(), lastCol);
    applyHeader(ws, r, ["Código", "Descripción", `Total (${cur})`, "% del total", `${cur}/m²`]);
    const headerRow = r;
    r++;

    for (const ca of catAggs) {
      const pct = grandTotal > 0 ? ca.total / grandTotal : 0;
      const perM2 = totalAreaM2 > 0 ? fm(ca.total) / totalAreaM2 : 0;
      setCell(ws, r, 1, ca.cat.code, S.catFirst);
      setCell(ws, r, 2, ca.cat.name, S.catLeft);
      setCell(ws, r, 3, fm(ca.total), S.catRight);
      setCell(ws, r, 4, pct, { ...S.catRight, numFmt: NUM_PCT });
      setCell(ws, r, 5, perM2, S.catRight);
      r++;
      for (const sa of ca.subs) {
        const subPct = grandTotal > 0 ? sa.total / grandTotal : 0;
        const subPerM2 = totalAreaM2 > 0 ? fm(sa.total) / totalAreaM2 : 0;
        setCell(ws, r, 1, sa.sub.code, S.subLeft);
        setCell(ws, r, 2, sa.sub.name, S.subLeft);
        setCell(ws, r, 3, fm(sa.total), S.subRight);
        setCell(ws, r, 4, subPct, { ...S.subRight, numFmt: NUM_PCT });
        setCell(ws, r, 5, subPerM2, S.subRight);
        r++;
      }
    }
    setCell(ws, r, 1, "", S.totalLeft);
    setCell(ws, r, 2, "TOTAL PRESUPUESTO", S.totalLeft);
    setCell(ws, r, 3, fm(grandTotal), S.totalRight);
    setCell(ws, r, 4, 1, { ...S.totalRight, numFmt: NUM_PCT });
    setCell(ws, r, 5, totalAreaM2 > 0 ? fm(grandTotal) / totalAreaM2 : 0, S.totalRight);

    freezeAfterHeader(ws, headerRow);
    setupPrint(ws, false);
  }

  // ────────────────── Hoja 2 — Detalle ──────────────────
  if (opts.includeHierarchy) {
    const ws = wb.addWorksheet("Detalle");
    const lastCol = 6;
    setColWidths(ws, [14, 50, 10, 14, 16, 18]);
    let r = addBranding(ws, `PRESUPUESTO DETALLADO — ${d.project.name}`, metaText(), lastCol);
    applyHeader(ws, r, ["Código", "Descripción", "Unidad", "Cantidad", `P.U. (${cur})`, `Total (${cur})`]);
    const headerRow = r;
    r++;
    for (const ca of catAggs) {
      setCell(ws, r, 1, ca.cat.code, S.catFirst);
      setCell(ws, r, 2, ca.cat.name, S.catLeft);
      setCell(ws, r, 3, "", S.catLeft);
      setCell(ws, r, 4, "", S.catRight);
      setCell(ws, r, 5, "", S.catRight);
      setCell(ws, r, 6, fm(ca.total), S.catRight);
      r++;
      for (const sa of ca.subs) {
        setCell(ws, r, 1, sa.sub.code, S.subLeft);
        setCell(ws, r, 2, sa.sub.name, S.subLeft);
        setCell(ws, r, 3, "", S.subLeft);
        setCell(ws, r, 4, "", S.subRight);
        setCell(ws, r, 5, "", S.subRight);
        setCell(ws, r, 6, fm(sa.total), S.subRight);
        r++;
        const arts = subArtMap.get(sa.sub.id);
        if (!arts) continue;
        const sorted = Array.from(arts.entries())
          .map(([artId, qty]) => ({ art: artById.get(artId), qty }))
          .filter((x) => x.art)
          .sort((a, b) => (a.art!.number || 0) - (b.art!.number || 0));
        for (const { art, qty } of sorted) {
          const pu = d.articuloCosts.get(art!.id) || 0;
          setCell(ws, r, 1, String(art!.number), S.artLeft);
          setCell(ws, r, 2, art!.description, S.artLeft);
          setCell(ws, r, 3, art!.unit, S.artLeft);
          setCell(ws, r, 4, Number(qty.toFixed(2)), { ...S.artRight, numFmt: NUM_2D });
          setCell(ws, r, 5, fm(pu), S.artRight);
          setCell(ws, r, 6, fm(pu * qty), S.artRight);
          r++;
        }
      }
    }
    setCell(ws, r, 1, "", S.totalLeft);
    setCell(ws, r, 2, "TOTAL PRESUPUESTO", S.totalLeft);
    setCell(ws, r, 3, "", S.totalLeft);
    setCell(ws, r, 4, "", S.totalRightLabel);
    setCell(ws, r, 5, "", S.totalRightLabel);
    setCell(ws, r, 6, fm(grandTotal), S.totalRight);

    freezeAfterHeader(ws, headerRow);
    setupPrint(ws, false);
  }

  // ────────────────── Hoja 3 — Composición (APU) ──────────────────
  if (opts.includeComposition) {
    const ws = wb.addWorksheet("Composición");
    const lastCol = 8;
    setColWidths(ws, [12, 44, 10, 12, 12, 12, 14, 16]);
    let r = addBranding(ws, "COMPOSICIÓN DE ARTÍCULOS (APU)", metaText(), lastCol);
    applyHeader(ws, r, ["Código", "Descripción", "Unidad", "Cantidad", "Desperdicio %", "Margen %", `P.U. (${cur})`, `Subtotal (${cur})`]);
    const headerRow = r;
    r++;
    const sortedArts = [...d.articulos].sort((a, b) => (a.number || 0) - (b.number || 0));
    for (const art of sortedArts) {
      const artComps = d.comps.filter((c) => c.articulo_id === art.id);
      const puArt = d.articuloCosts.get(art.id) || 0;
      setCell(ws, r, 1, String(art.number), S.catFirst);
      setCell(ws, r, 2, art.description, S.catLeft);
      setCell(ws, r, 3, art.unit, S.catLeft);
      for (let c = 4; c <= 7; c++) setCell(ws, r, c, "", S.catRight);
      setCell(ws, r, 8, fm(puArt), S.catRight);
      r++;
      for (const c of artComps) {
        const insumo = insumoById.get(c.insumo_id);
        const insumoPuUsd = Number(insumo?.pu_usd || 0);
        const lineSubtotal = Number(c.quantity || 0) * (1 + Number(c.waste_pct || 0) / 100) * insumoPuUsd * (1 + Number(c.margin_pct || 0) / 100);
        setCell(ws, r, 1, insumo?.code != null ? String(insumo.code) : "", S.artLeft);
        setCell(ws, r, 2, insumo?.description || "(insumo no encontrado)", S.artLeft);
        setCell(ws, r, 3, insumo?.unit || "", S.artLeft);
        setCell(ws, r, 4, Number(Number(c.quantity || 0).toFixed(2)), { ...S.artRight, numFmt: NUM_2D });
        setCell(ws, r, 5, Number(c.waste_pct || 0) / 100, { ...S.artRight, numFmt: NUM_PCT });
        setCell(ws, r, 6, Number(c.margin_pct || 0) / 100, { ...S.artRight, numFmt: NUM_PCT });
        setCell(ws, r, 7, fm(insumoPuUsd), S.artRight);
        setCell(ws, r, 8, fm(lineSubtotal), S.artRight);
        r++;
      }
    }
    freezeAfterHeader(ws, headerRow);
    setupPrint(ws, true);
  }

  // ────────────────── Hoja 4 — Paquetes (opcional) ──────────────────
  if (opts.includePackages && d.packages.length > 0) {
    const rollup = buildProcurementRollup(d);
    const ws = wb.addWorksheet("Paquetes");
    const lastCol = 8;
    // Paquete (header) | Insumo | Unidad | Cantidad | P.U. | Total | Fecha nec. | Estado/Tipo
    setColWidths(ws, [10, 44, 8, 13, 14, 16, 14, 18]);
    let r = addBranding(ws, "PAQUETES DE CONTRATACIÓN", metaText(), lastCol);
    applyHeader(ws, r, ["Cód.", "Insumo", "Unidad", "Cantidad", `P.U. (${cur})`, `Total (${cur})`, "Fecha necesidad", "Tipo / Estado"]);
    const headerRow = r;
    r++;
    let grandTotalPaquetes = 0;
    for (const pkg of d.packages) {
      const lines = d.procLines.filter((l) => l.package_id === pkg.id);
      // Pkg header row (descripción del paquete + meta a la derecha)
      const pkgTotal = lines.reduce((s, l) => s + (rollup.get(l.id)?.totalCost || 0), 0);
      grandTotalPaquetes += pkgTotal;
      const pkgMeta = `${pkg.purchase_type} · ${pkg.status}${pkg.advance_days ? ` · ${pkg.advance_days}d ant.` : ""}`;
      setCell(ws, r, 1, "", S.catFirst);
      setCell(ws, r, 2, pkg.name, S.catLeft);
      setCell(ws, r, 3, "", S.catLeft);
      setCell(ws, r, 4, "", S.catRight);
      setCell(ws, r, 5, "", S.catRight);
      setCell(ws, r, 6, fm(pkgTotal), S.catRight);
      setCell(ws, r, 7, "", S.catLeft);
      setCell(ws, r, 8, pkgMeta, S.catLeft);
      r++;
      for (const l of lines) {
        const roll = rollup.get(l.id);
        const ins = insumoById.get(l.insumo_id);
        const insCode = ins?.code != null ? String(ins.code) : "";
        setCell(ws, r, 1, insCode, S.artLeft);
        setCell(ws, r, 2, roll?.insumoDescription || ins?.description || "(no encontrado)", S.artLeft);
        setCell(ws, r, 3, roll?.insumoUnit || ins?.unit || "", S.artLeft);
        setCell(ws, r, 4, Number((roll?.quantity || 0).toFixed(2)), { ...S.artRight, numFmt: NUM_2D });
        setCell(ws, r, 5, fm(roll?.unitCost || 0), S.artRight);
        setCell(ws, r, 6, fm(roll?.totalCost || 0), S.artRight);
        setCell(ws, r, 7, roll?.needDateLabel || "—", S.artLeft);
        setCell(ws, r, 8, "", S.artLeft);
        r++;
      }
    }
    // Total general
    setCell(ws, r, 1, "", S.totalLeft);
    setCell(ws, r, 2, "TOTAL PAQUETES", S.totalLeft);
    setCell(ws, r, 3, "", S.totalLeft);
    setCell(ws, r, 4, "", S.totalRightLabel);
    setCell(ws, r, 5, "", S.totalRightLabel);
    setCell(ws, r, 6, fm(grandTotalPaquetes), S.totalRight);
    setCell(ws, r, 7, "", S.totalRightLabel);
    setCell(ws, r, 8, "", S.totalRightLabel);
    freezeAfterHeader(ws, headerRow);
    setupPrint(ws, true);
  }

  // ────────────────── Hoja 5 — Cronograma (opcional) ──────────────────
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
    const ws = wb.addWorksheet("Cronograma");
    const lastCol = 5 + (maxWeek + 1);
    const widths = [28, 12, 36, 12, 8];
    for (let i = 0; i <= maxWeek; i++) widths.push(4);
    setColWidths(ws, widths);
    let r = addBranding(
      ws,
      "CRONOGRAMA",
      `Inicio: ${d.schedConfig.start_date}  ·  Duración: ${maxWeek + 1} semanas  ·  ${d.qLines.length} líneas`,
      lastCol
    );
    const headers = ["EDT", "Sector", "Artículo", "Cantidad", "Unidad", ...Array.from({ length: maxWeek + 1 }, (_, i) => `S${i}`)];
    applyHeader(ws, r, headers);
    const headerRow = r;
    r++;
    for (const ql of d.qLines) {
      const sub = subById.get(ql.subcategory_id);
      const sector = sectorById.get(ql.sector_id);
      const art = ql.articulo_id ? artById.get(ql.articulo_id) : null;
      setCell(ws, r, 1, sub ? `${sub.code} ${sub.name}` : "", S.artLeft);
      setCell(ws, r, 2, sector?.name || "", S.artLeft);
      setCell(ws, r, 3, art ? `${art.number} ${art.description}` : "(sin artículo)", S.artLeft);
      setCell(ws, r, 4, Number(Number(ql.quantity || 0).toFixed(2)), { ...S.artRight, numFmt: NUM_2D });
      setCell(ws, r, 5, art?.unit || "", S.artLeft);
      const weeks = weeksByLine.get(ql.id) || new Set();
      for (let w = 0; w <= maxWeek; w++) {
        const on = weeks.has(w);
        setCell(ws, r, 6 + w, on ? "●" : "", on
          ? {
              font: { name: "Calibri", size: 11, bold: true, color: { argb: COLOR.orangeSignal } },
              alignment: { vertical: "middle", horizontal: "center" },
              border: thinBorder(COLOR.borderFaint),
            }
          : {
              alignment: { vertical: "middle", horizontal: "center" },
              border: thinBorder(COLOR.borderFaint),
            });
      }
      r++;
    }
    freezeAfterHeader(ws, headerRow);
    setupPrint(ws, true);
  }

  if (wb.worksheets.length === 0) throw new Error("Ninguna hoja generada");

  const buf = await wb.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  const safeName = d.project.name.replace(/[^a-zA-Z0-9_-]+/g, "_");
  downloadBlob(buf as ArrayBuffer, `presupuesto_${safeName}_${date}.xlsx`);
}

/* ─────────────────────── PDF (HTML print) ─────────────────────── */

async function generatePdf(d: ReportData, opts: ReportOptions) {
  // Embeber el logo como data-URI para que sobreviva al window.open
  // (los paths a /public no se resuelven igual en una ventana abierta).
  let logoDataUri: string | null = null;
  try {
    const logoResp = await fetch("/logo-horizontal.svg");
    if (logoResp.ok) {
      const logoSvg = await logoResp.text();
      logoDataUri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(logoSvg)))}`;
    }
  } catch {
    // Si falla el fetch, el HTML cae al texto sin logo.
  }
  const html = buildReportHtml(d, opts, logoDataUri);
  const w = window.open("", "_blank", "width=1024,height=768");
  if (!w) {
    toast.error("El navegador bloqueó la ventana de impresión. Permití pop-ups e intentá de nuevo.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function buildReportHtml(d: ReportData, opts: ReportOptions, logoDataUri: string | null): string {
  const locale = getNumberLocale();
  const today = new Date().toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  const cur = opts.showLocal ? d.project.local_currency : "USD";
  const tc = Number(d.project.exchange_rate || 1);
  const totalAreaM2 = d.sectors.reduce((s, sc) => s + Number(sc.area_m2 || 0), 0);
  const subArtMap = buildSubArticulos(d);
  const artById = new Map(d.articulos.map((a) => [a.id, a]));
  const subById = new Map(d.subs.map((s) => [s.id, s]));
  const sectorById = new Map(d.sectors.map((s) => [s.id, s]));
  const insumoById = new Map(d.insumos.map((i) => [i.id, i]));

  function fm(usd: number, dec = 2): string {
    if (opts.showLocal) return formatNumber(convertCurrency(usd, tc, "usd_to_local"), 0);
    return formatNumber(usd, dec);
  }

  // ── Sección: Presupuesto jerarquizado ──
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
              <td class="art-code">${escHtml(String(art!.number))}</td>
              <td class="art-desc">${escHtml(art!.description)}</td>
              <td class="art-unit">${escHtml(art!.unit)}</td>
              <td class="num">${formatNumber(qty, 2)}</td>
              <td class="num">${fm(pu)}</td>
              <td class="num strong">${fm(total)}</td>
            </tr>`);
          }
        }
        catTotal += subTotal;
        subBlocks.push(`<tr class="sub-row">
          <td colspan="5"><span class="sub-code">${escHtml(sub.code)}</span> ${escHtml(sub.name)}</td>
          <td class="num">${fm(subTotal)}</td>
        </tr>`);
        subBlocks.push(...artRows);
      }
      grandTotal += catTotal;
      rows.push(`<tr class="cat-row">
        <td colspan="5"><span class="cat-code">${escHtml(cat.code)}</span> ${escHtml(cat.name)}</td>
        <td class="num">${fm(catTotal)}</td>
      </tr>`);
      rows.push(...subBlocks);
    }
    rows.push(`<tr class="grand-total"><td colspan="5">TOTAL PRESUPUESTO</td><td class="num">${fm(grandTotal)}</td></tr>`);
    hierarchyHtml = `
      <section class="report-section">
        <h2 class="sec-title">Presupuesto jerarquizado</h2>
        <table class="report-table hierarchy">
          <colgroup>
            <col style="width:9%" />
            <col style="width:50%" />
            <col style="width:8%" />
            <col style="width:10%" />
            <col style="width:11%" />
            <col style="width:12%" />
          </colgroup>
          <thead><tr>
            <th>Código</th>
            <th>Descripción</th>
            <th>Unidad</th>
            <th class="num">Cantidad</th>
            <th class="num">P.U. (${escHtml(cur)})</th>
            <th class="num">Total (${escHtml(cur)})</th>
          </tr></thead>
          <tbody>${rows.join("\n")}</tbody>
        </table>
      </section>
    `;
  }

  // ── Sección: Composición — cada artículo en una tarjeta ──
  let compositionHtml = "";
  if (opts.includeComposition) {
    const sortedArts = [...d.articulos].sort((a, b) => (a.number || 0) - (b.number || 0));
    const cards: string[] = [];
    for (const art of sortedArts) {
      const artComps = d.comps.filter((c) => c.articulo_id === art.id);
      const puArt = d.articuloCosts.get(art.id) || 0;
      const compRows: string[] = [];
      let totalSubtotal = 0;
      for (const c of artComps) {
        const insumo = insumoById.get(c.insumo_id);
        const insumoPuUsd = Number(insumo?.pu_usd || 0);
        const subtotal = Number(c.quantity || 0) * (1 + Number(c.waste_pct || 0) / 100) * insumoPuUsd * (1 + Number(c.margin_pct || 0) / 100);
        totalSubtotal += subtotal;
        compRows.push(`<tr>
          <td class="ins-code">${escHtml(insumo?.code != null ? String(insumo.code) : "—")}</td>
          <td class="ins-desc">${escHtml(insumo?.description || "(no encontrado)")}</td>
          <td class="ins-unit">${escHtml(insumo?.unit || "")}</td>
          <td class="num">${formatNumber(Number(c.quantity || 0), 2)}</td>
          <td class="num">${formatNumber(Number(c.waste_pct || 0), 1)}%</td>
          <td class="num">${formatNumber(Number(c.margin_pct || 0), 1)}%</td>
          <td class="num">${fm(insumoPuUsd)}</td>
          <td class="num strong">${fm(subtotal)}</td>
        </tr>`);
      }
      if (compRows.length === 0) {
        compRows.push(`<tr><td colspan="8" class="muted-italic">Sin insumos cargados</td></tr>`);
      } else {
        compRows.push(`<tr class="card-total">
          <td colspan="7" class="num">TOTAL P.U. del artículo</td>
          <td class="num strong">${fm(totalSubtotal)}</td>
        </tr>`);
      }
      cards.push(`
        <div class="art-card">
          <div class="art-card-header">
            <span class="art-card-num">N° ${escHtml(String(art.number))}</span>
            <span class="art-card-desc">${escHtml(art.description)}</span>
            <span class="art-card-unit">por ${escHtml(art.unit)}</span>
            <span class="art-card-pu">${fm(puArt)} ${escHtml(cur)}</span>
          </div>
          <table class="report-table composition">
            <colgroup>
              <col style="width:8%" />
              <col style="width:34%" />
              <col style="width:6%" />
              <col style="width:11%" />
              <col style="width:9%" />
              <col style="width:9%" />
              <col style="width:11%" />
              <col style="width:12%" />
            </colgroup>
            <thead><tr>
              <th>Cód.</th>
              <th>Insumo</th>
              <th>Un.</th>
              <th class="num">Cantidad</th>
              <th class="num">Desp.</th>
              <th class="num">Margen</th>
              <th class="num">P.U.</th>
              <th class="num">Subtotal</th>
            </tr></thead>
            <tbody>${compRows.join("\n")}</tbody>
          </table>
        </div>
      `);
    }
    compositionHtml = `
      <section class="report-section">
        <h2 class="sec-title">Composición de artículos (Análisis de Precios Unitarios)</h2>
        <p class="sec-help">Descomposición de cada artículo en sus insumos, con cantidad, desperdicio, margen y subtotal. P.U. final del artículo en el header de la tarjeta.</p>
        <div class="art-cards">${cards.join("\n")}</div>
      </section>
    `;
  }

  // ── Sección: Paquetes ──
  let packagesHtml = "";
  if (opts.includePackages && d.packages.length > 0) {
    const rollup = buildProcurementRollup(d);
    const cards: string[] = [];
    let grandTotal = 0;
    for (const pkg of d.packages) {
      const lines = d.procLines.filter((l) => l.package_id === pkg.id);
      const pkgTotal = lines.reduce((s, l) => s + (rollup.get(l.id)?.totalCost || 0), 0);
      grandTotal += pkgTotal;
      const lineRows = lines.map((l) => {
        const ins = insumoById.get(l.insumo_id);
        const roll = rollup.get(l.id);
        const qty = roll?.quantity || 0;
        const pu = roll?.unitCost || 0;
        const total = roll?.totalCost || 0;
        return `<tr>
          <td class="ins-code">${escHtml(ins?.code != null ? String(ins.code) : "—")}</td>
          <td class="ins-desc">${escHtml(roll?.insumoDescription || ins?.description || "(no encontrado)")}</td>
          <td class="ins-unit">${escHtml(roll?.insumoUnit || ins?.unit || "")}</td>
          <td class="num">${formatNumber(qty, 2)}</td>
          <td class="num">${fm(pu)}</td>
          <td class="num strong">${fm(total)}</td>
          <td>${escHtml(roll?.needDateLabel || "—")}</td>
        </tr>`;
      }).join("\n") || `<tr><td colspan="7" class="muted-italic">Sin líneas en este paquete</td></tr>`;
      cards.push(`
        <div class="pkg-card">
          <div class="pkg-card-header">
            <span class="pkg-card-name">${escHtml(pkg.name)}</span>
            <span class="pkg-card-meta">${escHtml(pkg.purchase_type)} · ${escHtml(pkg.status)}${pkg.advance_days ? ` · ${pkg.advance_days} días anticipo` : ""}</span>
            <span class="pkg-card-pu">${fm(pkgTotal)} ${escHtml(cur)}</span>
          </div>
          <table class="report-table composition">
            <colgroup>
              <col style="width:8%" />
              <col style="width:34%" />
              <col style="width:7%" />
              <col style="width:11%" />
              <col style="width:11%" />
              <col style="width:14%" />
              <col style="width:15%" />
            </colgroup>
            <thead><tr>
              <th>Cód.</th>
              <th>Insumo</th>
              <th>Un.</th>
              <th class="num">Cantidad</th>
              <th class="num">P.U.</th>
              <th class="num">Total</th>
              <th>Fecha necesidad</th>
            </tr></thead>
            <tbody>${lineRows}</tbody>
          </table>
        </div>
      `);
    }
    packagesHtml = `
      <section class="report-section">
        <h2 class="sec-title">Paquetes de contratación</h2>
        <p class="sec-help">
          Cantidades derivadas de la cuantificación de los artículos asociados (vía composición × insumo). P.U. y total en ${escHtml(cur)} usando precios de los insumos. Fecha de necesidad calculada como inicio de la semana del cronograma menos los días de anticipo del paquete; "—" cuando no aplica.
        </p>
        <div class="pkg-cards">${cards.join("\n")}</div>
        <div class="pkg-grand-total">
          <span>Total paquetes de contratación</span>
          <span class="num strong">${fm(grandTotal)} ${escHtml(cur)}</span>
        </div>
      </section>
    `;
  }

  // ── Sección: Cronograma (landscape) ──
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
    const headerRow = headerCols.map((h, i) => {
      const isWeek = i >= 5;
      return `<th class="${isWeek ? "wk" : ""}">${escHtml(h)}</th>`;
    }).join("");
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
      <section class="report-section schedule-section">
        <h2 class="sec-title">Cronograma — fecha de inicio ${escHtml(d.schedConfig.start_date)}</h2>
        <table class="report-table compact schedule">
          <thead><tr>${headerRow}</tr></thead>
          <tbody>${dataRows}</tbody>
        </table>
      </section>
    `;
  }

  // Logo block (cae a texto si el fetch falló)
  const logoBlock = logoDataUri
    ? `<img src="${logoDataUri}" alt="MasterPlan Connect" class="brand-logo" />`
    : `<span class="brand-text">MasterPlan Connect</span>`;

  // Logo del cliente (opcional, configurado en Settings)
  const clientLogoBlock = d.project.client_logo_data
    ? `<img src="${d.project.client_logo_data}" alt="${escHtml(d.project.client || "Cliente")}" class="client-logo" />`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Reporte presupuesto — ${escHtml(d.project.name)}</title>
<style>
  /* ── Reset & base ── */
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    margin: 0;
    padding: 16mm 12mm;
    color: #0A0A0A;
    font-size: 10px;
    line-height: 1.4;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1 { font-size: 20px; margin: 0; line-height: 1.2; font-weight: 700; letter-spacing: -0.01em; }

  /* ── Document header (1ra página) ── */
  .doc-header {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 18px;
    border-bottom: 1px solid #0A0A0A;
    padding-bottom: 12px;
    margin-bottom: 6px;
  }
  .doc-header.with-client-logo { grid-template-columns: auto 1fr auto; }
  .doc-header .brand-logo { height: 30px; display: block; }
  .doc-header .brand-text { font-weight: 700; font-size: 13px; color: #0A0A0A; letter-spacing: -0.01em; }
  .doc-header .client-logo {
    height: 36px;
    max-width: 180px;
    object-fit: contain;
    display: block;
  }
  .doc-header .doc-title-block {
    text-align: center;
    border-left: 1px solid #E5E5E5;
    border-right: 1px solid #E5E5E5;
    padding: 0 18px;
  }
  .doc-header .doc-title-block .label {
    font-size: 8.5px;
    text-transform: uppercase;
    color: #737373;
    letter-spacing: 0.08em;
    margin-bottom: 2px;
  }
  /* Meta-bar va debajo del header cuando hay logo del cliente, así no se
     pelea por espacio horizontal con el logo en el lado derecho */
  .doc-meta-bar {
    display: flex;
    justify-content: flex-end;
    gap: 18px;
    padding: 4px 0;
    margin-bottom: 12px;
    font-size: 9px;
    color: #737373;
    border-bottom: 1px solid #E5E5E5;
  }
  .doc-meta-bar .meta-item .meta-label {
    text-transform: uppercase;
    font-size: 8px;
    color: #A3A3A3;
    letter-spacing: 0.06em;
    margin-right: 4px;
  }

  /* ── Sección ── */
  .report-section { margin-top: 16px; }
  h2.sec-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #0A0A0A;
    margin: 0 0 10px;
    padding: 0 0 6px 0;
    border-bottom: 1.5px solid #0A0A0A;
    font-weight: 700;
    position: relative;
  }
  h2.sec-title::after {
    content: "";
    position: absolute;
    left: 0;
    bottom: -1.5px;
    width: 36px;
    height: 1.5px;
    background: #E87722;
  }
  .sec-help { font-size: 9px; color: #737373; margin: 0 0 10px; padding: 0; font-style: italic; }

  /* ── Report table base ── */
  table.report-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 9.5px;
  }
  table.report-table th {
    background: #0A0A0A;
    color: #FFFFFF;
    text-align: left;
    text-transform: uppercase;
    font-size: 8.5px;
    letter-spacing: 0.06em;
    padding: 7px 8px;
    font-weight: 600;
    border-right: 1px solid #2B2B2B;
  }
  table.report-table th:last-child { border-right: none; }
  table.report-table th.num { text-align: right; }
  table.report-table td {
    padding: 5px 8px;
    border-bottom: 1px solid #EFEFEF;
    vertical-align: top;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  table.report-table .num {
    text-align: right;
    font-family: "SF Mono", Menlo, Consolas, monospace;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow-wrap: normal;
    word-break: keep-all;
  }
  table.report-table .num.strong { font-weight: 700; }

  /* ── Hierarchy table ── */
  table.hierarchy tr.cat-row td {
    background: #F5F5F5;
    color: #0A0A0A;
    font-weight: 700;
    font-size: 11px;
    padding: 9px 10px 9px 14px;
    border-top: 1px solid #D4D4D4;
    border-bottom: 1px solid #D4D4D4;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  table.hierarchy tr.cat-row td:first-child {
    border-left: 3px solid #E87722;
  }
  table.hierarchy tr.cat-row td .cat-code {
    display: inline-block;
    color: #E87722;
    margin-right: 10px;
    font-family: "SF Mono", Menlo, monospace;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  table.hierarchy tr.cat-row td.num {
    color: #0A0A0A;
    font-weight: 700;
  }
  table.hierarchy tr.sub-row td {
    background: #FFFFFF;
    color: #0A0A0A;
    font-weight: 600;
    font-size: 10px;
    padding: 6px 10px 6px 22px;
    border-bottom: 1px solid #E5E5E5;
  }
  table.hierarchy tr.sub-row td .sub-code {
    display: inline-block;
    color: #E87722;
    margin-right: 8px;
    font-family: "SF Mono", Menlo, monospace;
    font-size: 9.5px;
    font-weight: 700;
  }
  table.hierarchy tr.sub-row td.num { color: #0A0A0A; font-weight: 700; }
  table.hierarchy tr.art-row td {
    background: #FAFAFA;
    color: #404040;
    font-size: 9.5px;
    padding: 4px 8px 4px 30px;
    border-bottom: 1px solid #F0F0F0;
  }
  table.hierarchy tr.art-row td.art-code {
    font-family: "SF Mono", Menlo, monospace;
    color: #737373;
    padding-left: 30px;
    font-size: 9px;
  }
  table.hierarchy tr.art-row td.art-desc { color: #1A1A1A; }
  table.hierarchy tr.art-row td.art-unit { color: #737373; text-transform: lowercase; font-size: 9px; font-style: italic; }
  table.hierarchy tr.grand-total td {
    background: #0A0A0A;
    color: #FFFFFF;
    font-weight: 700;
    font-size: 11px;
    padding: 10px 10px;
    border-top: 2px solid #0A0A0A;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  table.hierarchy tr.grand-total td.num {
    color: #E87722;
    font-size: 12px;
  }

  /* ── Composition cards ── */
  .art-cards, .pkg-cards { display: flex; flex-direction: column; gap: 10px; }
  .art-card {
    border: 1px solid #D4D4D4;
    border-radius: 4px;
    overflow: hidden;
    page-break-inside: avoid;
    break-inside: avoid;
    background: #FFFFFF;
  }
  .art-card-header {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    gap: 14px;
    align-items: baseline;
    padding: 9px 14px 9px 11px;
    background: #FAFAFA;
    border-left: 3px solid #E87722;
    border-bottom: 1px solid #E5E5E5;
  }
  .art-card-header .art-card-num {
    font-family: "SF Mono", Menlo, monospace;
    font-weight: 700;
    font-size: 10px;
    background: #0A0A0A;
    color: #FFFFFF;
    padding: 3px 9px;
    border-radius: 2px;
    letter-spacing: 0.04em;
  }
  .art-card-header .art-card-desc {
    font-size: 11px;
    font-weight: 700;
    color: #0A0A0A;
    line-height: 1.35;
  }
  .art-card-header .art-card-unit {
    font-size: 8.5px;
    color: #737373;
    text-transform: lowercase;
    font-style: italic;
  }
  .art-card-header .art-card-pu {
    font-family: "SF Mono", Menlo, monospace;
    font-weight: 700;
    font-size: 11.5px;
    color: #0A0A0A;
    background: #FFFFFF;
    padding: 4px 10px;
    border-radius: 2px;
    border: 1px solid #0A0A0A;
  }
  .art-card-header .art-card-pu .currency {
    color: #E87722;
    margin-left: 4px;
    font-weight: 600;
  }
  table.composition th {
    background: #404040;
    color: #FFFFFF;
    font-weight: 600;
    font-size: 8.5px;
    letter-spacing: 0.05em;
    padding: 5px 8px;
    border-right: 1px solid #5A5A5A;
  }
  table.composition th:last-child { border-right: none; }
  table.composition td {
    padding: 5px 8px;
    border-bottom: 1px solid #F0F0F0;
    font-size: 9.5px;
  }
  table.composition tr:last-child td { border-bottom: none; }
  table.composition tr.card-total td {
    background: #F5F5F5;
    font-weight: 700;
    font-size: 10px;
    color: #0A0A0A;
    padding: 6px 8px;
    border-top: 1.5px solid #0A0A0A;
  }
  table.composition tr.card-total td.num.strong { color: #E87722; }
  table.composition .ins-code { color: #737373; font-family: "SF Mono", Menlo, monospace; font-size: 9px; }
  table.composition .ins-desc { color: #1A1A1A; }
  table.composition .ins-unit { color: #737373; font-size: 9px; }

  /* ── Package cards ── */
  .pkg-card {
    border: 1px solid #D4D4D4;
    border-radius: 4px;
    overflow: hidden;
    page-break-inside: avoid;
    break-inside: avoid;
    background: #FFFFFF;
  }
  .pkg-card-header {
    display: flex;
    gap: 12px;
    align-items: baseline;
    padding: 9px 14px 9px 11px;
    background: #F5F5F5;
    border-left: 3px solid #737373;
    border-bottom: 1px solid #E5E5E5;
  }
  .pkg-card-header .pkg-card-name {
    font-weight: 700;
    flex: 1;
    font-size: 11px;
    color: #0A0A0A;
  }
  .pkg-card-header .pkg-card-meta {
    color: #737373;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .pkg-card-header .pkg-card-pu {
    font-family: "SF Mono", Menlo, monospace;
    font-weight: 700;
    font-size: 11px;
    color: #0A0A0A;
    background: #FFFFFF;
    padding: 3px 9px;
    border-radius: 2px;
    border: 1px solid #0A0A0A;
    white-space: nowrap;
  }
  .pkg-grand-total {
    margin-top: 8px;
    padding: 8px 14px;
    background: #0A0A0A;
    color: #FFFFFF;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  .pkg-grand-total .num {
    color: #E87722;
    font-family: "SF Mono", Menlo, monospace;
    font-size: 13px;
    white-space: nowrap;
  }

  /* ── Schedule (landscape) ── */
  .schedule-section { page: landscape-page; page-break-before: always; }
  table.schedule { table-layout: auto; font-size: 9px; }
  table.schedule th { padding: 5px 4px; font-size: 8.5px; }
  table.schedule td { padding: 3px 4px; font-size: 9px; border-bottom: 1px solid #EFEFEF; }
  table.schedule .wk { width: 16px; text-align: center; padding: 3px 0; }
  table.schedule .wk.on { color: #E87722; font-weight: 700; font-size: 11px; }

  .muted-italic { color: #737373; font-style: italic; }

  /* ── Print rules: page header + footer en cada página ── */
  @page {
    size: A4 portrait;
    margin: 22mm 12mm 18mm 12mm;
    @top-left {
      content: "MasterPlan Connect · ${escHtml(d.project.name)}";
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      font-size: 8pt;
      color: #737373;
    }
    @top-right {
      content: "${escHtml(today)}";
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      font-size: 8pt;
      color: #737373;
    }
    @bottom-left {
      content: "Reporte de presupuesto · Importes en ${escHtml(cur)}";
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      font-size: 8pt;
      color: #A3A3A3;
    }
    @bottom-right {
      content: "Página " counter(page) " de " counter(pages);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      font-size: 8pt;
      color: #A3A3A3;
    }
  }
  @page landscape-page {
    size: A4 landscape;
    margin: 18mm 12mm 16mm 12mm;
    @top-left {
      content: "MasterPlan Connect · ${escHtml(d.project.name)} · Cronograma";
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      font-size: 8pt;
      color: #737373;
    }
    @top-right {
      content: "${escHtml(today)}";
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      font-size: 8pt;
      color: #737373;
    }
    @bottom-right {
      content: "Página " counter(page) " de " counter(pages);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      font-size: 8pt;
      color: #A3A3A3;
    }
  }
  @media print {
    body { padding: 0; }
    h2.sec-title { page-break-after: avoid; break-after: avoid; }
    table.report-table tr { page-break-inside: avoid; break-inside: avoid; }
    .art-card, .pkg-card { page-break-inside: avoid; break-inside: avoid; }
    tr.cat-row { page-break-after: avoid; break-after: avoid; }
    tr.sub-row { page-break-after: avoid; break-after: avoid; }
  }
</style>
</head>
<body>
  <div class="doc-header${clientLogoBlock ? " with-client-logo" : ""}">
    <div class="brand">${logoBlock}</div>
    <div class="doc-title-block">
      <div class="label">Reporte de presupuesto</div>
      <h1>${escHtml(d.project.name)}</h1>
    </div>
    <div class="brand-right">${clientLogoBlock || `<span class="brand-text" style="color:#A3A3A3">${escHtml(d.project.client || "")}</span>`}</div>
  </div>
  <div class="doc-meta-bar">
    <span class="meta-item"><span class="meta-label">TC</span>${formatNumber(tc, 0)} ${escHtml(d.project.local_currency || "")}</span>
    <span class="meta-item"><span class="meta-label">Importes</span>${escHtml(cur)}</span>
    ${totalAreaM2 > 0 ? `<span class="meta-item"><span class="meta-label">Área</span>${formatNumber(totalAreaM2, 0)} m²</span>` : ""}
    <span class="meta-item"><span class="meta-label">Fecha</span>${escHtml(today)}</span>
  </div>
  ${hierarchyHtml}
  ${compositionHtml}
  ${packagesHtml}
  ${scheduleHtml}
  <script>
    window.addEventListener("load", () => { setTimeout(() => window.print(), 100); });
    window.addEventListener("afterprint", () => window.close());
  </script>
</body>
</html>`;
}
