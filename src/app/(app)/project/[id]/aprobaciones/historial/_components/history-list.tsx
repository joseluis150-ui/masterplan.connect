"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2, XCircle, FileText, Scale,
  Calendar, Search, Loader2,
  History as HistoryIcon,
} from "lucide-react";
import { formatNumber } from "@/lib/utils/formula";
import { OcHistoryDetail } from "./oc-history-detail";
import { AwardHistoryDetail } from "./award-history-detail";

interface DecidedOc {
  id: string;
  number: string | null;
  issue_date: string | null;
  supplier: string | null;
  currency: string | null;
  approval_status: "approved" | "rejected" | null;
  decided_at: string | null;
  approval_note: string | null;
  request_id: string | null;
}

/** Resumen de una adjudicación: agrupa todas las cotizaciones de UNA SC que
 *  el usuario decidió en el mismo lote (mismo timestamp). */
interface DecidedAward {
  request_id: string;
  request_number: string | null;
  decided_at: string;
  approval_note: string | null;
  awarded_count: number;
  rejected_count: number;
  /** IDs de cotizaciones decididas — necesarias para el detalle. */
  quotation_ids: string[];
}

type HistoryEntry =
  | { kind: "oc"; data: DecidedOc; sortKey: string }
  | { kind: "award"; data: DecidedAward; sortKey: string };

export function ApprovalHistoryList({ projectId }: { projectId: string }) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "oc" | "award">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "rejected">("all");

  // Estado de los modales
  const [openOcId, setOpenOcId] = useState<string | null>(null);
  const [openAwardSc, setOpenAwardSc] = useState<DecidedAward | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) { setEntries([]); setLoading(false); return; }

    // OCs decididas por mí en este proyecto.
    // Filtramos por approval_status para excluir las legacy con NULL — esas
    // no fueron "decididas" en el flujo formal de aprobación.
    const ocPromise = supabase
      .from("purchase_orders")
      .select("id, number, issue_date, supplier, currency, approval_status, decided_at, approval_note, request_id")
      .eq("project_id", projectId)
      .eq("decided_by", userId)
      .in("approval_status", ["approved", "rejected"])
      .order("decided_at", { ascending: false })
      .limit(200);

    // Cotizaciones decididas por mí (status awarded/rejected).
    // Las agrupamos por request_id porque award_quotations decide todo el set
    // en un solo timestamp.
    const quotePromise = supabase
      .from("quotations")
      .select(`
        id, status, decided_at, approval_note, request_id,
        purchase_request:purchase_requests!inner(number, project_id)
      `)
      .eq("decided_by", userId)
      .in("status", ["awarded", "rejected"])
      .order("decided_at", { ascending: false })
      .limit(400);

    const [ocRes, quoteRes] = await Promise.all([ocPromise, quotePromise]);

    const ocEntries: HistoryEntry[] = ((ocRes.data ?? []) as DecidedOc[]).map((oc) => ({
      kind: "oc" as const,
      data: oc,
      sortKey: oc.decided_at ?? "",
    }));

    // Agrupar cotizaciones por request_id
    type QRow = {
      id: string;
      status: "awarded" | "rejected";
      decided_at: string;
      approval_note: string | null;
      request_id: string;
      purchase_request: { number: string; project_id: string } | { number: string; project_id: string }[] | null;
    };
    const byRequest = new Map<string, DecidedAward>();
    for (const q of (quoteRes.data ?? []) as unknown as QRow[]) {
      const pr = Array.isArray(q.purchase_request) ? q.purchase_request[0] : q.purchase_request;
      if (!pr || pr.project_id !== projectId) continue; // Filtramos al proyecto actual
      const cur = byRequest.get(q.request_id);
      if (!cur) {
        byRequest.set(q.request_id, {
          request_id: q.request_id,
          request_number: pr.number,
          decided_at: q.decided_at,
          approval_note: q.approval_note,
          awarded_count: q.status === "awarded" ? 1 : 0,
          rejected_count: q.status === "rejected" ? 1 : 0,
          quotation_ids: [q.id],
        });
      } else {
        cur.quotation_ids.push(q.id);
        if (q.status === "awarded") cur.awarded_count += 1;
        else cur.rejected_count += 1;
        // El más temprano gana como sortKey (todas suelen tener el mismo)
        if (q.decided_at < cur.decided_at) cur.decided_at = q.decided_at;
      }
    }
    const awardEntries: HistoryEntry[] = Array.from(byRequest.values()).map((a) => ({
      kind: "award" as const,
      data: a,
      sortKey: a.decided_at,
    }));

    const all = [...ocEntries, ...awardEntries].sort((a, b) =>
      a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0
    );
    setEntries(all);
    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => { load(); }, [load]);

  function fmt(when: string | null) {
    if (!when) return "—";
    const d = new Date(when);
    return d.toLocaleDateString() + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  /** Filtros combinados. */
  const filtered = entries.filter((e) => {
    // Tipo
    if (kindFilter !== "all" && e.kind !== kindFilter) return false;
    // Estado
    if (statusFilter !== "all") {
      if (e.kind === "oc") {
        if (e.data.approval_status !== statusFilter) return false;
      } else {
        // Para award: si filtra "rejected" mostrar sólo las que fueron 100% rechazadas
        if (statusFilter === "rejected" && e.data.awarded_count > 0) return false;
        if (statusFilter === "approved" && e.data.awarded_count === 0) return false;
      }
    }
    // Búsqueda libre
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      if (e.kind === "oc") {
        const hay = `${e.data.number ?? ""} ${e.data.supplier ?? ""} ${e.data.approval_note ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      } else {
        const hay = `${e.data.request_number ?? ""} ${e.data.approval_note ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
    }
    return true;
  });

  if (loading) {
    return (
      <Card className="text-center py-16">
        <CardContent>
          <Loader2 className="h-6 w-6 mx-auto animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground mt-3">Cargando historial…</p>
        </CardContent>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Card className="text-center py-16">
        <CardContent>
          <HistoryIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-1">Sin decisiones aún</h3>
          <p className="text-muted-foreground text-sm">
            Cuando apruebes OCs o adjudiques cotizaciones, aparecerán acá para consulta.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar por número, proveedor, comentario…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
        <FilterPills
          options={[
            { key: "all",   label: "Todo" },
            { key: "oc",    label: "OCs" },
            { key: "award", label: "Adjudicaciones" },
          ]}
          value={kindFilter}
          onChange={(v) => setKindFilter(v as "all" | "oc" | "award")}
        />
        <FilterPills
          options={[
            { key: "all",      label: "Todos" },
            { key: "approved", label: "Aprobado / adj." },
            { key: "rejected", label: "Rechazado" },
          ]}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as "all" | "approved" | "rejected")}
        />
      </div>

      {/* Lista */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8 italic">
            Sin resultados con los filtros actuales.
          </p>
        ) : filtered.map((entry) => {
          if (entry.kind === "oc") {
            const oc = entry.data;
            const isApproved = oc.approval_status === "approved";
            return (
              <Card
                key={`oc-${oc.id}`}
                className="cursor-pointer hover:border-[#E87722]/40 transition-colors"
                onClick={() => setOpenOcId(oc.id)}
              >
                <CardContent className="py-3">
                  <div className="flex items-center gap-4">
                    <div
                      className={`rounded-full p-2 shrink-0 ${
                        isApproved ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                      }`}
                    >
                      {isApproved ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700 font-semibold inline-flex items-center gap-1">
                          <FileText className="h-3 w-3" /> OC
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          #{oc.number ?? "—"}
                        </span>
                        <span className={`text-[10px] uppercase tracking-wider font-bold ${
                          isApproved ? "text-emerald-700" : "text-red-700"
                        }`}>
                          {isApproved ? "Aprobada" : "Rechazada"}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold truncate">
                        {oc.supplier ?? "(sin proveedor)"}
                      </h3>
                      {oc.approval_note && (
                        <p className="text-xs text-muted-foreground italic mt-0.5 truncate">
                          “{oc.approval_note}”
                        </p>
                      )}
                    </div>
                    <div className="text-right text-xs text-muted-foreground inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {fmt(oc.decided_at)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          }

          // award
          const a = entry.data;
          const isAllRejected = a.awarded_count === 0;
          return (
            <Card
              key={`award-${a.request_id}`}
              className="cursor-pointer hover:border-[#E87722]/40 transition-colors"
              onClick={() => setOpenAwardSc(a)}
            >
              <CardContent className="py-3">
                <div className="flex items-center gap-4">
                  <div
                    className={`rounded-full p-2 shrink-0 ${
                      isAllRejected ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {isAllRejected ? <XCircle className="h-4 w-4" /> : <Scale className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#E87722]/10 text-[#E87722] font-semibold inline-flex items-center gap-1">
                        <Scale className="h-3 w-3" /> Adjudicación
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        SC #{a.request_number ?? "—"}
                      </span>
                      <span className={`text-[10px] uppercase tracking-wider font-bold ${
                        isAllRejected ? "text-red-700" : "text-emerald-700"
                      }`}>
                        {isAllRejected ? "Todas rechazadas" : `${a.awarded_count} adjudicada${a.awarded_count === 1 ? "" : "s"}`}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold truncate">
                      {a.awarded_count + a.rejected_count} cotización{(a.awarded_count + a.rejected_count) === 1 ? "" : "es"}
                      {a.rejected_count > 0 && a.awarded_count > 0 && (
                        <span className="text-xs text-muted-foreground font-normal ml-2">
                          · {a.rejected_count} rechazada{a.rejected_count === 1 ? "" : "s"}
                        </span>
                      )}
                    </h3>
                    {a.approval_note && (
                      <p className="text-xs text-muted-foreground italic mt-0.5 truncate">
                        “{a.approval_note}”
                      </p>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {fmt(a.decided_at)}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground text-right">
        Mostrando las {entries.length} decisiones más recientes
        {filtered.length !== entries.length && ` · ${filtered.length} con filtros aplicados`}
      </p>

      {/* Modales de detalle */}
      {openOcId && (
        <OcHistoryDetail
          ocId={openOcId}
          onClose={() => setOpenOcId(null)}
        />
      )}
      {openAwardSc && (
        <AwardHistoryDetail
          requestId={openAwardSc.request_id}
          requestNumber={openAwardSc.request_number}
          onClose={() => setOpenAwardSc(null)}
        />
      )}
    </>
  );
}

/** Pills de filtro reutilizables. */
function FilterPills<T extends string>({
  options, value, onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex gap-1 border rounded-md p-0.5 bg-neutral-50">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            value === opt.key
              ? "bg-white shadow-sm font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

