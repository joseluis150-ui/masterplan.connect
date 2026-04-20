"use client";

import { useEffect, useState, useCallback } from "react";
import { getNumberLocale } from "@/lib/utils/number-format";
import { createClient } from "@/lib/supabase/client";
import { ChevronDown, ChevronRight, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type {
  EdtCategory,
  EdtSubcategory,
  PurchaseOrder,
  PurchaseOrderLine,
  DeliveryNote,
  Invoice,
  Payment,
  Project,
  ReceptionNote,
} from "@/lib/types/database";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
}

type ColumnKey = "presupuestado" | "ejecutado" | "comprometido" | "recibido" | "facturado" | "pagado" | "anticipos";

interface BreakdownItem {
  // generic fields
  date?: string | null;
  ref?: string;           // OC number, reception number, invoice number, payment reference
  supplier?: string;      // Proveedor de la OC (no aplica para Presupuestado)
  description?: string;
  amountUsd: number;      // always USD internally
  amountOriginal?: number;
  currency?: string;
  note?: string;
}

interface SubcategoryFinance {
  subcategoryId: string;
  subcategoryCode: string;
  subcategoryName: string;
  categoryId: string;
  presupuestado: number;
  comprometido: number;
  recibido: number;
  facturado: number;
  pagado: number;
  anticipos: number;
  details: Record<ColumnKey, BreakdownItem[]>;
}

interface CategoryFinance {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  subcategories: SubcategoryFinance[];
  presupuestado: number;
  comprometido: number;
  recibido: number;
  facturado: number;
  pagado: number;
  anticipos: number;
}

interface BudgetSummaryRow {
  subcategory_id: string;
  category_id: string;
  total_usd: number;
  total_mat: number;
  total_mo: number;
  total_glo: number;
  subcategory_name: string;
  subcategory_code: string;
}

const COLUMN_LABELS: Record<ColumnKey, string> = {
  presupuestado: "Presupuestado",
  ejecutado: "Ejecutado",
  comprometido: "Comprometido",
  recibido: "Recibido",
  facturado: "Facturado",
  pagado: "Pagado",
  anticipos: "Anticipos dados",
};

// Brand-compliant color progression: Ash → Amber → Amber-dark → Emerald (success)
const COLUMN_COLORS: Record<ColumnKey, string> = {
  presupuestado: "text-foreground",
  ejecutado: "text-[#0A0A0A] font-semibold",  // Ink Black (final KPI)
  comprometido: "text-[#737373]",              // Ash 500 (neutral, pending)
  recibido: "text-[#E87722]",                  // Signal Amber (active)
  facturado: "text-[#B85A0F]",                 // Amber 700 (darker amber)
  pagado: "text-emerald-600",                  // Success
  anticipos: "text-amber-700",                 // Amber darker — anticipated outflow
};

export function AvanceTab({ projectId }: Props) {
  const supabase = createClient();
  const [data, setData] = useState<CategoryFinance[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  // Persist the currency choice per project so tab-switching doesn't reset it
  const DISPLAY_CURR_KEY = `avance:displayCurrency:${projectId}`;
  const [displayCurrency, _setDisplayCurrency] = useState<"usd" | "local">(() => {
    if (typeof window === "undefined") return "local";
    const stored = window.localStorage.getItem(DISPLAY_CURR_KEY);
    return stored === "usd" || stored === "local" ? stored : "local";
  });
  const setDisplayCurrency = (v: "usd" | "local") => {
    _setDisplayCurrency(v);
    if (typeof window !== "undefined") window.localStorage.setItem(DISPLAY_CURR_KEY, v);
  };
  // Total amount amortized against advances across all regular certifications (USD).
  const [amortizedUsd, setAmortizedUsd] = useState(0);

  // Breakdown dialog state
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownTitle, setBreakdownTitle] = useState("");
  const [breakdownColumn, setBreakdownColumn] = useState<ColumnKey>("comprometido");
  const [breakdownItems, setBreakdownItems] = useState<BreakdownItem[]>([]);

  const loadData = useCallback(async () => {
    const { data: projectData } = await supabase.from("projects").select("*").eq("id", projectId).single();
    if (projectData) setProject(projectData);
    const tc = Number(projectData?.exchange_rate || 1);

    const { data: ordRaw } = await supabase
      .from("purchase_orders")
      .select("id, number, currency, supplier")
      .eq("project_id", projectId);
    const orders = (ordRaw || []) as Pick<PurchaseOrder, "id" | "number" | "currency" | "supplier">[];
    const ordersById = new Map(orders.map((o) => [o.id, o]));
    const orderIds = orders.map((o) => o.id);

    const { data: olRaw } = orderIds.length
      ? await supabase.from("purchase_order_lines").select("id, order_id").in("order_id", orderIds)
      : { data: [] as { id: string; order_id: string }[] };
    const orderLineIds = (olRaw || []).map((l) => l.id);

    const [
      catsRes,
      subsRes,
      orderLinesRes,
      deliveryRes,
      receptionsRes,
      invoicesRes,
      paymentsRes,
      budgetRes,
    ] = await Promise.all([
      supabase.from("edt_categories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      orderIds.length
        ? supabase.from("purchase_order_lines").select("*").in("order_id", orderIds)
        : Promise.resolve({ data: [] as PurchaseOrderLine[] }),
      orderLineIds.length
        ? supabase.from("delivery_notes").select("*").in("order_line_id", orderLineIds)
        : Promise.resolve({ data: [] as DeliveryNote[] }),
      orderIds.length
        ? supabase.from("reception_notes").select("*").in("order_id", orderIds)
        : Promise.resolve({ data: [] as ReceptionNote[] }),
      supabase.from("invoices").select("*").eq("project_id", projectId),
      supabase.from("payments").select("*").eq("project_id", projectId),
      supabase.rpc("get_budget_summary", { p_project_id: projectId }),
    ]);

    const cats = (catsRes.data || []) as EdtCategory[];
    const subs = (subsRes.data || []) as EdtSubcategory[];
    const orderLines = (orderLinesRes.data || []) as PurchaseOrderLine[];
    const deliveryNotes = (deliveryRes.data || []) as DeliveryNote[];
    const receptions = (receptionsRes.data || []) as ReceptionNote[];
    const invoices = (invoicesRes.data || []) as Invoice[];
    const payments = (paymentsRes.data || []) as Payment[];
    const budgetRows = (budgetRes.data || []) as BudgetSummaryRow[];

    const toUSD = (amount: number, fromCurrency: string): number => {
      if (fromCurrency === "USD") return amount;
      if (fromCurrency === "PYG" || fromCurrency === projectData?.local_currency) {
        return tc > 0 ? amount / tc : 0;
      }
      return amount;
    };

    const receptionById = new Map<string, ReceptionNote>();
    for (const r of receptions) receptionById.set(r.id, r);

    const invoiceByReception = new Map<string, Invoice>();
    for (const inv of invoices) {
      if (!inv.reception_id) continue;
      if (inv.status === "cancelled") continue;
      invoiceByReception.set(inv.reception_id, inv);
    }

    const deliveryByLine = new Map<string, DeliveryNote[]>();
    deliveryNotes.forEach((dn) => {
      // Skip advance-type delivery notes that have null order_line_id
      if (!dn.order_line_id) return;
      const arr = deliveryByLine.get(dn.order_line_id) || [];
      arr.push(dn);
      deliveryByLine.set(dn.order_line_id, arr);
    });

    // Payments per invoice (in USD using payment's own TC)
    const paymentsByInvoice = new Map<string, Payment[]>();
    const paidUsdByInvoice = new Map<string, number>();
    for (const p of payments) {
      if (!p.invoice_id) continue;
      const arr = paymentsByInvoice.get(p.invoice_id) || [];
      arr.push(p);
      paymentsByInvoice.set(p.invoice_id, arr);
      const paymentCurrency = p.currency || projectData?.local_currency || "USD";
      const paymentRate = p.exchange_rate && p.exchange_rate > 0 ? Number(p.exchange_rate) : tc;
      const amt = Number(p.amount || 0);
      const amtUsd = paymentCurrency === "USD" ? amt : amt / paymentRate;
      paidUsdByInvoice.set(p.invoice_id, (paidUsdByInvoice.get(p.invoice_id) || 0) + amtUsd);
    }

    const subFinance = new Map<string, SubcategoryFinance>();
    subs.forEach((sub) => {
      subFinance.set(sub.id, {
        subcategoryId: sub.id,
        subcategoryCode: sub.code,
        subcategoryName: sub.name,
        categoryId: sub.category_id,
        presupuestado: 0,
        comprometido: 0,
        recibido: 0,
        facturado: 0,
        pagado: 0,
        anticipos: 0,
        details: {
          presupuestado: [],
          ejecutado: [],
          comprometido: [],
          recibido: [],
          facturado: [],
          pagado: [],
          anticipos: [],
        },
      });
    });

    // PRESUPUESTADO
    for (const br of budgetRows) {
      const sf = subFinance.get(br.subcategory_id);
      if (!sf) continue;
      sf.presupuestado += Number(br.total_usd || 0);
      // Breakdown by type of insumo (mat/mo/glo)
      if (Number(br.total_mat || 0) > 0) {
        sf.details.presupuestado.push({
          description: "Materiales",
          amountUsd: Number(br.total_mat || 0),
        });
      }
      if (Number(br.total_mo || 0) > 0) {
        sf.details.presupuestado.push({
          description: "Mano de Obra",
          amountUsd: Number(br.total_mo || 0),
        });
      }
      if (Number(br.total_glo || 0) > 0) {
        sf.details.presupuestado.push({
          description: "Global",
          amountUsd: Number(br.total_glo || 0),
        });
      }
    }

    // Received per OC line (USD)
    const receivedUsdByLine = new Map<string, number>();
    for (const ol of orderLines) {
      const ocCurrency = ordersById.get(ol.order_id)?.currency || "USD";
      const dns = deliveryByLine.get(ol.id) || [];
      const sumUsd = dns.reduce((s, dn) => s + toUSD(Number(dn.gross_amount || 0), ocCurrency), 0);
      receivedUsdByLine.set(ol.id, sumUsd);
    }

    // COMPROMETIDO: OC line total - received
    orderLines.forEach((ol) => {
      const sf = subFinance.get(ol.subcategory_id);
      if (!sf) return;
      const oc = ordersById.get(ol.order_id);
      const ocCurrency = oc?.currency || "USD";
      const lineTotalOriginal = Number(ol.total || 0);
      const lineTotalUsd = toUSD(lineTotalOriginal, ocCurrency);
      const receivedUsd = receivedUsdByLine.get(ol.id) || 0;
      const remainingUsd = Math.max(0, lineTotalUsd - receivedUsd);
      if (remainingUsd > 0) {
        sf.comprometido += remainingUsd;
        const remainingOriginal = lineTotalOriginal * (remainingUsd / (lineTotalUsd || 1));
        sf.details.comprometido.push({
          ref: oc?.number,
          supplier: oc?.supplier,
          description: ol.description,
          amountUsd: remainingUsd,
          amountOriginal: remainingOriginal,
          currency: ocCurrency,
          note: lineTotalUsd > remainingUsd ? "Parcialmente recibido" : undefined,
        });
      }
    });

    // Classify deliveries into Recibido / Facturado / Pagado
    for (const ol of orderLines) {
      const sf = subFinance.get(ol.subcategory_id);
      if (!sf) continue;
      const oc = ordersById.get(ol.order_id);
      const ocCurrency = oc?.currency || "USD";
      const dns = deliveryByLine.get(ol.id) || [];
      for (const dn of dns) {
        const grossOriginal = Number(dn.gross_amount || 0);
        const grossUsd = toUSD(grossOriginal, ocCurrency);
        if (grossUsd <= 0) continue;

        const recId = dn.reception_id;
        const rec = recId ? receptionById.get(recId) : undefined;
        const recStatus = rec?.status || "received";
        if (recStatus === "cancelled") continue;

        const recRef = rec && oc ? `${oc.number}-REC-${String(rec.number).padStart(3, "0")}` : (oc?.number || "—");

        if (recStatus === "invoiced" && recId) {
          const inv = invoiceByReception.get(recId);
          if (inv) {
            const invAmountUsd = toUSD(Number(inv.amount || 0), ocCurrency);
            const paidUsd = paidUsdByInvoice.get(inv.id) || 0;
            const receptionTotalGross = deliveryNotes
              .filter((d) => d.reception_id === recId)
              .reduce((s, d) => s + Number(d.gross_amount || 0), 0);
            const share = receptionTotalGross > 0 ? Number(dn.gross_amount || 0) / receptionTotalGross : 1;
            const paidShare = paidUsd * share;
            const invoicedShare = invAmountUsd * share;

            const paidPortion = Math.min(paidShare, invoicedShare);
            const pendingPortion = Math.max(0, invoicedShare - paidShare);

            if (paidPortion > 0) {
              sf.pagado += paidPortion;
              sf.details.pagado.push({
                ref: inv.invoice_number,
                supplier: oc?.supplier,
                date: inv.invoice_date,
                description: ol.description,
                amountUsd: paidPortion,
                currency: ocCurrency,
                note: `Factura ${inv.invoice_number}`,
              });
            }
            if (pendingPortion > 0) {
              sf.facturado += pendingPortion;
              sf.details.facturado.push({
                ref: inv.invoice_number,
                supplier: oc?.supplier,
                date: inv.invoice_date,
                description: ol.description,
                amountUsd: pendingPortion,
                currency: ocCurrency,
                note: `Factura ${inv.invoice_number} · saldo pendiente`,
              });
            }
          } else {
            sf.facturado += grossUsd;
            sf.details.facturado.push({
              ref: recRef,
              supplier: oc?.supplier,
              date: dn.date,
              description: ol.description,
              amountUsd: grossUsd,
              amountOriginal: grossOriginal,
              currency: ocCurrency,
            });
          }
        } else {
          sf.recibido += grossUsd;
          sf.details.recibido.push({
            ref: recRef,
            supplier: oc?.supplier,
            date: dn.date,
            description: ol.description,
            amountUsd: grossUsd,
            amountOriginal: grossOriginal,
            currency: ocCurrency,
          });
        }
      }
    }

    // ANTICIPOS DADOS — Compute the USD paid against advance receptions and distribute
    // it across the OC's subcategories proportionally to line totals.
    // (Advance delivery_notes have null order_line_id so they don't touch the regular
    // buckets above; this makes "anticipos" a parallel column that doesn't double-count.)
    const advancePaidUsdByOC = new Map<string, number>();
    for (const rec of receptions) {
      if (rec.type !== "advance") continue;
      if (rec.status === "cancelled" || rec.status === "pending_approval") continue;
      const inv = invoiceByReception.get(rec.id);
      if (!inv) continue;
      const paidUsd = paidUsdByInvoice.get(inv.id) || 0;
      if (paidUsd <= 0) continue;
      advancePaidUsdByOC.set(rec.order_id, (advancePaidUsdByOC.get(rec.order_id) || 0) + paidUsd);
    }
    for (const [orderId, advanceUsd] of advancePaidUsdByOC) {
      const oc = ordersById.get(orderId);
      const ocCurrency = oc?.currency || "USD";
      const ocLines = orderLines.filter((ol) => ol.order_id === orderId);
      const totalLineUsd = ocLines.reduce(
        (s, ol) => s + toUSD(Number(ol.total || 0), ocCurrency),
        0
      );
      if (totalLineUsd <= 0) continue;
      for (const ol of ocLines) {
        const sf = subFinance.get(ol.subcategory_id);
        if (!sf) continue;
        const lineUsd = toUSD(Number(ol.total || 0), ocCurrency);
        const share = lineUsd / totalLineUsd;
        const allocUsd = advanceUsd * share;
        if (allocUsd <= 0.001) continue;
        sf.anticipos += allocUsd;
        sf.details.anticipos.push({
          ref: oc?.number,
          supplier: oc?.supplier,
          description: ol.description,
          amountUsd: allocUsd,
          currency: ocCurrency,
          note: `Anticipo pagado · distribución ${(share * 100).toFixed(1)}%`,
        });
      }
    }

    // Total amortizado USD — sum of amortization_amount across regular delivery_notes
    // (advance delivery_notes have order_line_id=null and don't amortize themselves).
    let amortizedTotalUsd = 0;
    for (const dn of deliveryNotes) {
      if (!dn.order_line_id) continue;
      const ol = orderLines.find((l) => l.id === dn.order_line_id);
      if (!ol) continue;
      const oc = ordersById.get(ol.order_id);
      const ocCurrency = oc?.currency || "USD";
      amortizedTotalUsd += toUSD(Number(dn.amortization_amount || 0), ocCurrency);
    }
    setAmortizedUsd(amortizedTotalUsd);

    // Populate "ejecutado" details (all items from comprometido/recibido/facturado/pagado, tagged)
    for (const sf of subFinance.values()) {
      const tagged: BreakdownItem[] = [
        ...sf.details.comprometido.map((it) => ({ ...it, note: `Comprometido${it.note ? " · " + it.note : ""}` })),
        ...sf.details.recibido.map((it) => ({ ...it, note: `Recibido${it.note ? " · " + it.note : ""}` })),
        ...sf.details.facturado.map((it) => ({ ...it, note: `Facturado${it.note ? " · " + it.note : ""}` })),
        ...sf.details.pagado.map((it) => ({ ...it, note: `Pagado${it.note ? " · " + it.note : ""}` })),
      ];
      sf.details.ejecutado = tagged;
    }

    // Build category groups
    const catFinance: CategoryFinance[] = cats.map((cat) => {
      const catSubs = Array.from(subFinance.values()).filter((sf) => sf.categoryId === cat.id);
      return {
        categoryId: cat.id,
        categoryCode: cat.code,
        categoryName: cat.name,
        subcategories: catSubs,
        presupuestado: catSubs.reduce((s, sf) => s + sf.presupuestado, 0),
        comprometido: catSubs.reduce((s, sf) => s + sf.comprometido, 0),
        recibido: catSubs.reduce((s, sf) => s + sf.recibido, 0),
        facturado: catSubs.reduce((s, sf) => s + sf.facturado, 0),
        pagado: catSubs.reduce((s, sf) => s + sf.pagado, 0),
        anticipos: catSubs.reduce((s, sf) => s + sf.anticipos, 0),
      };
    });

    setData(catFinance);
    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const tc = Number(project?.exchange_rate || 1);
  const localCurrency = project?.local_currency || "PYG";

  function displayAmount(usdAmount: number): number {
    if (displayCurrency === "usd") return usdAmount;
    return usdAmount * tc;
  }

  function formatMoney(usdAmount: number) {
    const val = displayAmount(usdAmount);
    return val.toLocaleString(getNumberLocale(), {
      minimumFractionDigits: displayCurrency === "usd" ? 2 : 0,
      maximumFractionDigits: displayCurrency === "usd" ? 2 : 0,
    });
  }

  // Helpers for "ejecutado" (suma) y su %
  function ejecutadoOf(row: { comprometido: number; recibido: number; facturado: number; pagado: number }): number {
    return row.comprometido + row.recibido + row.facturado + row.pagado;
  }
  function executionPct(presupuestado: number, ejecutado: number): string {
    if (presupuestado <= 0.001) return ejecutado > 0.001 ? "—" : "";
    return `${((ejecutado / presupuestado) * 100).toFixed(1)}%`;
  }
  function executionPctColor(presupuestado: number, ejecutado: number): string {
    if (presupuestado <= 0.001) return "text-muted-foreground";
    const ratio = ejecutado / presupuestado;
    if (ratio > 1) return "text-red-600 font-semibold";
    if (ratio > 0.9) return "text-amber-600";
    return "text-emerald-600";
  }

  function toggleCat(catId: string) {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }

  function openSubcategoryBreakdown(sub: SubcategoryFinance, column: ColumnKey) {
    const items = sub.details[column];
    if (items.length === 0) return;
    setBreakdownTitle(`${COLUMN_LABELS[column]} · ${sub.subcategoryCode} ${sub.subcategoryName}`);
    setBreakdownColumn(column);
    setBreakdownItems(items);
    setBreakdownOpen(true);
  }

  function openCategoryBreakdown(cat: CategoryFinance, column: ColumnKey) {
    const items = cat.subcategories.flatMap((s) =>
      s.details[column].map((it) => ({
        ...it,
        description: `[${s.subcategoryCode} ${s.subcategoryName}] ${it.description || ""}`,
      }))
    );
    if (items.length === 0) return;
    setBreakdownTitle(`${COLUMN_LABELS[column]} · ${cat.categoryCode} ${cat.categoryName}`);
    setBreakdownColumn(column);
    setBreakdownItems(items);
    setBreakdownOpen(true);
  }

  const grandTotal = data.reduce(
    (acc, cat) => ({
      presupuestado: acc.presupuestado + cat.presupuestado,
      comprometido: acc.comprometido + cat.comprometido,
      recibido: acc.recibido + cat.recibido,
      facturado: acc.facturado + cat.facturado,
      pagado: acc.pagado + cat.pagado,
      anticipos: acc.anticipos + cat.anticipos,
    }),
    { presupuestado: 0, comprometido: 0, recibido: 0, facturado: 0, pagado: 0, anticipos: 0 }
  );

  if (loading) return <div className="p-6 text-muted-foreground">Cargando avance financiero...</div>;

  const currencyLabel = displayCurrency === "usd" ? "USD" : localCurrency;

  // Cell renderer: empty cells are transparent (continuous row), filled cells are clickable
  function renderCell(
    value: number,
    column: ColumnKey,
    onClick?: () => void
  ) {
    const isEmpty = value <= 0.001;
    if (isEmpty) {
      // Transparent empty cell — inherits row background so rows look continuous
      return <div className="px-3 py-1.5 text-right text-xs border-r border-border/40" />;
    }
    return (
      <button
        onClick={onClick}
        className={cn(
          "px-3 py-1.5 text-right text-xs border-r border-border/40 cursor-pointer transition-colors",
          COLUMN_COLORS[column],
          "hover:bg-muted/60 hover:underline underline-offset-2"
        )}
      >
        {formatMoney(value)}
      </button>
    );
  }

  // Ejecutado cell: shows amount + % vs Presupuestado
  function renderEjecutadoCell(
    ejecutado: number,
    presupuestado: number,
    onClick?: () => void,
    bold: boolean = false
  ) {
    const isEmpty = ejecutado <= 0.001;
    if (isEmpty) {
      return <div className={cn("px-3 py-1.5 text-right text-xs", bold && "py-2.5")} />;
    }
    const pct = executionPct(presupuestado, ejecutado);
    const pctColor = executionPctColor(presupuestado, ejecutado);
    return (
      <button
        onClick={onClick}
        className={cn(
          "px-3 text-right text-xs cursor-pointer transition-colors flex flex-col items-end justify-center leading-tight",
          COLUMN_COLORS.ejecutado,
          bold ? "py-2 font-semibold" : "py-1.5",
          "hover:bg-muted/60"
        )}
      >
        <span className={cn("hover:underline underline-offset-2", bold && "text-sm")}>
          {formatMoney(ejecutado)}
        </span>
        {pct && (
          <span className={cn("text-[10px] font-normal", pctColor)}>
            {pct}
          </span>
        )}
      </button>
    );
  }

  function renderHeaderCell(
    value: number,
    column: ColumnKey,
    onClick?: () => void,
    bold: boolean = false
  ) {
    const isEmpty = value <= 0.001;
    if (isEmpty) {
      return <div className={cn("px-3 py-2 text-right text-xs border-r border-border/40", bold && "py-2.5")} />;
    }
    return (
      <button
        onClick={onClick}
        className={cn(
          "px-3 py-2 text-right text-xs border-r border-border/40 cursor-pointer transition-colors",
          COLUMN_COLORS[column],
          bold && "py-2.5 font-semibold",
          "hover:bg-muted/60 hover:underline underline-offset-2"
        )}
      >
        {formatMoney(value)}
      </button>
    );
  }

  return (
    <div className="py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Avance Financiero por EDT</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Montos normalizados desde la moneda de cada OC.
            {displayCurrency === "local" && tc > 1 && ` TC proyecto: 1 USD = ${tc.toLocaleString(getNumberLocale())} ${localCurrency}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border p-0.5">
            <Button
              size="sm"
              variant={displayCurrency === "local" ? "default" : "ghost"}
              className="h-7 px-3 text-xs"
              onClick={() => setDisplayCurrency("local")}
            >
              {localCurrency}
            </Button>
            <Button
              size="sm"
              variant={displayCurrency === "usd" ? "default" : "ghost"}
              className="h-7 px-3 text-xs"
              onClick={() => setDisplayCurrency("usd")}
            >
              <DollarSign className="h-3 w-3 mr-0.5" />
              USD
            </Button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      {(() => {
        const grandEjecutado = ejecutadoOf(grandTotal);
        const grandPct = executionPct(grandTotal.presupuestado, grandEjecutado);
        const grandPctColor = executionPctColor(grandTotal.presupuestado, grandEjecutado);
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {([
                { label: "Presupuestado", value: grandTotal.presupuestado, color: "text-foreground", bg: "bg-neutral-100 border-neutral-300" },
                { label: "Comprometido", value: grandTotal.comprometido, color: "text-[#737373]", bg: "bg-neutral-100 border-neutral-300" },
                { label: "Recibido", value: grandTotal.recibido, color: "text-[#E87722]", bg: "bg-neutral-100 border-neutral-300" },
                { label: "Facturado", value: grandTotal.facturado, color: "text-[#B85A0F]", bg: "bg-neutral-100 border-neutral-300" },
                { label: "Pagado", value: grandTotal.pagado, color: "text-emerald-700", bg: "bg-neutral-100 border-neutral-300" },
                { label: "Ejecutado", value: grandEjecutado, color: "text-[#0A0A0A] font-bold", bg: "bg-[#0A0A0A] border-[#0A0A0A] text-white", extra: grandPct, extraColor: grandPctColor },
              ] as const).map((item) => {
                const isExec = item.label === "Ejecutado";
                return (
                  <div key={item.label} className={cn("rounded-lg p-3 border", item.bg)}>
                    <p className={cn("text-xs", isExec ? "text-white/70" : "text-muted-foreground")}>{item.label}</p>
                    <p className={cn(
                      "text-lg font-bold",
                      isExec ? "text-white" : item.color,
                      item.value <= 0.001 && "opacity-40"
                    )}>
                      {item.value <= 0.001 ? "—" : formatMoney(item.value)}
                    </p>
                    <div className="flex items-center justify-between">
                      <p className={cn("text-[10px]", isExec ? "text-white/60" : "text-muted-foreground")}>{currencyLabel}</p>
                      {"extra" in item && item.extra && (
                        <span className={cn("text-[11px] font-semibold", (item as { extraColor?: string }).extraColor)}>
                          {item.extra}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Anticipos dados — línea paralela con desglose de amortización.
                No se suma a Ejecutado para evitar doble conteo. */}
            {grandTotal.anticipos > 0 && (() => {
              const anticiposTotal = grandTotal.anticipos;
              const amortizedApplied = Math.min(amortizedUsd, anticiposTotal);
              const pendienteAmort = Math.max(0, anticiposTotal - amortizedApplied);
              const pct = (v: number) =>
                anticiposTotal > 0 ? `${((v / anticiposTotal) * 100).toFixed(1)}%` : "—";
              return (
                <div className="rounded-lg border border-amber-300 bg-[#FFF4E6] px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-2 w-2 rounded-full bg-amber-600" />
                    <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
                      Anticipos dados
                    </p>
                    <span className="text-[10px] text-muted-foreground italic ml-auto">
                      no se suma a Ejecutado — se amortiza en certificaciones
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md bg-white/60 border border-amber-200 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider font-mono text-amber-700/80">
                        Anticipos dados
                      </p>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <p className="text-base font-bold text-amber-800">
                          {formatMoney(anticiposTotal)}
                        </p>
                        <span className="text-[10px] text-muted-foreground">{currencyLabel}</span>
                      </div>
                      <p className="text-[10px] text-amber-700/70 mt-0.5">100%</p>
                    </div>

                    <div className="rounded-md bg-white/60 border border-amber-200 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider font-mono text-amber-700/80">
                        Amortizado
                      </p>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <p className="text-base font-bold text-emerald-700">
                          {formatMoney(amortizedApplied)}
                        </p>
                        <span className="text-[10px] text-muted-foreground">{currencyLabel}</span>
                      </div>
                      <p className="text-[10px] text-emerald-700/80 mt-0.5">
                        {pct(amortizedApplied)} del anticipo
                      </p>
                    </div>

                    <div className="rounded-md bg-white/60 border border-amber-200 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider font-mono text-amber-700/80">
                        Pendiente de amortizar
                      </p>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <p className="text-base font-bold text-[#B85A0F]">
                          {formatMoney(pendienteAmort)}
                        </p>
                        <span className="text-[10px] text-muted-foreground">{currencyLabel}</span>
                      </div>
                      <p className="text-[10px] text-[#B85A0F]/80 mt-0.5">
                        {pct(pendienteAmort)} del anticipo
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="grid grid-cols-[1fr_130px_130px_130px_130px_130px_170px] gap-0 bg-muted/60 text-xs font-medium text-muted-foreground">
          <div className="px-4 py-2.5 border-r border-border/40">EDT</div>
          <div className="px-3 py-2.5 text-right border-r border-border/40">Presupuestado</div>
          <div className="px-3 py-2.5 text-right border-r border-border/40" title="OC emitida aún no recibida">Comprometido</div>
          <div className="px-3 py-2.5 text-right border-r border-border/40">Recibido</div>
          <div className="px-3 py-2.5 text-right border-r border-border/40">Facturado</div>
          <div className="px-3 py-2.5 text-right border-r border-border/40" title="Usa TC del pago cuando está registrado">Pagado</div>
          <div className="px-3 py-2.5 text-right" title="Suma de Comprometido + Recibido + Facturado + Pagado">Ejecutado</div>
        </div>

        {data.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No hay datos de EDT disponibles.
          </div>
        )}

        {data.map((cat) => {
          const isCollapsed = collapsedCats.has(cat.categoryId);
          const hasValues =
            cat.presupuestado > 0 || cat.comprometido > 0 || cat.recibido > 0 ||
            cat.facturado > 0 || cat.pagado > 0;
          return (
            <div key={cat.categoryId}>
              {/* Category row */}
              <div
                className={cn(
                  "grid grid-cols-[1fr_130px_130px_130px_130px_130px_170px] gap-0 transition-colors border-t border-border",
                  hasValues ? "bg-[#E8EDF5]/60 dark:bg-[#E87722]/10" : "bg-muted/20"
                )}
              >
                <div
                  className="px-4 py-2 flex items-center gap-2 text-sm font-semibold border-r border-border/40 cursor-pointer hover:bg-muted/30"
                  onClick={() => toggleCat(cat.categoryId)}
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span>{cat.categoryCode} — {cat.categoryName}</span>
                </div>
                {renderHeaderCell(cat.presupuestado, "presupuestado", () => openCategoryBreakdown(cat, "presupuestado"))}
                {renderHeaderCell(cat.comprometido, "comprometido", () => openCategoryBreakdown(cat, "comprometido"))}
                {renderHeaderCell(cat.recibido, "recibido", () => openCategoryBreakdown(cat, "recibido"))}
                {renderHeaderCell(cat.facturado, "facturado", () => openCategoryBreakdown(cat, "facturado"))}
                {renderHeaderCell(cat.pagado, "pagado", () => openCategoryBreakdown(cat, "pagado"))}
                {renderEjecutadoCell(
                  ejecutadoOf(cat),
                  cat.presupuestado,
                  () => openCategoryBreakdown(cat, "ejecutado"),
                  true
                )}
              </div>

              {!isCollapsed &&
                cat.subcategories.map((sub, idx) => (
                  <div
                    key={sub.subcategoryId}
                    className={cn(
                      "grid grid-cols-[1fr_130px_130px_130px_130px_130px_170px] gap-0 border-t border-border/40 transition-colors hover:bg-muted/30",
                      idx % 2 === 1 && "bg-muted/10"
                    )}
                  >
                    <div className="px-4 pl-10 py-1.5 text-xs text-muted-foreground border-r border-border/40 truncate">
                      {sub.subcategoryCode} {sub.subcategoryName}
                    </div>
                    {renderCell(sub.presupuestado, "presupuestado", () => openSubcategoryBreakdown(sub, "presupuestado"))}
                    {renderCell(sub.comprometido, "comprometido", () => openSubcategoryBreakdown(sub, "comprometido"))}
                    {renderCell(sub.recibido, "recibido", () => openSubcategoryBreakdown(sub, "recibido"))}
                    {renderCell(sub.facturado, "facturado", () => openSubcategoryBreakdown(sub, "facturado"))}
                    {renderCell(sub.pagado, "pagado", () => openSubcategoryBreakdown(sub, "pagado"))}
                    {renderEjecutadoCell(
                      ejecutadoOf(sub),
                      sub.presupuestado,
                      () => openSubcategoryBreakdown(sub, "ejecutado")
                    )}
                  </div>
                ))}
            </div>
          );
        })}

        {data.length > 0 && (() => {
          const grandEjecutado = ejecutadoOf(grandTotal);
          const grandPct = executionPct(grandTotal.presupuestado, grandEjecutado);
          const grandPctColor = executionPctColor(grandTotal.presupuestado, grandEjecutado);
          return (
            <div className="grid grid-cols-[1fr_130px_130px_130px_130px_130px_170px] gap-0 border-t-2 bg-muted/40">
              <div className="px-4 py-2.5 text-sm font-bold border-r border-border/40">TOTAL</div>
              {(["presupuestado", "comprometido", "recibido", "facturado", "pagado"] as const).map((col) => {
                const value = grandTotal[col];
                const isEmpty = value <= 0.001;
                if (isEmpty) return <div key={col} className="px-3 py-2.5 text-right border-r border-border/40" />;
                return (
                  <div key={col} className={cn("px-3 py-2.5 text-right text-sm font-bold border-r border-border/40", COLUMN_COLORS[col])}>
                    {formatMoney(value)}
                  </div>
                );
              })}
              {grandEjecutado <= 0.001 ? (
                <div className="px-3 py-2.5 text-right" />
              ) : (
                <div className={cn("px-3 py-1.5 text-right flex flex-col items-end justify-center leading-tight", COLUMN_COLORS.ejecutado)}>
                  <span className="text-sm font-bold">{formatMoney(grandEjecutado)}</span>
                  {grandPct && (
                    <span className={cn("text-[10px] font-normal", grandPctColor)}>{grandPct}</span>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      <p className="text-[10px] text-muted-foreground italic">
        Los pagos usan el tipo de cambio registrado al momento del pago (puede diferir del TC del proyecto).
        Hacé click en cualquier casilla con monto para ver el desglose de las líneas que lo componen.
      </p>

      {/* Breakdown Dialog */}
      <Dialog open={breakdownOpen} onOpenChange={setBreakdownOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className={COLUMN_COLORS[breakdownColumn]}>●</span>
              {breakdownTitle}
            </DialogTitle>
          </DialogHeader>

          {breakdownItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Sin detalles disponibles</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[110px_95px_1fr_1.2fr_140px] gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 pb-1 border-b">
                <span>Referencia</span>
                <span>Fecha</span>
                <span>Proveedor</span>
                <span>Descripción</span>
                <span className="text-right">Monto</span>
              </div>
              {breakdownItems.map((item, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[110px_95px_1fr_1.2fr_140px] gap-2 items-center text-xs px-2 py-1.5 border-b last:border-b-0 hover:bg-muted/20"
                >
                  <span className="font-mono truncate" title={item.ref}>{item.ref || "—"}</span>
                  <span className="text-muted-foreground">
                    {item.date ? new Date(item.date).toLocaleDateString("es") : "—"}
                  </span>
                  <span className="truncate" title={item.supplier}>
                    {item.supplier || <span className="text-muted-foreground">—</span>}
                  </span>
                  <span className="truncate" title={item.description}>
                    {item.description || "—"}
                    {item.note && (
                      <span className="text-[10px] text-muted-foreground italic ml-1">({item.note})</span>
                    )}
                  </span>
                  <span className="text-right font-mono">
                    <div className="font-semibold">{formatMoney(item.amountUsd)} {currencyLabel}</div>
                    {item.amountOriginal !== undefined && item.currency && item.currency !== currencyLabel && displayCurrency === "usd" && (
                      <div className="text-[10px] text-muted-foreground">
                        ({item.currency} {item.amountOriginal.toLocaleString(getNumberLocale(), { maximumFractionDigits: 2 })})
                      </div>
                    )}
                  </span>
                </div>
              ))}

              {/* Total row */}
              <div className="grid grid-cols-[110px_95px_1fr_1.2fr_140px] gap-2 items-center text-xs px-2 py-2 border-t-2 bg-muted/40 font-bold">
                <span />
                <span />
                <span />
                <span className="text-right">TOTAL</span>
                <span className="text-right font-mono">
                  {formatMoney(breakdownItems.reduce((s, it) => s + it.amountUsd, 0))} {currencyLabel}
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
