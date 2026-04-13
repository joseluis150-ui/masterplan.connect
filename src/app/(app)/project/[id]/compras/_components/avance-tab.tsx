"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  EdtCategory,
  EdtSubcategory,
  PurchaseOrderLine,
  DeliveryNote,
  Invoice,
  Payment,
} from "@/lib/types/database";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
}

interface SubcategoryFinance {
  subcategoryId: string;
  subcategoryCode: string;
  subcategoryName: string;
  categoryId: string;
  presupuestado: number; // From quantification (budget)
  comprometido: number;  // OC lines total
  recibido: number;      // Delivery notes gross
  facturado: number;     // Invoices amount
  pagado: number;        // Payments amount
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
}

export function AvanceTab({ projectId }: Props) {
  const supabase = createClient();
  const [data, setData] = useState<CategoryFinance[]>([]);
  const [currency, setCurrency] = useState("USD");
  const [loading, setLoading] = useState(true);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    // Load all needed data in parallel
    const [
      catsRes,
      subsRes,
      ordersRes,
      orderLinesRes,
      deliveryRes,
      invoicesRes,
      paymentsRes,
      projectRes,
    ] = await Promise.all([
      supabase.from("edt_categories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("purchase_orders").select("id, currency, status").eq("project_id", projectId),
      supabase.from("purchase_order_lines").select("*").in(
        "order_id",
        (await supabase.from("purchase_orders").select("id").eq("project_id", projectId)).data?.map((o) => o.id) || []
      ),
      supabase.from("delivery_notes").select("*").in(
        "order_line_id",
        (await supabase.from("purchase_order_lines").select("id").in(
          "order_id",
          (await supabase.from("purchase_orders").select("id").eq("project_id", projectId)).data?.map((o) => o.id) || []
        )).data?.map((l) => l.id) || []
      ),
      supabase.from("invoices").select("*"),
      supabase.from("payments").select("*").eq("project_id", projectId),
      supabase.from("projects").select("local_currency").eq("id", projectId).single(),
    ]);

    const cats = (catsRes.data || []) as EdtCategory[];
    const subs = (subsRes.data || []) as EdtSubcategory[];
    const orderLines = (orderLinesRes.data || []) as PurchaseOrderLine[];
    const deliveryNotes = (deliveryRes.data || []) as DeliveryNote[];
    const invoices = (invoicesRes.data || []) as Invoice[];
    const payments = (paymentsRes.data || []) as Payment[];

    if (projectRes.data) {
      setCurrency(projectRes.data.local_currency || "USD");
    }

    // Build delivery note -> order line mapping
    const deliveryByLine = new Map<string, DeliveryNote[]>();
    deliveryNotes.forEach((dn) => {
      const arr = deliveryByLine.get(dn.order_line_id) || [];
      arr.push(dn);
      deliveryByLine.set(dn.order_line_id, arr);
    });

    // Build invoice -> delivery note mapping
    const invoiceByDelivery = new Map<string, Invoice[]>();
    invoices.forEach((inv) => {
      const arr = invoiceByDelivery.get(inv.delivery_note_id) || [];
      arr.push(inv);
      invoiceByDelivery.set(inv.delivery_note_id, arr);
    });

    // Aggregate by subcategory
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
      });
    });

    // Comprometido: sum of OC lines by subcategory
    orderLines.forEach((ol) => {
      const sf = subFinance.get(ol.subcategory_id);
      if (sf) sf.comprometido += Number(ol.total || 0);
    });

    // Recibido: sum of delivery notes gross_amount by subcategory (through order lines)
    orderLines.forEach((ol) => {
      const dns = deliveryByLine.get(ol.id) || [];
      const sf = subFinance.get(ol.subcategory_id);
      if (sf) {
        dns.forEach((dn) => {
          sf.recibido += Number(dn.gross_amount || 0);
          // Facturado: invoices linked to these delivery notes
          const invs = invoiceByDelivery.get(dn.id) || [];
          invs.forEach((inv) => {
            if (inv.status !== "cancelled") {
              sf.facturado += Number(inv.amount || 0);
            }
          });
        });
      }
    });

    // Pagado: sum payments by project (we'll distribute later or show project-wide)
    // For now, show total payments at project level
    const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

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
      };
    });

    setData(catFinance);
    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  function formatMoney(amount: number) {
    return amount.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function toggleCat(catId: string) {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }

  // Grand totals
  const grandTotal = data.reduce(
    (acc, cat) => ({
      presupuestado: acc.presupuestado + cat.presupuestado,
      comprometido: acc.comprometido + cat.comprometido,
      recibido: acc.recibido + cat.recibido,
      facturado: acc.facturado + cat.facturado,
      pagado: acc.pagado + cat.pagado,
    }),
    { presupuestado: 0, comprometido: 0, recibido: 0, facturado: 0, pagado: 0 }
  );

  if (loading) return <div className="p-6 text-muted-foreground">Cargando avance financiero...</div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Avance Financiero por EDT</h2>
        <span className="text-xs text-muted-foreground">
          Montos en {currency}
        </span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Presupuestado", value: grandTotal.presupuestado, color: "text-foreground" },
          { label: "Comprometido", value: grandTotal.comprometido, color: "text-blue-500" },
          { label: "Recibido", value: grandTotal.recibido, color: "text-amber-500" },
          { label: "Facturado", value: grandTotal.facturado, color: "text-purple-500" },
          { label: "Pagado", value: grandTotal.pagado, color: "text-green-500" },
        ].map((item) => (
          <div key={item.label} className="bg-muted/40 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className={cn("text-lg font-bold", item.color)}>
              {formatMoney(item.value)}
            </p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_repeat(5,120px)] gap-0 bg-muted/60 text-xs font-medium text-muted-foreground">
          <div className="px-4 py-2.5 border-r">EDT</div>
          <div className="px-3 py-2.5 text-right border-r">Presupuestado</div>
          <div className="px-3 py-2.5 text-right border-r">Comprometido</div>
          <div className="px-3 py-2.5 text-right border-r">Recibido</div>
          <div className="px-3 py-2.5 text-right border-r">Facturado</div>
          <div className="px-3 py-2.5 text-right">Pagado</div>
        </div>

        {data.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No hay datos de EDT disponibles.
          </div>
        )}

        {data.map((cat) => {
          const isCollapsed = collapsedCats.has(cat.categoryId);
          const hasValues = cat.comprometido > 0 || cat.recibido > 0 || cat.facturado > 0 || cat.pagado > 0;
          return (
            <div key={cat.categoryId}>
              {/* Category row */}
              <div
                className={cn(
                  "grid grid-cols-[1fr_repeat(5,120px)] gap-0 cursor-pointer hover:bg-muted/30 transition-colors border-t",
                  hasValues ? "bg-[#E8EDF5]/50 dark:bg-[#1E3A8A]/10" : ""
                )}
                onClick={() => toggleCat(cat.categoryId)}
              >
                <div className="px-4 py-2 flex items-center gap-2 text-sm font-semibold border-r">
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span>{cat.categoryCode} — {cat.categoryName}</span>
                </div>
                <div className="px-3 py-2 text-right text-xs font-medium border-r">{formatMoney(cat.presupuestado)}</div>
                <div className="px-3 py-2 text-right text-xs font-medium text-blue-500 border-r">{formatMoney(cat.comprometido)}</div>
                <div className="px-3 py-2 text-right text-xs font-medium text-amber-500 border-r">{formatMoney(cat.recibido)}</div>
                <div className="px-3 py-2 text-right text-xs font-medium text-purple-500 border-r">{formatMoney(cat.facturado)}</div>
                <div className="px-3 py-2 text-right text-xs font-medium text-green-500">{formatMoney(cat.pagado)}</div>
              </div>

              {/* Subcategory rows */}
              {!isCollapsed &&
                cat.subcategories.map((sub) => (
                  <div
                    key={sub.subcategoryId}
                    className="grid grid-cols-[1fr_repeat(5,120px)] gap-0 border-t border-border/50"
                  >
                    <div className="px-4 pl-10 py-1.5 text-xs text-muted-foreground border-r truncate">
                      {sub.subcategoryCode} {sub.subcategoryName}
                    </div>
                    <div className="px-3 py-1.5 text-right text-xs border-r">{formatMoney(sub.presupuestado)}</div>
                    <div className="px-3 py-1.5 text-right text-xs text-blue-500 border-r">{formatMoney(sub.comprometido)}</div>
                    <div className="px-3 py-1.5 text-right text-xs text-amber-500 border-r">{formatMoney(sub.recibido)}</div>
                    <div className="px-3 py-1.5 text-right text-xs text-purple-500 border-r">{formatMoney(sub.facturado)}</div>
                    <div className="px-3 py-1.5 text-right text-xs text-green-500">{formatMoney(sub.pagado)}</div>
                  </div>
                ))}
            </div>
          );
        })}

        {/* Grand total row */}
        {data.length > 0 && (
          <div className="grid grid-cols-[1fr_repeat(5,120px)] gap-0 border-t-2 bg-muted/40">
            <div className="px-4 py-2.5 text-sm font-bold border-r">TOTAL</div>
            <div className="px-3 py-2.5 text-right text-sm font-bold border-r">{formatMoney(grandTotal.presupuestado)}</div>
            <div className="px-3 py-2.5 text-right text-sm font-bold text-blue-500 border-r">{formatMoney(grandTotal.comprometido)}</div>
            <div className="px-3 py-2.5 text-right text-sm font-bold text-amber-500 border-r">{formatMoney(grandTotal.recibido)}</div>
            <div className="px-3 py-2.5 text-right text-sm font-bold text-purple-500 border-r">{formatMoney(grandTotal.facturado)}</div>
            <div className="px-3 py-2.5 text-right text-sm font-bold text-green-500">{formatMoney(grandTotal.pagado)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
