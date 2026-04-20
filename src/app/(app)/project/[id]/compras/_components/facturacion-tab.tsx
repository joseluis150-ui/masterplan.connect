"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  Receipt,
  Upload,
  CheckCircle2,
  Paperclip,
  AlertCircle,
  Wallet,
  DollarSign,
} from "lucide-react";
import { toast } from "sonner";
import { CURRENCIES } from "@/lib/constants/units";
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  ReceptionNote,
  DeliveryNote,
  Invoice,
  Payment,
  Project,
} from "@/lib/types/database";
import { cn } from "@/lib/utils";
import { logActivity } from "@/lib/utils/activity-log";
import { ColumnFilter, matchesColumnFilter } from "./column-filter";

interface Props {
  projectId: string;
}

type ReceptionFull = ReceptionNote & {
  lines: DeliveryNote[];
  order: PurchaseOrder & { lines: PurchaseOrderLine[] };
  invoice?: Invoice | null;
  paidAmount?: number;     // Total paid on this invoice (in invoice currency, not USD)
};

export function FacturacionTab({ projectId }: Props) {
  const supabase = createClient();
  const [receptions, setReceptions] = useState<ReceptionFull[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"pending" | "invoiced" | "paid">("pending");

  // Excel-style column filters (empty set = no filter; {"__NONE__"} = show nothing)
  const [filterReception, setFilterReception] = useState<Set<string>>(new Set());
  const [filterOC, setFilterOC] = useState<Set<string>>(new Set());
  const [filterSupplier, setFilterSupplier] = useState<Set<string>>(new Set());
  const [filterDate, setFilterDate] = useState<Set<string>>(new Set());
  const [filterInvoice, setFilterInvoice] = useState<Set<string>>(new Set());

  // Invoice dialog state
  const [invoicingRec, setInvoicingRec] = useState<ReceptionFull | null>(null);
  const [invNumber, setInvNumber] = useState("");
  const [invDate, setInvDate] = useState(new Date().toISOString().slice(0, 10));
  const [invAmount, setInvAmount] = useState(0);
  const [invComment, setInvComment] = useState("");
  const [invFile, setInvFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Payment dialog state
  const [payingRec, setPayingRec] = useState<ReceptionFull | null>(null);
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payAmount, setPayAmount] = useState(0);
  const [payCurrency, setPayCurrency] = useState("USD");
  const [payUseCustomTC, setPayUseCustomTC] = useState(false);
  const [payCustomTC, setPayCustomTC] = useState(0);
  const [payType, setPayType] = useState<"advance" | "regular" | "retention_return">("regular");
  const [payComment, setPayComment] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);

  const loadData = useCallback(async () => {
    const { data: projData } = await supabase.from("projects").select("*").eq("id", projectId).single();
    if (projData) setProject(projData as Project);

    // Load receptions with all needed data
    const { data: ordersData } = await supabase
      .from("purchase_orders")
      .select("*, lines:purchase_order_lines(*)")
      .eq("project_id", projectId);

    const orders = (ordersData || []) as (PurchaseOrder & { lines: PurchaseOrderLine[] })[];
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const orderIds = orders.map((o) => o.id);

    if (orderIds.length === 0) {
      setReceptions([]);
      setLoading(false);
      return;
    }

    const [recRes, invRes, payRes] = await Promise.all([
      supabase
        .from("reception_notes")
        .select("*, lines:delivery_notes(*)")
        .in("order_id", orderIds)
        .order("created_at", { ascending: false }),
      supabase
        .from("invoices")
        .select("*")
        .eq("project_id", projectId),
      supabase
        .from("payments")
        .select("*")
        .eq("project_id", projectId),
    ]);

    const invoiceByReception = new Map<string, Invoice>();
    for (const inv of (invRes.data || []) as Invoice[]) {
      if (inv.reception_id) invoiceByReception.set(inv.reception_id, inv);
    }

    // Sum payments per invoice (in invoice's currency — same as OC currency)
    const paidByInvoice = new Map<string, number>();
    for (const p of (payRes.data || []) as Payment[]) {
      if (!p.invoice_id) continue;
      paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) || 0) + Number(p.amount || 0));
    }

    const enriched: ReceptionFull[] = ((recRes.data || []) as (ReceptionNote & { lines: DeliveryNote[] })[])
      .map((rec) => {
        const inv = invoiceByReception.get(rec.id) || null;
        return {
          ...rec,
          order: orderMap.get(rec.order_id)!,
          invoice: inv,
          paidAmount: inv ? (paidByInvoice.get(inv.id) || 0) : 0,
        };
      })
      .filter((r) => r.order);

    setReceptions(enriched);
    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // Open invoicing dialog
  function openInvoiceDialog(rec: ReceptionFull) {
    const payableTotal = rec.lines.reduce((s, l) => s + Number(l.payable_amount || 0), 0);
    setInvoicingRec(rec);
    setInvNumber("");
    setInvDate(new Date().toISOString().slice(0, 10));
    setInvAmount(payableTotal);
    setInvComment("");
    setInvFile(null);
  }

  async function submitInvoice() {
    if (!invoicingRec) return;
    if (!invNumber.trim()) {
      toast.error("Número de factura es requerido");
      return;
    }
    if (invAmount <= 0) {
      toast.error("El monto debe ser mayor a cero");
      return;
    }

    setSaving(true);
    try {
      let attachmentUrl: string | null = null;
      let attachmentName: string | null = null;

      // Upload file to Supabase Storage if present
      if (invFile) {
        const ext = invFile.name.split(".").pop() || "bin";
        const fileName = `${projectId}/${invoicingRec.id}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("invoice-attachments")
          .upload(fileName, invFile, { upsert: true });
        if (upErr) {
          toast.error(`Error al subir archivo: ${upErr.message}`);
          return;
        }
        attachmentUrl = fileName; // store path; we'll sign URLs on demand
        attachmentName = invFile.name;
      }

      // Create invoice record
      const { data: invData, error: invErr } = await supabase.from("invoices").insert({
        project_id: projectId,
        reception_id: invoicingRec.id,
        invoice_number: invNumber.trim(),
        invoice_date: invDate,
        amount: invAmount,
        status: "pending",
        comment: invComment || null,
        attachment_url: attachmentUrl,
        attachment_name: attachmentName,
      }).select().single();

      if (invErr || !invData) {
        toast.error(`Error al crear factura: ${invErr?.message}`);
        return;
      }

      // Update reception status to 'invoiced'
      await supabase.from("reception_notes")
        .update({ status: "invoiced" })
        .eq("id", invoicingRec.id);

      await logActivity({
        projectId,
        actionType: "invoice_registered",
        entityType: "invoice",
        entityId: invData.id,
        description: `Factura ${invNumber.trim()} registrada (${invoicingRec.order.supplier})`,
        metadata: {
          invoiceId: invData.id,
          invoiceNumber: invNumber.trim(),
          receptionId: invoicingRec.id,
          attachmentUrl: attachmentUrl || undefined,
          amount: invAmount,
        },
      });

      toast.success(`Factura ${invNumber} registrada`);
      setInvoicingRec(null);
      loadData();
    } finally {
      setSaving(false);
    }
  }

  // ─── Payment dialog ───
  function openPaymentDialog(rec: ReceptionFull) {
    if (!rec.invoice) return;
    const remaining = Number(rec.invoice.amount) - (rec.paidAmount || 0);
    setPayingRec(rec);
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayAmount(Math.max(0, remaining));
    setPayCurrency(rec.order.currency);
    setPayUseCustomTC(false);
    setPayCustomTC(Number(project?.exchange_rate || 0));
    setPayType("regular");
    setPayComment("");
  }

  async function submitPayment() {
    if (!payingRec || !payingRec.invoice) return;
    if (payAmount <= 0) {
      toast.error("El monto del pago debe ser mayor a cero");
      return;
    }

    const remaining = Number(payingRec.invoice.amount) - (payingRec.paidAmount || 0);
    if (payAmount > remaining + 0.001) {
      if (!confirm(`El monto (${payAmount}) supera el saldo pendiente (${remaining.toFixed(2)}). ¿Continuar?`)) {
        return;
      }
    }

    setSavingPayment(true);
    try {
      const exchangeRate = payUseCustomTC && payCustomTC > 0
        ? payCustomTC
        : (project?.exchange_rate || null);

      const { data: payData, error: payErr } = await supabase.from("payments").insert({
        project_id: projectId,
        invoice_id: payingRec.invoice.id,
        order_id: payingRec.order.id,
        type: payType,
        payment_date: payDate,
        amount: payAmount,
        currency: payCurrency,
        exchange_rate: exchangeRate,
        comment: payComment || null,
      }).select().single();

      if (payErr || !payData) {
        toast.error(`Error al registrar pago: ${payErr?.message}`);
        return;
      }

      // If this payment completes the invoice, mark invoice as paid
      const totalPaid = (payingRec.paidAmount || 0) + payAmount;
      const wasInvoiceMarkedPaid = totalPaid >= Number(payingRec.invoice.amount) - 0.001;
      if (wasInvoiceMarkedPaid) {
        await supabase.from("invoices").update({ status: "paid" }).eq("id", payingRec.invoice.id);
      }

      await logActivity({
        projectId,
        actionType: "payment_registered",
        entityType: "payment",
        entityId: payData.id,
        description: `Pago de ${payAmount.toLocaleString("es")} ${payCurrency} a ${payingRec.order.supplier} (Factura ${payingRec.invoice.invoice_number})`,
        metadata: {
          paymentId: payData.id,
          invoiceId: payingRec.invoice.id,
          amount: payAmount,
          currency: payCurrency,
          wasInvoiceMarkedPaid,
        },
      });

      toast.success(`Pago de ${payAmount.toLocaleString("es")} ${payCurrency} registrado`);
      setPayingRec(null);
      loadData();
    } finally {
      setSavingPayment(false);
    }
  }

  async function openAttachment(url: string) {
    const { data, error } = await supabase.storage
      .from("invoice-attachments")
      .createSignedUrl(url, 3600);
    if (error || !data?.signedUrl) {
      toast.error("No se pudo abrir el archivo");
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  function formatMoney(amount: number, currency: string) {
    const curr = CURRENCIES.find((c) => c.code === currency);
    const symbol = curr?.symbol || "";
    return `${symbol} ${amount.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  if (loading) return <div className="p-6 text-muted-foreground">Cargando facturación...</div>;

  // Receptions without invoice yet
  const pendingReceptions = receptions.filter((r) => r.status === "received");
  // Receptions invoiced but with invoice NOT fully paid
  const invoicedReceptions = receptions.filter(
    (r) => r.status === "invoiced" &&
           r.invoice &&
           (r.paidAmount || 0) < Number(r.invoice.amount) - 0.001
  );
  // Receptions fully paid
  const paidReceptions = receptions.filter(
    (r) => r.status === "invoiced" &&
           r.invoice &&
           (r.paidAmount || 0) >= Number(r.invoice.amount) - 0.001
  );

  const baseView = view === "pending"
    ? pendingReceptions
    : view === "invoiced"
      ? invoicedReceptions
      : paidReceptions;

  // Helpers for filter values (read from baseView so options match current view)
  function receptionRef(r: ReceptionFull) {
    return `${r.order.number}-REC-${String(r.number).padStart(3, "0")}`;
  }
  const allReceptionRefs = baseView.map(receptionRef);
  const allOcNumbers = baseView.map((r) => r.order.number);
  const allSuppliers = baseView.map((r) => r.order.supplier);
  const allDates = baseView.map((r) => r.date);
  const allInvoiceNumbers = baseView.map((r) => r.invoice?.invoice_number || "").filter(Boolean);

  const dateLabels = Object.fromEntries(
    Array.from(new Set(allDates)).map((d) => [d, new Date(d).toLocaleDateString("es")])
  );

  const visible = baseView.filter((r) => {
    if (!matchesColumnFilter(filterReception, receptionRef(r))) return false;
    if (!matchesColumnFilter(filterOC, r.order.number)) return false;
    if (!matchesColumnFilter(filterSupplier, r.order.supplier)) return false;
    if (!matchesColumnFilter(filterDate, r.date)) return false;
    if (view !== "pending") {
      if (!matchesColumnFilter(filterInvoice, r.invoice?.invoice_number || "")) return false;
    }
    return true;
  });

  const hasActiveColumnFilter =
    filterReception.size > 0 || filterOC.size > 0 ||
    filterSupplier.size > 0 || filterDate.size > 0 || filterInvoice.size > 0;

  function clearAllColumnFilters() {
    setFilterReception(new Set());
    setFilterOC(new Set());
    setFilterSupplier(new Set());
    setFilterDate(new Set());
    setFilterInvoice(new Set());
  }

  // Summary
  const pendingTotal = pendingReceptions.reduce(
    (s, r) => s + r.lines.reduce((ss, l) => ss + Number(l.payable_amount || 0), 0),
    0
  );
  const invoicedTotal = invoicedReceptions.reduce(
    (s, r) => s + (r.invoice ? (Number(r.invoice.amount) - (r.paidAmount || 0)) : 0),
    0
  );
  const paidTotal = paidReceptions.reduce(
    (s, r) => s + (r.invoice ? Number(r.invoice.amount) : 0),
    0
  );

  return (
    <div className="py-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Facturación</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Gestiona las facturas asociadas a recepciones. Cada recepción habilita al proveedor a facturar el monto pagable.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => { setView("pending"); clearAllColumnFilters(); }}
          className={cn(
            "text-left p-4 rounded-lg border transition-colors",
            view === "pending" ? "border-amber-400 bg-amber-50" : "hover:bg-muted/30"
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-semibold">Recibido no Facturado</span>
            </div>
            <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">{pendingReceptions.length}</Badge>
          </div>
          <p className="text-xl font-bold mt-2 text-amber-700">
            {pendingTotal > 0 ? pendingTotal.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0,00"}
          </p>
          <p className="text-[10px] text-muted-foreground">Pendiente de facturar</p>
        </button>

        <button
          onClick={() => { setView("invoiced"); clearAllColumnFilters(); }}
          className={cn(
            "text-left p-4 rounded-lg border transition-colors",
            view === "invoiced" ? "border-amber-400 bg-amber-50" : "hover:bg-muted/30"
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-[#B85A0F]" />
              <span className="text-sm font-semibold">Facturado sin Pagar</span>
            </div>
            <Badge className="bg-amber-100 text-[#B85A0F] hover:bg-amber-100">{invoicedReceptions.length}</Badge>
          </div>
          <p className="text-xl font-bold mt-2 text-[#B85A0F]">
            {invoicedTotal > 0 ? invoicedTotal.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0,00"}
          </p>
          <p className="text-[10px] text-muted-foreground">Saldo pendiente de pagar</p>
        </button>

        <button
          onClick={() => { setView("paid"); clearAllColumnFilters(); }}
          className={cn(
            "text-left p-4 rounded-lg border transition-colors",
            view === "paid" ? "border-emerald-400 bg-emerald-50" : "hover:bg-muted/30"
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-semibold">Pagadas</span>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{paidReceptions.length}</Badge>
          </div>
          <p className="text-xl font-bold mt-2 text-emerald-700">
            {paidTotal > 0 ? paidTotal.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0,00"}
          </p>
          <p className="text-[10px] text-muted-foreground">Total pagado</p>
        </button>
      </div>

      {/* Clear all filters helper bar */}
      {hasActiveColumnFilter && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Filtros activos: mostrando {visible.length} de {baseView.length}</span>
          <button
            onClick={clearAllColumnFilters}
            className="text-primary hover:underline"
          >
            Limpiar todos los filtros
          </button>
        </div>
      )}

      {/* List */}
      {baseView.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {view === "pending" && "No hay recepciones pendientes de facturar."}
          {view === "invoiced" && "No hay facturas pendientes de pagar."}
          {view === "paid" && "No hay recepciones pagadas todavía."}
        </div>
      ) : visible.length === 0 ? (
        <div className="border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[140px_140px_1fr_90px_130px_120px_170px] gap-2 px-4 py-2 bg-muted/40 text-[10px] font-semibold uppercase tracking-wider border-b">
            <ColumnFilter label="Recepción" values={allReceptionRefs} selected={filterReception} onChange={setFilterReception} />
            <ColumnFilter label="OC" values={allOcNumbers} selected={filterOC} onChange={setFilterOC} />
            <ColumnFilter label="Proveedor" values={allSuppliers} selected={filterSupplier} onChange={setFilterSupplier} />
            <div className="flex items-center justify-center"><ColumnFilter label="Fecha" values={allDates} valueLabels={dateLabels} selected={filterDate} onChange={setFilterDate} /></div>
            <span className="text-right">
              {view === "pending" ? "Monto a facturar" : view === "invoiced" ? "Saldo pendiente" : "Total pagado"}
            </span>
            {view !== "pending" ? (
              <ColumnFilter label="N° Factura" values={allInvoiceNumbers} selected={filterInvoice} onChange={setFilterInvoice} />
            ) : (
              <span />
            )}
            <span className="text-right">Acción</span>
          </div>
          <div className="text-center py-8 text-muted-foreground text-sm">
            Ninguna fila coincide con los filtros aplicados.
          </div>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[140px_140px_1fr_90px_130px_120px_170px] gap-2 px-4 py-2 bg-muted/40 text-[10px] font-semibold uppercase tracking-wider border-b">
            <ColumnFilter label="Recepción" values={allReceptionRefs} selected={filterReception} onChange={setFilterReception} />
            <ColumnFilter label="OC" values={allOcNumbers} selected={filterOC} onChange={setFilterOC} />
            <ColumnFilter label="Proveedor" values={allSuppliers} selected={filterSupplier} onChange={setFilterSupplier} />
            <div className="flex items-center justify-center"><ColumnFilter label="Fecha" values={allDates} valueLabels={dateLabels} selected={filterDate} onChange={setFilterDate} /></div>
            <span className="text-right">
              {view === "pending" ? "Monto a facturar" : view === "invoiced" ? "Saldo pendiente" : "Total pagado"}
            </span>
            {view !== "pending" ? (
              <ColumnFilter label="N° Factura" values={allInvoiceNumbers} selected={filterInvoice} onChange={setFilterInvoice} />
            ) : (
              <span />
            )}
            <span className="text-right">Acción</span>
          </div>

          {visible.map((rec) => {
            const payable = rec.lines.reduce((s, l) => s + Number(l.payable_amount || 0), 0);
            const invAmt = rec.invoice ? Number(rec.invoice.amount) : 0;
            const paidSoFar = rec.paidAmount || 0;
            const remaining = invAmt - paidSoFar;
            return (
              <div
                key={rec.id}
                className="grid grid-cols-[140px_140px_1fr_90px_130px_120px_170px] gap-2 px-4 py-2.5 items-center text-xs border-b last:border-b-0 hover:bg-muted/20"
              >
                <span className="font-mono font-semibold flex items-center gap-1.5">
                  {rec.order.number}-REC-{String(rec.number).padStart(3, "0")}
                  {rec.type === "advance" && (
                    <Badge className="text-[9px] bg-amber-100 text-amber-700 hover:bg-amber-100 font-normal px-1.5 py-0">
                      Anticipo
                    </Badge>
                  )}
                </span>
                <span className="font-mono text-muted-foreground">{rec.order.number}</span>
                <span className="truncate" title={rec.order.supplier}>{rec.order.supplier}</span>
                <span className="text-center text-muted-foreground">
                  {new Date(rec.date).toLocaleDateString("es")}
                </span>
                <span className="text-right font-mono font-semibold" style={{ color: "#E87722" }}>
                  {view === "pending" && formatMoney(payable, rec.order.currency)}
                  {view === "invoiced" && (
                    <span className="flex flex-col items-end leading-tight">
                      <span className="text-sm">{formatMoney(remaining, rec.order.currency)}</span>
                      {paidSoFar > 0 && (
                        <span className="text-[9px] text-muted-foreground font-normal">
                          {formatMoney(paidSoFar, rec.order.currency)} de {formatMoney(invAmt, rec.order.currency)}
                        </span>
                      )}
                    </span>
                  )}
                  {view === "paid" && formatMoney(invAmt, rec.order.currency)}
                </span>
                <span className="flex items-center gap-1">
                  {view !== "pending" && rec.invoice?.invoice_number && (
                    <span className="font-mono text-xs">{rec.invoice.invoice_number}</span>
                  )}
                </span>
                <span className="flex items-center justify-end gap-2">
                  {view !== "pending" && rec.invoice?.attachment_url && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => openAttachment(rec.invoice!.attachment_url!)}
                      title={rec.invoice.attachment_name || ""}
                    >
                      <Paperclip className="h-3 w-3" />
                    </Button>
                  )}
                  {view === "pending" && (
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => openInvoiceDialog(rec)}
                    >
                      <Receipt className="h-3 w-3 mr-1" /> Facturar
                    </Button>
                  )}
                  {view === "invoiced" && (
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => openPaymentDialog(rec)}
                    >
                      <Wallet className="h-3 w-3 mr-1" /> Registrar pago
                    </Button>
                  )}
                  {view === "paid" && (
                    <Badge className="text-[10px] bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                      <CheckCircle2 className="h-3 w-3 mr-0.5" /> Pagada
                    </Badge>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ─────── Invoice Dialog ─────── */}
      <Dialog open={invoicingRec !== null} onOpenChange={(open) => !open && setInvoicingRec(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              Registrar Factura
            </DialogTitle>
          </DialogHeader>

          {invoicingRec && (
            <div className="space-y-4">
              {/* Context info */}
              <div className="bg-muted/30 rounded-md p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recepción:</span>
                  <span className="font-mono font-semibold">
                    {invoicingRec.order.number}-REC-{String(invoicingRec.number).padStart(3, "0")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Orden de Compra:</span>
                  <span className="font-mono">{invoicingRec.order.number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Proveedor:</span>
                  <span>{invoicingRec.order.supplier}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Monto a pagar de la recepción:</span>
                  <span className="font-semibold">
                    {formatMoney(
                      invoicingRec.lines.reduce((s, l) => s + Number(l.payable_amount || 0), 0),
                      invoicingRec.order.currency
                    )}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">N° de Factura *</label>
                  <Input
                    className="mt-1"
                    value={invNumber}
                    onChange={(e) => setInvNumber(e.target.value)}
                    placeholder="Ej: A-001-0001234"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Fecha de Factura *</label>
                  <Input
                    className="mt-1"
                    type="date"
                    value={invDate}
                    onChange={(e) => setInvDate(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Monto facturado *</label>
                <Input
                  className="mt-1"
                  type="number"
                  step="0.01"
                  value={invAmount || ""}
                  onChange={(e) => setInvAmount(parseFloat(e.target.value) || 0)}
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Pre-llenado con el monto pagable de la recepción. Ajustá si la factura real difiere.
                </p>
              </div>

              {/* File upload */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">Adjuntar Factura (PDF o imagen)</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,image/png,image/jpeg,image/jpg,image/webp"
                    className="hidden"
                    onChange={(e) => setInvFile(e.target.files?.[0] || null)}
                  />
                  <Button
                    variant="outline"
                    className="flex-1 justify-start"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {invFile ? invFile.name : "Seleccionar archivo..."}
                  </Button>
                  {invFile && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setInvFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                    >
                      Quitar
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Tamaño máximo: 10 MB. Formatos: PDF, PNG, JPG, WEBP
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Comentario</label>
                <Input
                  className="mt-1"
                  value={invComment}
                  onChange={(e) => setInvComment(e.target.value)}
                  placeholder="Notas opcionales..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setInvoicingRec(null)} disabled={saving}>
                  Cancelar
                </Button>
                <Button onClick={submitInvoice} disabled={saving}>
                  {saving ? "Guardando..." : "Registrar Factura"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─────── Payment Dialog ─────── */}
      <Dialog open={payingRec !== null} onOpenChange={(open) => !open && setPayingRec(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              Registrar Pago
            </DialogTitle>
          </DialogHeader>

          {payingRec && payingRec.invoice && (() => {
            const invAmt = Number(payingRec.invoice.amount);
            const paidSoFar = payingRec.paidAmount || 0;
            const remaining = invAmt - paidSoFar;
            const projectRate = Number(project?.exchange_rate || 0);
            const localCurr = project?.local_currency || "PYG";
            const effectiveRate = payUseCustomTC && payCustomTC > 0 ? payCustomTC : projectRate;
            // USD equivalent preview
            const usdEquivalent = payCurrency === "USD"
              ? payAmount
              : (effectiveRate > 0 ? payAmount / effectiveRate : 0);

            return (
              <div className="space-y-4">
                {/* Context */}
                <div className="bg-muted/30 rounded-md p-3 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Factura:</span>
                    <span className="font-mono font-semibold">{payingRec.invoice.invoice_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Proveedor:</span>
                    <span>{payingRec.order.supplier}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Monto total de la factura:</span>
                    <span>{formatMoney(invAmt, payingRec.order.currency)}</span>
                  </div>
                  {paidSoFar > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Ya pagado:</span>
                      <span className="text-emerald-700 font-semibold">
                        {formatMoney(paidSoFar, payingRec.order.currency)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between border-t pt-1 mt-1">
                    <span className="text-muted-foreground font-medium">Saldo pendiente:</span>
                    <span className="font-bold" style={{ color: "#E87722" }}>
                      {formatMoney(remaining, payingRec.order.currency)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Fecha de pago *</label>
                    <Input
                      className="mt-1"
                      type="date"
                      value={payDate}
                      onChange={(e) => setPayDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Tipo de pago</label>
                    <Select value={payType} onValueChange={(v) => { if (v) setPayType(v as typeof payType); }}>
                      <SelectTrigger className="mt-1 w-full">
                        <span>
                          {payType === "advance" ? "Anticipo" :
                           payType === "retention_return" ? "Devolución retención" : "Regular"}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="regular">Regular</SelectItem>
                        <SelectItem value="advance">Anticipo</SelectItem>
                        <SelectItem value="retention_return">Devolución retención</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-[2fr_1fr] gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Monto pagado *</label>
                    <Input
                      className="mt-1"
                      type="number"
                      step="0.01"
                      value={payAmount || ""}
                      onChange={(e) => setPayAmount(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Moneda</label>
                    <Select value={payCurrency} onValueChange={(v) => { if (v) setPayCurrency(v); }}>
                      <SelectTrigger className="mt-1 w-full">
                        <span>{payCurrency}</span>
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.symbol} {c.code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Custom exchange rate section */}
                <div className="border rounded-md p-3 bg-muted/10 space-y-2">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id="useCustomTC"
                      checked={payUseCustomTC}
                      onChange={(e) => setPayUseCustomTC(e.target.checked)}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <label htmlFor="useCustomTC" className="text-xs font-medium cursor-pointer">
                        Aplicar tipo de cambio diferente al del proyecto
                      </label>
                      <p className="text-[10px] text-muted-foreground">
                        TC del proyecto: 1 USD = {projectRate.toLocaleString("es")} {localCurr}
                      </p>
                    </div>
                  </div>
                  {payUseCustomTC && (
                    <div className="flex items-center gap-2 pl-6">
                      <label className="text-xs text-muted-foreground whitespace-nowrap">1 USD =</label>
                      <Input
                        className="h-8 text-xs w-32"
                        type="number"
                        step="0.01"
                        value={payCustomTC || ""}
                        onChange={(e) => setPayCustomTC(parseFloat(e.target.value) || 0)}
                      />
                      <span className="text-xs text-muted-foreground">{localCurr}</span>
                    </div>
                  )}
                  {payAmount > 0 && payCurrency !== "USD" && effectiveRate > 0 && (
                    <div className="text-xs text-muted-foreground pl-6 pt-1 border-t">
                      <DollarSign className="h-3 w-3 inline mr-0.5" />
                      Equivalente USD:{" "}
                      <span className="font-semibold text-foreground">
                        ${usdEquivalent.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>{" "}
                      <span className="text-[10px]">(usando TC {effectiveRate})</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">Comentario</label>
                  <Input
                    className="mt-1"
                    value={payComment}
                    onChange={(e) => setPayComment(e.target.value)}
                    placeholder="Medio de pago, referencia, etc."
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button variant="outline" onClick={() => setPayingRec(null)} disabled={savingPayment}>
                    Cancelar
                  </Button>
                  <Button onClick={submitPayment} disabled={savingPayment || payAmount <= 0}>
                    {savingPayment ? "Guardando..." : "Registrar Pago"}
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
