"use client";

import { useEffect, useState, useCallback } from "react";
import { getNumberLocale } from "@/lib/utils/number-format";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Package as PackageIcon,
  ShoppingCart,
  Lock,
  FileText,
  CheckCircle2,
  Scale,
} from "lucide-react";
import { toast } from "sonner";
import {
  SC_STATUSES,
  DEFAULT_UNITS,
  CURRENCIES,
} from "@/lib/constants/units";
import type {
  PurchaseRequest,
  PurchaseRequestLine,
  PurchaseOrder,
  PurchaseOrderLine,
  EdtSubcategory,
  EdtCategory,
  ProcurementPackage,
  ProcurementLine,
  PurchaseRequestStatus,
  Insumo,
  Project,
  Sector,
} from "@/lib/types/database";
import { InsumoPicker } from "./insumo-picker";
import { SupplierPicker } from "@/components/shared/supplier-picker";
import { cn } from "@/lib/utils";
import { logActivity } from "@/lib/utils/activity-log";
import { resolveAdvanceAmount } from "@/lib/utils/oc-advance";
import { PriceSuggestionsInput, type PriceRef } from "./price-suggestions";

interface Props {
  projectId: string;
}

type SCWithLines = PurchaseRequest & { lines: PurchaseRequestLine[] };

interface OCLineAgg {
  requestLineId: string;
  orderedQty: number;
  orderNumbers: string[]; // List of OC numbers covering this line
}

export function SolicitudesTab({ projectId }: Props) {
  const supabase = createClient();
  const [requests, setRequests] = useState<SCWithLines[]>([]);
  const [categories, setCategories] = useState<EdtCategory[]>([]);
  const [subcategories, setSubcategories] = useState<EdtSubcategory[]>([]);
  const [loading, setLoading] = useState(true);
  // Cotizaciones agrupadas por request_id (para mostrar en cada SC)
  const [quotationsByRequest, setQuotationsByRequest] = useState<Map<string, { id: string; number: string; status: string }[]>>(new Map());
  const [creatingQuotationFor, setCreatingQuotationFor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Map of SC line id -> aggregated OC consumption
  const [ocConsumption, setOcConsumption] = useState<Map<string, OCLineAgg>>(new Map());
  // Reference data for price suggestions
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  // Historical OC lines (all past purchases in this project) for price history
  const [historicalOCLines, setHistoricalOCLines] = useState<
    (PurchaseOrderLine & { oc_number?: string; supplier?: string; oc_currency?: string; oc_date?: string })[]
  >([]);
  // Filter & sort
  const [statusFilter, setStatusFilter] = useState<PurchaseRequestStatus | "all">("all");
  const [sortBy, setSortBy] = useState<"recent" | "status" | "number">("recent");

  // Import from packages
  const [packageDialogOpen, setPackageDialogOpen] = useState(false);
  const [packages, setPackages] = useState<(ProcurementPackage & { procurement_lines: (ProcurementLine & { insumo: { description: string; unit: string } | null })[] })[]>([]);
  const [selectedPackages, setSelectedPackages] = useState<Set<string>>(new Set());
  const [importingPackages, setImportingPackages] = useState(false);

  // Manual SC creation dialog
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [manualComment, setManualComment] = useState("");
  type ManualLine = { tmpId: string; subcategory_id: string | null; description: string; quantity: number; unit: string; need_date: string | null };
  const [manualLines, setManualLines] = useState<ManualLine[]>([]);
  const [creatingManual, setCreatingManual] = useState(false);

  // Generate OC dialog (from a SC)
  const [generateOCFor, setGenerateOCFor] = useState<SCWithLines | null>(null);
  const [ocSupplier, setOcSupplier] = useState("");
  const [ocSupplierId, setOcSupplierId] = useState<string | null>(null);
  const [projectSuppliers, setProjectSuppliers] = useState<import("@/lib/types/database").Supplier[]>([]);
  const [ocCurrency, setOcCurrency] = useState("USD");
  // Payment terms
  const [ocPaymentType, setOcPaymentType] = useState<"contado" | "credito" | "contrato" | "contra_entrega">("contado");
  const [ocCreditDays, setOcCreditDays] = useState(30);
  const [ocMeasurementFreq, setOcMeasurementFreq] = useState<"semanal" | "quincenal" | "mensual">("mensual");
  const [ocHasAdvance, setOcHasAdvance] = useState(false);
  const [ocAdvanceAmount, setOcAdvanceAmount] = useState(0);
  const [ocAdvanceType, setOcAdvanceType] = useState<"amount" | "percentage">("percentage");
  const [ocAmortMode, setOcAmortMode] = useState<"percentage" | "per_certification">("percentage");
  const [ocAmortPct, setOcAmortPct] = useState(0);
  const [ocRetentionPct, setOcRetentionPct] = useState(0);
  const [ocReturnCondition, setOcReturnCondition] = useState("");
  const [ocPaymentNotes, setOcPaymentNotes] = useState("");
  const [ocComment, setOcComment] = useState("");
  // Per-SC-line: { selected, qty, unitPrice, sector_id, subcategory_id }
  // Sector/subcategory override SC values so user can reassign per OC
  const [ocLineSel, setOcLineSel] = useState<
    Map<string, { selected: boolean; qty: number; unitPrice: number; sector_id: string | null; subcategory_id: string | null }>
  >(new Map());
  // Extra lines (NOT from SC — added on the fly)
  type ExtraOCLine = {
    tmpId: string;
    sector_id: string | null;
    subcategory_id: string | null;
    insumo_id: string | null;
    description: string;
    quantity: number;
    unit: string;
    unit_price: number;
  };
  const [ocExtraLines, setOcExtraLines] = useState<ExtraOCLine[]>([]);
  const [generatingOC, setGeneratingOC] = useState(false);

  const loadData = useCallback(async () => {
    const [reqRes, catsRes, subsRes, ordersRes, insumosRes, projectRes, allOcLinesRes, sectorsRes, supsRes, quoRes] = await Promise.all([
      supabase
        .from("purchase_requests")
        .select("*, lines:purchase_request_lines(*)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      supabase.from("edt_categories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase
        .from("purchase_orders")
        .select("id, number, lines:purchase_order_lines(request_line_id, quantity)")
        .eq("project_id", projectId),
      supabase.from("insumos").select("*").eq("project_id", projectId),
      supabase.from("projects").select("*").eq("id", projectId).single(),
      supabase
        .from("purchase_order_lines")
        .select("*, order:purchase_orders(number, supplier, currency, issue_date, project_id)")
        .order("created_at", { ascending: false }),
      supabase.from("sectors").select("*").eq("project_id", projectId).order("order"),
      supabase.from("suppliers").select("*").eq("project_id", projectId).order("name"),
      supabase.from("quotations").select("id, number, status, request_id").eq("project_id", projectId),
    ]);

    setRequests((reqRes.data || []) as SCWithLines[]);
    // Agrupar cotizaciones por request_id
    const qmap = new Map<string, { id: string; number: string; status: string }[]>();
    for (const q of (quoRes.data ?? []) as { id: string; number: string; status: string; request_id: string | null }[]) {
      if (!q.request_id) continue;
      const arr = qmap.get(q.request_id) ?? [];
      arr.push({ id: q.id, number: q.number, status: q.status });
      qmap.set(q.request_id, arr);
    }
    setQuotationsByRequest(qmap);
    setCategories(catsRes.data || []);
    setSubcategories(subsRes.data || []);
    setInsumos((insumosRes.data || []) as Insumo[]);
    setSectors((sectorsRes.data || []) as Sector[]);
    setProjectSuppliers((supsRes.data || []) as import("@/lib/types/database").Supplier[]);
    if (projectRes.data) setProject(projectRes.data as Project);

    // Filter historical OC lines by project + enrich
    type RawLine = PurchaseOrderLine & {
      order?: { number?: string; supplier?: string; currency?: string; issue_date?: string; project_id?: string };
    };
    const rawLines = (allOcLinesRes.data || []) as RawLine[];
    const enrichedHistory = rawLines
      .filter((l) => l.order?.project_id === projectId && Number(l.unit_price || 0) > 0)
      .map((l) => ({
        ...l,
        oc_number: l.order?.number,
        supplier: l.order?.supplier,
        oc_currency: l.order?.currency,
        oc_date: l.order?.issue_date,
      }));
    setHistoricalOCLines(enrichedHistory);

    // Build consumption map from OC lines
    const consumption = new Map<string, OCLineAgg>();
    const orders = (ordersRes.data || []) as (PurchaseOrder & { lines: { request_line_id: string | null; quantity: number }[] })[];
    for (const oc of orders) {
      for (const ol of oc.lines || []) {
        if (!ol.request_line_id) continue;
        const prev = consumption.get(ol.request_line_id);
        if (prev) {
          prev.orderedQty += Number(ol.quantity || 0);
          if (!prev.orderNumbers.includes(oc.number)) prev.orderNumbers.push(oc.number);
        } else {
          consumption.set(ol.request_line_id, {
            requestLineId: ol.request_line_id,
            orderedQty: Number(ol.quantity || 0),
            orderNumbers: [oc.number],
          });
        }
      }
    }
    setOcConsumption(consumption);

    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Manual SC creation ───
  function openManualDialog() {
    setManualComment("");
    setManualLines([{
      tmpId: crypto.randomUUID(),
      subcategory_id: subcategories[0]?.id || null,
      description: "",
      quantity: 1,
      unit: "U",
      need_date: null,
    }]);
    setManualDialogOpen(true);
  }

  function addManualLine() {
    setManualLines((prev) => [...prev, {
      tmpId: crypto.randomUUID(),
      subcategory_id: subcategories[0]?.id || null,
      description: "",
      quantity: 1,
      unit: "U",
      need_date: null,
    }]);
  }

  function updateManualLine(tmpId: string, field: keyof ManualLine, value: unknown) {
    setManualLines((prev) =>
      prev.map((l) => (l.tmpId === tmpId ? { ...l, [field]: value } : l))
    );
  }

  function removeManualLine(tmpId: string) {
    setManualLines((prev) => prev.filter((l) => l.tmpId !== tmpId));
  }

  async function createManualSC() {
    const validLines = manualLines.filter((l) => l.description.trim() && l.quantity > 0);
    if (validLines.length === 0) {
      toast.error("Agrega al menos una línea válida (descripción y cantidad)");
      return;
    }

    setCreatingManual(true);
    try {
      const { data: numData } = await supabase.rpc("next_document_number", {
        p_project_id: projectId,
        p_doc_type: "SC",
      });
      const number = numData || `SC-${new Date().getFullYear()}-???`;

      const { data: sc, error: scErr } = await supabase
        .from("purchase_requests")
        .insert({
          project_id: projectId,
          number,
          origin: "manual",
          status: "pending",
          comment: manualComment || null,
        })
        .select()
        .single();

      if (scErr || !sc) {
        toast.error("Error al crear solicitud");
        return;
      }

      const linesPayload = validLines.map((l) => ({
        request_id: sc.id,
        subcategory_id: l.subcategory_id,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        need_date: l.need_date,
      }));

      const { error: lErr } = await supabase.from("purchase_request_lines").insert(linesPayload);
      if (lErr) {
        toast.error("SC creada pero error al insertar líneas");
        return;
      }

      await logActivity({
        projectId,
        actionType: "sc_created_manual",
        entityType: "purchase_request",
        entityId: sc.id,
        description: `Solicitud ${number} creada manualmente (${validLines.length} línea${validLines.length === 1 ? "" : "s"})`,
        metadata: { scId: sc.id, number, lineCount: validLines.length },
      });

      toast.success(`Solicitud ${number} creada y archivada`);
      setManualDialogOpen(false);
      loadData();
    } finally {
      setCreatingManual(false);
    }
  }

  // ─── Cancel SC ───
  async function cancelSC(id: string) {
    if (!confirm("¿Cancelar esta solicitud? Quedará registrada pero no se podrá generar OCs a partir de ella.")) return;
    const sc = requests.find((r) => r.id === id);
    await supabase.from("purchase_requests").update({ status: "cancelled" }).eq("id", id);
    await logActivity({
      projectId,
      actionType: "sc_cancelled",
      entityType: "purchase_request",
      entityId: id,
      description: `Solicitud ${sc?.number || ""} cancelada`,
      metadata: { scId: id, previousStatus: sc?.status },
    });
    toast.success("Solicitud cancelada");
    loadData();
  }

  // Force SC to "completed" state when buyer decides pending qty won't be ordered
  /**
   * Crea una cotización a partir de una SC. La RPC copia las líneas
   * de la SC como ítems a cotizar. Después abre la cotización en la
   * pestaña Cotizaciones (o redirigimos manualmente al usuario).
   */
  async function createQuotationFromSC(sc: SCWithLines) {
    if (creatingQuotationFor) return;
    setCreatingQuotationFor(sc.id);
    try {
      const title = `Cotización SC ${sc.number}`;
      const { error } = await supabase.rpc("create_quotation_from_request", {
        p_request_id: sc.id,
        p_title: title,
      });
      if (error) {
        toast.error(`Error al crear cotización: ${error.message}`);
        return;
      }
      toast.success(`Cotización creada desde SC ${sc.number}. Andá a la pestaña Cotizaciones para editarla.`);
      loadData();
    } finally {
      setCreatingQuotationFor(null);
    }
  }

  async function markSCCompleted(sc: SCWithLines) {
    const totalPending = sc.lines.reduce(
      (s, l) => s + getRemainingQty(l),
      0
    );
    const unitsSummary = summarizeByUnit(
      sc.lines.map((l) => ({ qty: getRemainingQty(l), unit: l.unit }))
    );
    if (
      !confirm(
        `¿Marcar SC ${sc.number} como completada?\n\nLa cantidad pendiente (${unitsSummary}) no se ordenará y la SC quedará cerrada.`
      )
    )
      return;
    await supabase.from("purchase_requests").update({ status: "completed" }).eq("id", sc.id);
    await logActivity({
      projectId,
      actionType: "sc_cancelled",
      entityType: "purchase_request",
      entityId: sc.id,
      description: `Solicitud ${sc.number} marcada completada manualmente`,
      metadata: { scId: sc.id, previousStatus: sc.status, reason: "manual_complete", pendingAbandoned: totalPending },
    });
    toast.success(`SC ${sc.number} marcada como completada`);
    loadData();
  }

  // Helper: summarize quantities grouped by unit (e.g. "8.43 m3 + 2 kg")
  function summarizeByUnit(items: { qty: number; unit: string }[]): string {
    const byUnit = new Map<string, number>();
    for (const it of items) {
      if (it.qty <= 0) continue;
      byUnit.set(it.unit, (byUnit.get(it.unit) || 0) + it.qty);
    }
    if (byUnit.size === 0) return "0";
    return Array.from(byUnit.entries())
      .map(([unit, qty]) => `${qty.toLocaleString(getNumberLocale(), { maximumFractionDigits: 2 })} ${unit}`)
      .join(" + ");
  }

  // ─── Import from packages ───
  async function openPackageImport() {
    const { data } = await supabase
      .from("procurement_packages")
      .select("*, procurement_lines(*, insumo:insumos(description, unit))")
      .eq("project_id", projectId)
      .eq("status", "aprobado")
      .order("created_at", { ascending: false });
    setPackages((data || []) as typeof packages);
    setSelectedPackages(new Set());
    setPackageDialogOpen(true);
  }

  async function importFromPackages() {
    if (selectedPackages.size === 0) return;
    setImportingPackages(true);
    try {
      for (const pkgId of selectedPackages) {
        const pkg = packages.find((p) => p.id === pkgId);
        if (!pkg || pkg.procurement_lines.length === 0) continue;

        const { data: numData } = await supabase.rpc("next_document_number", {
          p_project_id: projectId,
          p_doc_type: "SC",
        });
        const number = numData || `SC-${new Date().getFullYear()}-???`;

        const { data: sc, error: scErr } = await supabase
          .from("purchase_requests")
          .insert({
            project_id: projectId,
            number,
            origin: "package",
            package_id: pkgId,
            status: "pending",
            comment: `Desde paquete: ${pkg.name}`,
          })
          .select()
          .single();

        if (scErr || !sc) continue;

        const lines = pkg.procurement_lines.map((pl) => ({
          request_id: sc.id,
          subcategory_id: pl.subcategory_origin || null,
          description: pl.insumo?.description || "Sin descripción",
          quantity: pl.quantity,
          unit: pl.insumo?.unit || "U",
          need_date: pl.need_date || null,
        }));

        await supabase.from("purchase_request_lines").insert(lines);

        await logActivity({
          projectId,
          actionType: "sc_created_from_package",
          entityType: "purchase_request",
          entityId: sc.id,
          description: `Solicitud ${number} importada del paquete "${pkg.name}"`,
          metadata: { scId: sc.id, number, packageId: pkgId, lineCount: lines.length },
        });
      }

      toast.success(`${selectedPackages.size} solicitud(es) creada(s) desde paquetes`);
      setPackageDialogOpen(false);
      loadData();
    } finally {
      setImportingPackages(false);
    }
  }

  // ─── Generate OC from SC ───
  function openGenerateOC(sc: SCWithLines) {
    setGenerateOCFor(sc);
    setOcSupplier("");
    setOcSupplierId(null);
    setOcCurrency(project?.local_currency || "USD");
    setOcPaymentType("contado");
    setOcCreditDays(30);
    setOcMeasurementFreq("mensual");
    setOcHasAdvance(false);
    setOcAdvanceAmount(0);
    setOcAdvanceType("percentage");
    setOcAmortMode("percentage");
    setOcAmortPct(0);
    setOcRetentionPct(0);
    setOcReturnCondition("");
    setOcPaymentNotes("");
    setOcComment("");

    // Initialize line selection: all UNCHECKED by default
    const sel = new Map<string, {
      selected: boolean; qty: number; unitPrice: number;
      sector_id: string | null; subcategory_id: string | null;
    }>();
    for (const line of sc.lines) {
      const remaining = getRemainingQty(line);
      sel.set(line.id, {
        selected: false,
        qty: remaining,
        unitPrice: 0,
        sector_id: sectors[0]?.id || null,   // default to first sector
        subcategory_id: line.subcategory_id,  // inherit from SC
      });
    }
    setOcLineSel(sel);
    setOcExtraLines([]);
  }

  function addOcExtraLine() {
    setOcExtraLines((prev) => [
      ...prev,
      {
        tmpId: crypto.randomUUID(),
        sector_id: sectors[0]?.id || null,
        subcategory_id: null,
        insumo_id: null,
        description: "",
        quantity: 1,
        unit: "U",
        unit_price: 0,
      },
    ]);
  }
  function updateOcExtraLine(tmpId: string, patch: Partial<ExtraOCLine>) {
    setOcExtraLines((prev) => prev.map((l) => (l.tmpId === tmpId ? { ...l, ...patch } : l)));
  }
  function removeOcExtraLine(tmpId: string) {
    setOcExtraLines((prev) => prev.filter((l) => l.tmpId !== tmpId));
  }
  function selectExtraInsumo(tmpId: string, ins: Insumo) {
    updateOcExtraLine(tmpId, {
      insumo_id: ins.id,
      description: ins.description,
      unit: ins.unit,
      unit_price: Number(ins.pu_usd || 0),
    });
  }

  async function submitGenerateOC() {
    if (!generateOCFor) return;
    if (!ocSupplierId || !ocSupplier.trim()) {
      toast.error("Proveedor es requerido — seleccionalo de la lista");
      return;
    }

    // If anticipo is enabled, advance_amount is always required.
    // Amortization method is also required: either a fixed % per reception,
    // or manual amount per certification (selected via ocAmortMode).
    if (ocHasAdvance) {
      if (!ocAdvanceAmount || ocAdvanceAmount <= 0) {
        toast.error(`Debés ingresar el ${ocAdvanceType === "percentage" ? "% del anticipo" : "monto del anticipo"}`);
        return;
      }
      if (ocAmortMode === "percentage" && (!ocAmortPct || ocAmortPct <= 0)) {
        toast.error("Debés ingresar el % de amortización o cambiar a modo 'monto por certificación'");
        return;
      }
    }

    const selectedLines = generateOCFor.lines.filter((l) => {
      const s = ocLineSel.get(l.id);
      return s?.selected && s.qty > 0;
    });

    const validExtraLines = ocExtraLines.filter(
      (l) => l.quantity > 0 && l.description.trim()
    );

    if (selectedLines.length === 0 && validExtraLines.length === 0) {
      toast.error("Selecciona al menos una línea de la SC o agrega una línea extra");
      return;
    }

    // Validate sector, EDT, and unit_price on all lines
    for (const scLine of selectedLines) {
      const sel = ocLineSel.get(scLine.id)!;
      if (!sel.sector_id) {
        toast.error(`Línea "${scLine.description}" requiere Sector`);
        return;
      }
      if (!sel.subcategory_id) {
        toast.error(`Línea "${scLine.description}" requiere EDT`);
        return;
      }
      if (!sel.unitPrice || sel.unitPrice <= 0) {
        toast.error(`Línea "${scLine.description}" requiere Precio Unitario`);
        return;
      }
    }
    for (const [idx, ex] of validExtraLines.entries()) {
      if (!ex.sector_id) {
        toast.error(`Línea extra #${idx + 1}: Sector es requerido`);
        return;
      }
      if (!ex.subcategory_id) {
        toast.error(`Línea extra #${idx + 1}: EDT es requerido`);
        return;
      }
      if (!ex.insumo_id) {
        toast.error(`Línea extra #${idx + 1}: Insumo es requerido`);
        return;
      }
      if (!ex.unit_price || ex.unit_price <= 0) {
        toast.error(`Línea extra #${idx + 1}: Precio Unitario es requerido`);
        return;
      }
    }

    setGeneratingOC(true);
    try {
      // Get next OC number
      const { data: numData } = await supabase.rpc("next_document_number", {
        p_project_id: projectId,
        p_doc_type: "OC",
      });
      const number = numData || `OC-${new Date().getFullYear()}-???`;

      // Create OC header
      const { data: oc, error: ocErr } = await supabase
        .from("purchase_orders")
        .insert({
          project_id: projectId,
          number,
          request_id: generateOCFor.id,
          supplier: ocSupplier.trim(),
          supplier_id: ocSupplierId,
          currency: ocCurrency,
          has_advance: ocHasAdvance,
          advance_amount: ocHasAdvance ? ocAdvanceAmount : 0,
          advance_type: ocHasAdvance ? ocAdvanceType : null,
          // Amortization applies when there's an advance (regardless of payment type); retention and return_condition only under "contrato"
          amortization_mode: ocHasAdvance ? ocAmortMode : "percentage",
          amortization_pct: ocHasAdvance
            ? (ocAmortMode === "percentage" ? ocAmortPct : 0)
            : (ocPaymentType === "contrato" ? ocAmortPct : 0),
          retention_pct: ocPaymentType === "contrato" ? ocRetentionPct : 0,
          return_condition: ocPaymentType === "contrato" ? (ocReturnCondition || null) : null,
          payment_terms_type: ocPaymentType,
          credit_days: ocPaymentType === "credito" ? ocCreditDays : null,
          measurement_frequency: ocPaymentType === "contrato" ? ocMeasurementFreq : null,
          payment_notes: ocPaymentNotes || null,
          comment: ocComment || null,
          status: "open",
        })
        .select()
        .single();

      if (ocErr || !oc) {
        toast.error("Error al crear orden de compra");
        return;
      }

      // Build changes history for activity log
      const changes: { type: string; detail: string }[] = [];

      // Lines from SC — detect modifications vs SC original
      const scLinesPayload = selectedLines.map((scLine) => {
        const sel = ocLineSel.get(scLine.id)!;
        if (Math.abs(sel.qty - Number(scLine.quantity)) > 0.001) {
          changes.push({
            type: "qty_modified",
            detail: `"${scLine.description}": ${scLine.quantity} → ${sel.qty} ${scLine.unit}`,
          });
        }
        if (sel.subcategory_id !== scLine.subcategory_id) {
          changes.push({
            type: "edt_changed",
            detail: `"${scLine.description}" EDT reasignado`,
          });
        }
        return {
          order_id: oc.id,
          request_line_id: scLine.id,
          subcategory_id: sel.subcategory_id!,
          sector_id: sel.sector_id,
          description: scLine.description,
          quantity: sel.qty,
          unit: scLine.unit,
          unit_price: sel.unitPrice,
        };
      });

      // Excluded SC lines (unchecked)
      const excludedScLines = generateOCFor.lines.filter((l) => {
        const s = ocLineSel.get(l.id);
        return s && !s.selected;
      });
      for (const excl of excludedScLines) {
        changes.push({
          type: "line_excluded",
          detail: `"${excl.description}" NO incluida en esta OC`,
        });
      }

      // Extra lines (manually added, not from SC)
      const extraLinesPayload = validExtraLines.map((ex) => {
        changes.push({
          type: "line_added",
          detail: `+ "${ex.description}" · ${ex.quantity} ${ex.unit} × ${ex.unit_price}`,
        });
        return {
          order_id: oc.id,
          request_line_id: null,
          subcategory_id: ex.subcategory_id!,
          sector_id: ex.sector_id,
          insumo_id: ex.insumo_id,
          description: ex.description,
          quantity: ex.quantity,
          unit: ex.unit,
          unit_price: ex.unit_price,
        };
      });

      const ocLinesPayload = [...scLinesPayload, ...extraLinesPayload];

      if (ocLinesPayload.length === 0) {
        await supabase.from("purchase_orders").delete().eq("id", oc.id);
        toast.error("No hay líneas válidas para crear la OC");
        return;
      }

      const { error: lErr } = await supabase.from("purchase_order_lines").insert(ocLinesPayload);
      if (lErr) {
        await supabase.from("purchase_orders").delete().eq("id", oc.id);
        toast.error(`Error al insertar líneas: ${lErr.message}`);
        return;
      }

      // Store changes in OC audit_log if any
      if (changes.length > 0) {
        await supabase
          .from("purchase_orders")
          .update({
            audit_log: [
              {
                at: new Date().toISOString(),
                changes: changes.map((c) => ({
                  field: c.type,
                  from: null,
                  to: c.detail,
                })),
                note: `Divergencias vs SC ${generateOCFor.number}`,
              },
            ],
          })
          .eq("id", oc.id);
      }

      // La recepción de anticipo se genera al aprobar la OC (decide_oc_approval).
      // Sin aprobación, no debería existir movimiento sobre la OC.

      await logActivity({
        projectId,
        actionType: "oc_generated",
        entityType: "purchase_order",
        entityId: oc.id,
        description: `OC ${number} generada desde ${generateOCFor.number} (${ocSupplier.trim()})${changes.length > 0 ? ` · ${changes.length} cambio${changes.length === 1 ? "" : "s"}` : ""}`,
        metadata: {
          ocId: oc.id,
          ocNumber: number,
          scId: generateOCFor.id,
          supplier: ocSupplier.trim(),
          lineCount: ocLinesPayload.length,
          scLinesUsed: selectedLines.length,
          extraLinesAdded: validExtraLines.length,
          changes,
        },
      });

      toast.success(`Orden ${number} creada desde ${generateOCFor.number}${ocHasAdvance ? " (con anticipo auto-generado)" : ""}`);
      setGenerateOCFor(null);
      loadData();
    } finally {
      setGeneratingOC(false);
    }
  }

  // ─── Helpers ───
  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function getSubName(subId: string | null) {
    if (!subId) return "—";
    const sub = subcategories.find((s) => s.id === subId);
    if (!sub) return "—";
    const cat = categories.find((c) => c.id === sub.category_id);
    return `${cat?.code || ""}.${sub.code?.split(".")[1] || ""} ${sub.name}`;
  }

  function getOrderedQty(line: PurchaseRequestLine) {
    return ocConsumption.get(line.id)?.orderedQty || 0;
  }

  /**
   * Compute price suggestions for a SC line:
   * - Budget reference (from insumos table: pu_usd / pu_local)
   * - Historical prices from previous OC lines with matching insumo or description
   */
  function getPriceSuggestions(line: PurchaseRequestLine): PriceRef[] {
    const suggestions: PriceRef[] = [];
    const desc = (line.description || "").trim().toLowerCase();
    if (!desc) return suggestions;

    // 1. Find insumo reference by description match
    const matchedInsumo = insumos.find(
      (i) => i.description.trim().toLowerCase() === desc
    );
    if (matchedInsumo) {
      // Prefer USD reference; if only pu_local available, fall back
      if (matchedInsumo.pu_usd && matchedInsumo.pu_usd > 0) {
        suggestions.push({
          source: "budget",
          price: Number(matchedInsumo.pu_usd),
          currency: "USD",
        });
      } else if (matchedInsumo.pu_local && matchedInsumo.pu_local > 0) {
        suggestions.push({
          source: "budget",
          price: Number(matchedInsumo.pu_local),
          currency: project?.local_currency || "PYG",
        });
      }
    }

    // 2. Historical prices — match by insumo_id (if available) OR by description
    const matchedHistory = historicalOCLines
      .filter((h) => {
        const hDesc = (h.description || "").trim().toLowerCase();
        if (matchedInsumo && h.insumo_id === matchedInsumo.id) return true;
        return hDesc === desc;
      })
      .slice(0, 8);

    for (const h of matchedHistory) {
      if (Number(h.unit_price || 0) <= 0) continue;
      suggestions.push({
        source: "history",
        price: Number(h.unit_price),
        currency: h.oc_currency || "USD",
        supplier: h.supplier,
        date: h.oc_date,
        quantity: Number(h.quantity || 0),
        ocNumber: h.oc_number,
      });
    }

    return suggestions;
  }
  function getRemainingQty(line: PurchaseRequestLine) {
    return Math.max(0, Number(line.quantity) - getOrderedQty(line));
  }
  function getLineOCs(line: PurchaseRequestLine) {
    return ocConsumption.get(line.id)?.orderNumbers || [];
  }
  function getLineStatus(line: PurchaseRequestLine): "pending" | "partial" | "complete" | "excess" {
    const ordered = getOrderedQty(line);
    const requested = Number(line.quantity);
    if (ordered <= 0) return "pending";
    if (ordered < requested - 0.001) return "partial";
    if (ordered > requested + 0.001) return "excess";
    return "complete";
  }

  function getStatusBadge(status: PurchaseRequestStatus) {
    const s = SC_STATUSES.find((st) => st.value === status);
    return (
      <Badge variant="outline" className="text-xs" style={{ borderColor: s?.color, color: s?.color }}>
        {s?.label || status}
      </Badge>
    );
  }

  function formatQty(n: number) {
    return n.toLocaleString(getNumberLocale(), { maximumFractionDigits: 2 });
  }

  // Aggregate status for the whole SC (for overall progress indicator)
  function getSCProgress(sc: SCWithLines) {
    if (sc.lines.length === 0) return { pending: 0, partial: 0, complete: 0, excess: 0 };
    let pending = 0, partial = 0, complete = 0, excess = 0;
    for (const l of sc.lines) {
      const st = getLineStatus(l);
      if (st === "pending") pending++;
      else if (st === "partial") partial++;
      else if (st === "excess") excess++;
      else complete++;
    }
    return { pending, partial, complete, excess };
  }

  // Derived SC status: "cancelled" stays manual, rest is auto from line progress.
  function getDerivedSCStatus(sc: SCWithLines): PurchaseRequestStatus {
    if (sc.status === "cancelled") return "cancelled";
    if (sc.status === "completed") return "completed";  // Manual override
    if (sc.lines.length === 0) return "pending";
    const progress = getSCProgress(sc);
    if (progress.pending === sc.lines.length) return "pending";
    if (progress.complete + progress.excess === sc.lines.length) return "completed";
    return "partial";
  }

  if (loading) return <div className="p-6 text-muted-foreground">Cargando solicitudes...</div>;

  return (
    <div className="py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Solicitudes de Compra</h2>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Lock className="h-3 w-3" /> Las solicitudes son archivos inmutables del requerimiento original
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={openPackageImport}>
            <PackageIcon className="h-4 w-4 mr-1" /> Desde Paquetes
          </Button>
          <Button size="sm" onClick={openManualDialog}>
            <Plus className="h-4 w-4 mr-1" /> Nueva Solicitud
          </Button>
        </div>
      </div>

      {/* Filter & Sort Bar */}
      {requests.length > 0 && (
        <div className="flex items-center gap-3 pb-2 border-b">
          <span className="text-xs font-medium text-muted-foreground">Estado:</span>
          <div className="flex gap-1">
            {([
              { v: "all", label: "Todas", count: requests.length },
              ...SC_STATUSES.map((s) => ({
                v: s.value,
                label: s.label,
                count: requests.filter((r) => getDerivedSCStatus(r) === s.value).length,
              })),
            ] as const).map((opt) => (
              <button
                key={opt.v}
                onClick={() => setStatusFilter(opt.v as PurchaseRequestStatus | "all")}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-md border transition-colors",
                  statusFilter === opt.v
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted"
                )}
              >
                {opt.label} <span className="opacity-70">({opt.count})</span>
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">Ordenar por:</span>
          <Select value={sortBy} onValueChange={(v) => { if (v) setSortBy(v as typeof sortBy); }}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <span>{sortBy === "recent" ? "Más recientes" : sortBy === "status" ? "Estado" : "N° SC"}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent" className="text-xs">Más recientes</SelectItem>
              <SelectItem value="status" className="text-xs">Estado</SelectItem>
              <SelectItem value="number" className="text-xs">N° SC</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {requests.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No hay solicitudes de compra. Crea una nueva o importa desde paquetes.
        </div>
      )}

      {/* SC List */}
      <div className="space-y-3">
        {requests
          .filter((sc) => statusFilter === "all" || getDerivedSCStatus(sc) === statusFilter)
          .sort((a, b) => {
            if (sortBy === "recent") return (b.created_at || "").localeCompare(a.created_at || "");
            if (sortBy === "number") return a.number.localeCompare(b.number);
            // status: order pending → partial → completed → cancelled
            const order = { pending: 0, partial: 1, completed: 2, cancelled: 3 };
            return order[getDerivedSCStatus(a)] - order[getDerivedSCStatus(b)];
          })
          .map((sc) => {
          const isExpanded = expanded.has(sc.id);
          const progress = getSCProgress(sc);
          const derivedStatus = getDerivedSCStatus(sc);
          const canGenerateOC =
            sc.status !== "cancelled" &&
            sc.status !== "completed" &&
            sc.lines.length > 0 &&
            derivedStatus !== "completed";
          const canCancel = sc.status !== "cancelled" && progress.partial === 0 && progress.complete === 0 && progress.excess === 0;
          // Allow manual close when SC is in partial progress and there's still quantity
          // unfulfilled — either lines that haven't been ordered at all (pending) or lines
          // that have been ordered only partially (partial).
          const canMarkCompleted =
            sc.status !== "cancelled" &&
            sc.status !== "completed" &&
            derivedStatus === "partial" &&
            (progress.pending > 0 || progress.partial > 0);

          return (
            <div key={sc.id} className="border rounded-lg overflow-hidden">
              {/* SC Header */}
              <div
                className="flex items-center gap-3 px-4 py-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => toggleExpand(sc.id)}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className="font-mono text-sm font-semibold">{sc.number}</span>
                {getStatusBadge(derivedStatus)}
                <Lock className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {sc.origin === "package" ? "Paquete" : "Manual"} · {sc.date} · {sc.lines.length} línea(s)
                </span>

                {/* Progress mini-badges */}
                {sc.lines.length > 0 && (
                  <div className="flex items-center gap-1 ml-2">
                    {progress.complete > 0 && (
                      <Badge className="text-[10px] bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                        ✓ {progress.complete}
                      </Badge>
                    )}
                    {progress.excess > 0 && (
                      <Badge className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-100" title="Ordenado mayor que lo solicitado">
                        ↑ {progress.excess}
                      </Badge>
                    )}
                    {progress.partial > 0 && (
                      <Badge className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-100">
                        ◐ {progress.partial}
                      </Badge>
                    )}
                    {progress.pending > 0 && (
                      <Badge className="text-[10px] bg-muted text-muted-foreground hover:bg-muted">
                        ○ {progress.pending}
                      </Badge>
                    )}
                  </div>
                )}

                <div className="flex-1" />

                {/* Cotizaciones existentes de esta SC */}
                {(() => {
                  const qList = quotationsByRequest.get(sc.id) || [];
                  if (qList.length === 0) return null;
                  return (
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Scale className="h-3 w-3" />
                      <span>
                        {qList.length} {qList.length === 1 ? "cotización" : "cotizaciones"}
                      </span>
                    </div>
                  );
                })()}

                {canGenerateOC && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={(e) => { e.stopPropagation(); createQuotationFromSC(sc); }}
                    disabled={creatingQuotationFor === sc.id}
                    title="Generar una nueva cotización a partir de esta SC"
                  >
                    <Scale className="h-3.5 w-3.5 mr-1" />
                    {creatingQuotationFor === sc.id ? "Creando…" : "Nueva cotización"}
                  </Button>
                )}

                {canGenerateOC && (
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={(e) => { e.stopPropagation(); openGenerateOC(sc); }}
                  >
                    <ShoppingCart className="h-3.5 w-3.5 mr-1" />
                    Generar OC
                  </Button>
                )}

                {canMarkCompleted && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={(e) => { e.stopPropagation(); markSCCompleted(sc); }}
                    title="Forzar cierre de la SC (lo pendiente no se ordenará)"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    Marcar Completada
                  </Button>
                )}

                {canCancel && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); cancelSC(sc.id); }}
                    title="Cancelar solicitud"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* SC Lines (READ-ONLY) */}
              {isExpanded && (
                <div className="p-4 space-y-2">
                  {sc.comment !== null && sc.comment !== "" && (
                    <p className="text-xs text-muted-foreground italic mb-2">{sc.comment}</p>
                  )}

                  {sc.lines.length > 0 && (
                    <>
                      <div className="grid grid-cols-[1fr_2fr_90px_90px_90px_70px_110px_1fr] gap-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-2 pb-1 border-b">
                        <span>EDT</span>
                        <span>Descripción</span>
                        <span className="text-right">Solicitado</span>
                        <span className="text-right">Ordenado</span>
                        <span className="text-right">Pendiente</span>
                        <span className="text-center">Unidad</span>
                        <span>F. Necesidad</span>
                        <span>Estado / OC</span>
                      </div>

                      {sc.lines.map((line) => {
                        const requested = Number(line.quantity);
                        const ordered = getOrderedQty(line);
                        const remaining = getRemainingQty(line);
                        const status = getLineStatus(line);
                        const ocs = getLineOCs(line);
                        const isFullyOrdered = status === "complete" || status === "excess";
                        return (
                          <div
                            key={line.id}
                            className={cn(
                              "grid grid-cols-[1fr_2fr_90px_90px_90px_70px_110px_1fr] gap-2 items-center text-xs px-2 py-1.5 rounded hover:bg-muted/20",
                              isFullyOrdered && "bg-muted/20"
                            )}
                          >
                            <span className={cn(
                              "truncate text-muted-foreground",
                              isFullyOrdered && "line-through"
                            )}>{getSubName(line.subcategory_id)}</span>
                            <span className={cn(
                              "truncate",
                              isFullyOrdered && "line-through text-muted-foreground"
                            )}>{line.description}</span>
                            <span className={cn(
                              "text-right font-mono",
                              isFullyOrdered && "line-through text-muted-foreground"
                            )}>{formatQty(requested)}</span>
                            <span className="text-right font-mono text-amber-600">{formatQty(ordered)}</span>
                            <span className={cn(
                              "text-right font-mono",
                              remaining === 0 ? "text-muted-foreground" : "text-amber-600 font-semibold"
                            )}>
                              {formatQty(remaining)}
                            </span>
                            <span className={cn(
                              "text-center text-muted-foreground",
                              isFullyOrdered && "line-through"
                            )}>{line.unit}</span>
                            <span className={cn(
                              "text-muted-foreground",
                              isFullyOrdered && "line-through"
                            )}>
                              {line.need_date ? new Date(line.need_date).toLocaleDateString("es") : "—"}
                            </span>
                            <span className="flex items-center gap-1 flex-wrap">
                              {status === "complete" && (
                                <Badge className="text-[10px] bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                                  Completa
                                </Badge>
                              )}
                              {status === "excess" && (
                                <Badge
                                  className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-100"
                                  title={`Ordenado ${formatQty(ordered)} / Solicitado ${formatQty(requested)}`}
                                >
                                  Sobrepedido +{formatQty(ordered - requested)}
                                </Badge>
                              )}
                              {status === "partial" && (
                                <Badge className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-100">
                                  Parcial
                                </Badge>
                              )}
                              {status === "pending" && (
                                <Badge className="text-[10px] bg-muted text-muted-foreground hover:bg-muted">
                                  Pendiente
                                </Badge>
                              )}
                              {ocs.map((n) => (
                                <span key={n} className="text-[10px] font-mono text-muted-foreground">
                                  {n}
                                </span>
                              ))}
                            </span>
                          </div>
                        );
                      })}

                      {/* TOTAL row — aggregated by unit */}
                      {(() => {
                        const requestedSummary = summarizeByUnit(
                          sc.lines.map((l) => ({ qty: Number(l.quantity), unit: l.unit }))
                        );
                        const orderedSummary = summarizeByUnit(
                          sc.lines.map((l) => ({ qty: getOrderedQty(l), unit: l.unit }))
                        );
                        const pendingSummary = summarizeByUnit(
                          sc.lines.map((l) => ({ qty: getRemainingQty(l), unit: l.unit }))
                        );
                        return (
                          <div className="grid grid-cols-[1fr_2fr_90px_90px_90px_70px_110px_1fr] gap-2 items-center text-xs px-2 py-2 mt-1 border-t-2 bg-muted/40 font-semibold">
                            <span />
                            <span className="text-right text-[11px] uppercase tracking-wider text-muted-foreground font-mono">
                              TOTAL
                            </span>
                            <span className="text-right font-mono" title={requestedSummary}>
                              {requestedSummary}
                            </span>
                            <span className="text-right font-mono text-[#E87722]" title={orderedSummary}>
                              {orderedSummary}
                            </span>
                            <span className="text-right font-mono text-amber-700" title={pendingSummary}>
                              {pendingSummary}
                            </span>
                            <span />
                            <span />
                            <span />
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ─────── Package Import Dialog ─────── */}
      <Dialog open={packageDialogOpen} onOpenChange={setPackageDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Importar desde Paquetes</DialogTitle>
          </DialogHeader>
          {packages.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No hay paquetes aprobados para importar.
            </p>
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-auto">
              {packages.map((pkg) => (
                <label
                  key={pkg.id}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                    selectedPackages.has(pkg.id)
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedPackages.has(pkg.id)}
                    onChange={() => {
                      setSelectedPackages((prev) => {
                        const next = new Set(prev);
                        if (next.has(pkg.id)) next.delete(pkg.id);
                        else next.add(pkg.id);
                        return next;
                      });
                    }}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{pkg.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {pkg.purchase_type} · {pkg.procurement_lines.length} insumo(s) · {pkg.status}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setPackageDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={importFromPackages}
              disabled={selectedPackages.size === 0 || importingPackages}
            >
              {importingPackages
                ? "Importando..."
                : `Importar ${selectedPackages.size} paquete(s)`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─────── Manual SC Dialog ─────── */}
      <Dialog open={manualDialogOpen} onOpenChange={setManualDialogOpen}>
        <DialogContent className="sm:max-w-[85vw] w-[85vw] max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Nueva Solicitud de Compra
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
            <Lock className="h-3 w-3" /> Una vez creada, las líneas no podrán modificarse
          </p>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Comentario (opcional)</label>
              <Input
                className="mt-1"
                value={manualComment}
                onChange={(e) => setManualComment(e.target.value)}
                placeholder="Motivo, proyecto relacionado, etc..."
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-muted-foreground">Líneas</label>
                <Button size="sm" variant="outline" onClick={addManualLine}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Agregar línea
                </Button>
              </div>

              <div className="grid grid-cols-[1fr_2fr_90px_70px_120px_40px] gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 pb-1 border-b">
                <span>EDT</span>
                <span>Descripción</span>
                <span className="text-right">Cantidad</span>
                <span className="text-center">Unidad</span>
                <span>F. Necesidad</span>
                <span />
              </div>

              <div className="space-y-2 mt-2">
                {manualLines.map((line) => (
                  <div key={line.tmpId} className="grid grid-cols-[1fr_2fr_90px_70px_120px_40px] gap-2 items-center">
                    <Select
                      value={line.subcategory_id || ""}
                      onValueChange={(v) => updateManualLine(line.tmpId, "subcategory_id", v)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <span className="truncate text-left">
                          {line.subcategory_id ? getSubName(line.subcategory_id) : "EDT..."}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {categories.flatMap((cat) =>
                          subcategories
                            .filter((s) => s.category_id === cat.id)
                            .map((sub) => (
                              <SelectItem key={sub.id} value={sub.id} className="text-xs">
                                {cat.code}.{sub.code?.split(".")[1]} {sub.name}
                              </SelectItem>
                            ))
                        )}
                      </SelectContent>
                    </Select>

                    <Input
                      className="h-8 text-xs"
                      value={line.description}
                      placeholder="Descripción..."
                      onChange={(e) => updateManualLine(line.tmpId, "description", e.target.value)}
                    />

                    <Input
                      className="h-8 text-xs text-right"
                      type="number"
                      value={line.quantity || ""}
                      onChange={(e) => updateManualLine(line.tmpId, "quantity", parseFloat(e.target.value) || 0)}
                    />

                    <Select
                      value={line.unit}
                      onValueChange={(v) => updateManualLine(line.tmpId, "unit", v)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <span>{line.unit}</span>
                      </SelectTrigger>
                      <SelectContent>
                        {DEFAULT_UNITS.map((u) => (
                          <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Input
                      className="h-8 text-xs"
                      type="date"
                      value={line.need_date || ""}
                      onChange={(e) => updateManualLine(line.tmpId, "need_date", e.target.value || null)}
                    />

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => removeManualLine(line.tmpId)}
                      disabled={manualLines.length <= 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setManualDialogOpen(false)} disabled={creatingManual}>
              Cancelar
            </Button>
            <Button onClick={createManualSC} disabled={creatingManual}>
              {creatingManual ? "Creando..." : "Crear Solicitud"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─────── Generate OC Dialog ─────── */}
      <Dialog open={generateOCFor !== null} onOpenChange={(open) => !open && setGenerateOCFor(null)}>
        <DialogContent className="sm:max-w-[95vw] w-[95vw] h-[90vh] max-h-[90vh] p-0 gap-0 flex flex-col">
          {/* Fixed header */}
          <div className="flex-none px-6 py-4 border-b">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg">
                <ShoppingCart className="h-5 w-5" />
                Generar Orden de Compra desde <span className="font-mono">{generateOCFor?.number}</span>
              </DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground mt-1">
              Selecciona las líneas a ordenar. Puedes ordenar parcialmente o generar múltiples OCs a lo largo del tiempo.
            </p>
          </div>

          {generateOCFor && (
            <>
              {/* Scrollable body */}
              <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
                {/* Two-column: OC config on left, Financial config on right */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Column 1: Supplier + Currency + Comment */}
                  <div className="border rounded-lg p-4 space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Datos de la OC</p>
                    <div className="grid grid-cols-[1fr_120px] gap-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Proveedor *</label>
                        <SupplierPicker
                          className="mt-1"
                          projectId={projectId}
                          suppliers={projectSuppliers}
                          selectedId={ocSupplierId}
                          onSelect={(s) => {
                            setOcSupplierId(s.id);
                            setOcSupplier(s.name);
                          }}
                          onSupplierCreated={(s) => setProjectSuppliers((prev) => [...prev, s].sort((a, b) => a.name.localeCompare(b.name)))}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Moneda</label>
                        <Select value={ocCurrency} onValueChange={(v) => { if (v) setOcCurrency(v); }}>
                          <SelectTrigger className="mt-1 w-full">
                            <span>{CURRENCIES.find((c) => c.code === ocCurrency)?.code || ocCurrency}</span>
                          </SelectTrigger>
                          <SelectContent>
                            {CURRENCIES.map((c) => (
                              <SelectItem key={c.code} value={c.code}>
                                {c.symbol} {c.code} — {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Comentario</label>
                      <Input
                        className="mt-1"
                        value={ocComment}
                        onChange={(e) => setOcComment(e.target.value)}
                        placeholder="Nota o comentario opcional..."
                      />
                    </div>
                  </div>

                  {/* Column 2: Payment terms */}
                  <div className="border rounded-lg p-4 space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Forma de Pago</p>

                    {/* Payment type radio-style selector */}
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { v: "contado", label: "Contado", desc: "Pago inmediato" },
                        { v: "credito", label: "Crédito", desc: "Pago a X días" },
                        { v: "contra_entrega", label: "Contra entrega", desc: "Pago al recibir" },
                        { v: "contrato", label: "Según contrato", desc: "Mediciones + anticipo" },
                      ].map((opt) => (
                        <label
                          key={opt.v}
                          className={cn(
                            "flex items-start gap-2 p-2 border rounded-md cursor-pointer transition-colors",
                            ocPaymentType === opt.v
                              ? "border-primary bg-primary/5"
                              : "hover:bg-muted/40"
                          )}
                        >
                          <input
                            type="radio"
                            name="ocPaymentType"
                            value={opt.v}
                            checked={ocPaymentType === opt.v}
                            onChange={() => setOcPaymentType(opt.v as typeof ocPaymentType)}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium">{opt.label}</p>
                            <p className="text-[10px] text-muted-foreground">{opt.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>

                    {/* Crédito: días */}
                    {ocPaymentType === "credito" && (
                      <div className="flex items-center gap-2 bg-muted/30 rounded-md p-2">
                        <label className="text-xs text-muted-foreground whitespace-nowrap">Días de crédito:</label>
                        <Input
                          className="h-8 text-xs w-24"
                          type="number"
                          value={ocCreditDays || ""}
                          onChange={(e) => setOcCreditDays(parseInt(e.target.value) || 0)}
                        />
                        <span className="text-xs text-muted-foreground">días desde factura</span>
                      </div>
                    )}

                    {/* Contrato: frecuencia + anticipo + amort + retención */}
                    {ocPaymentType === "contrato" && (
                      <div className="space-y-3 bg-muted/20 rounded-md p-3 border border-muted">
                        <div>
                          <label className="text-xs text-muted-foreground">Frecuencia de medición</label>
                          <Select
                            value={ocMeasurementFreq}
                            onValueChange={(v) => { if (v) setOcMeasurementFreq(v as typeof ocMeasurementFreq); }}
                          >
                            <SelectTrigger className="h-8 text-xs mt-1">
                              <span>{
                                ocMeasurementFreq === "semanal" ? "Semanal" :
                                ocMeasurementFreq === "quincenal" ? "Quincenal" : "Mensual"
                              }</span>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="semanal">Semanal</SelectItem>
                              <SelectItem value="quincenal">Quincenal</SelectItem>
                              <SelectItem value="mensual">Mensual</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="border-t pt-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id="hasAdvanceGen"
                              checked={ocHasAdvance}
                              onChange={(e) => setOcHasAdvance(e.target.checked)}
                            />
                            <label htmlFor="hasAdvanceGen" className="text-xs font-medium">Tiene anticipo</label>
                          </div>
                          {ocHasAdvance && (
                            <div className="grid grid-cols-[1fr_110px] gap-2 mt-2">
                              <Select value={ocAdvanceType} onValueChange={(v) => setOcAdvanceType(v as "amount" | "percentage")}>
                                <SelectTrigger className="h-8 text-xs w-full">
                                  <span>{ocAdvanceType === "percentage" ? "Porcentaje" : "Monto fijo"}</span>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="percentage">Porcentaje</SelectItem>
                                  <SelectItem value="amount">Monto fijo</SelectItem>
                                </SelectContent>
                              </Select>
                              <Input
                                className={cn(
                                  "h-8 text-xs",
                                  ocHasAdvance && (!ocAdvanceAmount || ocAdvanceAmount <= 0) && "border-destructive/60 focus-visible:ring-destructive/30"
                                )}
                                type="number"
                                value={ocAdvanceAmount || ""}
                                onChange={(e) => setOcAdvanceAmount(parseFloat(e.target.value) || 0)}
                                placeholder={ocAdvanceType === "percentage" ? "% *" : "Monto *"}
                              />
                            </div>
                          )}
                        </div>

                        {ocHasAdvance && (
                          <div className="border-t pt-2 space-y-2">
                            <label className="text-xs text-muted-foreground font-medium">
                              Forma de amortización del anticipo <span className="text-destructive">*</span>
                            </label>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setOcAmortMode("percentage")}
                                className={cn(
                                  "flex-1 text-xs px-3 py-2 rounded-md border transition-colors text-left",
                                  ocAmortMode === "percentage"
                                    ? "bg-primary/10 border-primary text-foreground"
                                    : "bg-background hover:bg-muted"
                                )}
                              >
                                <div className="font-medium">% fijo por medición</div>
                                <div className="text-[10px] text-muted-foreground">Se descuenta el mismo % en cada recepción</div>
                              </button>
                              <button
                                type="button"
                                onClick={() => setOcAmortMode("per_certification")}
                                className={cn(
                                  "flex-1 text-xs px-3 py-2 rounded-md border transition-colors text-left",
                                  ocAmortMode === "per_certification"
                                    ? "bg-primary/10 border-primary text-foreground"
                                    : "bg-background hover:bg-muted"
                                )}
                              >
                                <div className="font-medium">Monto por certificación</div>
                                <div className="text-[10px] text-muted-foreground">Se indica el monto al registrar cada recepción</div>
                              </button>
                            </div>
                            {ocAmortMode === "percentage" && (
                              <div>
                                <label className="text-xs text-muted-foreground">
                                  Amortización % <span className="text-destructive">*</span>
                                </label>
                                <Input
                                  className={cn(
                                    "h-8 text-xs mt-1",
                                    (!ocAmortPct || ocAmortPct <= 0) && "border-destructive/60 focus-visible:ring-destructive/30"
                                  )}
                                  type="number"
                                  value={ocAmortPct || ""}
                                  onChange={(e) => setOcAmortPct(parseFloat(e.target.value) || 0)}
                                  placeholder="Requerido"
                                />
                              </div>
                            )}
                          </div>
                        )}

                        <div className="border-t pt-2">
                          <label className="text-xs text-muted-foreground">
                            Retención % <span className="text-[10px]">(opcional, por medición)</span>
                          </label>
                          <Input
                            className="h-8 text-xs mt-1"
                            type="number"
                            value={ocRetentionPct || ""}
                            onChange={(e) => setOcRetentionPct(parseFloat(e.target.value) || 0)}
                            placeholder="Sin retención"
                          />
                        </div>

                        {ocRetentionPct > 0 && (
                          <div>
                            <label className="text-xs text-muted-foreground">Condición devolución retención</label>
                            <Input
                              className="h-8 text-xs mt-1"
                              value={ocReturnCondition}
                              onChange={(e) => setOcReturnCondition(e.target.value)}
                              placeholder="Ej: 30 días post-finalización, contra acta..."
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Notas generales sobre el pago */}
                    <div>
                      <label className="text-xs text-muted-foreground">Notas sobre la forma de pago</label>
                      <Input
                        className="h-8 text-xs mt-1"
                        value={ocPaymentNotes}
                        onChange={(e) => setOcPaymentNotes(e.target.value)}
                        placeholder="Detalles adicionales..."
                      />
                    </div>
                  </div>
                </div>

                {/* Line selector - full width */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">
                      Líneas a ordenar ({Array.from(ocLineSel.values()).filter((s) => s.selected && s.qty > 0).length} seleccionada{Array.from(ocLineSel.values()).filter((s) => s.selected && s.qty > 0).length === 1 ? "" : "s"})
                    </p>
                    <div className="flex gap-2 text-xs">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          setOcLineSel((prev) => {
                            const next = new Map(prev);
                            for (const [k, v] of next) next.set(k, { ...v, selected: v.qty > 0 });
                            return next;
                          });
                        }}
                      >
                        Seleccionar todas
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          setOcLineSel((prev) => {
                            const next = new Map(prev);
                            for (const [k, v] of next) next.set(k, { ...v, selected: false });
                            return next;
                          });
                        }}
                      >
                        Deseleccionar
                      </Button>
                    </div>
                  </div>

                  <div className="border rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[36px_140px_140px_minmax(0,1fr)_70px_60px_90px_110px_100px_32px] gap-2 px-3 py-2 bg-muted/40 text-[10px] font-semibold uppercase tracking-wider border-b">
                      <span />
                      <span>Sector *</span>
                      <span>EDT *</span>
                      <span>Descripción</span>
                      <span className="text-right">Pend.</span>
                      <span>Unidad</span>
                      <span className="text-right">Cant. OC</span>
                      <span className="text-right">P. Unitario</span>
                      <span className="text-right">Subtotal</span>
                      <span />
                    </div>

                    <div>
                      {generateOCFor.lines.map((line) => {
                        const remaining = getRemainingQty(line);
                        const sel = ocLineSel.get(line.id) || {
                          selected: false, qty: 0, unitPrice: 0,
                          sector_id: null, subcategory_id: line.subcategory_id,
                        };
                        const subtotal = sel.qty * sel.unitPrice;
                        const isFullyOrdered = remaining === 0;
                        const qtyDiff = sel.selected && sel.qty > 0 ? sel.qty - remaining : 0;
                        const hasExcess = qtyDiff > 0.001;
                        const hasShortage = qtyDiff < -0.001;

                        return (
                          <div
                            key={line.id}
                            className={cn(
                              "grid grid-cols-[36px_140px_140px_minmax(0,1fr)_70px_60px_90px_110px_100px_32px] gap-2 px-3 py-2 items-center border-b last:border-b-0 text-xs",
                              isFullyOrdered && !sel.selected && "opacity-50 bg-muted/20",
                              sel.selected && !hasExcess && !hasShortage && "bg-primary/5",
                              sel.selected && (hasExcess || hasShortage) && "bg-amber-50"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={sel.selected}
                              onChange={(e) => {
                                setOcLineSel((prev) => {
                                  const next = new Map(prev);
                                  const defaultQty = e.target.checked && sel.qty === 0 && remaining > 0 ? remaining : sel.qty;
                                  next.set(line.id, { ...sel, selected: e.target.checked, qty: defaultQty });
                                  return next;
                                });
                              }}
                            />

                            {/* Sector (required) */}
                            <Select
                              value={sel.sector_id || ""}
                              onValueChange={(v) => v && setOcLineSel((prev) => {
                                const next = new Map(prev);
                                next.set(line.id, { ...sel, sector_id: v });
                                return next;
                              })}
                            >
                              <SelectTrigger className={cn("h-8 text-xs w-full", sel.selected && !sel.sector_id && "border-destructive/40")}>
                                <span className="truncate">
                                  {sel.sector_id ? sectors.find((s) => s.id === sel.sector_id)?.name || "—" : "Sector..."}
                                </span>
                              </SelectTrigger>
                              <SelectContent>
                                {sectors.map((s) => (
                                  <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            {/* EDT (editable per OC) */}
                            <Select
                              value={sel.subcategory_id || ""}
                              onValueChange={(v) => v && setOcLineSel((prev) => {
                                const next = new Map(prev);
                                next.set(line.id, { ...sel, subcategory_id: v });
                                return next;
                              })}
                            >
                              <SelectTrigger className={cn("h-8 text-xs w-full", sel.selected && !sel.subcategory_id && "border-destructive/40")}>
                                <span className="truncate text-left">
                                  {sel.subcategory_id ? getSubName(sel.subcategory_id) : "EDT..."}
                                </span>
                              </SelectTrigger>
                              <SelectContent>
                                {categories.flatMap((cat) =>
                                  subcategories
                                    .filter((s) => s.category_id === cat.id)
                                    .map((sub) => (
                                      <SelectItem key={sub.id} value={sub.id} className="text-xs">
                                        {cat.code}.{sub.code?.split(".")[1]} {sub.name}
                                      </SelectItem>
                                    ))
                                )}
                              </SelectContent>
                            </Select>

                            <span className="truncate flex items-center gap-1" title={line.description}>
                              {line.description}
                              {hasExcess && (
                                <span className="text-[9px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded whitespace-nowrap">
                                  +{formatQty(qtyDiff)}
                                </span>
                              )}
                              {hasShortage && sel.qty > 0 && (
                                <span className="text-[9px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded whitespace-nowrap">
                                  Parcial
                                </span>
                              )}
                            </span>
                            <span className="text-right font-mono">{formatQty(remaining)}</span>
                            <span className="text-muted-foreground">{line.unit}</span>
                            <Input
                              className="h-8 text-xs text-right"
                              type="number"
                              value={sel.qty || ""}
                              disabled={!sel.selected}
                              onChange={(e) => {
                                const v = Math.max(0, parseFloat(e.target.value) || 0);
                                setOcLineSel((prev) => {
                                  const next = new Map(prev);
                                  next.set(line.id, { ...sel, qty: v });
                                  return next;
                                });
                              }}
                            />
                            <PriceSuggestionsInput
                              value={sel.unitPrice}
                              disabled={!sel.selected}
                              currency={ocCurrency}
                              projectTc={Number(project?.exchange_rate || 0)}
                              suggestions={getPriceSuggestions(line)}
                              onChange={(v) => {
                                setOcLineSel((prev) => {
                                  const next = new Map(prev);
                                  next.set(line.id, { ...sel, unitPrice: v });
                                  return next;
                                });
                              }}
                            />
                            <span className="text-right font-mono font-semibold">
                              {formatQty(subtotal)}
                            </span>
                            <span />
                          </div>
                        );
                      })}

                      {/* Extra lines (added on the fly) */}
                      {ocExtraLines.map((ex) => {
                        const subtotal = ex.quantity * ex.unit_price;
                        return (
                          <div
                            key={ex.tmpId}
                            className="grid grid-cols-[36px_140px_140px_minmax(0,1fr)_70px_60px_90px_110px_100px_32px] gap-2 px-3 py-2 items-center border-b last:border-b-0 text-xs bg-emerald-50/40"
                          >
                            <span className="text-[10px] font-mono text-emerald-700 font-semibold text-center">
                              +
                            </span>
                            {/* Sector */}
                            <Select
                              value={ex.sector_id || ""}
                              onValueChange={(v) => v && updateOcExtraLine(ex.tmpId, { sector_id: v })}
                            >
                              <SelectTrigger className={cn("h-8 text-xs w-full", !ex.sector_id && "border-destructive/40")}>
                                <span className="truncate">
                                  {ex.sector_id ? sectors.find((s) => s.id === ex.sector_id)?.name || "—" : "Sector..."}
                                </span>
                              </SelectTrigger>
                              <SelectContent>
                                {sectors.map((s) => (
                                  <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {/* EDT */}
                            <Select
                              value={ex.subcategory_id || ""}
                              onValueChange={(v) => v && updateOcExtraLine(ex.tmpId, { subcategory_id: v })}
                            >
                              <SelectTrigger className={cn("h-8 text-xs w-full", !ex.subcategory_id && "border-destructive/40")}>
                                <span className="truncate text-left">
                                  {ex.subcategory_id ? getSubName(ex.subcategory_id) : "EDT..."}
                                </span>
                              </SelectTrigger>
                              <SelectContent>
                                {categories.flatMap((cat) =>
                                  subcategories
                                    .filter((s) => s.category_id === cat.id)
                                    .map((sub) => (
                                      <SelectItem key={sub.id} value={sub.id} className="text-xs">
                                        {cat.code}.{sub.code?.split(".")[1]} {sub.name}
                                      </SelectItem>
                                    ))
                                )}
                              </SelectContent>
                            </Select>
                            {/* Insumo picker (description from insumo) */}
                            <InsumoPicker
                              projectId={projectId}
                              insumos={insumos}
                              selectedInsumoId={ex.insumo_id}
                              onSelect={(ins) => selectExtraInsumo(ex.tmpId, ins)}
                              onInsumoCreated={(ins) => setInsumos((prev) => [...prev, ins])}
                            />
                            <span className="text-right text-muted-foreground text-[10px]">— extra</span>
                            <Select
                              value={ex.unit}
                              onValueChange={(v) => v && updateOcExtraLine(ex.tmpId, { unit: v })}
                            >
                              <SelectTrigger className="h-8 text-xs w-full">
                                <span>{ex.unit}</span>
                              </SelectTrigger>
                              <SelectContent>
                                {DEFAULT_UNITS.map((u) => (
                                  <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              className="h-8 text-xs text-right"
                              type="number"
                              value={ex.quantity || ""}
                              onChange={(e) => updateOcExtraLine(ex.tmpId, { quantity: Math.max(0, parseFloat(e.target.value) || 0) })}
                            />
                            <Input
                              className="h-8 text-xs text-right"
                              type="number"
                              value={ex.unit_price || ""}
                              onChange={(e) => updateOcExtraLine(ex.tmpId, { unit_price: parseFloat(e.target.value) || 0 })}
                            />
                            <span className="text-right font-mono font-semibold">{formatQty(subtotal)}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => removeOcExtraLine(ex.tmpId)}
                              title="Quitar línea"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Add extra line button */}
                    <div className="px-3 py-2 border-t bg-muted/20">
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addOcExtraLine}>
                        <Plus className="h-3 w-3 mr-1" /> Agregar línea extra (no planificada)
                      </Button>
                    </div>

                    {/* Total row */}
                    <div className="grid grid-cols-[36px_140px_140px_minmax(0,1fr)_70px_60px_90px_110px_100px_32px] gap-2 px-3 py-3 bg-muted/60 items-center border-t-2">
                      <span className="col-span-8 text-right text-sm font-bold">TOTAL</span>
                      <span className="text-right font-mono font-bold text-base" style={{ color: "#E87722" }}>
                        {ocCurrency} {formatQty(
                          Array.from(ocLineSel.entries())
                            .filter(([, s]) => s.selected)
                            .reduce((sum, [, s]) => sum + s.qty * s.unitPrice, 0)
                          + ocExtraLines.reduce((sum, e) => sum + e.quantity * e.unit_price, 0)
                        )}
                      </span>
                      <span />
                    </div>
                  </div>
                </div>
              </div>

              {/* Fixed footer */}
              <div className="flex-none border-t bg-muted/30 px-6 py-3 flex justify-between items-center">
                <div className="text-xs text-muted-foreground">
                  {Array.from(ocLineSel.values()).filter((s) => s.selected && s.qty > 0).length} línea(s) seleccionada(s)
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setGenerateOCFor(null)} disabled={generatingOC}>
                    Cancelar
                  </Button>
                  <Button onClick={submitGenerateOC} disabled={generatingOC}>
                    {generatingOC ? "Creando OC..." : "Crear Orden de Compra"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
