"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatNumber } from "@/lib/utils/formula";
import {
  CheckCircle2, XCircle, Mail, Calendar, Loader2,
  FileText, Scale, Layers, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { AwardQuotationDialog } from "./award-quotation-dialog";

interface PendingOC {
  id: string;
  number: string | null;
  issue_date: string | null;
  supplier_name: string | null;
  total: number | string | null;
  currency: string | null;
  submitted_by: string | null;
  submitted_by_email: string | null;
  submitted_at: string | null;
}

interface PendingQuotation {
  request_id: string;
  request_number: string | null;
  quotation_count: number;
  total_lines: number;
  earliest_submitted: string | null;
}

interface OCLine {
  id: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total: number | null;
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

export function ApprovalQueue({
  projectId,
  initialPendingOcs,
  initialPendingQuotations,
}: {
  projectId: string;
  initialPendingOcs: PendingOC[];
  initialPendingQuotations: PendingQuotation[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const [pendingOcs, setPendingOcs] = useState<PendingOC[]>(initialPendingOcs);
  const [pendingQuotes, setPendingQuotes] =
    useState<PendingQuotation[]>(initialPendingQuotations);
  /** TC del proyecto, cacheado al primer detalle abierto. Lo usamos para
   *  convertir totales de OC en moneda local a USD para comparar contra
   *  el presupuesto (que está en USD). */
  const [projectFx, setProjectFx] = useState<number | null>(null);

  // Estado del modal de OC
  const [selectedOc, setSelectedOc] = useState<PendingOC | null>(null);
  const [ocLines, setOcLines] = useState<OCLine[]>([]);
  const [loadingOcLines, setLoadingOcLines] = useState(false);
  const [budgetByOcSubcat, setBudgetByOcSubcat] = useState<Map<string, BudgetHealth>>(new Map());
  const [decisionMode, setDecisionMode] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Estado del modal de adjudicación de cotizaciones
  const [awardingRequestId, setAwardingRequestId] = useState<string | null>(null);

  async function openOcDetail(oc: PendingOC) {
    setSelectedOc(oc);
    setDecisionMode(null);
    setNote("");
    setLoadingOcLines(true);
    setBudgetByOcSubcat(new Map());
    const { data } = await supabase
      .from("purchase_order_lines")
      .select("id, description, quantity, unit, unit_price, total, subcategory_id")
      .eq("order_id", oc.id);
    const lines = (data ?? []) as OCLine[];
    setOcLines(lines);
    setLoadingOcLines(false);

    // Cargar TC del proyecto si aún no está
    let fx = projectFx;
    if (fx == null) {
      const { data: proj } = await supabase
        .from("projects")
        .select("exchange_rate")
        .eq("id", projectId)
        .single();
      fx = Number((proj as { exchange_rate: number } | null)?.exchange_rate || 1);
      setProjectFx(fx);
    }

    // Salud presupuestal de las subcategorías de esta OC
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
      setBudgetByOcSubcat(map);
    }
  }

  async function decideOc(decision: "approve" | "reject") {
    if (!selectedOc) return;
    if (decision === "reject" && !note.trim()) {
      toast.error("Para rechazar, ingresá un motivo en el comentario");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc("decide_oc_approval", {
      p_oc_id: selectedOc.id,
      p_decision: decision,
      p_note: note.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(decision === "approve" ? "OC aprobada" : "OC rechazada");
    setPendingOcs((prev) => prev.filter((p) => p.id !== selectedOc.id));
    setSelectedOc(null);
    setDecisionMode(null);
    setNote("");
    router.refresh();
  }

  function fmtRel(when: string | null) {
    if (!when) return "—";
    const ms = Date.now() - new Date(when).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return "hace instantes";
    if (min < 60) return `hace ${min} min`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `hace ${hrs} h`;
    const days = Math.floor(hrs / 24);
    return `hace ${days} ${days === 1 ? "día" : "días"}`;
  }

  const total = pendingOcs.length + pendingQuotes.length;
  if (total === 0) {
    return (
      <Card className="text-center py-16">
        <CardContent>
          <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-500 mb-4" />
          <h3 className="text-lg font-medium mb-1">Todo al día</h3>
          <p className="text-muted-foreground text-sm">
            No tenés cotizaciones por adjudicar ni OCs pendientes de firmar.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* COTIZACIONES PENDIENTES DE ADJUDICAR */}
      {pendingQuotes.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground inline-flex items-center gap-2">
            <Scale className="h-3.5 w-3.5" />
            Cotizaciones por adjudicar ({pendingQuotes.length})
          </h2>
          <div className="space-y-3">
            {pendingQuotes.map((q) => (
              <Card
                key={q.request_id}
                className="cursor-pointer hover:border-[#E87722]/40 transition-colors"
                onClick={() => setAwardingRequestId(q.request_id)}
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-mono text-sm text-muted-foreground">
                          SC #{q.request_number ?? "—"}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#E87722]/10 text-[#E87722] font-semibold">
                          Cotización
                        </span>
                      </div>
                      <h3 className="text-lg font-semibold truncate inline-flex items-center gap-2">
                        <Layers className="h-4 w-4 text-muted-foreground" />
                        {q.quotation_count} {q.quotation_count === 1 ? "proveedor" : "proveedores"}
                        <span className="text-sm text-muted-foreground font-normal">
                          · {q.total_lines} {q.total_lines === 1 ? "ítem" : "ítems"}
                        </span>
                      </h3>
                      <div className="text-xs text-muted-foreground mt-1 inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Cargada {fmtRel(q.earliest_submitted)}
                      </div>
                    </div>
                    <div className="text-right">
                      <Button
                        size="sm"
                        className="bg-[#E87722] hover:bg-[#E87722]/90"
                        onClick={(e) => { e.stopPropagation(); setAwardingRequestId(q.request_id); }}
                      >
                        <Scale className="h-4 w-4 mr-2" />
                        Adjudicar
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* OCs PENDIENTES DE APROBAR */}
      {pendingOcs.length > 0 && (
        <div className="space-y-2 mt-6">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground inline-flex items-center gap-2">
            <FileText className="h-3.5 w-3.5" />
            Órdenes de compra por aprobar ({pendingOcs.length})
          </h2>
          <div className="space-y-3">
            {pendingOcs.map((oc) => {
              const total = Number(oc.total ?? 0);
              return (
                <Card
                  key={oc.id}
                  className="cursor-pointer hover:border-[#E87722]/40 transition-colors"
                  onClick={() => openOcDetail(oc)}
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-mono text-sm text-muted-foreground">
                            OC #{oc.number ?? "—"}
                          </span>
                          {oc.issue_date && (
                            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(oc.issue_date).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <h3 className="text-lg font-semibold truncate">
                          {oc.supplier_name ?? "(sin proveedor)"}
                        </h3>
                        <div className="text-xs text-muted-foreground mt-1 inline-flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          Enviada por {oc.submitted_by_email ?? "—"} · {fmtRel(oc.submitted_at)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold">
                          {formatNumber(total, 0)}
                        </div>
                        <div className="text-xs text-muted-foreground uppercase">
                          {oc.currency ?? ""}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL — DETALLE DE OC */}
      <Dialog open={!!selectedOc} onOpenChange={(o) => { if (!o) { setSelectedOc(null); setDecisionMode(null); } }}>
        <DialogContent className="sm:max-w-2xl">
          {selectedOc && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-[#E87722]" />
                  OC #{selectedOc.number ?? "—"} · {selectedOc.supplier_name ?? ""}
                </DialogTitle>
                <DialogDescription>
                  Enviada por {selectedOc.submitted_by_email ?? "—"} · {fmtRel(selectedOc.submitted_at)}
                </DialogDescription>
              </DialogHeader>

              {/* Salud presupuestal de las subcategorías afectadas por esta OC */}
              <OcBudgetPanel
                ocLines={ocLines}
                ocCurrency={selectedOc.currency ?? "USD"}
                fx={projectFx ?? 1}
                budgetMap={budgetByOcSubcat}
              />

              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Detalle ({ocLines.length} ítems)
                </h4>
                {loadingOcLines ? (
                  <p className="text-sm text-muted-foreground py-3">Cargando…</p>
                ) : ocLines.length === 0 ? (
                  <p className="text-sm italic text-muted-foreground py-2">
                    La OC no tiene líneas cargadas.
                  </p>
                ) : (
                  <div className="border rounded-md overflow-hidden max-h-[300px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-neutral-100 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Descripción</th>
                          <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold w-[80px]">Cant.</th>
                          <th className="text-center px-3 py-2 text-xs uppercase tracking-wider font-semibold w-[60px]">Un.</th>
                          <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold w-[100px]">P.U.</th>
                          <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold w-[110px]">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ocLines.map((l) => (
                          <tr key={l.id} className="border-t">
                            <td className="px-3 py-1.5">{l.description ?? ""}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{formatNumber(Number(l.quantity ?? 0))}</td>
                            <td className="px-3 py-1.5 text-center text-muted-foreground">{l.unit ?? ""}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{formatNumber(Number(l.unit_price ?? 0), 0)}</td>
                            <td className="px-3 py-1.5 text-right font-mono font-semibold">{formatNumber(Number(l.total ?? 0), 0)}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-neutral-900 bg-neutral-900 font-bold">
                          <td colSpan={4} className="px-3 py-2 text-right text-xs uppercase tracking-wider text-white">Total</td>
                          <td className="px-3 py-2 text-right font-mono" style={{ color: "#E87722" }}>
                            {formatNumber(Number(selectedOc.total ?? 0), 0)} {selectedOc.currency}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {decisionMode ? (
                <div className="space-y-3 pt-2">
                  <div className="space-y-2">
                    <Label>
                      Comentario {decisionMode === "approve" ? "(opcional)" : "(requerido)"}
                    </Label>
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={
                        decisionMode === "approve"
                          ? "Cualquier observación que quieras dejar registrada"
                          : "Motivo del rechazo (será visible para el comprador)"
                      }
                      rows={3}
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" onClick={() => setDecisionMode(null)} disabled={submitting}>
                      Cancelar
                    </Button>
                    <Button
                      onClick={() => decideOc(decisionMode)}
                      disabled={submitting}
                      className={decisionMode === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}
                    >
                      {submitting ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Procesando…</>
                      ) : decisionMode === "approve" ? (
                        <><CheckCircle2 className="h-4 w-4 mr-2" /> Confirmar aprobación</>
                      ) : (
                        <><XCircle className="h-4 w-4 mr-2" /> Confirmar rechazo</>
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => setDecisionMode("reject")}
                    variant="outline"
                    className="flex-1 border-red-200 text-red-700 hover:bg-red-50"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Rechazar
                  </Button>
                  <Button
                    onClick={() => setDecisionMode("approve")}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Aprobar
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* MODAL — ADJUDICACIÓN DE COTIZACIONES */}
      {awardingRequestId && (
        <AwardQuotationDialog
          requestId={awardingRequestId}
          onClose={() => setAwardingRequestId(null)}
          onAwarded={() => {
            setPendingQuotes((prev) => prev.filter((q) => q.request_id !== awardingRequestId));
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/**
 * Panel compacto que muestra la salud presupuestal de las subcategorías
 * afectadas por una OC pendiente. Lo que aporta esta OC se calcula
 * client-side (las líneas tienen total + subcategoría) y se convierte a
 * USD si la OC está en moneda local.
 *
 * Como la RPC `get_subcategory_budget_health` ya excluye OCs en estado
 * `pending_approval`, el `ordered_usd` que devuelve NO incluye esta OC,
 * y por eso podemos sumar el aporte propio limpio sin doble-conteo.
 */
function OcBudgetPanel({
  ocLines,
  ocCurrency,
  fx,
  budgetMap,
}: {
  ocLines: OCLine[];
  ocCurrency: string;
  fx: number;
  budgetMap: Map<string, BudgetHealth>;
}) {
  if (budgetMap.size === 0) return null;

  function lineUsd(total: number) {
    if (ocCurrency.toUpperCase() === "USD") return total;
    return fx > 0 ? total / fx : total;
  }

  const subcatIds = Array.from(budgetMap.keys());
  const contribByCat = new Map<string, number>();
  for (const l of ocLines) {
    if (!l.subcategory_id) continue;
    const usd = lineUsd(Number(l.total ?? 0));
    contribByCat.set(l.subcategory_id, (contribByCat.get(l.subcategory_id) || 0) + usd);
  }

  const willOverspend = subcatIds.some((sid) => {
    const bh = budgetMap.get(sid);
    if (!bh || Number(bh.budgeted_usd) <= 0) return false;
    const adding = contribByCat.get(sid) || 0;
    return Number(bh.available_usd) - adding < 0;
  });

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        💰 Presupuesto disponible · subcategorías afectadas
      </h4>
      <div className="space-y-1.5">
        {subcatIds.map((sid) => {
          const bh = budgetMap.get(sid)!;
          const budgeted = Number(bh.budgeted_usd || 0);
          const ordered = Number(bh.ordered_usd || 0);
          const available = Number(bh.available_usd || 0);
          const adding = contribByCat.get(sid) || 0;
          const after = available - adding;
          const noBudget = budgeted <= 0;
          const status: "ok" | "warn" | "over" | "none" =
            noBudget ? "none"
            : after < 0 ? "over"
            : after < budgeted * 0.3 ? "warn"
            : "ok";
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
          const orderedPct = budgeted > 0 ? Math.min(100, (ordered / budgeted) * 100) : 0;
          const addingPct = budgeted > 0 ? Math.min(100 - orderedPct, (adding / budgeted) * 100) : 0;
          return (
            <div key={sid} className={`border rounded-md p-2.5 text-xs ${statusBg}`}>
              <div className="flex items-center justify-between">
                <p className="font-semibold leading-snug">
                  <span className="font-mono text-muted-foreground">{bh.subcategory_code}</span>
                  {" · "}
                  {bh.subcategory_name}
                </p>
                <span className={`text-[10px] uppercase tracking-wider font-bold ${statusText}`}>
                  {status === "over"
                    ? "⚠ sobre presupuesto"
                    : status === "warn"
                      ? "Margen ajustado"
                      : status === "ok"
                        ? "OK"
                        : "Sin presupuesto"}
                </span>
              </div>
              {noBudget ? (
                <p className="text-muted-foreground italic mt-1">
                  Sin cuantificación cargada — no hay presupuesto contra el cual comparar.
                </p>
              ) : (
                <>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-neutral-200 overflow-hidden flex">
                    <div className="bg-neutral-700 h-full" style={{ width: `${orderedPct}%` }} />
                    <div
                      className={`h-full ${status === "over" ? "bg-red-600" : "bg-[#E87722]"}`}
                      style={{ width: `${addingPct}%` }}
                    />
                  </div>
                  <div className="mt-1.5 grid grid-cols-4 gap-1 text-[10px]">
                    <div>
                      <p className="text-muted-foreground uppercase tracking-wider">Presup.</p>
                      <p className="font-mono font-semibold">{formatNumber(budgeted, 0)} USD</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground uppercase tracking-wider">Comprometido</p>
                      <p className="font-mono">{formatNumber(ordered, 0)} USD</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground uppercase tracking-wider">Esta OC</p>
                      <p className="font-mono font-semibold text-[#E87722]">
                        +{formatNumber(adding, 0)} USD
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground uppercase tracking-wider">Tras aprobar</p>
                      <p className={`font-mono font-bold ${statusText}`}>
                        {formatNumber(after, 0)} USD
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
        {willOverspend && (
          <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-md border border-red-300 bg-red-50 text-red-900">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              <strong>Atención:</strong> aprobar esta OC dejaría al menos una subcategoría
              sobre presupuesto.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
