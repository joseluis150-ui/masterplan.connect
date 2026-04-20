"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  FileText,
  Link as LinkIcon,
  PackageCheck,
  Truck,
  Pencil,
  History,
  HandCoins,
} from "lucide-react";
import { toast } from "sonner";
import { OC_STATUSES, CURRENCIES, DEFAULT_UNITS } from "@/lib/constants/units";
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  PurchaseRequest,
  PurchaseRequestLine,
  EdtSubcategory,
  EdtCategory,
  ReceptionNote,
  DeliveryNote,
  Insumo,
  Sector,
  Project,
} from "@/lib/types/database";
import { InsumoPicker } from "./insumo-picker";
import { cn } from "@/lib/utils";
import { logActivity } from "@/lib/utils/activity-log";
import { createAdvanceReception, resolveAdvanceAmount } from "@/lib/utils/oc-advance";

interface Props {
  projectId: string;
}

type OCWithLines = PurchaseOrder & { lines: PurchaseOrderLine[] };

export function OrdenesTab({ projectId }: Props) {
  const supabase = createClient();
  const [orders, setOrders] = useState<OCWithLines[]>([]);
  const [categories, setCategories] = useState<EdtCategory[]>([]);
  const [subcategories, setSubcategories] = useState<EdtSubcategory[]>([]);
  const [requests, setRequests] = useState<(PurchaseRequest & { lines: PurchaseRequestLine[] })[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Filters
  const [filterStatus, setFilterStatus] = useState<PurchaseOrderStatus | "all">("all");
  const [filterSupplier, setFilterSupplier] = useState<string>("all");
  const [searchText, setSearchText] = useState("");

  // Receptions (albaranes) — Map<orderId, ReceptionNote[]>
  const [receptions, setReceptions] = useState<Map<string, (ReceptionNote & { lines: DeliveryNote[] })[]>>(new Map());

  // Reception dialog state
  const [receptionFor, setReceptionFor] = useState<OCWithLines | null>(null);
  const [receptionDate, setReceptionDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [receptionComment, setReceptionComment] = useState("");
  // Per OC line: { selected, qtyReceived, unitPrice, amortAmount }
  // amortAmount is only used when OC.amortization_mode === 'per_certification'
  const [receptionLineSel, setReceptionLineSel] = useState<Map<string, { selected: boolean; qtyReceived: number; unitPrice: number; amortAmount: number }>>(new Map());
  const [savingReception, setSavingReception] = useState(false);

  // Create OC dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newSupplier, setNewSupplier] = useState("");
  const [newCurrency, setNewCurrency] = useState("USD");
  const [newHasAdvance, setNewHasAdvance] = useState(false);
  const [newAdvanceAmount, setNewAdvanceAmount] = useState(0);
  const [newAdvanceType, setNewAdvanceType] = useState<"amount" | "percentage">("percentage");
  const [newAmortMode, setNewAmortMode] = useState<"percentage" | "per_certification">("percentage");
  const [newAmortPct, setNewAmortPct] = useState(0);
  const [newRetentionPct, setNewRetentionPct] = useState(0);
  const [newReturnCondition, setNewReturnCondition] = useState("");
  const [newComment, setNewComment] = useState("");
  const [creating, setCreating] = useState(false);

  // Manual OC line editor state
  type NewLine = {
    tmpId: string;
    sector_id: string | null;
    subcategory_id: string | null;
    insumo_id: string | null;
    description: string;
    quantity: number;
    unit: string;
    unit_price: number;
  };
  const [newLines, setNewLines] = useState<NewLine[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [insumos, setInsumos] = useState<Insumo[]>([]);

  // Edit OC dialog
  const [editingOC, setEditingOC] = useState<OCWithLines | null>(null);
  const [editSupplier, setEditSupplier] = useState("");
  const [editCurrency, setEditCurrency] = useState("USD");
  const [editAmortPct, setEditAmortPct] = useState(0);
  const [editRetentionPct, setEditRetentionPct] = useState(0);
  const [editReturnCondition, setEditReturnCondition] = useState("");
  const [editComment, setEditComment] = useState("");
  // Line edits: Map<lineId, { quantity, unit_price }>
  const [editLines, setEditLines] = useState<Map<string, { quantity: number; unit_price: number }>>(new Map());
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const loadData = useCallback(async () => {
    const [ordRes, catsRes, subsRes, reqRes, sectorsRes, insumosRes, projectRes] = await Promise.all([
      supabase
        .from("purchase_orders")
        .select("*, lines:purchase_order_lines(*)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      supabase.from("edt_categories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase
        .from("purchase_requests")
        .select("*, lines:purchase_request_lines(*)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      supabase.from("sectors").select("*").eq("project_id", projectId).order("order"),
      supabase.from("insumos").select("*").eq("project_id", projectId).order("code"),
      supabase.from("projects").select("*").eq("id", projectId).single(),
    ]);
    const orderList = (ordRes.data || []) as OCWithLines[];
    setOrders(orderList);
    setCategories(catsRes.data || []);
    setSubcategories(subsRes.data || []);
    setRequests((reqRes.data || []) as (PurchaseRequest & { lines: PurchaseRequestLine[] })[]);
    setSectors((sectorsRes.data || []) as Sector[]);
    setInsumos((insumosRes.data || []) as Insumo[]);
    if (projectRes.data) setProject(projectRes.data as Project);

    // Load receptions for all OCs
    if (orderList.length > 0) {
      const ocIds = orderList.map((o) => o.id);
      const { data: recData } = await supabase
        .from("reception_notes")
        .select("*, lines:delivery_notes(*)")
        .in("order_id", ocIds)
        .order("number", { ascending: true });

      const map = new Map<string, (ReceptionNote & { lines: DeliveryNote[] })[]>();
      for (const rec of (recData || []) as (ReceptionNote & { lines: DeliveryNote[] })[]) {
        const arr = map.get(rec.order_id) || [];
        arr.push(rec);
        map.set(rec.order_id, arr);
      }
      setReceptions(map);
    } else {
      setReceptions(new Map());
    }

    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // Create OC
  async function createOC() {
    if (!newSupplier.trim()) {
      toast.error("Proveedor es requerido");
      return;
    }
    if (newLines.length === 0) {
      toast.error("Agregá al menos una línea a la OC");
      return;
    }

    if (newHasAdvance) {
      if (!newAdvanceAmount || newAdvanceAmount <= 0) {
        toast.error(`Debés ingresar el ${newAdvanceType === "percentage" ? "% del anticipo" : "monto del anticipo"}`);
        return;
      }
      if (newAmortMode === "percentage" && (!newAmortPct || newAmortPct <= 0)) {
        toast.error("Debés ingresar el % de amortización o cambiar a modo 'monto por certificación'");
        return;
      }
    }

    // Validate all lines have sector + EDT + insumo + qty/price
    for (const [idx, line] of newLines.entries()) {
      if (!line.sector_id) {
        toast.error(`Línea ${idx + 1}: Sector es requerido`);
        return;
      }
      if (!line.subcategory_id) {
        toast.error(`Línea ${idx + 1}: EDT es requerido`);
        return;
      }
      if (!line.insumo_id) {
        toast.error(`Línea ${idx + 1}: Insumo es requerido`);
        return;
      }
      if (line.quantity <= 0) {
        toast.error(`Línea ${idx + 1}: Cantidad debe ser mayor a 0`);
        return;
      }
    }

    setCreating(true);
    try {
      const { data: numData } = await supabase.rpc("next_document_number", {
        p_project_id: projectId,
        p_doc_type: "OC",
      });
      const number = numData || `OC-${new Date().getFullYear()}-???`;

      const { data: ocData, error } = await supabase
        .from("purchase_orders")
        .insert({
          project_id: projectId,
          number,
          supplier: newSupplier.trim(),
          currency: newCurrency,
          has_advance: newHasAdvance,
          advance_amount: newHasAdvance ? newAdvanceAmount : 0,
          advance_type: newHasAdvance ? newAdvanceType : null,
          amortization_mode: newHasAdvance ? newAmortMode : "percentage",
          amortization_pct: newHasAdvance && newAmortMode === "per_certification" ? 0 : newAmortPct,
          retention_pct: newRetentionPct,
          return_condition: newReturnCondition || null,
          comment: newComment || null,
          status: "open",
        })
        .select()
        .single();

      if (error || !ocData) {
        toast.error(`Error al crear OC: ${error?.message}`);
        return;
      }

      // Insert lines
      const linesPayload = newLines.map((l) => ({
        order_id: ocData.id,
        subcategory_id: l.subcategory_id!,
        sector_id: l.sector_id,
        insumo_id: l.insumo_id,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unit_price: l.unit_price,
      }));

      const { error: lErr } = await supabase
        .from("purchase_order_lines")
        .insert(linesPayload);

      if (lErr) {
        await supabase.from("purchase_orders").delete().eq("id", ocData.id);
        toast.error(`Error al insertar líneas: ${lErr.message}`);
        return;
      }

      // Auto-generate advance reception if OC has advance
      if (newHasAdvance && newAdvanceAmount > 0) {
        const ocTotal = newLines.reduce((s, l) => s + (l.quantity * l.unit_price), 0);
        const advanceAbs = resolveAdvanceAmount(newAdvanceType, newAdvanceAmount, ocTotal);
        if (advanceAbs > 0) {
          await createAdvanceReception({
            supabase,
            orderId: ocData.id,
            advanceAmountAbsolute: advanceAbs,
            note: `Anticipo ${newAdvanceType === "percentage" ? `${newAdvanceAmount}%` : "monto fijo"} · OC ${number}`,
          });
        }
      }

      await logActivity({
        projectId,
        actionType: "oc_generated",
        entityType: "purchase_order",
        entityId: ocData.id,
        description: `OC ${number} creada manualmente (${newSupplier.trim()}, ${newLines.length} línea${newLines.length === 1 ? "" : "s"})`,
        metadata: {
          ocId: ocData.id,
          ocNumber: number,
          supplier: newSupplier.trim(),
          lineCount: newLines.length,
          manual: true,
          hasAdvance: newHasAdvance,
        },
      });

      toast.success(`Orden ${number} creada${newHasAdvance ? " (con anticipo auto-generado)" : ""}`);
      resetCreateForm();
      setCreateOpen(false);
      loadData();
    } finally {
      setCreating(false);
    }
  }

  function resetCreateForm() {
    setNewSupplier("");
    setNewCurrency(project?.local_currency || "USD");
    setNewHasAdvance(false);
    setNewAdvanceAmount(0);
    setNewAdvanceType("percentage");
    setNewAmortMode("percentage");
    setNewAmortPct(0);
    setNewRetentionPct(0);
    setNewReturnCondition("");
    setNewComment("");
    setNewLines([]);
  }

  function addNewLine() {
    setNewLines((prev) => [
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

  function updateNewLine(tmpId: string, patch: Partial<NewLine>) {
    setNewLines((prev) => prev.map((l) => (l.tmpId === tmpId ? { ...l, ...patch } : l)));
  }

  function removeNewLine(tmpId: string) {
    setNewLines((prev) => prev.filter((l) => l.tmpId !== tmpId));
  }

  function selectInsumoForLine(tmpId: string, ins: Insumo) {
    updateNewLine(tmpId, {
      insumo_id: ins.id,
      description: ins.description,
      unit: ins.unit,
      unit_price: Number(ins.pu_usd || 0),
    });
  }

  // Add line to OC
  async function addLine(orderId: string) {
    const defaultSub = subcategories[0];
    if (!defaultSub) {
      toast.error("No hay subcategorías EDT disponibles");
      return;
    }
    const { data, error } = await supabase
      .from("purchase_order_lines")
      .insert({
        order_id: orderId,
        subcategory_id: defaultSub.id,
        description: "",
        quantity: 1,
        unit: "U",
        unit_price: 0,
      })
      .select()
      .single();

    if (error) { toast.error("Error al agregar línea"); return; }
    setOrders(
      orders.map((o) =>
        o.id === orderId ? { ...o, lines: [...o.lines, data as PurchaseOrderLine] } : o
      )
    );
  }

  // Update line field
  async function updateLine(orderId: string, lineId: string, field: string, value: unknown) {
    const updates: Record<string, unknown> = { [field]: value };

    await supabase.from("purchase_order_lines").update(updates).eq("id", lineId);

    // total is a generated column in DB; recompute locally for UI
    const order = orders.find((o) => o.id === orderId);
    const line = order?.lines.find((l) => l.id === lineId);
    const localUpdates: Record<string, unknown> = { ...updates };
    if (line && (field === "quantity" || field === "unit_price")) {
      const qty = field === "quantity" ? (value as number) : line.quantity;
      const pu = field === "unit_price" ? (value as number) : line.unit_price;
      localUpdates.total = qty * pu;
    }

    setOrders(
      orders.map((o) =>
        o.id === orderId
          ? {
              ...o,
              lines: o.lines.map((l) =>
                l.id === lineId ? { ...l, ...localUpdates } : l
              ),
            }
          : o
      )
    );
  }

  // Delete line
  async function deleteLine(orderId: string, lineId: string) {
    await supabase.from("purchase_order_lines").delete().eq("id", lineId);
    setOrders(
      orders.map((o) =>
        o.id === orderId ? { ...o, lines: o.lines.filter((l) => l.id !== lineId) } : o
      )
    );
  }

  // Update OC header
  async function updateOC(id: string, field: string, value: unknown) {
    await supabase.from("purchase_orders").update({ [field]: value }).eq("id", id);
    setOrders(orders.map((o) => (o.id === id ? { ...o, [field]: value } : o)));
  }

  // Delete OC
  async function deleteOC(id: string) {
    if (!confirm("¿Eliminar esta orden de compra y todas sus líneas?")) return;
    await supabase.from("purchase_orders").delete().eq("id", id);
    setOrders(orders.filter((o) => o.id !== id));
    toast.success("Orden de compra eliminada");
  }

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

  function getStatusBadge(status: PurchaseOrderStatus) {
    const s = OC_STATUSES.find((st) => st.value === status);
    return (
      <Badge variant="outline" className="text-xs" style={{ borderColor: s?.color, color: s?.color }}>
        {s?.label || status}
      </Badge>
    );
  }

  function getOCTotal(oc: OCWithLines) {
    return oc.lines.reduce((sum, l) => sum + Number(l.total || 0), 0);
  }

  function formatMoney(amount: number, currency: string) {
    const curr = CURRENCIES.find((c) => c.code === currency);
    const symbol = curr?.symbol || "";
    return `${symbol} ${amount.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  // ─── Receptions helpers ───
  function getLineReceivedQty(orderLineId: string, ocId: string) {
    const recs = receptions.get(ocId) || [];
    let sum = 0;
    for (const rec of recs) {
      if (rec.status === "cancelled") continue;
      for (const l of rec.lines) {
        if (l.order_line_id === orderLineId) sum += Number(l.quantity_received || 0);
      }
    }
    return sum;
  }

  function getLineRemainingToReceive(line: PurchaseOrderLine, ocId: string) {
    const received = getLineReceivedQty(line.id, ocId);
    return Math.max(0, Number(line.quantity) - received);
  }

  // Open reception dialog
  // ─── Edit OC ───
  function canEditOC(oc: OCWithLines) {
    const recs = receptions.get(oc.id) || [];
    // Allow editing only if no receptions at all (including cancelled — they count as history)
    return recs.length === 0 && oc.status === "open";
  }

  function openEditDialog(oc: OCWithLines) {
    setEditingOC(oc);
    setEditSupplier(oc.supplier);
    setEditCurrency(oc.currency);
    setEditAmortPct(Number(oc.amortization_pct || 0));
    setEditRetentionPct(Number(oc.retention_pct || 0));
    setEditReturnCondition(oc.return_condition || "");
    setEditComment(oc.comment || "");
    const lineMap = new Map<string, { quantity: number; unit_price: number }>();
    for (const l of oc.lines) {
      lineMap.set(l.id, { quantity: Number(l.quantity), unit_price: Number(l.unit_price) });
    }
    setEditLines(lineMap);
  }

  async function deleteEditLine(lineId: string) {
    if (!editingOC) return;
    if (editingOC.lines.length <= 1) {
      toast.error("No se puede eliminar la última línea de la OC");
      return;
    }
    const line = editingOC.lines.find((l) => l.id === lineId);
    if (!line) return;
    if (!confirm(`¿Eliminar la línea "${line.description}" de la OC?`)) return;

    const { error } = await supabase.from("purchase_order_lines").delete().eq("id", lineId);
    if (error) {
      toast.error(`Error al eliminar línea: ${error.message}`);
      return;
    }

    // Add audit entry for the deletion
    const newEntry = {
      at: new Date().toISOString(),
      changes: [{
        field: `Línea eliminada (${line.description})`,
        from: `${line.quantity} ${line.unit} × ${line.unit_price}`,
        to: null,
      }],
    };
    const newLog = [...(editingOC.audit_log || []), newEntry];
    await supabase.from("purchase_orders").update({ audit_log: newLog }).eq("id", editingOC.id);

    toast.success("Línea eliminada");
    // Update local state
    const updatedOC = {
      ...editingOC,
      lines: editingOC.lines.filter((l) => l.id !== lineId),
      audit_log: newLog,
    };
    setEditingOC(updatedOC);
    const newMap = new Map(editLines);
    newMap.delete(lineId);
    setEditLines(newMap);
    loadData();
  }

  async function submitEdit() {
    if (!editingOC) return;

    // Validate: all lines must have quantity > 0 and unit_price >= 0
    for (const line of editingOC.lines) {
      const updated = editLines.get(line.id);
      if (!updated) continue;
      if (updated.quantity <= 0) {
        toast.error(`La cantidad debe ser mayor a 0 en la línea "${line.description}". Si querés quitarla, usá el botón Eliminar línea.`);
        return;
      }
      if (updated.unit_price < 0) {
        toast.error(`El precio unitario no puede ser negativo en la línea "${line.description}"`);
        return;
      }
    }

    setSavingEdit(true);
    try {
      // Compute diff
      const changes: { field: string; from: string | number | boolean | null; to: string | number | boolean | null }[] = [];
      if (editSupplier.trim() !== editingOC.supplier)
        changes.push({ field: "Proveedor", from: editingOC.supplier, to: editSupplier.trim() });
      if (editCurrency !== editingOC.currency)
        changes.push({ field: "Moneda", from: editingOC.currency, to: editCurrency });
      if (editAmortPct !== Number(editingOC.amortization_pct || 0))
        changes.push({ field: "Amortización %", from: Number(editingOC.amortization_pct || 0), to: editAmortPct });
      if (editRetentionPct !== Number(editingOC.retention_pct || 0))
        changes.push({ field: "Retención %", from: Number(editingOC.retention_pct || 0), to: editRetentionPct });
      if ((editReturnCondition || null) !== (editingOC.return_condition || null))
        changes.push({ field: "Condición devolución", from: editingOC.return_condition, to: editReturnCondition || null });
      if ((editComment || null) !== (editingOC.comment || null))
        changes.push({ field: "Comentario", from: editingOC.comment, to: editComment || null });

      // Per-line changes
      for (const line of editingOC.lines) {
        const updated = editLines.get(line.id);
        if (!updated) continue;
        if (updated.quantity !== Number(line.quantity)) {
          changes.push({
            field: `Cantidad (${line.description || "línea"})`,
            from: Number(line.quantity),
            to: updated.quantity,
          });
        }
        if (updated.unit_price !== Number(line.unit_price)) {
          changes.push({
            field: `P. Unitario (${line.description || "línea"})`,
            from: Number(line.unit_price),
            to: updated.unit_price,
          });
        }
      }

      if (changes.length === 0) {
        toast.info("No hay cambios para guardar");
        setEditingOC(null);
        return;
      }

      // Update OC header (add audit entry)
      const newEntry = { at: new Date().toISOString(), changes };
      const newLog = [...(editingOC.audit_log || []), newEntry];

      const { error: ocErr } = await supabase
        .from("purchase_orders")
        .update({
          supplier: editSupplier.trim(),
          currency: editCurrency,
          amortization_pct: editAmortPct,
          retention_pct: editRetentionPct,
          return_condition: editReturnCondition || null,
          comment: editComment || null,
          audit_log: newLog,
        })
        .eq("id", editingOC.id);

      if (ocErr) {
        toast.error(`Error al actualizar OC: ${ocErr.message}`);
        return;
      }

      // Update lines that changed
      for (const line of editingOC.lines) {
        const updated = editLines.get(line.id);
        if (!updated) continue;
        if (updated.quantity !== Number(line.quantity) || updated.unit_price !== Number(line.unit_price)) {
          const { error: lErr } = await supabase
            .from("purchase_order_lines")
            .update({ quantity: updated.quantity, unit_price: updated.unit_price })
            .eq("id", line.id);
          if (lErr) {
            toast.error(`Error al actualizar línea: ${lErr.message}`);
            return;
          }
        }
      }

      await logActivity({
        projectId,
        actionType: "oc_edited",
        entityType: "purchase_order",
        entityId: editingOC.id,
        description: `OC ${editingOC.number} editada (${changes.length} cambio${changes.length === 1 ? "" : "s"})`,
        metadata: { ocId: editingOC.id, ocNumber: editingOC.number, changes },
        undoable: false, // Edits kept in audit_log but not auto-undoable
      });

      toast.success(`OC ${editingOC.number} actualizada (${changes.length} cambio${changes.length === 1 ? "" : "s"})`);
      setEditingOC(null);
      loadData();
    } finally {
      setSavingEdit(false);
    }
  }

  function openReceptionDialog(oc: OCWithLines) {
    setReceptionFor(oc);
    setReceptionDate(new Date().toISOString().slice(0, 10));
    setReceptionComment("");
    // Default all lines UNCHECKED; user explicitly picks what's being received
    const sel = new Map<string, { selected: boolean; qtyReceived: number; unitPrice: number; amortAmount: number }>();
    for (const line of oc.lines) {
      const remaining = getLineRemainingToReceive(line, oc.id);
      sel.set(line.id, {
        selected: false,
        qtyReceived: remaining,
        unitPrice: Number(line.unit_price || 0),
        amortAmount: 0,
      });
    }
    setReceptionLineSel(sel);
  }

  async function submitReception() {
    if (!receptionFor) return;
    const selectedLines = receptionFor.lines.filter((l) => {
      const s = receptionLineSel.get(l.id);
      return s?.selected && s.qtyReceived > 0;
    });
    if (selectedLines.length === 0) {
      toast.error("Selecciona al menos una línea con cantidad recibida > 0");
      return;
    }

    setSavingReception(true);
    try {
      // Get next reception number for this OC
      const { data: numData, error: numErr } = await supabase.rpc("next_reception_number", {
        p_order_id: receptionFor.id,
      });
      if (numErr) {
        toast.error(`Error obteniendo número: ${numErr.message}`);
        return;
      }
      const number = numData || 1;

      // Create reception header
      const { data: rec, error: recErr } = await supabase
        .from("reception_notes")
        .insert({
          order_id: receptionFor.id,
          number,
          date: receptionDate,
          comment: receptionComment || null,
          status: "received",
        })
        .select()
        .single();

      if (recErr || !rec) {
        toast.error(`Error al crear recepción: ${recErr?.message || ""}`);
        return;
      }

      // Create delivery_notes (lines of this reception).
      // NOTE: gross_amount, amortization_amount, retention_amount and payable_amount are
      // GENERATED columns in the DB — do NOT include them in the insert payload.
      // When the OC has an advance, we always use the user-editable amortAmount per line
      // (pre-seeded from the pct in percentage mode, empty in per_certification mode)
      // and convert it to an effective per-line pct so the generated column matches.
      const hasAdvance = receptionFor.has_advance;
      const ocRetentionPct = Number(receptionFor.retention_pct || 0);
      const linesPayload = selectedLines.map((ocLine) => {
        const sel = receptionLineSel.get(ocLine.id)!;
        const gross = sel.qtyReceived * sel.unitPrice;
        const effectiveAmortPct = hasAdvance
          ? (gross > 0 ? (sel.amortAmount / gross) * 100 : 0)
          : 0;
        return {
          reception_id: rec.id,
          order_line_id: ocLine.id,
          date: receptionDate,
          quantity_received: sel.qtyReceived,
          unit_price: sel.unitPrice,
          amortization_pct: effectiveAmortPct,
          retention_pct: ocRetentionPct,
        };
      });

      const { error: lErr } = await supabase.from("delivery_notes").insert(linesPayload);
      if (lErr) {
        // Rollback
        await supabase.from("reception_notes").delete().eq("id", rec.id);
        toast.error(`Error al insertar líneas: ${lErr.message}`);
        return;
      }

      // Auto-close OC if all lines fully received after this reception
      const newReceivedTotals = new Map<string, number>();
      for (const ocLine of receptionFor.lines) {
        const alreadyReceived = getLineReceivedQty(ocLine.id, receptionFor.id);
        const thisReception = linesPayload.find((p) => p.order_line_id === ocLine.id)?.quantity_received || 0;
        newReceivedTotals.set(ocLine.id, alreadyReceived + thisReception);
      }
      const allFullyReceived = receptionFor.lines.every(
        (l) => (newReceivedTotals.get(l.id) || 0) >= Number(l.quantity) - 0.001
      );
      if (allFullyReceived) {
        await supabase.from("purchase_orders").update({ status: "closed" }).eq("id", receptionFor.id);
      }

      await logActivity({
        projectId,
        actionType: "reception_created",
        entityType: "reception_note",
        entityId: rec.id,
        description: `Recepción ${receptionFor.number}-REC-${String(number).padStart(3, "0")} registrada (${linesPayload.length} línea${linesPayload.length === 1 ? "" : "s"})`,
        metadata: {
          receptionId: rec.id,
          orderId: receptionFor.id,
          ocNumber: receptionFor.number,
          wasAutoClosed: allFullyReceived,
        },
      });

      if (allFullyReceived) {
        toast.success(`Recepción ${receptionFor.number}-REC-${String(number).padStart(3, "0")} creada. OC cerrada automáticamente.`);
      } else {
        toast.success(`Recepción ${receptionFor.number}-REC-${String(number).padStart(3, "0")} creada`);
      }

      setReceptionFor(null);
      loadData();
    } finally {
      setSavingReception(false);
    }
  }

  if (loading) return <div className="p-6 text-muted-foreground">Cargando órdenes...</div>;

  // Derived data for filters
  const uniqueSuppliers = Array.from(new Set(orders.map((o) => o.supplier))).sort();
  const statusCounts = {
    all: orders.length,
    open: orders.filter((o) => o.status === "open").length,
    closed: orders.filter((o) => o.status === "closed").length,
    cancelled: orders.filter((o) => o.status === "cancelled").length,
  };

  const filteredOrders = orders.filter((oc) => {
    if (filterStatus !== "all" && oc.status !== filterStatus) return false;
    if (filterSupplier !== "all" && oc.supplier !== filterSupplier) return false;
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      if (!oc.number.toLowerCase().includes(q) && !oc.supplier.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const hasActiveFilter = filterStatus !== "all" || filterSupplier !== "all" || searchText.trim() !== "";

  return (
    <div className="py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Órdenes de Compra</h2>
        <Button size="sm" onClick={() => { resetCreateForm(); addNewLine(); setCreateOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Nueva Orden
        </Button>
      </div>

      {/* Filter bar */}
      {orders.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap border-b pb-3">
          {/* Status pills */}
          <div className="flex gap-1">
            {([
              { v: "all", label: "Todas", count: statusCounts.all },
              { v: "open", label: "Abiertas", count: statusCounts.open },
              { v: "closed", label: "Cerradas", count: statusCounts.closed },
              { v: "cancelled", label: "Canceladas", count: statusCounts.cancelled },
            ] as const).map((opt) => (
              <button
                key={opt.v}
                onClick={() => setFilterStatus(opt.v as PurchaseOrderStatus | "all")}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-md border transition-colors",
                  filterStatus === opt.v
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted"
                )}
              >
                {opt.label} <span className="opacity-70">({opt.count})</span>
              </button>
            ))}
          </div>

          {/* Supplier filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Proveedor:</span>
            <Select value={filterSupplier} onValueChange={(v) => { if (v) setFilterSupplier(v); }}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <span className="truncate">{filterSupplier === "all" ? "Todos" : filterSupplier}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos los proveedores</SelectItem>
                {uniqueSuppliers.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Search */}
          <div className="flex items-center gap-1.5 flex-1 min-w-[200px] max-w-xs">
            <Input
              className="h-8 text-xs"
              placeholder="Buscar por OC o proveedor..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>

          {hasActiveFilter && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setFilterStatus("all");
                setFilterSupplier("all");
                setSearchText("");
              }}
            >
              Limpiar filtros
            </Button>
          )}

          <div className="text-xs text-muted-foreground ml-auto">
            {filteredOrders.length} de {orders.length} OC
          </div>
        </div>
      )}

      {orders.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No hay órdenes de compra. Crea una nueva.
        </div>
      )}

      {orders.length > 0 && filteredOrders.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No hay OC que coincidan con los filtros aplicados.
        </div>
      )}

      {/* OC List */}
      <div className="space-y-3">
        {filteredOrders.map((oc) => {
          const isExpanded = expanded.has(oc.id);
          const total = getOCTotal(oc);
          const linkedSC = requests.find((r) => r.id === oc.request_id);
          return (
            <div key={oc.id} className="border rounded-lg overflow-hidden">
              {/* OC Header */}
              <div
                className="flex items-center gap-3 px-4 py-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => toggleExpand(oc.id)}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className="font-mono text-sm font-semibold shrink-0">{oc.number}</span>
                <span className="shrink-0">{getStatusBadge(oc.status)}</span>
                {/* Supplier — prominent and unconstrained */}
                <span className="text-sm font-medium truncate min-w-0 flex-1">{oc.supplier}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {oc.issue_date} &middot; {oc.lines.length} línea(s)
                </span>
                {/* Amount — fixed-width column so it aligns vertically across rows */}
                <span className="text-sm font-semibold w-[160px] text-right shrink-0">
                  {formatMoney(total, oc.currency)}
                </span>
                {/* Actions — fixed-width column so amounts never shift */}
                <div className="w-[240px] flex items-center justify-end gap-2 shrink-0">
                  {canEditOC(oc) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={(e) => { e.stopPropagation(); openEditDialog(oc); }}
                      title="Editar OC (sin recepciones)"
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Editar
                    </Button>
                  )}
                  {oc.status === "open" && (() => {
                    const hasReceptions = (receptions.get(oc.id) || []).some((r) => r.status !== "cancelled");
                    const targetStatus = hasReceptions ? "closed" : "cancelled";
                    const actionLabel = hasReceptions ? "Cerrar OC" : "Cancelar OC";
                    const confirmText = hasReceptions
                      ? "¿Cerrar esta OC manualmente? No se podrán registrar más recepciones."
                      : "Esta OC no tiene recepciones. ¿Cancelarla? Queda registrada pero sin movimiento.";
                    return (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (confirm(confirmText)) {
                            await updateOC(oc.id, "status", targetStatus);
                            await logActivity({
                              projectId,
                              actionType: "oc_closed",
                              entityType: "purchase_order",
                              entityId: oc.id,
                              description: `OC ${oc.number} ${targetStatus === "closed" ? "cerrada" : "cancelada"} manualmente`,
                              metadata: { ocId: oc.id, ocNumber: oc.number, previousStatus: "open", newStatus: targetStatus },
                            });
                          }
                        }}
                        title={actionLabel}
                      >
                        {actionLabel}
                      </Button>
                    );
                  })()}
                </div>
              </div>

              {/* OC Detail */}
              {isExpanded && (
                <div className="p-4 space-y-4">
                  {/* Linked SC */}
                  {linkedSC && (
                    <div className="flex items-center gap-2 text-xs bg-muted/20 rounded-md px-3 py-2 border border-border/50">
                      <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Solicitud vinculada:</span>
                      <span className="font-mono font-semibold">{linkedSC.number}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{linkedSC.lines.length} línea(s) originales</span>
                    </div>
                  )}

                  {/* Financial summary */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div className="bg-muted/40 rounded-md p-2">
                      <span className="text-muted-foreground block">Moneda</span>
                      <span className="font-medium">{oc.currency}</span>
                    </div>
                    <div className="bg-muted/40 rounded-md p-2">
                      <span className="text-muted-foreground block">Anticipo</span>
                      <span className="font-medium">
                        {oc.has_advance
                          ? oc.advance_type === "percentage"
                            ? `${oc.advance_amount}%`
                            : formatMoney(Number(oc.advance_amount), oc.currency)
                          : "No"}
                      </span>
                    </div>
                    <div className="bg-muted/40 rounded-md p-2">
                      <span className="text-muted-foreground block">Amortización</span>
                      <span className="font-medium">{oc.amortization_pct}%</span>
                    </div>
                    <div className="bg-muted/40 rounded-md p-2">
                      <span className="text-muted-foreground block">Retención</span>
                      <span className="font-medium">{oc.retention_pct}%</span>
                    </div>
                  </div>

                  {/* Audit log / history */}
                  {oc.audit_log && oc.audit_log.length > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                        onClick={() => setHistoryOpen(historyOpen === oc.id ? null : oc.id)}
                      >
                        <History className="h-3 w-3" />
                        <span>
                          Modificada {oc.audit_log.length} {oc.audit_log.length === 1 ? "vez" : "veces"} · última {new Date(oc.audit_log[oc.audit_log.length - 1].at).toLocaleString("es")}
                        </span>
                        {historyOpen === oc.id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      </button>
                      {historyOpen === oc.id && (
                        <div className="mt-2 space-y-1.5 pl-4 border-l-2 border-muted-foreground/20">
                          {oc.audit_log.slice().reverse().map((entry, i) => (
                            <div key={i} className="space-y-0.5">
                              <p className="text-[10px] font-medium text-muted-foreground">
                                {new Date(entry.at).toLocaleString("es")}
                              </p>
                              {entry.changes.map((c, j) => (
                                <p key={j} className="text-[10px] pl-2">
                                  <span className="font-medium">{c.field}:</span>{" "}
                                  <span className="line-through opacity-60">{String(c.from ?? "—")}</span>
                                  <span className="mx-1">→</span>
                                  <span className="text-foreground font-medium">{String(c.to ?? "—")}</span>
                                </p>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {oc.comment && (
                    <p className="text-xs text-muted-foreground italic">{oc.comment}</p>
                  )}

                  {/* Lines table header (READ-ONLY — OC is immutable once created) */}
                  {oc.lines.length > 0 && (
                    <div className="grid grid-cols-[1fr_2fr_90px_80px_110px_110px] gap-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-2 pb-1 border-b">
                      <span>EDT</span>
                      <span>Descripción</span>
                      <span className="text-right">Cantidad</span>
                      <span className="text-center">Unidad</span>
                      <span className="text-right">P. Unitario</span>
                      <span className="text-right">Total</span>
                    </div>
                  )}

                  {oc.lines.map((line) => (
                    <div
                      key={line.id}
                      className="grid grid-cols-[1fr_2fr_90px_80px_110px_110px] gap-2 items-center px-2 py-1.5 text-xs rounded hover:bg-muted/20"
                    >
                      <span className="truncate text-muted-foreground" title={getSubName(line.subcategory_id)}>
                        {getSubName(line.subcategory_id)}
                      </span>
                      <span className="truncate" title={line.description}>{line.description}</span>
                      <span className="text-right font-mono">
                        {Number(line.quantity).toLocaleString("es", { maximumFractionDigits: 2 })}
                      </span>
                      <span className="text-center text-muted-foreground">{line.unit}</span>
                      <span className="text-right font-mono">
                        {formatMoney(Number(line.unit_price), oc.currency)}
                      </span>
                      <span className="text-right font-mono font-semibold">
                        {formatMoney(Number(line.total || 0), oc.currency)}
                      </span>
                    </div>
                  ))}

                  {/* Totals row */}
                  {oc.lines.length > 0 && (
                    <div className="grid grid-cols-[1fr_2fr_90px_80px_110px_110px] gap-2 items-center px-2 pt-2 border-t">
                      <div className="col-span-5 text-right text-xs font-semibold">TOTAL</div>
                      <div className="text-right text-sm font-bold" style={{ color: "#E87722" }}>
                        {formatMoney(total, oc.currency)}
                      </div>
                    </div>
                  )}

                  {/* ───── Receptions section ───── */}
                  {oc.lines.length > 0 && (() => {
                    const ocReceptions = receptions.get(oc.id) || [];
                    const totalOrdered = oc.lines.reduce((s, l) => s + Number(l.quantity), 0);
                    const totalReceived = oc.lines.reduce((s, l) => s + getLineReceivedQty(l.id, oc.id), 0);
                    const hasPendingToReceive = oc.lines.some((l) => getLineRemainingToReceive(l, oc.id) > 0);

                    return (
                      <div className="mt-6 pt-4 border-t">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <PackageCheck className="h-4 w-4" />
                            <h4 className="text-sm font-semibold">
                              Recepciones ({ocReceptions.length})
                            </h4>
                            <span className="text-xs text-muted-foreground">
                              · {totalReceived.toLocaleString("es", { maximumFractionDigits: 2 })} de {totalOrdered.toLocaleString("es", { maximumFractionDigits: 2 })} unidades recibidas
                            </span>
                          </div>
                          {hasPendingToReceive && oc.status === "open" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => { e.stopPropagation(); openReceptionDialog(oc); }}
                            >
                              <Truck className="h-3.5 w-3.5 mr-1" />
                              Nueva Recepción
                            </Button>
                          )}
                        </div>

                        {ocReceptions.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">
                            Sin recepciones registradas. Crea una para habilitar la facturación.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {ocReceptions.map((rec) => {
                              const recTotal = rec.lines.reduce((s, l) => s + Number(l.gross_amount || 0), 0);
                              const recPayable = rec.lines.reduce((s, l) => s + Number(l.payable_amount || 0), 0);
                              const recAmort = rec.lines.reduce((s, l) => s + Number(l.amortization_amount || 0), 0);
                              const recRetention = rec.lines.reduce((s, l) => s + Number(l.retention_amount || 0), 0);
                              const isAdvance = rec.type === "advance";
                              const statusLabel =
                                rec.status === "received" ? "Recibido" :
                                rec.status === "invoiced" ? "Facturado" :
                                rec.status === "pending_approval" ? "Pendiente de aprobación" : "Cancelado";
                              return (
                                <div
                                  key={rec.id}
                                  className={cn(
                                    "border rounded-md p-3",
                                    isAdvance
                                      ? "bg-amber-50/60 border-amber-300 ring-1 ring-amber-200"
                                      : "bg-muted/20"
                                  )}
                                >
                                  {isAdvance && (
                                    <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold text-[#B85A0F] uppercase tracking-wider">
                                      <HandCoins className="h-3.5 w-3.5" />
                                      Recepción de anticipo
                                    </div>
                                  )}
                                  <div className="flex items-center gap-3 mb-2">
                                    <span className="font-mono text-xs font-semibold">
                                      {oc.number}-REC-{String(rec.number).padStart(3, "0")}
                                    </span>
                                    <Badge
                                      className={cn(
                                        "text-[10px]",
                                        rec.status === "pending_approval" && "bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200",
                                        rec.status === "received" && "bg-amber-100 text-amber-700 hover:bg-amber-100",
                                        rec.status === "invoiced" && "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
                                        rec.status === "cancelled" && "bg-muted text-muted-foreground hover:bg-muted"
                                      )}
                                    >
                                      {statusLabel}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                      {new Date(rec.date).toLocaleDateString("es")} · {rec.lines.length} línea(s)
                                    </span>
                                    <div className="flex-1" />
                                    <span className="text-sm font-bold" style={{ color: "#E87722" }}>
                                      {formatMoney(recTotal, oc.currency)}
                                    </span>
                                  </div>
                                  {rec.comment && (
                                    <p className="text-[11px] text-muted-foreground italic mb-2">{rec.comment}</p>
                                  )}
                                  <div className="grid grid-cols-[1fr_80px_100px_80px_90px_90px_110px] gap-2 text-[10px] font-semibold text-muted-foreground uppercase px-2 py-1 border-b">
                                    <span>Descripción</span>
                                    <span className="text-right">Cantidad</span>
                                    <span className="text-right">P. Unitario</span>
                                    <span className="text-right">Bruto</span>
                                    <span className="text-right">Amort.</span>
                                    <span className="text-right">Retención</span>
                                    <span className="text-right">A pagar</span>
                                  </div>
                                  {rec.lines.map((rl) => {
                                    const ocLine = oc.lines.find((l) => l.id === rl.order_line_id);
                                    return (
                                      <div
                                        key={rl.id}
                                        className="grid grid-cols-[1fr_80px_100px_80px_90px_90px_110px] gap-2 text-xs px-2 py-1 items-center border-b last:border-b-0"
                                      >
                                        <span className="truncate" title={ocLine ? `${getSubName(ocLine.subcategory_id)} · ${ocLine.description}` : (isAdvance ? "Pago de anticipo" : "—")}>
                                          {ocLine && (
                                            <span className="text-muted-foreground text-[10px] font-mono mr-1.5">
                                              {getSubName(ocLine.subcategory_id)}
                                            </span>
                                          )}
                                          {ocLine?.description || (isAdvance ? (
                                            <span className="italic text-[#B85A0F]">Pago de anticipo</span>
                                          ) : "—")}
                                        </span>
                                        <span className="text-right font-mono">
                                          {Number(rl.quantity_received).toLocaleString("es", { maximumFractionDigits: 2 })}
                                        </span>
                                        <span className="text-right font-mono text-muted-foreground">
                                          {formatMoney(Number(rl.unit_price), oc.currency)}
                                        </span>
                                        <span className="text-right font-mono">
                                          {formatMoney(Number(rl.gross_amount || 0), oc.currency)}
                                        </span>
                                        <span className="text-right font-mono text-amber-700">
                                          {Number(rl.amortization_amount || 0) > 0
                                            ? formatMoney(Number(rl.amortization_amount), oc.currency)
                                            : "—"}
                                        </span>
                                        <span className="text-right font-mono text-[#B85A0F]">
                                          {Number(rl.retention_amount || 0) > 0
                                            ? formatMoney(Number(rl.retention_amount), oc.currency)
                                            : "—"}
                                        </span>
                                        <span className="text-right font-mono font-semibold text-emerald-700">
                                          {formatMoney(Number(rl.payable_amount || 0), oc.currency)}
                                        </span>
                                      </div>
                                    );
                                  })}
                                  {/* Reception totals */}
                                  <div className="grid grid-cols-[1fr_80px_100px_80px_90px_90px_110px] gap-2 text-xs px-2 py-1.5 items-center bg-muted/40 font-semibold mt-1">
                                    <span className="text-right col-span-3">TOTAL</span>
                                    <span className="text-right font-mono">{formatMoney(recTotal, oc.currency)}</span>
                                    <span className="text-right font-mono text-amber-700">
                                      {recAmort > 0 ? formatMoney(recAmort, oc.currency) : "—"}
                                    </span>
                                    <span className="text-right font-mono text-[#B85A0F]">
                                      {recRetention > 0 ? formatMoney(recRetention, oc.currency) : "—"}
                                    </span>
                                    <span className="text-right font-mono text-emerald-700">
                                      {formatMoney(recPayable, oc.currency)}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between mt-2">
                                    <p className="text-[10px] text-muted-foreground italic">
                                      {rec.status === "pending_approval"
                                        ? (isAdvance ? "Aprobar desde Anticipos dados ↗" : "Pendiente de aprobación")
                                        : rec.status === "invoiced"
                                          ? "Facturado"
                                          : rec.status === "received"
                                            ? `Pendiente de facturar · ${formatMoney(recPayable, oc.currency)}`
                                            : "Cancelado"}
                                    </p>
                                    <Badge
                                      className={cn(
                                        "text-[10px]",
                                        rec.status === "pending_approval" && "bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200",
                                        rec.status === "invoiced" && "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
                                        rec.status === "received" && "bg-amber-100 text-amber-700 hover:bg-amber-100",
                                        rec.status === "cancelled" && "bg-muted text-muted-foreground hover:bg-muted"
                                      )}
                                    >
                                      {rec.status === "pending_approval"
                                        ? "Pendiente de aprobación"
                                        : rec.status === "invoiced"
                                          ? "Facturado"
                                          : rec.status === "received"
                                            ? "Recibido · No Facturado"
                                            : "Cancelado"}
                                    </Badge>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create OC Dialog — full manual flow with line editor */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[95vw] w-[95vw] h-[92vh] max-h-[92vh] p-0 gap-0 flex flex-col">
          <div className="flex-none px-6 py-4 border-b">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg">
                <Plus className="h-5 w-5" />
                Nueva Orden de Compra (sin planificación)
              </DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground mt-1">
              Creá una OC directa. Cada línea debe tener <strong>Sector</strong>, <strong>EDT</strong> e <strong>Insumo</strong> para trackear correctamente el centro de costos.
            </p>
          </div>

          <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
            {/* Header fields */}
            <div className="grid grid-cols-[1fr_160px] gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Proveedor *</label>
                <Input
                  className="mt-1"
                  value={newSupplier}
                  onChange={(e) => setNewSupplier(e.target.value)}
                  placeholder="Nombre del proveedor"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Moneda</label>
                <Select value={newCurrency} onValueChange={(v) => { if (v) setNewCurrency(v); }}>
                  <SelectTrigger className="mt-1 w-full">
                    <span>{CURRENCIES.find((c) => c.code === newCurrency)?.code || newCurrency}</span>
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

            {/* Financial config collapsible summary */}
            <div className="border rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Configuración Financiera</p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="newHasAdvance"
                  checked={newHasAdvance}
                  onCheckedChange={(v) => setNewHasAdvance(!!v)}
                />
                <label htmlFor="newHasAdvance" className="text-xs font-medium">Tiene anticipo</label>
                {newHasAdvance && (
                  <div className="grid grid-cols-[140px_120px] gap-2 ml-2 flex-1">
                    <Select value={newAdvanceType} onValueChange={(v) => setNewAdvanceType(v as "amount" | "percentage")}>
                      <SelectTrigger className="h-8 text-xs w-full">
                        <span>{newAdvanceType === "percentage" ? "Porcentaje" : "Monto fijo"}</span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Porcentaje</SelectItem>
                        <SelectItem value="amount">Monto fijo</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      className={cn(
                        "h-8 text-xs",
                        newHasAdvance && (!newAdvanceAmount || newAdvanceAmount <= 0) && "border-destructive/60 focus-visible:ring-destructive/30"
                      )}
                      type="number"
                      value={newAdvanceAmount || ""}
                      onChange={(e) => setNewAdvanceAmount(parseFloat(e.target.value) || 0)}
                      placeholder={newAdvanceType === "percentage" ? "% *" : "Monto *"}
                    />
                  </div>
                )}
              </div>
              {newHasAdvance && (
                <div className="space-y-2">
                  <label className="text-[10px] text-muted-foreground font-medium">
                    Forma de amortización <span className="text-destructive">*</span>
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setNewAmortMode("percentage")}
                      className={cn(
                        "flex-1 text-xs px-3 py-2 rounded-md border transition-colors text-left",
                        newAmortMode === "percentage"
                          ? "bg-primary/10 border-primary text-foreground"
                          : "bg-background hover:bg-muted"
                      )}
                    >
                      <div className="font-medium">% fijo por medición</div>
                      <div className="text-[10px] text-muted-foreground">Mismo % en cada recepción</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewAmortMode("per_certification")}
                      className={cn(
                        "flex-1 text-xs px-3 py-2 rounded-md border transition-colors text-left",
                        newAmortMode === "per_certification"
                          ? "bg-primary/10 border-primary text-foreground"
                          : "bg-background hover:bg-muted"
                      )}
                    >
                      <div className="font-medium">Monto por certificación</div>
                      <div className="text-[10px] text-muted-foreground">Indicás el monto al recepcionar</div>
                    </button>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                {newHasAdvance && newAmortMode === "percentage" && (
                  <div>
                    <label className="text-[10px] text-muted-foreground">
                      Amortización % <span className="text-destructive">*</span>
                    </label>
                    <Input
                      className={cn(
                        "h-8 text-xs mt-0.5",
                        (!newAmortPct || newAmortPct <= 0) && "border-destructive/60 focus-visible:ring-destructive/30"
                      )}
                      type="number"
                      value={newAmortPct || ""}
                      onChange={(e) => setNewAmortPct(parseFloat(e.target.value) || 0)}
                      placeholder="Requerido"
                    />
                  </div>
                )}
                <div>
                  <label className="text-[10px] text-muted-foreground">
                    Retención % <span className="text-[9px]">(opcional)</span>
                  </label>
                  <Input
                    className="h-8 text-xs mt-0.5"
                    type="number"
                    value={newRetentionPct || ""}
                    onChange={(e) => setNewRetentionPct(parseFloat(e.target.value) || 0)}
                    placeholder="Sin retención"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Cond. devolución retención</label>
                  <Input
                    className="h-8 text-xs mt-0.5"
                    value={newReturnCondition}
                    onChange={(e) => setNewReturnCondition(e.target.value)}
                    placeholder="Ej: 30 días post-fin..."
                  />
                </div>
              </div>
              <Input
                className="h-8 text-xs"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Comentario opcional..."
              />
            </div>

            {/* Line editor */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase">
                  Líneas ({newLines.length})
                </p>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addNewLine}>
                  <Plus className="h-3 w-3 mr-1" /> Agregar línea
                </Button>
              </div>

              {newLines.length === 0 ? (
                <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">
                  Sin líneas todavía. Agregá al menos una.
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[140px_160px_minmax(0,1fr)_2fr_80px_70px_110px_110px_40px] gap-2 px-3 py-2 bg-muted/40 text-[10px] font-semibold uppercase tracking-wider border-b">
                    <span>Sector *</span>
                    <span>EDT *</span>
                    <span>Insumo *</span>
                    <span>Descripción</span>
                    <span className="text-right">Cantidad</span>
                    <span>Unidad</span>
                    <span className="text-right">P. Unitario</span>
                    <span className="text-right">Total</span>
                    <span />
                  </div>

                  {newLines.map((line, idx) => {
                    const total = line.quantity * line.unit_price;
                    return (
                      <div
                        key={line.tmpId}
                        className="grid grid-cols-[140px_160px_minmax(0,1fr)_2fr_80px_70px_110px_110px_40px] gap-2 px-3 py-2 items-center border-b last:border-b-0 text-xs"
                      >
                        {/* Sector */}
                        <Select
                          value={line.sector_id || ""}
                          onValueChange={(v) => v && updateNewLine(line.tmpId, { sector_id: v })}
                        >
                          <SelectTrigger className={cn("h-8 text-xs w-full", !line.sector_id && "border-destructive/40")}>
                            <span className="truncate">
                              {line.sector_id ? sectors.find((s) => s.id === line.sector_id)?.name || "—" : "Sector..."}
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
                          value={line.subcategory_id || ""}
                          onValueChange={(v) => v && updateNewLine(line.tmpId, { subcategory_id: v })}
                        >
                          <SelectTrigger className={cn("h-8 text-xs w-full", !line.subcategory_id && "border-destructive/40")}>
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

                        {/* Insumo picker */}
                        <InsumoPicker
                          projectId={projectId}
                          insumos={insumos}
                          selectedInsumoId={line.insumo_id}
                          onSelect={(ins) => selectInsumoForLine(line.tmpId, ins)}
                          onInsumoCreated={(ins) => setInsumos((prev) => [...prev, ins])}
                        />

                        {/* Description (auto-filled from insumo, editable) */}
                        <Input
                          className="h-8 text-xs"
                          value={line.description}
                          onChange={(e) => updateNewLine(line.tmpId, { description: e.target.value })}
                          placeholder="Descripción..."
                        />

                        {/* Qty */}
                        <Input
                          className="h-8 text-xs text-right"
                          type="number"
                          step="any"
                          value={line.quantity || ""}
                          onChange={(e) => updateNewLine(line.tmpId, { quantity: parseFloat(e.target.value) || 0 })}
                        />

                        {/* Unit */}
                        <Select
                          value={line.unit}
                          onValueChange={(v) => v && updateNewLine(line.tmpId, { unit: v })}
                        >
                          <SelectTrigger className="h-8 text-xs w-full">
                            <span>{line.unit}</span>
                          </SelectTrigger>
                          <SelectContent>
                            {DEFAULT_UNITS.map((u) => (
                              <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {/* Unit price */}
                        <Input
                          className="h-8 text-xs text-right"
                          type="number"
                          step="any"
                          value={line.unit_price || ""}
                          onChange={(e) => updateNewLine(line.tmpId, { unit_price: parseFloat(e.target.value) || 0 })}
                        />

                        {/* Total */}
                        <span className="text-right font-mono font-semibold text-xs">
                          {formatMoney(total, newCurrency)}
                        </span>

                        {/* Delete */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => removeNewLine(line.tmpId)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}

                  {/* Total row */}
                  <div className="grid grid-cols-[140px_160px_minmax(0,1fr)_2fr_80px_70px_110px_110px_40px] gap-2 px-3 py-2.5 items-center bg-muted/60 border-t-2">
                    <span className="col-span-7 text-right text-xs font-semibold">TOTAL</span>
                    <span className="text-right font-mono font-bold text-sm" style={{ color: "#E87722" }}>
                      {formatMoney(
                        newLines.reduce((s, l) => s + l.quantity * l.unit_price, 0),
                        newCurrency
                      )}
                    </span>
                    <span />
                  </div>
                </div>
              )}

              <p className="text-[10px] text-muted-foreground italic mt-1.5">
                💡 Los insumos creados aquí se marcan automáticamente como <strong>ejecución</strong> y podrás filtrarlos luego en el módulo Insumos.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex-none border-t bg-muted/30 px-6 py-3 flex justify-between items-center">
            <div className="text-xs text-muted-foreground">
              {newLines.length} línea(s) · Total:{" "}
              <span className="font-bold text-foreground">
                {formatMoney(
                  newLines.reduce((s, l) => s + l.quantity * l.unit_price, 0),
                  newCurrency
                )}
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                Cancelar
              </Button>
              <Button onClick={createOC} disabled={creating || newLines.length === 0 || !newSupplier.trim()}>
                {creating ? "Creando..." : "Crear Orden"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─────── Reception Dialog ─────── */}
      <Dialog open={receptionFor !== null} onOpenChange={(open) => !open && setReceptionFor(null)}>
        <DialogContent className="sm:max-w-[90vw] w-[90vw] max-h-[90vh] p-0 gap-0 flex flex-col">
          <div className="flex-none px-6 py-4 border-b">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg">
                <PackageCheck className="h-5 w-5" />
                Registrar Recepción para <span className="font-mono">{receptionFor?.number}</span>
              </DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground mt-1">
              Este documento certifica el material/trabajo recibido y habilita al proveedor a facturar el monto pagable.
            </p>
          </div>

          {receptionFor && (() => {
            const nextNum = (receptions.get(receptionFor.id)?.length || 0) + 1;
            const ocAmortPct = Number(receptionFor.amortization_pct || 0);
            const ocRetentionPct = Number(receptionFor.retention_pct || 0);
            const hasAdvance = receptionFor.has_advance;
            const isPerCert = receptionFor.amortization_mode === "per_certification" && hasAdvance;

            // Aggregate preview totals
            const selectedSummary = Array.from(receptionLineSel.entries())
              .filter(([, s]) => s.selected && s.qtyReceived > 0);
            const grossTotal = selectedSummary.reduce((sum, [, s]) => sum + s.qtyReceived * s.unitPrice, 0);
            // When there's an advance, we always use the user-editable amortAmount per line
            // (pre-seeded from pct in percentage mode). This lets the user override the
            // suggested amount per certification.
            const amortTotal = hasAdvance
              ? selectedSummary.reduce((sum, [, s]) => sum + (s.amortAmount || 0), 0)
              : 0;
            const retentionTotal = (grossTotal * ocRetentionPct) / 100;
            const payableTotal = grossTotal - amortTotal - retentionTotal;

            return (
              <>
                <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
                  {/* Header info */}
                  <div className="grid grid-cols-[1fr_200px_1fr] gap-4">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">N° de Recepción</label>
                      <div className="mt-1 h-9 px-3 flex items-center text-sm font-mono border rounded-md bg-muted/30">
                        {receptionFor.number}-REC-{String(nextNum).padStart(3, "0")}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Fecha *</label>
                      <Input
                        className="mt-1"
                        type="date"
                        value={receptionDate}
                        onChange={(e) => setReceptionDate(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Comentario</label>
                      <Input
                        className="mt-1"
                        value={receptionComment}
                        onChange={(e) => setReceptionComment(e.target.value)}
                        placeholder="Detalles de la recepción..."
                      />
                    </div>
                  </div>

                  {/* Line selector */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase">
                        Líneas a recibir ({selectedSummary.length} seleccionada{selectedSummary.length === 1 ? "" : "s"})
                      </p>
                      <div className="flex gap-2 text-xs">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setReceptionLineSel((prev) => {
                              const next = new Map(prev);
                              for (const [k, v] of next) {
                                if (v.qtyReceived > 0) next.set(k, { ...v, selected: true });
                              }
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
                            setReceptionLineSel((prev) => {
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
                      <div className="grid grid-cols-[36px_minmax(0,2fr)_90px_90px_90px_60px_110px_110px_110px] gap-2 px-3 py-2 bg-muted/40 text-[10px] font-semibold uppercase tracking-wider border-b">
                        <span />
                        <span>Descripción</span>
                        <span className="text-right">Ordenado</span>
                        <span className="text-right">Recibido</span>
                        <span className="text-right">Pendiente</span>
                        <span>Unidad</span>
                        <span className="text-right">Cant. Recibir</span>
                        <span className="text-right">P. Unitario</span>
                        <span className="text-right">Subtotal</span>
                      </div>

                      {receptionFor.lines.map((line) => {
                        const ordered = Number(line.quantity);
                        const alreadyReceived = getLineReceivedQty(line.id, receptionFor.id);
                        const remaining = Math.max(0, ordered - alreadyReceived);
                        const sel = receptionLineSel.get(line.id) || { selected: false, qtyReceived: 0, unitPrice: 0, amortAmount: 0 };
                        const subtotal = sel.qtyReceived * sel.unitPrice;
                        const isFullyReceived = remaining === 0;

                        return (
                          <div
                            key={line.id}
                            className={cn(
                              "grid grid-cols-[36px_minmax(0,2fr)_90px_90px_90px_60px_110px_110px_110px] gap-2 px-3 py-2 items-center border-b last:border-b-0 text-xs",
                              isFullyReceived && !sel.selected && "opacity-50 bg-muted/20",
                              sel.selected && "bg-primary/5"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={sel.selected}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                // Auto-seed amortization amount on first check
                                // when the OC has an advance in percentage mode
                                const gross = sel.qtyReceived * sel.unitPrice;
                                const shouldSeed = checked && receptionFor.has_advance &&
                                  receptionFor.amortization_mode === "percentage" &&
                                  sel.amortAmount === 0;
                                const seededAmort = shouldSeed
                                  ? (gross * Number(receptionFor.amortization_pct || 0)) / 100
                                  : sel.amortAmount;
                                setReceptionLineSel((prev) => {
                                  const next = new Map(prev);
                                  next.set(line.id, { ...sel, selected: checked, amortAmount: seededAmort });
                                  return next;
                                });
                              }}
                            />
                            <span className="truncate" title={`${getSubName(line.subcategory_id)} · ${line.description}`}>
                              <span className="text-muted-foreground text-[10px] font-mono mr-1.5">
                                {getSubName(line.subcategory_id)}
                              </span>
                              {line.description}
                            </span>
                            <span className="text-right font-mono text-muted-foreground">
                              {ordered.toLocaleString("es", { maximumFractionDigits: 2 })}
                            </span>
                            <span className="text-right font-mono text-amber-600">
                              {alreadyReceived.toLocaleString("es", { maximumFractionDigits: 2 })}
                            </span>
                            <span className={cn(
                              "text-right font-mono",
                              remaining === 0 ? "text-muted-foreground" : "text-amber-600 font-semibold"
                            )}>
                              {remaining.toLocaleString("es", { maximumFractionDigits: 2 })}
                            </span>
                            <span className="text-muted-foreground">{line.unit}</span>
                            <Input
                              className="h-8 text-xs text-right"
                              type="number"
                              value={sel.qtyReceived || ""}
                              disabled={!sel.selected}
                              onChange={(e) => {
                                const v = Math.max(0, parseFloat(e.target.value) || 0);
                                setReceptionLineSel((prev) => {
                                  const next = new Map(prev);
                                  next.set(line.id, { ...sel, qtyReceived: v });
                                  return next;
                                });
                              }}
                            />
                            <Input
                              className="h-8 text-xs text-right"
                              type="number"
                              value={sel.unitPrice || ""}
                              disabled={!sel.selected}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value) || 0;
                                setReceptionLineSel((prev) => {
                                  const next = new Map(prev);
                                  next.set(line.id, { ...sel, unitPrice: v });
                                  return next;
                                });
                              }}
                            />
                            <span className="text-right font-mono font-semibold">
                              {formatMoney(subtotal, receptionFor.currency)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Per-line amortization editor (shown whenever OC has an advance) */}
                  {hasAdvance && selectedSummary.length > 0 && (
                    <div className="border rounded-lg p-3 bg-amber-50/40">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-[#B85A0F] uppercase flex items-center gap-1.5">
                          <HandCoins className="h-3.5 w-3.5" />
                          Amortización de anticipo por línea
                        </p>
                        {!isPerCert && (
                          <button
                            type="button"
                            className="text-[10px] text-[#B85A0F] hover:underline"
                            onClick={() => {
                              const pct = Number(receptionFor.amortization_pct || 0);
                              setReceptionLineSel((prev) => {
                                const next = new Map(prev);
                                for (const [k, v] of next) {
                                  if (!v.selected) continue;
                                  const gross = v.qtyReceived * v.unitPrice;
                                  next.set(k, { ...v, amortAmount: (gross * pct) / 100 });
                                }
                                return next;
                              });
                            }}
                          >
                            ↻ Recalcular ({ocAmortPct}%)
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mb-2">
                        {isPerCert
                          ? "Ingresá el monto a amortizar en esta certificación. Se descuenta del anticipo pendiente."
                          : `Sugerido ${ocAmortPct}% del bruto. Podés ajustar manualmente cada monto si corresponde.`}
                      </p>
                      <div className="space-y-1.5">
                        {selectedSummary.map(([lineId, s]) => {
                          const line = receptionFor.lines.find((l) => l.id === lineId);
                          if (!line) return null;
                          const lineGross = s.qtyReceived * s.unitPrice;
                          return (
                            <div key={lineId} className="grid grid-cols-[minmax(0,1fr)_120px_140px] gap-2 items-center text-xs">
                              <span className="truncate text-muted-foreground">{line.description}</span>
                              <span className="text-right font-mono text-[11px] text-muted-foreground">
                                Bruto: {formatMoney(lineGross, receptionFor.currency)}
                              </span>
                              <Input
                                className="h-8 text-xs text-right"
                                type="number"
                                value={s.amortAmount || ""}
                                max={lineGross}
                                onChange={(e) => {
                                  const v = Math.max(0, Math.min(lineGross, parseFloat(e.target.value) || 0));
                                  setReceptionLineSel((prev) => {
                                    const next = new Map(prev);
                                    next.set(lineId, { ...s, amortAmount: v });
                                    return next;
                                  });
                                }}
                                placeholder="Monto a amortizar"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Financial summary */}
                  {selectedSummary.length > 0 && (
                    <div className="border rounded-lg p-3 bg-muted/20">
                      <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Resumen Financiero</p>
                      <div className="grid grid-cols-4 gap-3 text-xs">
                        <div className="bg-background rounded p-2">
                          <p className="text-muted-foreground">Bruto recibido</p>
                          <p className="text-sm font-bold">{formatMoney(grossTotal, receptionFor.currency)}</p>
                        </div>
                        <div className="bg-background rounded p-2">
                          <p className="text-muted-foreground">Amortización{hasAdvance ? " (editable)" : ""}</p>
                          <p className="text-sm font-bold text-amber-700">
                            {amortTotal > 0 ? `- ${formatMoney(amortTotal, receptionFor.currency)}` : "—"}
                          </p>
                        </div>
                        <div className="bg-background rounded p-2">
                          <p className="text-muted-foreground">Retención ({ocRetentionPct}%)</p>
                          <p className="text-sm font-bold text-[#B85A0F]">
                            {retentionTotal > 0 ? `- ${formatMoney(retentionTotal, receptionFor.currency)}` : "—"}
                          </p>
                        </div>
                        <div className="bg-emerald-50 rounded p-2 border border-emerald-200">
                          <p className="text-muted-foreground">A facturar</p>
                          <p className="text-sm font-bold text-emerald-700">{formatMoney(payableTotal, receptionFor.currency)}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex-none border-t bg-muted/30 px-6 py-3 flex justify-between items-center">
                  <div className="text-xs text-muted-foreground">
                    {selectedSummary.length} línea(s) · Total a facturar: <span className="font-bold text-foreground">{formatMoney(payableTotal, receptionFor.currency)}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setReceptionFor(null)} disabled={savingReception}>
                      Cancelar
                    </Button>
                    <Button onClick={submitReception} disabled={savingReception || selectedSummary.length === 0}>
                      {savingReception ? "Guardando..." : "Registrar Recepción"}
                    </Button>
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ─────── Edit OC Dialog ─────── */}
      <Dialog open={editingOC !== null} onOpenChange={(open) => !open && setEditingOC(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" />
              Editar OC <span className="font-mono">{editingOC?.number}</span>
            </DialogTitle>
          </DialogHeader>

          {editingOC && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Esta OC no tiene recepciones asociadas. Los cambios quedarán registrados en el historial.
              </p>

              <div className="grid grid-cols-[2fr_120px] gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Proveedor</label>
                  <Input
                    className="mt-1"
                    value={editSupplier}
                    onChange={(e) => setEditSupplier(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Moneda</label>
                  <Select value={editCurrency} onValueChange={(v) => { if (v) setEditCurrency(v); }}>
                    <SelectTrigger className="mt-1 w-full">
                      <span>{editCurrency}</span>
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Amortización %</label>
                  <Input
                    className="mt-1"
                    type="number"
                    value={editAmortPct || ""}
                    onChange={(e) => setEditAmortPct(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Retención %</label>
                  <Input
                    className="mt-1"
                    type="number"
                    value={editRetentionPct || ""}
                    onChange={(e) => setEditRetentionPct(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Condición devolución retención</label>
                <Input
                  className="mt-1"
                  value={editReturnCondition}
                  onChange={(e) => setEditReturnCondition(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Comentario</label>
                <Input
                  className="mt-1"
                  value={editComment}
                  onChange={(e) => setEditComment(e.target.value)}
                />
              </div>

              {/* Lines */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Líneas</p>
                <div className="border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[180px_minmax(0,2fr)_90px_60px_120px_120px_40px] gap-2 px-3 py-2 bg-muted/40 text-[10px] font-semibold uppercase tracking-wider border-b">
                    <span>EDT</span>
                    <span>Descripción</span>
                    <span className="text-right">Cantidad</span>
                    <span>Unidad</span>
                    <span className="text-right">P. Unitario</span>
                    <span className="text-right">Total</span>
                    <span />
                  </div>
                  {editingOC.lines.map((line) => {
                    const e = editLines.get(line.id) || { quantity: Number(line.quantity), unit_price: Number(line.unit_price) };
                    const qtyInvalid = e.quantity <= 0;
                    return (
                      <div key={line.id} className="grid grid-cols-[180px_minmax(0,2fr)_90px_60px_120px_120px_40px] gap-2 px-3 py-2 items-center border-b last:border-b-0 text-xs">
                        <span className="truncate text-muted-foreground" title={getSubName(line.subcategory_id)}>
                          {getSubName(line.subcategory_id)}
                        </span>
                        <span className="truncate" title={line.description}>{line.description}</span>
                        <Input
                          className={cn(
                            "h-8 text-xs text-right",
                            qtyInvalid && "border-destructive focus-visible:ring-destructive/30"
                          )}
                          type="number"
                          step="any"
                          min="0"
                          value={e.quantity || ""}
                          onChange={(ev) => {
                            const v = parseFloat(ev.target.value) || 0;
                            setEditLines((prev) => {
                              const next = new Map(prev);
                              next.set(line.id, { ...e, quantity: v });
                              return next;
                            });
                          }}
                        />
                        <span className="text-muted-foreground">{line.unit}</span>
                        <Input
                          className="h-8 text-xs text-right"
                          type="number"
                          step="any"
                          min="0"
                          value={e.unit_price || ""}
                          onChange={(ev) => {
                            const v = parseFloat(ev.target.value) || 0;
                            setEditLines((prev) => {
                              const next = new Map(prev);
                              next.set(line.id, { ...e, unit_price: v });
                              return next;
                            });
                          }}
                        />
                        <span className="text-right font-mono font-semibold">
                          {formatMoney(e.quantity * e.unit_price, editCurrency)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => deleteEditLine(line.id)}
                          title="Eliminar línea"
                          disabled={editingOC.lines.length <= 1}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  La cantidad debe ser mayor a 0. Para quitar una línea completa usá el botón 🗑️.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => setEditingOC(null)} disabled={savingEdit}>
                  Cancelar
                </Button>
                <Button onClick={submitEdit} disabled={savingEdit}>
                  {savingEdit ? "Guardando..." : "Guardar cambios"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
