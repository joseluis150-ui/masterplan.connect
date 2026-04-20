"use client";

import { useEffect, useState, useCallback, use, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { PACKAGE_STATUSES } from "@/lib/constants/units";
import { cn } from "@/lib/utils";
import type {
  ProcurementPackage,
  ProcurementLine,
  Insumo,
  Articulo,
  ArticuloComposition,
  EdtCategory,
  EdtSubcategory,
  PackageStatus,
  PurchaseType,
} from "@/lib/types/database";
import { Plus, Trash2, Truck, ChevronDown, ChevronRight, Pencil, Search, X, Filter, Package, CheckCircle2, ShoppingCart, Lock } from "lucide-react";
import { toast } from "sonner";
import { addWeeks, startOfWeek, format } from "date-fns";
import { es } from "date-fns/locale";
import { formatNumber } from "@/lib/utils/formula";
import { logActivity } from "@/lib/utils/activity-log";

/* ── Hierarchy interfaces ── */
interface InsumoRow {
  compositionId: string;
  insumoId: string;
  insumoCode: number;
  insumoDescription: string;
  insumoUnit: string;
  insumoType: string;
  // Cost data for budget calculation
  compQuantity: number;
  wastePct: number;
  marginPct: number;
  puUsd: number;
}

interface ArticuloGroup {
  id: string;
  number: number;
  description: string;
  unit: string;
  totalQlQuantity: number; // Sum of quantification_line quantities for this artículo
  insumos: InsumoRow[];
}

interface SubcategoryGroup {
  id: string;
  code: string;
  name: string;
  articulos: ArticuloGroup[];
}

interface CategoryGroup {
  id: string;
  code: string;
  name: string;
  subcategories: SubcategoryGroup[];
}

export default function PaquetesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [packages, setPackages] = useState<ProcurementPackage[]>([]);
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [scheduleStartDate, setScheduleStartDate] = useState<string | null>(null);
  // Map: compositionId → earliest week number (from schedule_weeks via quantification_lines)
  const [compEarliestWeek, setCompEarliestWeek] = useState<Map<string, number>>(new Map());

  // Collapse state
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [collapsedSubs, setCollapsedSubs] = useState<Set<string>>(new Set());
  const [collapsedArts, setCollapsedArts] = useState<Set<string>>(new Set());

  // Drag-to-paint
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState(true);
  const [dragPkgId, setDragPkgId] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState<Partial<ProcurementPackage> | null>(null);

  // Summary expanded packages
  const [expandedSummary, setExpandedSummary] = useState<Set<string>>(new Set());

  // Send SC confirmation dialog
  const [sendDialogPkg, setSendDialogPkg] = useState<ProcurementPackage | null>(null);
  const [sendingSC, setSendingSC] = useState(false);

  // Filter state
  const [selectedInsumoId, setSelectedInsumoId] = useState<string | null>(null);
  const [insumoSearchText, setInsumoSearchText] = useState("");
  const [insumoDropdownOpen, setInsumoDropdownOpen] = useState(false);
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [filterAssignment, setFilterAssignment] = useState<"all" | "unassigned" | string>("all");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Summary sort
  const [summarySort, setSummarySort] = useState<"created" | "amount_desc" | "amount_asc" | "date_asc" | "date_desc">("created");

  const supabase = createClient();

  /* ── Load data ── */
  const loadData = useCallback(async () => {
    // Round 1
    const [catsRes, subsRes, qlRes, artsRes, pkgsRes, schedConfigRes] = await Promise.all([
      supabase.from("edt_categories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("quantification_lines").select("*").eq("project_id", projectId).is("deleted_at", null).order("line_number"),
      supabase.from("articulos").select("*").eq("project_id", projectId).order("number"),
      supabase.from("procurement_packages").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.from("schedule_config").select("*").eq("project_id", projectId).single(),
    ]);

    if (schedConfigRes.data) {
      setScheduleStartDate(schedConfigRes.data.start_date);
    }

    const cats = (catsRes.data || []) as EdtCategory[];
    const subs = (subsRes.data || []) as EdtSubcategory[];
    const qLines = qlRes.data || [];
    const arts = (artsRes.data || []) as Articulo[];
    const pkgs = (pkgsRes.data || []) as ProcurementPackage[];

    // Round 2: compositions + procurement lines
    const artIds = arts.map((a) => a.id);
    const pkgIds = pkgs.map((p) => p.id);

    const [compsRes, plRes, schedWeeksRes] = await Promise.all([
      artIds.length > 0
        ? supabase.from("articulo_compositions").select("*, insumo:insumos(*)").in("articulo_id", artIds)
        : Promise.resolve({ data: [] }),
      pkgIds.length > 0
        ? supabase.from("procurement_lines").select("*").in("package_id", pkgIds)
        : Promise.resolve({ data: [] }),
      supabase.from("schedule_weeks").select("*").eq("active", true),
    ]);

    const comps = (compsRes.data || []) as (ArticuloComposition & { insumo: Insumo })[];
    const pLines = (plRes.data || []) as ProcurementLine[];
    const schedWeeks = (schedWeeksRes.data || []) as { quantification_line_id: string; week_number: number; active: boolean }[];

    // Build map: ql_line_id → earliest active week
    const qlEarliestWeek = new Map<string, number>();
    for (const sw of schedWeeks) {
      const lineIds = new Set(qLines.map((ql: { id: string }) => ql.id));
      if (!lineIds.has(sw.quantification_line_id)) continue;
      const existing = qlEarliestWeek.get(sw.quantification_line_id);
      if (existing === undefined || sw.week_number < existing) {
        qlEarliestWeek.set(sw.quantification_line_id, sw.week_number);
      }
    }

    // Build map: compositionId → earliest week (via articuloId → ql lines → earliest week)
    const compWeekMap = new Map<string, number>();

    // Build assignment map: "compositionId::packageId" → procurement_lines.id
    const assignMap = new Map<string, string>();
    for (const pl of pLines) {
      // Use composition_id if available, fall back to insumo_id for legacy rows
      const key = pl.composition_id
        ? `${pl.composition_id}::${pl.package_id}`
        : `${pl.insumo_id}::${pl.package_id}`;
      assignMap.set(key, pl.id);
    }

    // Build hierarchy: group quantification_lines by category → subcategory → articulo
    // Then attach insumos from articulo_compositions
    const catGroups: CategoryGroup[] = cats.map((cat) => {
      const catSubs = subs.filter((s) => s.category_id === cat.id);
      const subcategoryGroups: SubcategoryGroup[] = catSubs.map((sub) => {
        // Get unique articuloIds for this subcategory
        const subQLines = qLines.filter(
          (ql: { category_id: string; subcategory_id: string; articulo_id: string | null }) =>
            ql.category_id === cat.id && ql.subcategory_id === sub.id && ql.articulo_id
        );
        const articuloIdSet = new Set(subQLines.map((ql: { articulo_id: string }) => ql.articulo_id));

        const articuloGroups: ArticuloGroup[] = [];
        for (const artId of articuloIdSet) {
          const art = arts.find((a) => a.id === artId);
          if (!art) continue;
          const artComps = comps.filter((c) => c.articulo_id === artId);
          const insumoRows: InsumoRow[] = artComps
            .filter((c) => c.insumo)
            .map((c) => ({
              compositionId: c.id,
              insumoId: c.insumo_id,
              insumoCode: c.insumo!.code,
              insumoDescription: c.insumo!.description,
              insumoUnit: c.insumo!.unit,
              insumoType: c.insumo!.type,
              compQuantity: Number(c.quantity) || 0,
              wastePct: Number(c.waste_pct) || 0,
              marginPct: Number(c.margin_pct) || 0,
              puUsd: Number(c.insumo!.pu_usd) || 0,
            }));
          // Sum ql quantities for this artículo in this subcategory
          const artQLines = subQLines.filter((ql: { articulo_id: string }) => ql.articulo_id === artId);
          const qlQty = artQLines
            .reduce((sum: number, ql: { quantity: number | null }) => sum + (Number(ql.quantity) || 0), 0);
          // Find earliest week for compositions of this artículo
          let artEarliestWeek: number | undefined;
          for (const ql of artQLines) {
            const w = qlEarliestWeek.get((ql as { id: string }).id);
            if (w !== undefined && (artEarliestWeek === undefined || w < artEarliestWeek)) {
              artEarliestWeek = w;
            }
          }
          if (artEarliestWeek !== undefined) {
            for (const c of artComps) {
              compWeekMap.set(c.id, artEarliestWeek);
            }
          }
          if (insumoRows.length > 0) {
            articuloGroups.push({
              id: art.id,
              number: art.number,
              description: art.description,
              unit: art.unit,
              totalQlQuantity: qlQty,
              insumos: insumoRows,
            });
          }
        }

        return {
          id: sub.id,
          code: sub.code,
          name: sub.name,
          articulos: articuloGroups,
        };
      }).filter((sg) => sg.articulos.length > 0);

      return {
        id: cat.id,
        code: cat.code,
        name: cat.name,
        subcategories: subcategoryGroups,
      };
    }).filter((cg) => cg.subcategories.length > 0);

    setGroups(catGroups);
    setPackages(pkgs);
    setAssignments(assignMap);
    setCompEarliestWeek(compWeekMap);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── Assignment lookup: compositionId → packageId (if assigned to any package) ── */
  const compAssignedTo = new Map<string, string>();
  for (const [key] of assignments) {
    const [compId, pkgId] = key.split("::");
    compAssignedTo.set(compId, pkgId);
  }

  /* ── Toggle assignment ── */
  async function toggleAssignment(compositionId: string, insumoId: string, packageId: string, forceValue?: boolean) {
    // Block editing on approved packages
    const pkg = packages.find((p) => p.id === packageId);
    if (pkg?.status === "aprobado") return;

    const key = `${compositionId}::${packageId}`;
    const existingId = assignments.get(key);
    const shouldAssign = forceValue !== undefined ? forceValue : !existingId;

    if (shouldAssign && !existingId) {
      // Check if already assigned to another package
      const existingPkgId = compAssignedTo.get(compositionId);
      if (existingPkgId && existingPkgId !== packageId) {
        const existingPkg = packages.find((p) => p.id === existingPkgId);
        toast.error(`Este insumo ya está asignado al paquete "${existingPkg?.name || "otro"}"`);
        return;
      }
      const { data } = await supabase
        .from("procurement_lines")
        .insert({ package_id: packageId, insumo_id: insumoId, composition_id: compositionId, quantity: 0 })
        .select()
        .single();
      if (data) {
        assignments.set(key, data.id);
        setAssignments(new Map(assignments));
      }
    } else if (!shouldAssign && existingId) {
      await supabase.from("procurement_lines").delete().eq("id", existingId);
      assignments.delete(key);
      setAssignments(new Map(assignments));
    }
  }

  /* ── Drag handlers ── */
  function handleMouseDown(compositionId: string, insumoId: string, packageId: string) {
    const pkg = packages.find((p) => p.id === packageId);
    if (pkg?.status === "aprobado") return;
    const key = `${compositionId}::${packageId}`;
    const newValue = !assignments.has(key);
    setIsDragging(true);
    setDragValue(newValue);
    setDragPkgId(packageId);
    toggleAssignment(compositionId, insumoId, packageId, newValue);
  }

  function handleMouseEnter(compositionId: string, insumoId: string, packageId: string) {
    if (!isDragging) return;
    toggleAssignment(compositionId, insumoId, packageId, dragValue);
  }

  function handleMouseUp() {
    setIsDragging(false);
    setDragPkgId(null);
  }

  /* ── Collapse helpers ── */
  function toggleCat(catId: string) {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  }

  function toggleSub(subId: string) {
    setCollapsedSubs((prev) => {
      const next = new Set(prev);
      if (next.has(subId)) next.delete(subId); else next.add(subId);
      return next;
    });
  }

  function toggleArt(artId: string) {
    setCollapsedArts((prev) => {
      const next = new Set(prev);
      if (next.has(artId)) next.delete(artId); else next.add(artId);
      return next;
    });
  }

  function expandAll() {
    setCollapsedCats(new Set());
    setCollapsedSubs(new Set());
    setCollapsedArts(new Set());
  }

  function collapseAll() {
    setCollapsedCats(new Set(groups.map((g) => g.id)));
  }

  /* ── Package CRUD ── */
  function openNewPackage() {
    setEditingPkg({
      name: "",
      purchase_type: "directa" as PurchaseType,
      advance_days: 7,
      suggested_supplier: "",
      awarded_supplier: "",
    });
    setDialogOpen(true);
  }

  function openEditPackage(pkg: ProcurementPackage) {
    if (pkg.status === "aprobado") return; // Approved packages are read-only
    setEditingPkg({ ...pkg });
    setDialogOpen(true);
  }

  async function savePackage() {
    if (!editingPkg) return;
    const record: Record<string, unknown> = {
      project_id: projectId,
      name: editingPkg.name || "",
      purchase_type: editingPkg.purchase_type || "directa",
      advance_days: Number(editingPkg.advance_days) || 0,
      suggested_supplier: editingPkg.suggested_supplier || null,
      awarded_supplier: editingPkg.awarded_supplier || null,
    };
    if (editingPkg.id) {
      // Include status on update
      record.status = editingPkg.status || "borrador";

      // Detect if status is changing TO "aprobado"
      const oldPkg = packages.find((p) => p.id === editingPkg.id);
      const isApproving = oldPkg && oldPkg.status !== "aprobado" && editingPkg.status === "aprobado";

      await supabase.from("procurement_packages").update(record).eq("id", editingPkg.id);

      // Auto-create SC when approving
      if (isApproving) {
        await createSCFromPackage(editingPkg.id, editingPkg.name || "");
      }

      toast.success("Paquete actualizado");
    } else {
      await supabase.from("procurement_packages").insert(record);
      toast.success("Paquete creado");
    }
    setDialogOpen(false);
    loadData();
  }

  /** Create a Solicitud de Compra from an approved package's procurement_lines */
  async function createSCFromPackage(packageId: string, packageName: string) {
    try {
      // Guard: check if SC already exists for this package
      const { data: existing } = await supabase
        .from("purchase_requests")
        .select("id")
        .eq("package_id", packageId)
        .limit(1);
      if (existing && existing.length > 0) {
        toast.info("Ya existe una solicitud para este paquete");
        return;
      }

      // Build aggregated lines using the hierarchy data we already have in memory.
      // For each procurement_line (composition assignment), compute real quantity
      // from quantification: sum( ql_qty * comp_qty * (1 + waste%/100) ) grouped by insumo+subcategory
      type AggKey = string; // `${insumoId}::${subId}`
      const aggMap = new Map<AggKey, { description: string; unit: string; subcategoryId: string | null; totalQty: number }>();

      for (const cat of groups) {
        for (const sub of cat.subcategories) {
          for (const art of sub.articulos) {
            for (const ins of art.insumos) {
              const key = `${ins.compositionId}::${packageId}`;
              if (!assignments.has(key)) continue;
              // This insumo/composition is assigned to this package
              const realQty = art.totalQlQuantity * ins.compQuantity * (1 + ins.wastePct / 100);
              const aggKey = `${ins.insumoId}::${sub.id}`;
              const prev = aggMap.get(aggKey);
              if (prev) {
                prev.totalQty += realQty;
              } else {
                aggMap.set(aggKey, {
                  description: ins.insumoDescription,
                  unit: ins.insumoUnit,
                  subcategoryId: sub.id,
                  totalQty: realQty,
                });
              }
            }
          }
        }
      }

      if (aggMap.size === 0) {
        toast.info("Paquete aprobado sin insumos asignados — no se creó solicitud");
        return;
      }

      // Get next SC number
      const { data: numData } = await supabase.rpc("next_document_number", {
        p_project_id: projectId,
        p_doc_type: "SC",
      });
      const number = numData || `SC-${new Date().getFullYear()}-???`;

      // Create SC
      const { data: sc, error: scErr } = await supabase
        .from("purchase_requests")
        .insert({
          project_id: projectId,
          number,
          origin: "package",
          package_id: packageId,
          status: "pending",
          comment: `Desde paquete aprobado: ${packageName}`,
        })
        .select()
        .single();

      if (scErr || !sc) {
        toast.error("Error al crear solicitud desde paquete");
        return;
      }

      // Create SC lines from aggregated data
      const lines = Array.from(aggMap.values()).map((agg) => ({
        request_id: sc.id,
        subcategory_id: agg.subcategoryId,
        description: agg.description,
        quantity: Math.round(agg.totalQty * 100) / 100,
        unit: agg.unit,
      }));

      const { error: linesErr } = await supabase.from("purchase_request_lines").insert(lines);
      if (linesErr) {
        toast.error("SC creada pero error al insertar líneas");
        return;
      }
      toast.success(`Solicitud ${number} creada en Compras con ${lines.length} línea(s)`);
      return { scId: sc.id as string, scNumber: number as string, lineCount: lines.length };
    } catch {
      toast.error("Error al generar solicitud de compra");
    }
  }

  async function deletePackage() {
    if (!editingPkg?.id) return;
    if (!confirm("¿Eliminar este paquete y todas sus asignaciones?")) return;
    await supabase.from("procurement_lines").delete().eq("package_id", editingPkg.id);
    await supabase.from("procurement_packages").delete().eq("id", editingPkg.id);
    toast.success("Paquete eliminado");
    setDialogOpen(false);
    loadData();
  }

  /* ── Summary helpers ── */
  function hasAnyAssignment(compIds: Set<string>, packageId: string): boolean {
    for (const cid of compIds) {
      if (assignments.has(`${cid}::${packageId}`)) return true;
    }
    return false;
  }

  function countAssignments(compIds: Set<string>, packageId: string): number {
    let count = 0;
    for (const cid of compIds) {
      if (assignments.has(`${cid}::${packageId}`)) count++;
    }
    return count;
  }

  // Collect all compositionIds for a category
  function getCatCompIds(cat: CategoryGroup): Set<string> {
    const ids = new Set<string>();
    for (const sub of cat.subcategories) {
      for (const art of sub.articulos) {
        for (const ins of art.insumos) ids.add(ins.compositionId);
      }
    }
    return ids;
  }

  // Collect all compositionIds for a subcategory
  function getSubCompIds(sub: SubcategoryGroup): Set<string> {
    const ids = new Set<string>();
    for (const art of sub.articulos) {
      for (const ins of art.insumos) ids.add(ins.compositionId);
    }
    return ids;
  }

  // Collect all compositionIds for an articulo
  function getArtCompIds(art: ArticuloGroup): Set<string> {
    return new Set(art.insumos.map((i) => i.compositionId));
  }

  // Convert week number to date string
  function weekToDate(weekNum: number): string {
    if (!scheduleStartDate) return `Semana ${weekNum + 1}`;
    const weekStart = addWeeks(startOfWeek(new Date(scheduleStartDate), { weekStartsOn: 1 }), weekNum);
    return format(weekStart, "dd/MM/yyyy", { locale: es });
  }

  // Build summary data for each package
  interface SummaryLine {
    compositionId: string;
    insumoCode: number;
    insumoDescription: string;
    insumoUnit: string;
    insumoType: string;
    catCode: string;
    catName: string;
    subCode: string;
    subName: string;
    artNumber: number;
    artDescription: string;
    qlQuantity: number;
    unitCost: number;
    totalCost: number;
    needDate: string;
  }

  function getPackageSummaryLines(packageId: string): SummaryLine[] {
    const lines: SummaryLine[] = [];
    for (const cat of groups) {
      for (const sub of cat.subcategories) {
        for (const art of sub.articulos) {
          for (const ins of art.insumos) {
            if (!assignments.has(`${ins.compositionId}::${packageId}`)) continue;
            const unitCost = ins.compQuantity * (1 + ins.wastePct / 100) * ins.puUsd * (1 + ins.marginPct / 100);
            const weekNum = compEarliestWeek.get(ins.compositionId);
            lines.push({
              compositionId: ins.compositionId,
              insumoCode: ins.insumoCode,
              insumoDescription: ins.insumoDescription,
              insumoUnit: ins.insumoUnit,
              insumoType: ins.insumoType,
              catCode: cat.code,
              catName: cat.name,
              subCode: sub.code,
              subName: sub.name,
              artNumber: art.number,
              artDescription: art.description,
              qlQuantity: art.totalQlQuantity,
              unitCost,
              totalCost: unitCost * art.totalQlQuantity,
              needDate: weekNum !== undefined ? weekToDate(weekNum) : "—",
            });
          }
        }
      }
    }
    return lines;
  }

  // Get earliest week number for a package (for sorting by date)
  function getPackageEarliestWeek(packageId: string): number {
    let earliest = Infinity;
    for (const [key] of assignments) {
      const [compId, pkgId] = key.split("::");
      if (pkgId !== packageId) continue;
      const w = compEarliestWeek.get(compId);
      if (w !== undefined && w < earliest) earliest = w;
    }
    return earliest === Infinity ? 9999 : earliest;
  }

  /* ── Package budget totals ── */
  // Build a lookup: compositionId → { insRow, qlQty } for fast total calculation
  const compCostLookup = new Map<string, { ins: InsumoRow; qlQty: number }>();
  for (const cat of groups) {
    for (const sub of cat.subcategories) {
      for (const art of sub.articulos) {
        for (const ins of art.insumos) {
          compCostLookup.set(ins.compositionId, { ins, qlQty: art.totalQlQuantity });
        }
      }
    }
  }

  function getPackageTotal(packageId: string): number {
    let total = 0;
    for (const [key] of assignments) {
      const [compId, pkgId] = key.split("::");
      if (pkgId !== packageId) continue;
      const data = compCostLookup.get(compId);
      if (!data) continue;
      const { ins, qlQty } = data;
      // insumo cost per artículo unit = compQty × (1 + waste/100) × puUsd × (1 + margin/100)
      const unitCost = ins.compQuantity * (1 + ins.wastePct / 100) * ins.puUsd * (1 + ins.marginPct / 100);
      total += unitCost * qlQty;
    }
    return total;
  }

  function formatUsdInt(value: number): string {
    return Math.round(value).toLocaleString("en-US");
  }

  // Sorted packages for summary panel (must be after getPackageTotal & compCostLookup)
  const sortedSummaryPackages = [...packages].sort((a, b) => {
    if (summarySort === "amount_desc") {
      return getPackageTotal(b.id) - getPackageTotal(a.id);
    }
    if (summarySort === "amount_asc") {
      return getPackageTotal(a.id) - getPackageTotal(b.id);
    }
    if (summarySort === "date_asc") {
      return getPackageEarliestWeek(a.id) - getPackageEarliestWeek(b.id);
    }
    if (summarySort === "date_desc") {
      return getPackageEarliestWeek(b.id) - getPackageEarliestWeek(a.id);
    }
    return 0;
  });

  const statusLabel = (status: string) =>
    PACKAGE_STATUSES.find((s) => s.value === status)?.label || status;

  /** Handle "Enviar solicitud de compra" confirmation */
  async function confirmSendSC() {
    if (!sendDialogPkg) return;
    setSendingSC(true);
    try {
      // 1. Mark package as approved
      const { error: updErr } = await supabase
        .from("procurement_packages")
        .update({ status: "aprobado" })
        .eq("id", sendDialogPkg.id);

      if (updErr) {
        toast.error("Error al aprobar el paquete");
        return;
      }

      // 2. Generate SC with all package lines
      const scResult = await createSCFromPackage(sendDialogPkg.id, sendDialogPkg.name);

      await logActivity({
        projectId,
        actionType: "package_approved",
        entityType: "procurement_package",
        entityId: sendDialogPkg.id,
        description: `Paquete "${sendDialogPkg.name}" aprobado${scResult ? ` → SC ${scResult.scNumber}` : ""}`,
        metadata: {
          packageId: sendDialogPkg.id,
          packageName: sendDialogPkg.name,
          createdScId: scResult?.scId,
        },
      });

      setSendDialogPkg(null);
      loadData();
    } finally {
      setSendingSC(false);
    }
  }

  const sendSCButton = (pkg: ProcurementPackage, disabled = false) => {
    if (pkg.status === "aprobado") {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
          <CheckCircle2 className="h-3 w-3" />
          Enviado a Compras
        </span>
      );
    }
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-[11px] font-medium"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setSendDialogPkg(pkg);
        }}
      >
        <ShoppingCart className="h-3 w-3 mr-1" />
        Enviar solicitud
      </Button>
    );
  };

  /* ── Filter logic ── */
  const hasActiveFilter = selectedInsumoId !== null || filterTypes.size > 0 || filterAssignment !== "all";

  // Build unique insumos list (by insumoId) for the dropdown
  const uniqueInsumosMap = new Map<string, InsumoRow>();
  for (const cat of groups) {
    for (const sub of cat.subcategories) {
      for (const art of sub.articulos) {
        for (const ins of art.insumos) {
          if (!uniqueInsumosMap.has(ins.insumoId)) {
            uniqueInsumosMap.set(ins.insumoId, ins);
          }
        }
      }
    }
  }

  // An insumo is "fully assigned" if ALL its compositions are assigned to some package
  const allCompositionsForInsumo = new Map<string, string[]>();
  for (const cat of groups) {
    for (const sub of cat.subcategories) {
      for (const art of sub.articulos) {
        for (const ins of art.insumos) {
          const list = allCompositionsForInsumo.get(ins.insumoId) || [];
          list.push(ins.compositionId);
          allCompositionsForInsumo.set(ins.insumoId, list);
        }
      }
    }
  }

  const unassignedInsumos = Array.from(uniqueInsumosMap.values())
    .filter((ins) => {
      // Show in dropdown if at least one composition of this insumo is unassigned
      const compIds = allCompositionsForInsumo.get(ins.insumoId) || [];
      return compIds.some((cid) => !packages.some((pkg) => assignments.has(`${cid}::${pkg.id}`)));
    })
    .sort((a, b) => a.insumoDescription.localeCompare(b.insumoDescription, "es"));

  const dropdownFilteredInsumos = insumoSearchText.length > 0
    ? unassignedInsumos.filter((ins) => {
        const q = insumoSearchText.toLowerCase();
        return ins.insumoDescription.toLowerCase().includes(q) || String(ins.insumoCode).includes(q);
      })
    : unassignedInsumos;

  // Close dropdown on click outside
  useEffect(() => {
    if (!insumoDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setInsumoDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [insumoDropdownOpen]);

  // selectedInsumoId is a real insumoId — filters all compositions of that insumo
  const selectedInsumoLabel = selectedInsumoId
    ? uniqueInsumosMap.get(selectedInsumoId)?.insumoDescription || "Insumo"
    : null;

  function matchesFilter(ins: InsumoRow): boolean {
    // Selected insumo filter — show ALL compositions of that insumo across all artículos
    if (selectedInsumoId !== null) {
      if (ins.insumoId !== selectedInsumoId) return false;
    }
    // Type filter
    if (filterTypes.size > 0 && !filterTypes.has(ins.insumoType)) {
      return false;
    }
    // Assignment filter
    if (filterAssignment === "unassigned") {
      const isAssignedToAny = packages.some((pkg) => assignments.has(`${ins.compositionId}::${pkg.id}`));
      if (isAssignedToAny) return false;
    } else if (filterAssignment !== "all") {
      if (!assignments.has(`${ins.compositionId}::${filterAssignment}`)) return false;
    }
    return true;
  }

  // Build filtered groups (hide empty branches)
  const filteredGroups: CategoryGroup[] = hasActiveFilter
    ? groups.map((cat) => ({
        ...cat,
        subcategories: cat.subcategories.map((sub) => ({
          ...sub,
          articulos: sub.articulos.map((art) => ({
            ...art,
            insumos: art.insumos.filter(matchesFilter),
          })).filter((art) => art.insumos.length > 0),
        })).filter((sub) => sub.articulos.length > 0),
      })).filter((cat) => cat.subcategories.length > 0)
    : groups;

  function toggleFilterType(type: string) {
    setFilterTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  function clearFilters() {
    setSelectedInsumoId(null);
    setInsumoSearchText("");
    setInsumoDropdownOpen(false);
    setFilterTypes(new Set());
    setFilterAssignment("all");
  }

  // Collect unique insumo types from all groups
  const allInsumoTypes = new Set<string>();
  for (const cat of groups) {
    for (const sub of cat.subcategories) {
      for (const art of sub.articulos) {
        for (const ins of art.insumos) allInsumoTypes.add(ins.insumoType);
      }
    }
  }

  const typeLabels: Record<string, string> = {
    material: "Material",
    mano_de_obra: "Mano de obra",
    servicio: "Servicio",
    global: "Global",
  };

  const typeColors: Record<string, string> = {
    material: "bg-amber-100 text-amber-700 border-amber-300",
    mano_de_obra: "bg-amber-100 text-amber-700 border-amber-300",
    servicio: "bg-emerald-100 text-emerald-700 border-emerald-300",
    global: "bg-gray-100 text-gray-700 border-gray-300",
  };

  const totalInsumos = groups.reduce(
    (sum, cat) => sum + cat.subcategories.reduce(
      (s2, sub) => s2 + sub.articulos.reduce(
        (s3, art) => s3 + art.insumos.length, 0
      ), 0
    ), 0
  );

  const filteredInsumoCount = filteredGroups.reduce(
    (sum, cat) => sum + cat.subcategories.reduce(
      (s2, sub) => s2 + sub.articulos.reduce(
        (s3, art) => s3 + art.insumos.length, 0
      ), 0
    ), 0
  );

  if (loading) return <div className="animate-pulse h-96 bg-muted rounded-lg" />;

  return (
    <div className="space-y-6" onMouseUp={handleMouseUp}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Paquetes de Contratación</h1>
          <p className="text-muted-foreground">Paso 8: Agrupa insumos para gestión de compras</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={expandAll}>Expandir todo</Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>Colapsar todo</Button>
          <Button size="sm" onClick={openNewPackage}>
            <Plus className="h-4 w-4 mr-1" /> Nuevo Paquete
          </Button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      {totalInsumos > 0 && (
        <div className="flex flex-wrap items-center gap-3 px-1">
          {/* Insumo dropdown search */}
          <div className="relative" ref={dropdownRef}>
            {selectedInsumoId ? (
              <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-[#E87722]/30 bg-[#EFF6FF] text-xs max-w-72">
                <Search className="h-3.5 w-3.5 text-[#E87722] shrink-0" />
                <span className="truncate text-[#E87722] font-medium">{selectedInsumoLabel}</span>
                <button
                  type="button"
                  onClick={() => { setSelectedInsumoId(null); setInsumoSearchText(""); }}
                  className="shrink-0 ml-auto"
                >
                  <X className="h-3.5 w-3.5 text-[#E87722] hover:text-[#E87722]/70" />
                </button>
              </div>
            ) : (
              <>
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  value={insumoSearchText}
                  onChange={(e) => { setInsumoSearchText(e.target.value); setInsumoDropdownOpen(true); }}
                  onFocus={() => setInsumoDropdownOpen(true)}
                  placeholder={`Buscar insumo sin asignar (${unassignedInsumos.length})...`}
                  className="h-8 w-72 pl-8 text-xs"
                />
                {insumoSearchText && (
                  <button
                    type="button"
                    onClick={() => { setInsumoSearchText(""); searchInputRef.current?.focus(); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
              </>
            )}
            {/* Dropdown list */}
            {insumoDropdownOpen && !selectedInsumoId && (
              <div
                className="absolute top-full left-0 mt-1 w-80 bg-background border rounded-md shadow-xl overflow-hidden"
                style={{ zIndex: 50, borderColor: "#E5E5E5" }}
              >
                <div className="overflow-y-auto" style={{ maxHeight: 280 }}>
                  {dropdownFilteredInsumos.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-center text-muted-foreground">
                      {unassignedInsumos.length === 0
                        ? "Todos los insumos están asignados"
                        : "Sin resultados"}
                    </div>
                  ) : (
                    dropdownFilteredInsumos.map((ins) => (
                      <button
                        key={ins.insumoId}
                        type="button"
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[#F5F5F5] transition-colors text-left cursor-pointer"
                        onClick={() => {
                          setSelectedInsumoId(ins.insumoId);
                          setInsumoSearchText("");
                          setInsumoDropdownOpen(false);
                        }}
                      >
                        <span
                          className={cn(
                            "w-1.5 h-1.5 rounded-full shrink-0",
                            ins.insumoType === "material" ? "bg-neutral-700" :
                            ins.insumoType === "mano_de_obra" ? "bg-amber-400" :
                            ins.insumoType === "servicio" ? "bg-emerald-400" :
                            "bg-gray-400"
                          )}
                        />
                        <span className="truncate flex-1">{ins.insumoDescription}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{ins.insumoUnit}</span>
                      </button>
                    ))
                  )}
                </div>
                {dropdownFilteredInsumos.length > 0 && (
                  <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground" style={{ borderColor: "#E5E5E5" }}>
                    {dropdownFilteredInsumos.length} insumos sin asignar
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Type chips */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground font-medium">Tipo:</span>
            {Array.from(allInsumoTypes).sort().map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleFilterType(type)}
                className={cn(
                  "text-[11px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer",
                  filterTypes.has(type)
                    ? typeColors[type] || "bg-gray-100 text-gray-700 border-gray-300"
                    : "bg-background text-muted-foreground border-border hover:bg-muted/50"
                )}
              >
                {typeLabels[type] || type}
              </button>
            ))}
          </div>

          {/* Assignment filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground font-medium">Asignación:</span>
            <select
              value={filterAssignment}
              onChange={(e) => setFilterAssignment(e.target.value)}
              className="h-7 text-[11px] rounded-md border border-border bg-background px-2 cursor-pointer"
            >
              <option value="all">Todos</option>
              <option value="unassigned">Sin asignar</option>
              {packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>En: {pkg.name}</option>
              ))}
            </select>
          </div>

          {/* Counter + clear */}
          {hasActiveFilter && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[11px] text-muted-foreground">
                {filteredInsumoCount} de {totalInsumos} insumos
              </span>
              <button
                type="button"
                onClick={clearFilters}
                className="text-[11px] text-destructive hover:underline font-medium flex items-center gap-1 cursor-pointer"
              >
                <X className="h-3 w-3" />
                Limpiar filtros
              </button>
            </div>
          )}
        </div>
      )}

      {totalInsumos === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Truck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Sin insumos</h3>
            <p className="text-muted-foreground">Agrega artículos con insumos en la cuantificación primero</p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
            <div className="min-w-max select-none">

              {/* ── Header ── */}
              <div className="flex border-b sticky top-0 z-20" style={{ background: "#F5F5F5" }}>
                <div
                  className="w-96 shrink-0 px-3 py-2 border-r font-semibold text-xs uppercase tracking-wider sticky left-0 z-30"
                  style={{ background: "#F5F5F5" }}
                >
                  EDT / Insumos
                </div>
                {/* Add column button — always next to EDT */}
                <div
                  className="w-10 shrink-0 flex items-center justify-center cursor-pointer hover:bg-muted/50 border-r transition-colors sticky z-25"
                  style={{ left: "24rem", background: "#F5F5F5" }}
                  onClick={openNewPackage}
                  title="Agregar paquete"
                >
                  <Plus className="h-4 w-4 text-muted-foreground" />
                </div>
                {packages.map((pkg) => {
                  const pkgTotal = getPackageTotal(pkg.id);
                  const isApproved = pkg.status === "aprobado";
                  return (
                    <div
                      key={pkg.id}
                      className={cn(
                        "w-28 shrink-0 border-r px-1.5 py-1 transition-colors",
                        isApproved
                          ? "opacity-60 cursor-default"
                          : "cursor-pointer hover:bg-muted/50"
                      )}
                      onClick={() => openEditPackage(pkg)}
                      title={isApproved
                        ? `${pkg.name} — Aprobado (bloqueado)\n$${formatUsdInt(pkgTotal)} USD`
                        : `${pkg.name} — ${statusLabel(pkg.status)}\n$${formatUsdInt(pkgTotal)} USD\nClick para editar`
                      }
                    >
                      <div className="text-[10px] font-semibold truncate leading-tight">{pkg.name}</div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span
                          className={cn(
                            "text-[9px] font-bold px-1 rounded",
                            pkg.purchase_type === "licitacion"
                              ? "bg-[#E87722]/10 text-[#E87722]"
                              : "bg-emerald-100 text-emerald-700"
                          )}
                        >
                          {pkg.purchase_type === "licitacion" ? "LIC" : "CD"}
                        </span>
                        {isApproved ? (
                          <span className="text-[9px] text-emerald-600 font-medium flex items-center gap-0.5 truncate">
                            <Lock className="h-2.5 w-2.5 shrink-0" />Aprobado
                          </span>
                        ) : (
                          <span className="text-[9px] text-muted-foreground truncate">
                            {statusLabel(pkg.status)}
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] font-mono font-semibold text-[#E87722] mt-0.5 truncate">
                        ${formatUsdInt(pkgTotal)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ── No results message ── */}
              {hasActiveFilter && filteredGroups.length === 0 && (
                <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                  No hay insumos que coincidan con los filtros aplicados
                </div>
              )}

              {/* ── Groups ── */}
              {filteredGroups.map((cat) => {
                const catCollapsed = hasActiveFilter ? false : collapsedCats.has(cat.id);
                const catCompIds = getCatCompIds(cat);

                return (
                  <div key={cat.id}>
                    {/* Category row */}
                    <div
                      className="flex border-b cursor-pointer hover:bg-muted/30"
                      style={{ background: "#E8EDF5" }}
                      onClick={() => toggleCat(cat.id)}
                    >
                      <div
                        className="w-96 shrink-0 px-3 py-1.5 border-r flex items-center gap-2 sticky left-0 z-10"
                        style={{ background: "#E8EDF5" }}
                      >
                        {catCollapsed
                          ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        }
                        <span className="font-mono text-xs font-bold" style={{ color: "#E87722" }}>{cat.code}</span>
                        <span className="text-sm font-semibold truncate">{cat.name}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                          {catCompIds.size} ins.
                        </span>
                      </div>
                      <div className="w-10 shrink-0 border-r sticky z-10" style={{ left: "24rem", background: "#E8EDF5" }} />
                      {packages.map((pkg) => (
                        <div
                          key={pkg.id}
                          className={cn(
                            "w-28 shrink-0 border-r flex items-center justify-center",
                            hasAnyAssignment(catCompIds, pkg.id) && "bg-[#E87722]/15"
                          )}
                          style={{ height: 32 }}
                        >
                          {hasAnyAssignment(catCompIds, pkg.id) && (
                            <span className="text-[9px] font-mono text-[#E87722]/70">
                              {countAssignments(catCompIds, pkg.id)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Subcategories */}
                    {!catCollapsed && cat.subcategories.map((sub) => {
                      const subCollapsed = hasActiveFilter ? false : collapsedSubs.has(sub.id);
                      const subCompIds = getSubCompIds(sub);

                      return (
                        <div key={sub.id}>
                          {/* Subcategory row */}
                          <div
                            className="flex border-b cursor-pointer hover:bg-muted/20"
                            style={{ background: "#F3F4F6" }}
                            onClick={() => toggleSub(sub.id)}
                          >
                            <div
                              className="w-96 shrink-0 px-3 py-1 border-r flex items-center gap-2 pl-8 sticky left-0 z-10"
                              style={{ background: "#F3F4F6" }}
                            >
                              {subCollapsed
                                ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              }
                              <span className="font-mono text-[11px] font-medium text-muted-foreground">{sub.code}</span>
                              <span className="text-xs font-medium truncate">{sub.name}</span>
                              <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                                {subCompIds.size}
                              </span>
                            </div>
                            <div className="w-10 shrink-0 border-r sticky z-10" style={{ left: "24rem", background: "#F3F4F6" }} />
                            {packages.map((pkg) => (
                              <div
                                key={pkg.id}
                                className={cn(
                                  "w-28 shrink-0 border-r flex items-center justify-center",
                                  hasAnyAssignment(subCompIds, pkg.id) && "bg-[#E87722]/10"
                                )}
                                style={{ height: 28 }}
                              >
                                {hasAnyAssignment(subCompIds, pkg.id) && (
                                  <span className="text-[9px] font-mono text-[#E87722]/50">
                                    {countAssignments(subCompIds, pkg.id)}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>

                          {/* Articulos */}
                          {!subCollapsed && sub.articulos.map((art) => {
                            const artCollapsed = hasActiveFilter ? false : collapsedArts.has(art.id);
                            const artCompIds = getArtCompIds(art);

                            return (
                              <div key={art.id}>
                                {/* Articulo row */}
                                <div
                                  className="flex border-b cursor-pointer hover:bg-muted/10"
                                  style={{ background: "#F9FAFB" }}
                                  onClick={() => toggleArt(art.id)}
                                >
                                  <div
                                    className="w-96 shrink-0 px-3 py-1 border-r flex items-center gap-2 pl-12 sticky left-0 z-10"
                                    style={{ background: "#F9FAFB" }}
                                  >
                                    {artCollapsed
                                      ? <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                      : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                                    }
                                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">#{art.number}</span>
                                    <span className="text-xs truncate" title={art.description}>{art.description}</span>
                                    <span className="text-[10px] text-muted-foreground shrink-0">{art.unit}</span>
                                    <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                                      {art.insumos.length}
                                    </span>
                                  </div>
                                  <div className="w-10 shrink-0 border-r sticky z-10" style={{ left: "24rem", background: "#F9FAFB" }} />
                                  {packages.map((pkg) => (
                                    <div
                                      key={pkg.id}
                                      className={cn(
                                        "w-28 shrink-0 border-r flex items-center justify-center",
                                        hasAnyAssignment(artCompIds, pkg.id) && "bg-[#E87722]/8"
                                      )}
                                      style={{ height: 26 }}
                                    >
                                      {hasAnyAssignment(artCompIds, pkg.id) && (
                                        <span className="text-[9px] font-mono text-[#E87722]/40">
                                          {countAssignments(artCompIds, pkg.id)}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>

                                {/* Insumo rows */}
                                {!artCollapsed && art.insumos.map((ins) => (
                                  <div key={ins.compositionId} className="flex border-b hover:bg-muted/5">
                                    <div
                                      className="w-96 shrink-0 px-3 py-1.5 border-r flex items-start gap-2 pl-16 sticky left-0 z-10 bg-background"
                                    >
                                      <span
                                        className={cn(
                                          "w-1.5 h-1.5 rounded-full shrink-0 mt-1.5",
                                          ins.insumoType === "material" ? "bg-neutral-700" :
                                          ins.insumoType === "mano_de_obra" ? "bg-amber-400" :
                                          ins.insumoType === "servicio" ? "bg-emerald-400" :
                                          "bg-gray-400"
                                        )}
                                      />
                                      <span className="text-[11px] line-clamp-2 leading-tight flex-1 min-w-0" title={ins.insumoDescription}>
                                        {ins.insumoDescription}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">{ins.insumoUnit}</span>
                                    </div>
                                    <div className="w-10 shrink-0 border-r sticky z-10 bg-background" style={{ left: "24rem" }} />
                                    {packages.map((pkg) => {
                                      const isAssigned = assignments.has(`${ins.compositionId}::${pkg.id}`);
                                      const assignedToPkg = compAssignedTo.get(ins.compositionId);
                                      const isLockedByOther = assignedToPkg !== undefined && assignedToPkg !== pkg.id;
                                      const lockedPkgName = isLockedByOther ? packages.find((p) => p.id === assignedToPkg)?.name : null;
                                      return (
                                        <div
                                          key={pkg.id}
                                          className={cn(
                                            "w-28 shrink-0 border-r transition-colors flex items-center justify-center self-stretch",
                                            isAssigned
                                              ? "bg-[#E87722] hover:bg-[#E87722]/70 cursor-pointer"
                                              : isLockedByOther
                                                ? "bg-muted/20 cursor-not-allowed"
                                                : "hover:bg-muted/30 cursor-pointer"
                                          )}
                                          title={isLockedByOther ? `Asignado a "${lockedPkgName}"` : undefined}
                                          onMouseDown={(e) => {
                                            e.preventDefault();
                                            if (isLockedByOther) return;
                                            handleMouseDown(ins.compositionId, ins.insumoId, pkg.id);
                                          }}
                                          onMouseEnter={() => {
                                            if (isLockedByOther) return;
                                            handleMouseEnter(ins.compositionId, ins.insumoId, pkg.id);
                                          }}
                                        >
                                          {isAssigned && (
                                            <div className="w-2.5 h-2.5 rounded-full bg-white/90" />
                                          )}
                                          {isLockedByOther && (
                                            <div className="w-2 h-2 rounded-full bg-muted-foreground/20" />
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Summary panel ── */}
      {packages.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Resumen de Paquetes</h2>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground font-medium">Ordenar por:</span>
              <select
                value={summarySort}
                onChange={(e) => setSummarySort(e.target.value as typeof summarySort)}
                className="h-7 text-[11px] rounded-md border border-border bg-background px-2 cursor-pointer"
              >
                <option value="created">Orden de creación</option>
                <option value="amount_desc">Monto: mayor a menor</option>
                <option value="amount_asc">Monto: menor a mayor</option>
                <option value="date_asc">Fecha necesidad: más próxima</option>
                <option value="date_desc">Fecha necesidad: más lejana</option>
              </select>
            </div>
          </div>

          {/* List header */}
          <div className="border rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_100px_170px_100px_90px_110px] gap-0 text-[10px] font-semibold uppercase tracking-wider px-4 py-2 border-b" style={{ background: "#F5F5F5" }}>
              <span>Paquete</span>
              <span className="text-center">Tipo</span>
              <span className="text-center">Acción</span>
              <span className="text-right">Insumos</span>
              <span className="text-right">Fecha</span>
              <span className="text-right">Monto USD</span>
            </div>

            {sortedSummaryPackages.map((pkg) => {
              const summaryLines = getPackageSummaryLines(pkg.id);
              const pkgTotal = summaryLines.reduce((sum, l) => sum + l.totalCost, 0);
              const isExpanded = expandedSummary.has(pkg.id);
              const earliestWeek = getPackageEarliestWeek(pkg.id);
              const earliestDate = earliestWeek < 9999 ? weekToDate(earliestWeek) : "—";

              if (summaryLines.length === 0) {
                return (
                  <div key={pkg.id} className="grid grid-cols-[1fr_100px_170px_100px_90px_110px] gap-0 items-center px-4 py-2 border-b text-xs text-muted-foreground hover:bg-muted/20">
                    <span className="flex items-center gap-2">
                      <Package className="h-3.5 w-3.5" />
                      <span className="font-medium text-foreground">{pkg.name}</span>
                    </span>
                    <span className="text-center">
                      <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", pkg.purchase_type === "licitacion" ? "bg-[#E87722]/10 text-[#E87722]" : "bg-emerald-100 text-emerald-700")}>
                        {pkg.purchase_type === "licitacion" ? "LIC" : "CD"}
                      </span>
                    </span>
                    <span className="flex justify-center" onClick={(e) => e.stopPropagation()}>{sendSCButton(pkg, summaryLines.length === 0)}</span>
                    <span className="text-right font-mono">0</span>
                    <span className="text-right">—</span>
                    <span className="text-right font-mono">$0</span>
                  </div>
                );
              }

              return (
                <div key={pkg.id}>
                  {/* Clickable summary row */}
                  <div
                    className="grid grid-cols-[1fr_100px_170px_100px_90px_110px] gap-0 items-center px-4 py-2.5 border-b cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedSummary((prev) => {
                      const next = new Set(prev);
                      if (next.has(pkg.id)) next.delete(pkg.id); else next.add(pkg.id);
                      return next;
                    })}
                  >
                    <span className="flex items-center gap-2">
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      }
                      <Package className="h-4 w-4 shrink-0" style={{ color: "#E87722" }} />
                      <span className="font-semibold text-sm">{pkg.name}</span>
                    </span>
                    <span className="text-center">
                      <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", pkg.purchase_type === "licitacion" ? "bg-[#E87722]/10 text-[#E87722]" : "bg-emerald-100 text-emerald-700")}>
                        {pkg.purchase_type === "licitacion" ? "LIC" : "CD"}
                      </span>
                    </span>
                    <span className="flex justify-center" onClick={(e) => e.stopPropagation()}>{sendSCButton(pkg, summaryLines.length === 0)}</span>
                    <span className="text-right text-xs font-mono">{summaryLines.length}</span>
                    <span className="text-right text-[11px]">{earliestDate}</span>
                    <span className="text-right font-mono font-bold text-sm" style={{ color: "#E87722" }}>${formatUsdInt(pkgTotal)}</span>
                  </div>

                  {/* Expanded detail table */}
                  {isExpanded && (() => {
                    const catMap = new Map<string, { catCode: string; catName: string; subs: Map<string, { subCode: string; subName: string; lines: SummaryLine[] }> }>();
                    for (const line of summaryLines) {
                      if (!catMap.has(line.catCode)) {
                        catMap.set(line.catCode, { catCode: line.catCode, catName: line.catName, subs: new Map() });
                      }
                      const catEntry = catMap.get(line.catCode)!;
                      if (!catEntry.subs.has(line.subCode)) {
                        catEntry.subs.set(line.subCode, { subCode: line.subCode, subName: line.subName, lines: [] });
                      }
                      catEntry.subs.get(line.subCode)!.lines.push(line);
                    }

                    return (
                      <div className="border-b" style={{ background: "#FAFBFC" }}>
                        <table className="w-full text-xs">
                          <thead>
                            <tr style={{ background: "#F0F2F5" }}>
                              <th className="text-left px-4 py-1.5 font-semibold text-[10px] uppercase tracking-wider">Categoría / Subcategoría</th>
                              <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-wider">Artículo</th>
                              <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-wider">Insumo</th>
                              <th className="text-center px-2 py-1.5 font-semibold text-[10px] uppercase tracking-wider">Und</th>
                              <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-wider">PU USD</th>
                              <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-wider">Cantidad</th>
                              <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-wider">Total USD</th>
                              <th className="text-center px-3 py-1.5 font-semibold text-[10px] uppercase tracking-wider">Fecha</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Array.from(catMap.values()).map((catEntry) => (
                              Array.from(catEntry.subs.values()).map((subEntry) => (
                                subEntry.lines.map((line, idx) => (
                                  <tr
                                    key={line.compositionId}
                                    className="border-t hover:bg-white/60"
                                    style={{ borderColor: "#EAEAEA" }}
                                  >
                                    {idx === 0 ? (
                                      <td className="px-4 py-1.5 align-top" rowSpan={subEntry.lines.length}>
                                        <div className="font-mono text-[10px] font-bold" style={{ color: "#E87722" }}>{catEntry.catCode}</div>
                                        <div className="text-[11px] font-medium">{catEntry.catName}</div>
                                        <div className="text-[10px] text-muted-foreground mt-0.5">{subEntry.subCode} {subEntry.subName}</div>
                                      </td>
                                    ) : null}
                                    <td className="px-3 py-1.5">
                                      <span className="font-mono text-[10px] text-muted-foreground">#{line.artNumber}</span>{" "}
                                      <span className="text-[11px]">{line.artDescription}</span>
                                    </td>
                                    <td className="px-3 py-1.5">
                                      <div className="flex items-center gap-1.5">
                                        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", line.insumoType === "material" ? "bg-neutral-700" : line.insumoType === "mano_de_obra" ? "bg-amber-400" : line.insumoType === "servicio" ? "bg-emerald-400" : "bg-gray-400")} />
                                        <span className="text-[11px]">{line.insumoDescription}</span>
                                      </div>
                                    </td>
                                    <td className="px-2 py-1.5 text-center text-[10px] text-muted-foreground">{line.insumoUnit}</td>
                                    <td className="px-3 py-1.5 text-right font-mono">{formatNumber(line.unitCost)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono">{formatNumber(line.qlQuantity)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono font-medium">{formatNumber(line.totalCost)}</td>
                                    <td className="px-3 py-1.5 text-center text-[11px]">{line.needDate}</td>
                                  </tr>
                                ))
                              ))
                            ))}
                            <tr className="border-t-2 font-bold" style={{ background: "#F0F2F5", borderColor: "#E87722" }}>
                              <td colSpan={6} className="px-4 py-2 text-right text-xs uppercase tracking-wider">Total paquete</td>
                              <td className="px-3 py-2 text-right font-mono text-sm" style={{ color: "#E87722" }}>${formatUsdInt(pkgTotal)}</td>
                              <td></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Package Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPkg?.id ? "Editar" : "Nuevo"} Paquete</DialogTitle>
          </DialogHeader>
          {editingPkg && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input
                  value={editingPkg.name || ""}
                  onChange={(e) => setEditingPkg({ ...editingPkg, name: e.target.value })}
                  placeholder="Ej: Acero estructural"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo de contratación</Label>
                  <Select
                    value={editingPkg.purchase_type || "directa"}
                    onValueChange={(v) => v && setEditingPkg({ ...editingPkg, purchase_type: v as PurchaseType })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="directa">Compra directa</SelectItem>
                      <SelectItem value="licitacion">Licitación</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Días anticipación</Label>
                  <Input
                    type="number"
                    value={editingPkg.advance_days || 0}
                    onChange={(e) => setEditingPkg({ ...editingPkg, advance_days: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Proveedor sugerido</Label>
                  <Input
                    value={editingPkg.suggested_supplier || ""}
                    onChange={(e) => setEditingPkg({ ...editingPkg, suggested_supplier: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Proveedor adjudicado</Label>
                  <Input
                    value={editingPkg.awarded_supplier || ""}
                    onChange={(e) => setEditingPkg({ ...editingPkg, awarded_supplier: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={savePackage} className="flex-1" disabled={!editingPkg.name}>
                  {editingPkg.id ? "Actualizar" : "Crear"}
                </Button>
                {editingPkg.id && (
                  <Button variant="destructive" onClick={deletePackage}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Send SC confirmation dialog */}
      <Dialog open={sendDialogPkg !== null} onOpenChange={(open) => !open && setSendDialogPkg(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              Enviar Solicitud de Compra
            </DialogTitle>
          </DialogHeader>
          {sendDialogPkg && (() => {
            const lines = getPackageSummaryLines(sendDialogPkg.id);
            const total = lines.reduce((s, l) => s + l.totalCost, 0);

            // Aggregate by insumo + subcategory for the SC preview (same as createSCFromPackage)
            type AggKey = string;
            const aggMap = new Map<AggKey, { description: string; unit: string; subName: string; totalQty: number }>();
            for (const cat of groups) {
              for (const sub of cat.subcategories) {
                for (const art of sub.articulos) {
                  for (const ins of art.insumos) {
                    const key = `${ins.compositionId}::${sendDialogPkg.id}`;
                    if (!assignments.has(key)) continue;
                    const realQty = art.totalQlQuantity * ins.compQuantity * (1 + ins.wastePct / 100);
                    const aggKey = `${ins.insumoId}::${sub.id}`;
                    const subName = `${cat.code}.${sub.code?.split(".")[1] || ""} ${sub.name}`;
                    const prev = aggMap.get(aggKey);
                    if (prev) prev.totalQty += realQty;
                    else aggMap.set(aggKey, {
                      description: ins.insumoDescription,
                      unit: ins.insumoUnit,
                      subName,
                      totalQty: realQty,
                    });
                  }
                }
              }
            }
            const scLines = Array.from(aggMap.values());

            return (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Se enviará una <strong>Solicitud de Compra</strong> al buzón de Compras con todo el contenido
                  del paquete <strong className="text-foreground">&ldquo;{sendDialogPkg.name}&rdquo;</strong>.
                  Una vez enviada, el paquete quedará bloqueado y no podrá editarse.
                </p>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="bg-muted/40 rounded-md p-2">
                    <span className="text-muted-foreground block">Tipo de compra</span>
                    <span className="font-semibold">
                      {sendDialogPkg.purchase_type === "licitacion" ? "Licitación" : "Compra Directa"}
                    </span>
                  </div>
                  <div className="bg-muted/40 rounded-md p-2">
                    <span className="text-muted-foreground block">Líneas en la SC</span>
                    <span className="font-semibold">{scLines.length}</span>
                  </div>
                  <div className="bg-muted/40 rounded-md p-2">
                    <span className="text-muted-foreground block">Monto estimado</span>
                    <span className="font-semibold" style={{ color: "#E87722" }}>
                      ${formatUsdInt(total)} USD
                    </span>
                  </div>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[1fr_2fr_80px_60px] gap-0 px-3 py-2 bg-muted/40 text-[10px] font-semibold uppercase tracking-wider border-b">
                    <span>EDT</span>
                    <span>Descripción</span>
                    <span className="text-right">Cantidad</span>
                    <span className="text-center">Unidad</span>
                  </div>
                  <div className="max-h-[300px] overflow-auto">
                    {scLines.map((line, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-[1fr_2fr_80px_60px] gap-0 px-3 py-1.5 text-xs border-b last:border-b-0"
                      >
                        <span className="truncate text-muted-foreground">{line.subName}</span>
                        <span className="truncate">{line.description}</span>
                        <span className="text-right font-mono">
                          {line.totalQty.toLocaleString("es", { maximumFractionDigits: 2 })}
                        </span>
                        <span className="text-center text-muted-foreground">{line.unit}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setSendDialogPkg(null)} disabled={sendingSC}>
                    Cancelar
                  </Button>
                  <Button onClick={confirmSendSC} disabled={sendingSC || scLines.length === 0}>
                    {sendingSC ? "Enviando..." : "Aceptar y enviar"}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
