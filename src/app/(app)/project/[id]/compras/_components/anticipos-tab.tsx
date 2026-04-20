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
  HandCoins,
  AlertCircle,
  CheckCircle2,
  TrendingDown,
  DollarSign,
  Clock,
  Upload,
  Shield,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { CURRENCIES } from "@/lib/constants/units";
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  ReceptionNote,
  DeliveryNote,
  Payment,
  Project,
} from "@/lib/types/database";
import { cn } from "@/lib/utils";
import { logActivity } from "@/lib/utils/activity-log";
import { resolveAdvanceAmount } from "@/lib/utils/oc-advance";

interface Props {
  projectId: string;
}

// Advance lifecycle follows the billing circuit:
// pending_approval → received (Recibido no Facturado) → invoiced (Facturado sin Pagar) → paid → amortizing → fully_amortized
type AdvanceStatus =
  | "pending_approval"
  | "received"
  | "invoiced"
  | "paid"
  | "amortizing"
  | "fully_amortized";

interface CertificationRow {
  receptionId: string;
  receptionRef: string;    // OC-NNN-REC-NNN
  date: string;
  grossAmount: number;
  amortizationAmount: number;
  retentionAmount: number;
}

interface OCAdvanceCard {
  oc: PurchaseOrder & { lines: PurchaseOrderLine[] };
  advanceReceptionId: string | null;   // reception_notes.id of the advance
  advanceReceptionStatus: string;       // pending_approval | received | invoiced | cancelled
  advanceAmount: number;
  paidAmount: number;
  amortizedAmount: number;
  outstandingBalance: number;
  remainingToPay: number;
  status: AdvanceStatus;
  payments: Payment[];
  certifications: CertificationRow[];
  retainedTotal: number;
  retentionReturned: number;
  retentionBalance: number;
}

const STATUS_META: Record<AdvanceStatus, { label: string; color: string; icon: typeof Clock }> = {
  pending_approval: { label: "Pendiente de aprobación", color: "bg-amber-100 text-amber-700", icon: AlertCircle },
  received:         { label: "Recibido · no facturado", color: "bg-[#FFEEDC] text-[#B85A0F]", icon: Clock },
  invoiced:         { label: "Facturado · sin pagar", color: "bg-[#FFEEDC] text-[#B85A0F]", icon: Clock },
  paid:             { label: "Pagado · sin amortizar", color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  amortizing:       { label: "Amortizándose", color: "bg-[#FFEEDC] text-[#B85A0F]", icon: TrendingDown },
  fully_amortized:  { label: "Totalmente amortizado", color: "bg-neutral-100 text-neutral-700", icon: CheckCircle2 },
};

export function AnticiposTab({ projectId }: Props) {
  const supabase = createClient();
  const [cards, setCards] = useState<OCAdvanceCard[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState<AdvanceStatus | "all">("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");

  // Payment dialog state (only for retention return now; advance pays via Facturación circuit)
  const [dialogMode, setDialogMode] = useState<"retention_return" | null>(null);
  const [dialogCard, setDialogCard] = useState<OCAdvanceCard | null>(null);
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payAmount, setPayAmount] = useState(0);
  const [payCurrency, setPayCurrency] = useState("USD");
  const [payUseCustomTC, setPayUseCustomTC] = useState(false);
  const [payCustomTC, setPayCustomTC] = useState(0);
  const [payComment, setPayComment] = useState("");
  const [payFile, setPayFile] = useState<File | null>(null);
  const [savingPay, setSavingPay] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    const { data: projData } = await supabase.from("projects").select("*").eq("id", projectId).single();
    if (projData) setProject(projData as Project);

    const { data: ordersData } = await supabase
      .from("purchase_orders")
      .select("*, lines:purchase_order_lines(*)")
      .eq("project_id", projectId)
      .eq("has_advance", true)
      .order("created_at", { ascending: false });

    const orders = (ordersData || []) as (PurchaseOrder & { lines: PurchaseOrderLine[] })[];

    if (orders.length === 0) {
      setCards([]);
      setLoading(false);
      return;
    }

    const orderIds = orders.map((o) => o.id);

    const [paymentsRes, regularRecsRes, advanceRecsRes, invoicesRes] = await Promise.all([
      supabase
        .from("payments")
        .select("*")
        .in("order_id", orderIds),
      supabase
        .from("reception_notes")
        .select("id, order_id, number, date, status, type, lines:delivery_notes(gross_amount, amortization_amount, retention_amount)")
        .in("order_id", orderIds)
        .eq("type", "regular")
        .neq("status", "cancelled"),
      supabase
        .from("reception_notes")
        .select("id, order_id, number, date, status, type")
        .in("order_id", orderIds)
        .eq("type", "advance"),
      supabase
        .from("invoices")
        .select("id, reception_id, amount, status")
        .eq("project_id", projectId),
    ]);

    const paymentsByOC = new Map<string, Payment[]>();
    for (const p of (paymentsRes.data || []) as Payment[]) {
      if (!p.order_id) continue;
      const arr = paymentsByOC.get(p.order_id) || [];
      arr.push(p);
      paymentsByOC.set(p.order_id, arr);
    }

    // Advance receptions by order
    type AdvRecRaw = { id: string; order_id: string; number: number; date: string; status: string; type: string };
    const advanceReceptionByOC = new Map<string, AdvRecRaw>();
    for (const r of (advanceRecsRes.data || []) as AdvRecRaw[]) {
      advanceReceptionByOC.set(r.order_id, r);
    }

    // Invoices that target an advance reception
    type InvRaw = { id: string; reception_id: string | null; amount: number; status: string };
    const invoiceByReceptionId = new Map<string, InvRaw>();
    for (const inv of (invoicesRes.data || []) as InvRaw[]) {
      if (inv.reception_id) invoiceByReceptionId.set(inv.reception_id, inv);
    }

    type RecRaw = {
      id: string;
      order_id: string;
      number: number;
      date: string;
      status: string;
      type: string;
      lines: { gross_amount: number | null; amortization_amount: number | null; retention_amount: number | null }[];
    };
    const recsByOC = new Map<string, RecRaw[]>();
    for (const r of (regularRecsRes.data || []) as RecRaw[]) {
      const arr = recsByOC.get(r.order_id) || [];
      arr.push(r);
      recsByOC.set(r.order_id, arr);
    }

    const cardsList: OCAdvanceCard[] = orders.map((oc) => {
      const ocTotal = oc.lines.reduce((s, l) => s + Number(l.total || 0), 0);
      const advanceAmount = resolveAdvanceAmount(
        oc.advance_type,
        Number(oc.advance_amount || 0),
        ocTotal
      );

      const ocPayments = paymentsByOC.get(oc.id) || [];
      const retentionReturnPayments = ocPayments.filter((p) => p.type === "retention_return");

      // Paid amount of the advance: payments that are either
      //   (a) explicitly type='advance' on this OC (legacy / direct-from-Anticipos flow), OR
      //   (b) linked to the invoice that targets the advance reception (Facturación flow)
      const advanceReceptionRec = advanceReceptionByOC.get(oc.id);
      const advanceInvoice = advanceReceptionRec ? invoiceByReceptionId.get(advanceReceptionRec.id) : null;
      const advancePayments = ocPayments.filter((p) => {
        if (p.type === "advance") return true;
        if (advanceInvoice && p.invoice_id === advanceInvoice.id) return true;
        return false;
      });
      const paidAmount = advancePayments.reduce((s, p) => s + Number(p.amount || 0), 0);
      const retentionReturned = retentionReturnPayments.reduce((s, p) => s + Number(p.amount || 0), 0);

      const recs = (recsByOC.get(oc.id) || []).sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      const certifications: CertificationRow[] = recs.map((r) => {
        const gross = r.lines.reduce((s, l) => s + Number(l.gross_amount || 0), 0);
        const amort = r.lines.reduce((s, l) => s + Number(l.amortization_amount || 0), 0);
        const reten = r.lines.reduce((s, l) => s + Number(l.retention_amount || 0), 0);
        return {
          receptionId: r.id,
          receptionRef: `${oc.number}-REC-${String(r.number).padStart(3, "0")}`,
          date: r.date,
          grossAmount: gross,
          amortizationAmount: amort,
          retentionAmount: reten,
        };
      });

      const amortizedAmount = certifications.reduce((s, c) => s + c.amortizationAmount, 0);
      const retainedTotal = certifications.reduce((s, c) => s + c.retentionAmount, 0);

      const outstandingBalance = Math.max(0, paidAmount - amortizedAmount);
      const remainingToPay = Math.max(0, advanceAmount - paidAmount);
      const retentionBalance = Math.max(0, retainedTotal - retentionReturned);

      const advanceReception = advanceReceptionByOC.get(oc.id);

      // Derive the status from the billing circuit
      // pending_approval → received → invoiced (via invoice) → paid (via payment) → amortizing → fully_amortized
      let status: AdvanceStatus;
      if (!advanceReception || advanceReception.status === "pending_approval") {
        status = "pending_approval";
      } else if (advanceReception.status === "received") {
        // Not yet invoiced: waiting for the supplier's invoice → Facturación "Recibido no Facturado"
        status = "received";
      } else if (advanceReception.status === "invoiced" && paidAmount <= 0.001) {
        // Invoice registered but not paid yet
        status = "invoiced";
      } else if (paidAmount > 0.001 && amortizedAmount <= 0.001) {
        status = "paid";
      } else if (amortizedAmount > 0.001 && outstandingBalance > 0.001) {
        status = "amortizing";
      } else if (outstandingBalance <= 0.001 && amortizedAmount > 0.001) {
        status = "fully_amortized";
      } else {
        status = "received"; // safe fallback
      }

      return {
        oc,
        advanceReceptionId: advanceReception?.id || null,
        advanceReceptionStatus: advanceReception?.status || "missing",
        advanceAmount,
        paidAmount,
        amortizedAmount,
        outstandingBalance,
        remainingToPay,
        status,
        payments: advancePayments,
        certifications,
        retainedTotal,
        retentionReturned,
        retentionBalance,
      };
    });

    setCards(cardsList);
    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  function formatMoney(amount: number, currency: string): string {
    const c = CURRENCIES.find((x) => x.code === currency);
    const symbol = c?.symbol || "";
    return `${symbol} ${amount.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function openRetentionReturnDialog(card: OCAdvanceCard) {
    setDialogCard(card);
    setDialogMode("retention_return");
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayAmount(Math.max(0, card.retentionBalance));
    setPayCurrency(card.oc.currency);
    setPayUseCustomTC(false);
    setPayCustomTC(Number(project?.exchange_rate || 0));
    setPayComment("");
    setPayFile(null);
  }

  // Approve advance: reception status pending_approval → received
  // Once received, it enters the Facturación "Recibido no Facturado" circuit
  async function approveAdvance(card: OCAdvanceCard) {
    if (!card.advanceReceptionId) {
      toast.error("Esta OC no tiene recepción de anticipo asociada");
      return;
    }
    if (!confirm(`¿Aprobar el anticipo de ${formatMoney(card.advanceAmount, card.oc.currency)} para la OC ${card.oc.number}?\n\nAl aprobar, el anticipo entrará al circuito de facturación en estado "Recibido no Facturado".`)) return;

    const { error } = await supabase
      .from("reception_notes")
      .update({ status: "received" })
      .eq("id", card.advanceReceptionId);

    if (error) {
      toast.error(`Error al aprobar: ${error.message}`);
      return;
    }

    await logActivity({
      projectId,
      actionType: "reception_created",   // reuse existing action type
      entityType: "reception_note",
      entityId: card.advanceReceptionId,
      description: `Anticipo aprobado · OC ${card.oc.number} · ${formatMoney(card.advanceAmount, card.oc.currency)}`,
      metadata: {
        receptionId: card.advanceReceptionId,
        orderId: card.oc.id,
        ocNumber: card.oc.number,
        approvalOfAdvance: true,
      },
    });

    toast.success(`Anticipo aprobado · entró a Facturación como "Recibido no Facturado"`);
    loadData();
  }

  async function submitRetentionReturn() {
    if (!dialogCard || dialogMode !== "retention_return") return;
    if (payAmount <= 0) {
      toast.error("El monto debe ser mayor a cero");
      return;
    }

    setSavingPay(true);
    try {
      const exchangeRate = payUseCustomTC && payCustomTC > 0
        ? payCustomTC
        : (project?.exchange_rate || null);

      let attachmentPath: string | null = null;
      if (payFile) {
        const ext = payFile.name.split(".").pop() || "bin";
        const fileName = `${projectId}/retention-returns/${dialogCard.oc.id}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("invoice-attachments")
          .upload(fileName, payFile, { upsert: true });
        if (upErr) {
          toast.error(`Error al subir comprobante: ${upErr.message}`);
          return;
        }
        attachmentPath = fileName;
      }

      const comment = [
        payComment.trim() || null,
        attachmentPath ? `ATT:${attachmentPath}` : null,
      ].filter(Boolean).join(" · ") || null;

      const { data, error } = await supabase.from("payments").insert({
        project_id: projectId,
        invoice_id: null,
        order_id: dialogCard.oc.id,
        type: "retention_return",
        payment_date: payDate,
        amount: payAmount,
        currency: payCurrency,
        exchange_rate: exchangeRate,
        comment,
      }).select().single();

      if (error || !data) {
        toast.error(`Error al registrar pago: ${error?.message}`);
        return;
      }

      await logActivity({
        projectId,
        actionType: "payment_registered",
        entityType: "payment",
        entityId: data.id,
        description: `Retención devuelta · OC ${dialogCard.oc.number} · ${payAmount.toLocaleString("es")} ${payCurrency}`,
        metadata: {
          paymentId: data.id,
          orderId: dialogCard.oc.id,
          ocNumber: dialogCard.oc.number,
          amount: payAmount,
          currency: payCurrency,
          paymentType: "retention_return",
        },
      });

      toast.success("Devolución de retención registrada");
      setDialogCard(null);
      setDialogMode(null);
      loadData();
    } finally {
      setSavingPay(false);
    }
  }

  if (loading) return <div className="py-6 text-muted-foreground">Cargando anticipos...</div>;

  const uniqueSuppliers = Array.from(new Set(cards.map((c) => c.oc.supplier))).sort();
  const visible = cards.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (supplierFilter !== "all" && c.oc.supplier !== supplierFilter) return false;
    return true;
  });

  // Summary — split by the OC's currency (local vs USD) so we don't mix units.
  // USD equivalent uses the project exchange rate.
  const localCurrency = project?.local_currency || "PYG";
  const projectRate = Number(project?.exchange_rate || 0);
  type Bucket = { local: number; usd: number; usdEq: number };
  const zeroBucket = (): Bucket => ({ local: 0, usd: 0, usdEq: 0 });
  const addToBucket = (b: Bucket, amount: number, currency: string) => {
    if (currency === "USD") {
      b.usd += amount;
      b.usdEq += amount;
    } else {
      b.local += amount;
      b.usdEq += projectRate > 0 ? amount / projectRate : 0;
    }
  };
  const totalsAdvance = zeroBucket();
  const totalsPaid = zeroBucket();
  const totalsAmortized = zeroBucket();
  const totalsRetained = zeroBucket();
  for (const c of cards) {
    addToBucket(totalsAdvance, c.advanceAmount, c.oc.currency);
    addToBucket(totalsPaid, c.paidAmount, c.oc.currency);
    addToBucket(totalsAmortized, c.amortizedAmount, c.oc.currency);
    addToBucket(totalsRetained, c.retentionBalance, c.oc.currency);
  }

  const fmt = (n: number, decimals = 0) =>
    n > 0 ? n.toLocaleString("es", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "—";

  return (
    <div className="py-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Anticipos dados</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Estado de cuenta por OC · Seguimiento de anticipos pagados, amortizaciones por certificación y retenciones acumuladas.
        </p>
      </div>

      {/* Summary strip — each metric split by currency */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total anticipos", bucket: totalsAdvance, color: "text-foreground", sub: `${cards.length} OC${cards.length !== 1 ? "s" : ""}` },
          { label: "Pagado", bucket: totalsPaid, color: "text-emerald-700", sub: null },
          { label: "Amortizado", bucket: totalsAmortized, color: "text-[#B85A0F]", sub: null },
          { label: "Retenido (saldo)", bucket: totalsRetained, color: "text-foreground", sub: null },
        ].map((m) => (
          <div key={m.label} className="bg-muted/40 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">{m.label}</p>
              {m.sub && <p className="text-[10px] text-muted-foreground">{m.sub}</p>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className="text-[9px] uppercase tracking-wider font-mono text-muted-foreground">
                  {localCurrency}
                </p>
                <p className={cn("text-sm font-bold mt-0.5", m.color)}>{fmt(m.bucket.local, 0)}</p>
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-wider font-mono text-muted-foreground">USD</p>
                <p className={cn("text-sm font-bold mt-0.5", m.color)}>{fmt(m.bucket.usd, 2)}</p>
              </div>
              <div className="border-l pl-2">
                <p className="text-[9px] uppercase tracking-wider font-mono text-muted-foreground">Equiv. USD</p>
                <p className={cn("text-sm font-bold mt-0.5", m.color)}>{fmt(m.bucket.usdEq, 2)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      {cards.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap border-b pb-3">
          <span className="text-xs text-muted-foreground font-medium">Estado:</span>
          <div className="flex gap-1">
            {([
              { v: "all", label: "Todas", count: cards.length },
              { v: "pending_approval", label: "Pend. aprobación", count: cards.filter((c) => c.status === "pending_approval").length },
              { v: "received", label: "Recibido", count: cards.filter((c) => c.status === "received").length },
              { v: "invoiced", label: "Facturado", count: cards.filter((c) => c.status === "invoiced").length },
              { v: "paid", label: "Pagado", count: cards.filter((c) => c.status === "paid").length },
              { v: "amortizing", label: "Amortizándose", count: cards.filter((c) => c.status === "amortizing").length },
              { v: "fully_amortized", label: "Amortizado", count: cards.filter((c) => c.status === "fully_amortized").length },
            ] as const).map((opt) => (
              <button
                key={opt.v}
                onClick={() => setStatusFilter(opt.v as AdvanceStatus | "all")}
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

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Proveedor:</span>
            <Select value={supplierFilter} onValueChange={(v) => { if (v) setSupplierFilter(v); }}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <span className="truncate">{supplierFilter === "all" ? "Todos" : supplierFilter}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos los proveedores</SelectItem>
                {uniqueSuppliers.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="ml-auto text-xs text-muted-foreground">
            {visible.length} de {cards.length} OC
          </div>
        </div>
      )}

      {/* Cards */}
      {cards.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <HandCoins className="h-10 w-10 mx-auto mb-3 opacity-40" />
          No hay OCs con anticipo en este proyecto.
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No hay anticipos que coincidan con los filtros.
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((card) => {
            const StatusIcon = STATUS_META[card.status].icon;
            const progressPct = card.advanceAmount > 0
              ? Math.min(100, (card.amortizedAmount / card.advanceAmount) * 100)
              : 0;
            return (
              <div
                key={card.oc.id}
                className="border rounded-lg overflow-hidden bg-card"
                style={{ boxShadow: "0 1px 2px 0 rgb(10 10 10 / 0.04)" }}
              >
                {/* Card header */}
                <div className="px-5 py-4 border-b bg-muted/20">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-sm font-semibold">{card.oc.number}</span>
                    <span className="text-sm text-muted-foreground">·</span>
                    <span className="text-sm font-medium">{card.oc.supplier}</span>
                    <Badge className={cn("text-[10px] gap-1 ml-auto", STATUS_META[card.status].color)}>
                      <StatusIcon className="h-3 w-3" />
                      {STATUS_META[card.status].label}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-4 gap-3 mt-3 text-xs">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Monto anticipo</p>
                      <p className="font-mono font-semibold mt-0.5">
                        {formatMoney(card.advanceAmount, card.oc.currency)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {card.oc.advance_type === "percentage"
                          ? `${card.oc.advance_amount}% del total`
                          : "Monto fijo"}
                        {" · "}amort. {card.oc.amortization_pct}%
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Pagado</p>
                      <p className={cn(
                        "font-mono font-semibold mt-0.5",
                        card.paidAmount > 0 ? "text-emerald-700" : "text-muted-foreground"
                      )}>
                        {formatMoney(card.paidAmount, card.oc.currency)}
                      </p>
                      {card.paidAmount > 0 && card.remainingToPay > 0 && (
                        <p className="text-[10px] text-amber-700">
                          Falta {formatMoney(card.remainingToPay, card.oc.currency)}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Amortizado</p>
                      <p className={cn(
                        "font-mono font-semibold mt-0.5",
                        card.amortizedAmount > 0 ? "text-[#B85A0F]" : "text-muted-foreground"
                      )}>
                        {formatMoney(card.amortizedAmount, card.oc.currency)}
                      </p>
                      {progressPct > 0 && (
                        <p className="text-[10px] text-muted-foreground">{progressPct.toFixed(1)}% del anticipo</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Saldo vigente</p>
                      <p className={cn(
                        "font-mono font-semibold mt-0.5",
                        card.outstandingBalance > 0 ? "text-foreground" : "text-muted-foreground"
                      )}>
                        {formatMoney(card.outstandingBalance, card.oc.currency)}
                      </p>
                      {card.status === "pending_approval" && (
                        <Button
                          size="sm"
                          className="h-7 text-xs mt-1"
                          onClick={() => approveAdvance(card)}
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Aprobar anticipo
                        </Button>
                      )}
                      {card.status === "received" && (
                        <p className="text-[10px] text-muted-foreground italic mt-1">
                          Facturar desde Facturación ↗
                        </p>
                      )}
                      {card.status === "invoiced" && (
                        <p className="text-[10px] text-muted-foreground italic mt-1">
                          Pagar desde Facturación ↗
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Amortización por certificación */}
                <div className="px-5 py-4">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">
                    Amortización por certificación
                  </h3>
                  {card.certifications.filter((c) => c.amortizationAmount > 0).length === 0 ? (
                    <div className="text-xs text-muted-foreground italic text-center py-4 bg-muted/20 rounded-md">
                      Aún no hay certificaciones con amortización registrada
                    </div>
                  ) : (
                    <div className="border rounded-md overflow-hidden">
                      <div className="grid grid-cols-[50px_1fr_110px_140px_140px] gap-2 px-3 py-2 bg-muted/40 text-[10px] font-semibold uppercase tracking-wider border-b font-mono">
                        <span>#</span>
                        <span>Certificación</span>
                        <span className="text-right">Fecha</span>
                        <span className="text-right">Bruto</span>
                        <span className="text-right">Amortizado</span>
                      </div>
                      {card.certifications
                        .filter((c) => c.amortizationAmount > 0)
                        .map((cert, idx) => (
                          <div
                            key={cert.receptionId}
                            className="grid grid-cols-[50px_1fr_110px_140px_140px] gap-2 px-3 py-2 text-xs border-b last:border-b-0"
                          >
                            <span className="font-mono text-muted-foreground">
                              {String(idx + 1).padStart(2, "0")}
                            </span>
                            <span className="font-mono">{cert.receptionRef}</span>
                            <span className="text-right text-muted-foreground">
                              {new Date(cert.date).toLocaleDateString("es")}
                            </span>
                            <span className="text-right font-mono">
                              {formatMoney(cert.grossAmount, card.oc.currency)}
                            </span>
                            <span className="text-right font-mono font-semibold text-[#B85A0F]">
                              {formatMoney(cert.amortizationAmount, card.oc.currency)}
                            </span>
                          </div>
                        ))}
                      <div className="grid grid-cols-[50px_1fr_110px_140px_140px] gap-2 px-3 py-2 bg-muted/40 text-xs font-semibold border-t-2">
                        <span />
                        <span />
                        <span />
                        <span className="text-right text-muted-foreground">TOTAL AMORTIZADO</span>
                        <span className="text-right font-mono text-[#B85A0F]">
                          {formatMoney(card.amortizedAmount, card.oc.currency)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Retenciones acumuladas */}
                {(card.retainedTotal > 0 || (card.oc.retention_pct ?? 0) > 0) && (
                  <div className="px-5 py-4 border-t bg-muted/10">
                    <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                      <Shield className="h-3 w-3" />
                      Retenciones acumuladas
                    </h3>
                    <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
                      <div>
                        <p className="text-[10px] text-muted-foreground">Retenido total</p>
                        <p className="font-mono font-semibold text-sm mt-0.5">
                          {formatMoney(card.retainedTotal, card.oc.currency)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {card.oc.retention_pct}% por certificación
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">Devuelto</p>
                        <p className={cn(
                          "font-mono font-semibold text-sm mt-0.5",
                          card.retentionReturned > 0 ? "text-emerald-700" : "text-muted-foreground"
                        )}>
                          {formatMoney(card.retentionReturned, card.oc.currency)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">Saldo retenido</p>
                        <p className="font-mono font-semibold text-sm mt-0.5">
                          {formatMoney(card.retentionBalance, card.oc.currency)}
                        </p>
                        {card.oc.return_condition && (
                          <p className="text-[10px] text-muted-foreground italic">{card.oc.return_condition}</p>
                        )}
                      </div>
                      {card.retentionBalance > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => openRetentionReturnDialog(card)}
                        >
                          <Undo2 className="h-3 w-3 mr-1" /> Devolver retención
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Payment Dialog — shared for advance payment and retention return */}
      <Dialog open={dialogCard !== null} onOpenChange={(open) => { if (!open) { setDialogCard(null); setDialogMode(null); } }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="h-5 w-5" />
              Devolver Retención
            </DialogTitle>
          </DialogHeader>

          {dialogCard && (() => {
            const projectRate = Number(project?.exchange_rate || 0);
            const localCurr = project?.local_currency || "PYG";
            const effectiveRate = payUseCustomTC && payCustomTC > 0 ? payCustomTC : projectRate;
            const usdEq = payCurrency === "USD" ? payAmount : (effectiveRate > 0 ? payAmount / effectiveRate : 0);
            const pendingAmount = dialogCard.retentionBalance;

            return (
              <div className="space-y-4">
                <div className="bg-muted/30 rounded-md p-3 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">OC:</span>
                    <span className="font-mono font-semibold">{dialogCard.oc.number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Proveedor:</span>
                    <span>{dialogCard.oc.supplier}</span>
                  </div>
                  <div className="flex justify-between border-t pt-1 mt-1">
                    <span className="text-muted-foreground font-medium">Saldo retenido:</span>
                    <span className="font-bold text-[#E87722]">
                      {formatMoney(pendingAmount, dialogCard.oc.currency)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Fecha *</label>
                    <Input className="mt-1" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Moneda</label>
                    <Select value={payCurrency} onValueChange={(v) => { if (v) setPayCurrency(v); }}>
                      <SelectTrigger className="mt-1 w-full"><span>{payCurrency}</span></SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c.code} value={c.code}>{c.symbol} {c.code}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">Monto *</label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="0.01"
                    value={payAmount || ""}
                    onChange={(e) => setPayAmount(parseFloat(e.target.value) || 0)}
                  />
                </div>

                <div className="border rounded-md p-3 bg-muted/10 space-y-2">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id="customTCAdvance"
                      checked={payUseCustomTC}
                      onChange={(e) => setPayUseCustomTC(e.target.checked)}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <label htmlFor="customTCAdvance" className="text-xs font-medium cursor-pointer">
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
                        ${usdEq.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">Comprobante (opcional)</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,image/png,image/jpeg,image/jpg,image/webp"
                      className="hidden"
                      onChange={(e) => setPayFile(e.target.files?.[0] || null)}
                    />
                    <Button variant="outline" className="flex-1 justify-start h-9" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="h-3.5 w-3.5 mr-2" />
                      {payFile ? payFile.name : "Seleccionar archivo..."}
                    </Button>
                    {payFile && (
                      <Button variant="ghost" size="sm" onClick={() => {
                        setPayFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}>
                        Quitar
                      </Button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">Comentario</label>
                  <Input className="mt-1" value={payComment} onChange={(e) => setPayComment(e.target.value)} placeholder="Referencia, medio de pago..." />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button variant="outline" onClick={() => { setDialogCard(null); setDialogMode(null); }} disabled={savingPay}>Cancelar</Button>
                  <Button onClick={submitRetentionReturn} disabled={savingPay || payAmount <= 0}>
                    {savingPay ? "Guardando..." : "Registrar Devolución"}
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
