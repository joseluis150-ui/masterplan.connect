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
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  FileText,
  Link as LinkIcon,
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
} from "@/lib/types/database";
import { cn } from "@/lib/utils";

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
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Create OC dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newSupplier, setNewSupplier] = useState("");
  const [newCurrency, setNewCurrency] = useState("USD");
  const [newRequestId, setNewRequestId] = useState<string | null>(null);
  const [newHasAdvance, setNewHasAdvance] = useState(false);
  const [newAdvanceAmount, setNewAdvanceAmount] = useState(0);
  const [newAdvanceType, setNewAdvanceType] = useState<"amount" | "percentage">("percentage");
  const [newAmortPct, setNewAmortPct] = useState(0);
  const [newRetentionPct, setNewRetentionPct] = useState(0);
  const [newReturnCondition, setNewReturnCondition] = useState("");
  const [newComment, setNewComment] = useState("");
  const [creating, setCreating] = useState(false);

  const loadData = useCallback(async () => {
    const [ordRes, catsRes, subsRes, reqRes] = await Promise.all([
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
    ]);
    setOrders((ordRes.data || []) as OCWithLines[]);
    setCategories(catsRes.data || []);
    setSubcategories(subsRes.data || []);
    setRequests((reqRes.data || []) as (PurchaseRequest & { lines: PurchaseRequestLine[] })[]);
    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // Create OC
  async function createOC() {
    if (!newSupplier.trim()) {
      toast.error("Proveedor es requerido");
      return;
    }
    setCreating(true);
    try {
      const { data: numData } = await supabase.rpc("next_document_number", {
        p_project_id: projectId,
        p_doc_type: "OC",
      });
      const number = numData || `OC-${new Date().getFullYear()}-???`;

      const { data, error } = await supabase
        .from("purchase_orders")
        .insert({
          project_id: projectId,
          number,
          request_id: newRequestId || null,
          supplier: newSupplier.trim(),
          currency: newCurrency,
          has_advance: newHasAdvance,
          advance_amount: newHasAdvance ? newAdvanceAmount : 0,
          advance_type: newHasAdvance ? newAdvanceType : null,
          amortization_pct: newAmortPct,
          retention_pct: newRetentionPct,
          return_condition: newReturnCondition || null,
          comment: newComment || null,
          status: "open",
        })
        .select("*, lines:purchase_order_lines(*)")
        .single();

      if (error) {
        toast.error("Error al crear OC");
        return;
      }

      const oc = data as OCWithLines;

      // If linked to a SC, auto-create lines from SC lines
      if (newRequestId) {
        const sc = requests.find((r) => r.id === newRequestId);
        if (sc && sc.lines.length > 0) {
          const linesToInsert = sc.lines
            .filter((l) => l.subcategory_id)
            .map((l) => ({
              order_id: oc.id,
              request_line_id: l.id,
              subcategory_id: l.subcategory_id!,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              unit_price: 0,
            }));

          if (linesToInsert.length > 0) {
            const { data: linesData } = await supabase
              .from("purchase_order_lines")
              .insert(linesToInsert)
              .select();

            if (linesData) {
              oc.lines = linesData as PurchaseOrderLine[];
            }
          }
        }
      }

      setOrders([oc, ...orders]);
      setExpanded(new Set([...expanded, oc.id]));
      resetCreateForm();
      setCreateOpen(false);
      toast.success(`Orden ${number} creada`);
    } finally {
      setCreating(false);
    }
  }

  function resetCreateForm() {
    setNewSupplier("");
    setNewCurrency("USD");
    setNewRequestId(null);
    setNewHasAdvance(false);
    setNewAdvanceAmount(0);
    setNewAdvanceType("percentage");
    setNewAmortPct(0);
    setNewRetentionPct(0);
    setNewReturnCondition("");
    setNewComment("");
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

    // Auto-calculate total when quantity or unit_price changes
    const order = orders.find((o) => o.id === orderId);
    const line = order?.lines.find((l) => l.id === lineId);
    if (line && (field === "quantity" || field === "unit_price")) {
      const qty = field === "quantity" ? (value as number) : line.quantity;
      const pu = field === "unit_price" ? (value as number) : line.unit_price;
      updates.total = qty * pu;
    }

    await supabase.from("purchase_order_lines").update(updates).eq("id", lineId);
    setOrders(
      orders.map((o) =>
        o.id === orderId
          ? {
              ...o,
              lines: o.lines.map((l) =>
                l.id === lineId ? { ...l, ...updates } : l
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

  if (loading) return <div className="p-6 text-muted-foreground">Cargando órdenes...</div>;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Órdenes de Compra</h2>
        <Button size="sm" onClick={() => { resetCreateForm(); setCreateOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Nueva Orden
        </Button>
      </div>

      {orders.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No hay órdenes de compra. Crea una nueva.
        </div>
      )}

      {/* OC List */}
      <div className="space-y-3">
        {orders.map((oc) => {
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
                <span className="font-mono text-sm font-semibold">{oc.number}</span>
                {getStatusBadge(oc.status)}
                <span className="text-sm font-medium truncate max-w-[200px]">{oc.supplier}</span>
                {linkedSC && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <LinkIcon className="h-3 w-3" /> {linkedSC.number}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {oc.issue_date} &middot; {oc.lines.length} línea(s)
                </span>
                <span className="text-sm font-semibold ml-auto mr-2">
                  {formatMoney(total, oc.currency)}
                </span>
                <Select
                  value={oc.status}
                  onValueChange={(v) => updateOC(oc.id, "status", v)}
                >
                  <SelectTrigger className="w-[120px] h-8 text-xs" onClick={(e) => e.stopPropagation()}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OC_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); deleteOC(oc.id); }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {/* OC Detail */}
              {isExpanded && (
                <div className="p-4 space-y-4">
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

                  {oc.comment && (
                    <p className="text-xs text-muted-foreground italic">{oc.comment}</p>
                  )}

                  {/* Lines table header */}
                  {oc.lines.length > 0 && (
                    <div className="grid grid-cols-[1fr_2fr_90px_80px_110px_110px_40px] gap-2 text-xs text-muted-foreground font-medium px-2">
                      <span>EDT</span>
                      <span>Descripción</span>
                      <span>Cantidad</span>
                      <span>Unidad</span>
                      <span className="text-right">P. Unitario</span>
                      <span className="text-right">Total</span>
                      <span />
                    </div>
                  )}

                  {oc.lines.map((line) => (
                    <div
                      key={line.id}
                      className="grid grid-cols-[1fr_2fr_90px_80px_110px_110px_40px] gap-2 items-center"
                    >
                      <Select
                        value={line.subcategory_id || ""}
                        onValueChange={(v) => updateLine(oc.id, line.id, "subcategory_id", v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="EDT..." />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((cat) => {
                            const subs = subcategories.filter((s) => s.category_id === cat.id);
                            return subs.map((sub) => (
                              <SelectItem key={sub.id} value={sub.id} className="text-xs">
                                {cat.code}.{sub.code?.split(".")[1]} {sub.name}
                              </SelectItem>
                            ));
                          })}
                        </SelectContent>
                      </Select>

                      <Input
                        className="h-8 text-xs"
                        defaultValue={line.description}
                        placeholder="Descripción..."
                        onBlur={(e) => updateLine(oc.id, line.id, "description", e.target.value)}
                      />

                      <Input
                        className="h-8 text-xs text-right"
                        type="number"
                        defaultValue={line.quantity}
                        onBlur={(e) =>
                          updateLine(oc.id, line.id, "quantity", parseFloat(e.target.value) || 1)
                        }
                      />

                      <Select
                        value={line.unit}
                        onValueChange={(v) => updateLine(oc.id, line.id, "unit", v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DEFAULT_UNITS.map((u) => (
                            <SelectItem key={u} value={u} className="text-xs">
                              {u}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Input
                        className="h-8 text-xs text-right"
                        type="number"
                        defaultValue={line.unit_price}
                        onBlur={(e) =>
                          updateLine(oc.id, line.id, "unit_price", parseFloat(e.target.value) || 0)
                        }
                      />

                      <div className="h-8 flex items-center justify-end text-xs font-medium px-2 bg-muted/30 rounded-md">
                        {formatMoney(Number(line.total || 0), orders.find(o => o.id === oc.id)?.currency || "USD")}
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => deleteLine(oc.id, line.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}

                  {/* Totals row */}
                  {oc.lines.length > 0 && (
                    <div className="grid grid-cols-[1fr_2fr_90px_80px_110px_110px_40px] gap-2 items-center px-2 pt-2 border-t">
                      <div className="col-span-5 text-right text-xs font-semibold">TOTAL</div>
                      <div className="text-right text-sm font-bold">
                        {formatMoney(total, oc.currency)}
                      </div>
                      <div />
                    </div>
                  )}

                  <Button variant="outline" size="sm" className="mt-2" onClick={() => addLine(oc.id)}>
                    <Plus className="h-4 w-4 mr-1" /> Agregar línea
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create OC Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nueva Orden de Compra</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Proveedor */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Proveedor *</label>
              <Input
                className="mt-1"
                value={newSupplier}
                onChange={(e) => setNewSupplier(e.target.value)}
                placeholder="Nombre del proveedor"
              />
            </div>

            {/* Moneda */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Moneda</label>
              <Select value={newCurrency} onValueChange={(v) => { if (v) setNewCurrency(v); }}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
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

            {/* Vincular a SC */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Vincular a Solicitud (opcional)</label>
              <Select value={newRequestId || "none"} onValueChange={(v) => setNewRequestId(v === "none" ? null : v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Sin vincular" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin vincular</SelectItem>
                  {requests
                    .filter((r) => r.status !== "cancelled")
                    .map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.number} — {r.lines.length} línea(s)
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Anticipo */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="hasAdvance"
                  checked={newHasAdvance}
                  onCheckedChange={(v) => setNewHasAdvance(!!v)}
                />
                <label htmlFor="hasAdvance" className="text-xs font-medium">
                  Tiene anticipo
                </label>
              </div>
              {newHasAdvance && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">Tipo</label>
                    <Select value={newAdvanceType} onValueChange={(v) => setNewAdvanceType(v as "amount" | "percentage")}>
                      <SelectTrigger className="mt-1 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Porcentaje</SelectItem>
                        <SelectItem value="amount">Monto fijo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {newAdvanceType === "percentage" ? "%" : "Monto"}
                    </label>
                    <Input
                      className="mt-1 h-8 text-xs"
                      type="number"
                      value={newAdvanceAmount}
                      onChange={(e) => setNewAdvanceAmount(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Amortización y Retención */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Amortización %</label>
                <Input
                  className="mt-1"
                  type="number"
                  value={newAmortPct}
                  onChange={(e) => setNewAmortPct(parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Retención %</label>
                <Input
                  className="mt-1"
                  type="number"
                  value={newRetentionPct}
                  onChange={(e) => setNewRetentionPct(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>

            {/* Condición de devolución */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Condición devolución retención</label>
              <Input
                className="mt-1"
                value={newReturnCondition}
                onChange={(e) => setNewReturnCondition(e.target.value)}
                placeholder="Ej: 30 días después de finalización"
              />
            </div>

            {/* Comentario */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Comentario</label>
              <Input
                className="mt-1"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Nota opcional..."
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={createOC} disabled={creating}>
              {creating ? "Creando..." : "Crear Orden"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
