"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Scale,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Award,
  Building,
} from "lucide-react";
import { toast } from "sonner";
import { formatNumber } from "@/lib/utils/formula";

interface RequestRow {
  id: string;
  number: string;
}

interface RequestLine {
  id: string;
  request_id: string;
  description: string;
  quantity: number;
  unit: string;
  subcategory_id: string | null;
}

interface BudgetHealth {
  subcategory_id: string;
  subcategory_code: string;
  subcategory_name: string;
  budgeted_usd: number;
  ordered_usd: number;
  available_usd: number;
}

interface ProjectFx {
  id: string;
  local_currency: string;
  exchange_rate: number;
}

interface QuotationRow {
  id: string;
  number: string;
  supplier_id: string | null;
  supplier_name_legacy: string | null;
  currency: string;
  has_advance: boolean;
  advance_amount: number | null;
  advance_type: string | null;
  retention_pct: number | null;
  payment_terms_type: string | null;
  credit_days: number | null;
  payment_notes: string | null;
  valid_until: string | null;
  justification: string | null;
  status: string;
  /** join: nombre del proveedor (vía suppliers.name) */
  supplier_name?: string | null;
}

interface QuotationLineRow {
  id: string;
  quotation_id: string;
  request_line_id: string;
  unit_price: number | null;
  lead_time_days: number | null;
}

/**
 * Modal de adjudicación. El aprobador ve el cuadro comparativo en modo
 * lectura (la información ya viene cargada por el comprador) y elige por
 * cada línea CUÁL cotización gana — o NINGUNA si quiere dejar la línea
 * sin adjudicar (ej. va a re-cotizar).
 *
 * Al confirmar, llama a `award_quotations` que:
 *   1. marca quotation_lines.awarded=TRUE en los matches
 *   2. genera una OC por cada cotización con ≥1 línea adjudicada
 *   3. cambia status de cotizaciones (awarded / rejected)
 *   4. si la cotización tiene anticipo, dispara generate_advance_reception_for_oc
 */
export function AwardQuotationDialog({
  requestId,
  onClose,
  onAwarded,
}: {
  requestId: string;
  onClose: () => void;
  onAwarded: () => void;
}) {
  const supabase = createClient();
  const [request, setRequest] = useState<RequestRow | null>(null);
  const [requestLines, setRequestLines] = useState<RequestLine[]>([]);
  const [quotations, setQuotations] = useState<QuotationRow[]>([]);
  const [quotationLines, setQuotationLines] = useState<QuotationLineRow[]>([]);
  /** Map<request_line_id, quotation_id> — la elección del aprobador.
   *  Si una línea no está en el map, queda sin adjudicar. */
  const [awards, setAwards] = useState<Map<string, string>>(new Map());
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [project, setProject] = useState<ProjectFx | null>(null);
  /** Salud presupuestal de cada subcategoría que aparece en las líneas de la SC. */
  const [budgetBySubcat, setBudgetBySubcat] = useState<Map<string, BudgetHealth>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    // Para resolver TC del proyecto → necesitamos primero obtener el project_id
    // de la SC. Lo hacemos en el primer round-trip.
    const reqMeta = await supabase
      .from("purchase_requests")
      .select("id, number, project_id")
      .eq("id", requestId)
      .single();
    const projectId = (reqMeta.data as { project_id: string } | null)?.project_id;
    const [rRes, rlRes, qRes, qlRes, projRes] = await Promise.all([
      Promise.resolve(reqMeta),
      supabase.from("purchase_request_lines").select("*").eq("request_id", requestId).order("created_at"),
      // Sólo las cotizaciones pending_approval — las draft del comprador no entran a la bandeja.
      supabase
        .from("quotations")
        .select(`
          id, number, supplier_id, supplier_name_legacy, currency,
          has_advance, advance_amount, advance_type, retention_pct,
          payment_terms_type, credit_days, payment_notes, valid_until,
          justification, status,
          supplier:suppliers(name)
        `)
        .eq("request_id", requestId)
        .eq("status", "pending_approval")
        .order("created_at"),
      supabase
        .from("quotation_lines")
        .select("*, quotation:quotations!inner(request_id, status)")
        .eq("quotation.request_id", requestId)
        .eq("quotation.status", "pending_approval"),
      projectId
        ? supabase.from("projects").select("id, local_currency, exchange_rate").eq("id", projectId).single()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (rRes.data) setRequest(rRes.data as RequestRow);
    if (projRes.data) setProject(projRes.data as ProjectFx);
    const lines = (rlRes.data ?? []) as RequestLine[];
    setRequestLines(lines);

    // Salud presupuestal de las subcategorías que aparecen en estas líneas.
    if (projectId) {
      const subcatIds = Array.from(
        new Set(lines.map((l) => l.subcategory_id).filter(Boolean) as string[])
      );
      if (subcatIds.length > 0) {
        const { data: bh } = await supabase.rpc("get_subcategory_budget_health", {
          p_project_id: projectId,
          p_subcategory_ids: subcatIds,
        });
        const map = new Map<string, BudgetHealth>();
        for (const row of (bh ?? []) as BudgetHealth[]) {
          map.set(row.subcategory_id, row);
        }
        setBudgetBySubcat(map);
      }
    }

    type QRaw = QuotationRow & {
      supplier?: { name: string } | { name: string }[] | null;
    };
    const qs: QuotationRow[] = ((qRes.data ?? []) as unknown as QRaw[]).map((q) => {
      const sup = Array.isArray(q.supplier) ? q.supplier[0] : q.supplier;
      return {
        ...q,
        supplier_name: sup?.name ?? q.supplier_name_legacy ?? null,
      };
    });
    setQuotations(qs);

    setQuotationLines((qlRes.data ?? []) as QuotationLineRow[]);

    // Pre-selección: por defecto, la cotización MÁS BARATA por línea.
    // El aprobador puede cambiarla manualmente. No adjudica nada todavía.
    const auto = new Map<string, string>();
    const qlines = (qlRes.data ?? []) as QuotationLineRow[];
    for (const line of lines) {
      let bestId: string | null = null;
      let bestPrice = Number.POSITIVE_INFINITY;
      for (const ql of qlines) {
        if (ql.request_line_id !== line.id) continue;
        if (ql.unit_price == null) continue;
        if (Number(ql.unit_price) < bestPrice) {
          bestPrice = Number(ql.unit_price);
          bestId = ql.quotation_id;
        }
      }
      if (bestId) auto.set(line.id, bestId);
    }
    setAwards(auto);
    setLoading(false);
  }, [requestId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  function priceFor(quotationId: string, requestLineId: string): number | null {
    const ql = quotationLines.find(
      (x) => x.quotation_id === quotationId && x.request_line_id === requestLineId
    );
    return ql?.unit_price ?? null;
  }

  function cheapestFor(requestLineId: string): string | null {
    let bestId: string | null = null;
    let bestPrice = Number.POSITIVE_INFINITY;
    for (const ql of quotationLines) {
      if (ql.request_line_id !== requestLineId) continue;
      if (ql.unit_price == null) continue;
      if (Number(ql.unit_price) < bestPrice) {
        bestPrice = Number(ql.unit_price);
        bestId = ql.quotation_id;
      }
    }
    return bestId;
  }

  function setAward(requestLineId: string, quotationId: string | null) {
    setAwards((prev) => {
      const next = new Map(prev);
      if (quotationId === null) next.delete(requestLineId);
      else next.set(requestLineId, quotationId);
      return next;
    });
  }

  /** Total que cada cotización generaría si se adjudica el set actual. */
  function awardedTotalFor(quotationId: string): number {
    let sum = 0;
    for (const line of requestLines) {
      if (awards.get(line.id) !== quotationId) continue;
      const p = priceFor(quotationId, line.id) ?? 0;
      sum += p * Number(line.quantity || 0);
    }
    return sum;
  }

  /** Set de cotizaciones que terminarán generando OC. */
  function winningQuotationIds(): Set<string> {
    return new Set(awards.values());
  }

  async function handleAward(decision: "approve" | "reject") {
    if (decision === "reject") {
      if (!note.trim()) {
        toast.error("Para rechazar todas las cotizaciones, ingresá un motivo");
        return;
      }
      setSubmitting(true);
      // Rechazo total: pasamos awards vacío. La RPC marcará todas como rejected.
      const { error } = await supabase.rpc("award_quotations", {
        p_request_id: requestId,
        p_awards: [],
        p_decision_note: note.trim(),
      });
      setSubmitting(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Cotizaciones rechazadas");
      onAwarded();
      onClose();
      return;
    }

    // Aprobación: validar al menos una línea adjudicada
    if (awards.size === 0) {
      toast.error("Adjudicá al menos una línea, o rechazá todas las cotizaciones");
      return;
    }

    const payload = Array.from(awards.entries()).map(([request_line_id, quotation_id]) => ({
      request_line_id,
      quotation_id,
    }));

    setSubmitting(true);
    const { data, error } = await supabase.rpc("award_quotations", {
      p_request_id: requestId,
      p_awards: payload,
      p_decision_note: note.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const generated = (data as string[] | null) ?? [];
    toast.success(
      `Adjudicación realizada · ${generated.length} ${generated.length === 1 ? "OC generada" : "OCs generadas"}`
    );
    onAwarded();
    onClose();
  }

  /**
   * Convierte un monto en la moneda de la cotización a USD usando el TC del
   * proyecto. Si la cotización está en USD lo devuelve tal cual.
   */
  function toUsd(amount: number, currency: string): number {
    if (!project) return amount;
    if (currency.toUpperCase() === "USD") return amount;
    const fx = Number(project.exchange_rate || 1);
    return fx > 0 ? amount / fx : amount;
  }

  /**
   * Lo que esta adjudicación va a sumar al "comprometido" de cada
   * subcategoría (en USD), basado en los radios actualmente elegidos.
   */
  function awardingBySubcat(): Map<string, number> {
    const m = new Map<string, number>();
    for (const line of requestLines) {
      const qid = awards.get(line.id);
      if (!qid) continue;
      const subId = line.subcategory_id;
      if (!subId) continue;
      const q = quotations.find((x) => x.id === qid);
      if (!q) continue;
      const p = priceFor(qid, line.id) ?? 0;
      const lineTotal = p * Number(line.quantity || 0);
      const usd = toUsd(lineTotal, q.currency);
      m.set(subId, (m.get(subId) || 0) + usd);
    }
    return m;
  }

  /* ------------------------------- RENDER ------------------------------- */
  const winners = winningQuotationIds();
  const linesWithoutAward = requestLines.filter((l) => !awards.has(l.id)).length;
  const awardingByCat = awardingBySubcat();
  // Subcategorías afectadas por esta SC, en orden de aparición.
  const affectedSubcatIds = Array.from(
    new Set(requestLines.map((l) => l.subcategory_id).filter(Boolean) as string[])
  );
  // Hay alguna subcategoría que se quedaría con disponible negativo después de esta adjudicación?
  const willOverspend = affectedSubcatIds.some((sid) => {
    const bh = budgetBySubcat.get(sid);
    if (!bh) return false;
    const adding = awardingByCat.get(sid) || 0;
    return Number(bh.available_usd) - adding < 0;
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[1300px] max-h-[92vh] overflow-y-auto">
        {loading || !request ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Cargando…</div>
        ) : quotations.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No hay cotizaciones pendientes para esta SC.
            </p>
            <Button variant="outline" className="mt-4" onClick={onClose}>Cerrar</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Award className="h-5 w-5 text-[#E87722]" />
                Adjudicación · SC {request.number}
              </DialogTitle>
              <DialogDescription>
                Elegí cuál cotización gana cada línea. Vas a generar una OC por cada proveedor adjudicado.
                {linesWithoutAward > 0 && (
                  <span className="text-amber-700 ml-2">
                    · {linesWithoutAward} {linesWithoutAward === 1 ? "línea sin" : "líneas sin"} adjudicar
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>

            {/* Salud presupuestal por subcategoría EDT — el aprobador necesita
                saber cuánto le queda disponible antes de firmar. */}
            {affectedSubcatIds.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-2">
                  💰 Presupuesto disponible · subcategorías afectadas
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {affectedSubcatIds.map((subId) => {
                    const bh = budgetBySubcat.get(subId);
                    const adding = awardingByCat.get(subId) || 0;
                    if (!bh) {
                      return (
                        <div key={subId} className="border rounded-md p-2.5 text-xs bg-neutral-50">
                          <p className="text-muted-foreground italic">
                            Sin presupuesto cargado para esta subcategoría.
                          </p>
                        </div>
                      );
                    }
                    const budgeted = Number(bh.budgeted_usd || 0);
                    const ordered = Number(bh.ordered_usd || 0);
                    const available = Number(bh.available_usd || 0);
                    const afterAward = available - adding;
                    // Sin cuantificación cargada: el "presupuestado" es 0 y no hay info contra qué comparar.
                    const noBudget = budgeted <= 0;
                    // Semáforo:
                    //   verde   → after >= 30% del presupuestado, sin estrés
                    //   amarillo → after entre 0 y 30%, ojo, te queda poco
                    //   rojo    → after < 0, estás sobrepasando
                    const status: "ok" | "warn" | "over" | "none" =
                      noBudget ? "none"
                      : afterAward < 0 ? "over"
                      : afterAward < budgeted * 0.3 ? "warn"
                      : "ok";
                    const orderedPct = budgeted > 0 ? Math.min(100, (ordered / budgeted) * 100) : 0;
                    const addingPct = budgeted > 0 ? Math.min(100 - orderedPct, (adding / budgeted) * 100) : 0;
                    const statusBg =
                      status === "over" ? "bg-red-50 border-red-200"
                      : status === "warn" ? "bg-amber-50 border-amber-200"
                      : status === "ok" ? "bg-emerald-50 border-emerald-200"
                      : "bg-neutral-50";
                    const statusText =
                      status === "over" ? "text-red-800"
                      : status === "warn" ? "text-amber-800"
                      : status === "ok" ? "text-emerald-800"
                      : "text-muted-foreground";
                    return (
                      <div key={subId} className={`border rounded-md p-2.5 text-xs ${statusBg}`}>
                        <p className="font-semibold leading-snug">
                          <span className="font-mono text-muted-foreground">{bh.subcategory_code}</span>
                          {" · "}
                          {bh.subcategory_name}
                        </p>
                        {noBudget ? (
                          <p className="text-muted-foreground italic mt-1">
                            Sin cuantificación cargada — no hay presupuesto contra el cual comparar.
                          </p>
                        ) : (
                          <>
                            {/* Barra de progreso: ordenado (oscuro) + esta adjudicación (amarillo/rojo) */}
                            <div className="mt-1.5 h-2 w-full rounded-full bg-neutral-200 overflow-hidden flex">
                              <div
                                className="bg-neutral-700 h-full"
                                style={{ width: `${orderedPct}%` }}
                                title={`Ya comprometido: ${formatNumber(ordered, 0)} USD`}
                              />
                              <div
                                className={`h-full ${status === "over" ? "bg-red-600" : "bg-[#E87722]"}`}
                                style={{ width: `${addingPct}%` }}
                                title={`Esta adjudicación: ${formatNumber(adding, 0)} USD`}
                              />
                            </div>
                            <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px]">
                              <div>
                                <p className="text-muted-foreground uppercase tracking-wider">Presupuesto</p>
                                <p className="font-mono font-semibold">{formatNumber(budgeted, 0)} USD</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground uppercase tracking-wider">Ya comprometido</p>
                                <p className="font-mono">{formatNumber(ordered, 0)} USD</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground uppercase tracking-wider">Esta adj.</p>
                                <p className={`font-mono font-semibold ${adding > 0 ? "text-[#E87722]" : ""}`}>
                                  {adding > 0 ? "+" : ""}{formatNumber(adding, 0)} USD
                                </p>
                              </div>
                            </div>
                            <div className={`mt-1 pt-1 border-t flex items-center justify-between ${statusText}`}>
                              <span className="text-[10px] uppercase tracking-wider font-semibold">
                                {status === "over"
                                  ? "⚠ Sobrepasa presupuesto"
                                  : status === "warn"
                                    ? "Margen ajustado"
                                    : "Disponible tras adjudicar"}
                              </span>
                              <span className="font-mono font-bold">
                                {formatNumber(afterAward, 0)} USD
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                {willOverspend && (
                  <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-md border border-red-300 bg-red-50 text-red-900">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      <strong>Atención:</strong> esta adjudicación deja al menos una subcategoría
                      sobre presupuesto. Podés continuar, pero queda registrado que firmaste
                      sabiendo del exceso.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Cuadro comparativo — read-only con radios para elegir ganador */}
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="text-left px-2 py-2 font-semibold sticky left-0 bg-neutral-100 z-20 min-w-[280px]">
                      Ítem
                    </th>
                    <th className="text-right px-2 py-2 font-semibold w-[70px]">Cantidad</th>
                    <th className="text-center px-2 py-2 font-semibold w-[50px]">Un.</th>
                    {quotations.map((q) => {
                      const isWinning = winners.has(q.id);
                      return (
                        <th
                          key={q.id}
                          className={`text-center px-2 py-2 font-semibold border-l-2 border-neutral-300 min-w-[140px] ${
                            isWinning ? "bg-emerald-100" : ""
                          }`}
                        >
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-[10px] text-muted-foreground font-mono">{q.number}</span>
                            <span
                              className="truncate max-w-[160px] inline-flex items-center gap-1"
                              title={q.supplier_name ?? "(sin proveedor)"}
                            >
                              <Building className="h-3 w-3 shrink-0" />
                              {q.supplier_name ?? "(sin proveedor)"}
                            </span>
                            <span className="text-[10px] font-normal text-muted-foreground">{q.currency}</span>
                            {isWinning && (
                              <span className="text-[10px] font-bold text-emerald-700">
                                Ganadora · {formatNumber(awardedTotalFor(q.id), 0)}
                              </span>
                            )}
                          </div>
                        </th>
                      );
                    })}
                    <th className="text-center px-2 py-2 font-semibold w-[80px]">Sin adj.</th>
                  </tr>
                </thead>
                <tbody>
                  {requestLines.map((line) => {
                    const cheapestId = cheapestFor(line.id);
                    const selectedId = awards.get(line.id) ?? null;
                    return (
                      <tr key={line.id} className="border-t">
                        <td className="px-2 py-1 align-top sticky left-0 z-10 bg-white">
                          <p className="font-medium leading-snug">{line.description}</p>
                        </td>
                        <td className="px-2 py-1 text-right font-mono">
                          {formatNumber(line.quantity)}
                        </td>
                        <td className="px-2 py-1 text-center text-muted-foreground">{line.unit}</td>
                        {quotations.map((q) => {
                          const p = priceFor(q.id, line.id);
                          const subtotal = (p ?? 0) * Number(line.quantity || 0);
                          const isCheapest = cheapestId === q.id && p != null;
                          const isSelected = selectedId === q.id;
                          const noPrice = p == null;
                          return (
                            <td
                              key={q.id}
                              className={`px-2 py-1 border-l-2 border-neutral-200 text-center align-middle ${
                                isSelected ? "bg-emerald-50" : ""
                              }`}
                            >
                              <label className="flex flex-col items-center gap-0.5 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`award-${line.id}`}
                                  checked={isSelected}
                                  disabled={noPrice}
                                  onChange={() => setAward(line.id, q.id)}
                                  className="accent-[#E87722]"
                                />
                                {noPrice ? (
                                  <span className="text-muted-foreground italic text-[11px]">—</span>
                                ) : (
                                  <>
                                    <span
                                      className={`font-mono text-[11px] ${
                                        isCheapest ? "font-bold text-emerald-700" : ""
                                      }`}
                                    >
                                      {formatNumber(p, 2)}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground font-mono">
                                      = {formatNumber(subtotal, 0)}
                                    </span>
                                    {isCheapest && (
                                      <span className="text-[9px] text-emerald-700 font-semibold uppercase tracking-wider">
                                        ⬇ menor
                                      </span>
                                    )}
                                  </>
                                )}
                              </label>
                            </td>
                          );
                        })}
                        <td className="px-2 py-1 text-center align-middle">
                          <label className="cursor-pointer">
                            <input
                              type="radio"
                              name={`award-${line.id}`}
                              checked={selectedId === null}
                              onChange={() => setAward(line.id, null)}
                              className="accent-neutral-500"
                              title="No adjudicar esta línea"
                            />
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                  {/* Totales por cotización (sólo lo que cada una gana) */}
                  <tr className="border-t-2 border-neutral-900 bg-neutral-50 font-bold">
                    <td className="px-2 py-2 sticky left-0 bg-neutral-50 text-xs uppercase tracking-wider">
                      Total adjudicado
                    </td>
                    <td colSpan={2}></td>
                    {quotations.map((q) => {
                      const total = awardedTotalFor(q.id);
                      const isWinning = winners.has(q.id);
                      return (
                        <td
                          key={q.id}
                          className={`px-2 py-2 text-right font-mono border-l-2 border-neutral-200 ${
                            isWinning ? "text-emerald-700" : "text-muted-foreground"
                          }`}
                        >
                          {formatNumber(total, 0)} {q.currency}
                        </td>
                      );
                    })}
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Resumen condiciones de cotizaciones ganadoras */}
            {winners.size > 0 && (
              <div className="space-y-2 mt-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Condiciones de las {winners.size === 1 ? "cotización" : "cotizaciones"} ganadora{winners.size === 1 ? "" : "s"}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {quotations.filter((q) => winners.has(q.id)).map((q) => (
                    <div key={q.id} className="border rounded-md p-3 text-xs space-y-1 bg-emerald-50/40">
                      <p className="font-semibold flex items-center gap-1">
                        <Building className="h-3 w-3" />
                        {q.supplier_name ?? "(sin proveedor)"} · {q.number}
                      </p>
                      {q.payment_terms_type && (
                        <p>
                          <span className="text-muted-foreground">Pago:</span>{" "}
                          {q.payment_terms_type === "credito" && q.credit_days
                            ? `Crédito ${q.credit_days} días`
                            : q.payment_terms_type}
                        </p>
                      )}
                      {q.has_advance && (
                        <p>
                          <span className="text-muted-foreground">Anticipo:</span>{" "}
                          {q.advance_type === "percentage"
                            ? `${formatNumber(Number(q.advance_amount ?? 0), 1)}%`
                            : `${formatNumber(Number(q.advance_amount ?? 0), 0)} ${q.currency}`}
                        </p>
                      )}
                      {q.retention_pct && Number(q.retention_pct) > 0 && (
                        <p>
                          <span className="text-muted-foreground">Retención:</span>{" "}
                          {formatNumber(Number(q.retention_pct), 1)}%
                        </p>
                      )}
                      {q.valid_until && (
                        <p>
                          <span className="text-muted-foreground">Válida hasta:</span>{" "}
                          {new Date(q.valid_until).toLocaleDateString()}
                        </p>
                      )}
                      {q.justification && (
                        <p className="text-muted-foreground italic pt-1 border-t">
                          {q.justification}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Comentario y acciones */}
            {confirming ? (
              <div className="space-y-3 pt-3 border-t mt-3">
                <div className="space-y-2">
                  <Label>Comentario (opcional)</Label>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Cualquier observación que quieras dejar registrada en las OCs generadas"
                    rows={3}
                  />
                </div>
                <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-md border border-amber-200 bg-amber-50 text-amber-900">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <div>
                    Vas a generar <strong>{winners.size} {winners.size === 1 ? "OC" : "OCs"}</strong>
                    {" "}por un total adjudicado de{" "}
                    <strong>
                      {Array.from(winners).map((qid) => {
                        const q = quotations.find((x) => x.id === qid);
                        return q ? `${formatNumber(awardedTotalFor(qid), 0)} ${q.currency}` : "";
                      }).filter(Boolean).join(" + ")}
                    </strong>.
                    Las cotizaciones no ganadoras pasarán a estado <em>rechazada</em>.
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setConfirming(false)} disabled={submitting}>
                    Volver
                  </Button>
                  <Button
                    onClick={() => handleAward("approve")}
                    disabled={submitting}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {submitting ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Adjudicando…</>
                    ) : (
                      <><CheckCircle2 className="h-4 w-4 mr-2" /> Confirmar adjudicación</>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 pt-3 border-t mt-3">
                <Button
                  variant="outline"
                  className="border-red-200 text-red-700 hover:bg-red-50"
                  onClick={() => {
                    if (!note.trim()) {
                      toast.error("Para rechazar todas, ingresá un motivo en el comentario");
                      return;
                    }
                    if (!confirm("¿Rechazar todas las cotizaciones? No se generará ninguna OC.")) return;
                    handleAward("reject");
                  }}
                  disabled={submitting}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Rechazar todas
                </Button>
                <div className="flex-1">
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Comentario opcional (requerido si rechazás todas)"
                    rows={2}
                    className="text-xs"
                  />
                </div>
                <Button
                  onClick={() => setConfirming(true)}
                  disabled={awards.size === 0 || submitting}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <Scale className="h-4 w-4 mr-2" />
                  Adjudicar ({winners.size} {winners.size === 1 ? "proveedor" : "proveedores"})
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
