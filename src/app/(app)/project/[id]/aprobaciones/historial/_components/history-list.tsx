"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2, XCircle, FileText, Scale,
  Search, Loader2, ArrowUp, ArrowDown, ArrowUpDown,
  History as HistoryIcon, Eye,
} from "lucide-react";
import { formatNumber } from "@/lib/utils/formula";
import { OcHistoryDetail } from "./oc-history-detail";
import { AwardHistoryDetail } from "./award-history-detail";
import { ColumnFilter, matchesColumnFilter } from "../../../compras/_components/column-filter";

/* ─────────────────────────── tipos de fila ─────────────────────────── */

interface OcDecision {
  id: string;
  number: string | null;
  issue_date: string | null;
  supplier: string | null;
  currency: string | null;
  approval_status: "approved" | "rejected" | null;
  approval_note: string | null;
  request_id: string | null;
  total: number | string;
  created_at: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  created_by_email: string | null;
  submitted_by_email: string | null;
}

interface AwardDecision {
  request_id: string;
  request_number: string | null;
  decided_at: string;
  approval_note: string | null;
  awarded_count: number;
  rejected_count: number;
  total_quotations: number;
  earliest_submitted_at: string | null;
  request_created_at: string | null;
}

/** Fila unificada de la tabla. */
type Row =
  | {
      kind: "oc";
      id: string;                // unique row id
      decided_at: string;
      type_label: string;
      doc_number: string;
      counterpart: string;       // proveedor
      status_label: string;      // 'Aprobada' | 'Rechazada'
      status_value: "approved" | "rejected";
      total: number;
      currency: string;
      note: string;
      raw: OcDecision;
    }
  | {
      kind: "award";
      id: string;
      decided_at: string;
      type_label: string;
      doc_number: string;
      counterpart: string;       // "N proveedores"
      status_label: string;
      status_value: "approved" | "rejected"; // approved = al menos 1 adjudicada
      total: number;             // cero, no aplica
      currency: string;          // ""
      note: string;
      raw: AwardDecision;
    };

type SortKey = "decided_at" | "type_label" | "doc_number" | "counterpart" | "status_label" | "total";
type SortDir = "asc" | "desc";

/* ─────────────────────────── componente ─────────────────────────── */

export function ApprovalHistoryList({ projectId }: { projectId: string }) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);

  // Filtros: búsqueda libre + por columna (estilo Excel)
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [counterpartFilter, setCounterpartFilter] = useState<Set<string>>(new Set());

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("decided_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Modales
  const [openOcId, setOpenOcId] = useState<string | null>(null);
  const [openAward, setOpenAward] = useState<{ requestId: string; number: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [ocRes, awardRes] = await Promise.all([
      supabase.rpc("list_my_oc_decisions", { p_project_id: projectId }),
      supabase.rpc("list_my_award_decisions", { p_project_id: projectId }),
    ]);

    const ocs = (ocRes.data as OcDecision[] | null) ?? [];
    const awards = (awardRes.data as AwardDecision[] | null) ?? [];

    const ocRows: Row[] = ocs.map((oc) => ({
      kind: "oc",
      id: `oc-${oc.id}`,
      decided_at: oc.decided_at ?? "",
      type_label: "OC",
      doc_number: oc.number ?? "—",
      counterpart: oc.supplier ?? "(sin proveedor)",
      status_label: oc.approval_status === "approved" ? "Aprobada" : "Rechazada",
      status_value: (oc.approval_status ?? "rejected") as "approved" | "rejected",
      total: Number(oc.total ?? 0),
      currency: oc.currency ?? "",
      note: oc.approval_note ?? "",
      raw: oc,
    }));

    const awardRows: Row[] = awards.map((a) => ({
      kind: "award",
      id: `award-${a.request_id}`,
      decided_at: a.decided_at,
      type_label: "Adjudicación",
      doc_number: `SC ${a.request_number ?? "—"}`,
      counterpart: `${a.total_quotations} proveedor${a.total_quotations === 1 ? "" : "es"}`,
      status_label:
        a.awarded_count === 0
          ? "Todas rechazadas"
          : a.rejected_count === 0
            ? `${a.awarded_count} adjudicada${a.awarded_count === 1 ? "" : "s"}`
            : `${a.awarded_count} adj. / ${a.rejected_count} rech.`,
      status_value: a.awarded_count > 0 ? "approved" : "rejected",
      total: 0,
      currency: "",
      note: a.approval_note ?? "",
      raw: a,
    }));

    setRows([...ocRows, ...awardRows]);
    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => { load(); }, [load]);

  /* Valores únicos para los filtros de columna */
  const typeValues = useMemo(() => Array.from(new Set(rows.map((r) => r.type_label))), [rows]);
  const statusValues = useMemo(() => Array.from(new Set(rows.map((r) => r.status_label))), [rows]);
  const counterpartValues = useMemo(() => Array.from(new Set(rows.map((r) => r.counterpart))), [rows]);

  /* Filtrado + sort */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (!matchesColumnFilter(typeFilter, r.type_label)) return false;
      if (!matchesColumnFilter(statusFilter, r.status_label)) return false;
      if (!matchesColumnFilter(counterpartFilter, r.counterpart)) return false;
      if (q) {
        const hay = `${r.doc_number} ${r.counterpart} ${r.note} ${r.type_label}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "es") * dir;
    });
  }, [rows, search, typeFilter, statusFilter, counterpartFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "decided_at" || key === "total" ? "desc" : "asc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />;
    return sortDir === "asc"
      ? <ArrowUp className="h-3 w-3 text-[#E87722]" />
      : <ArrowDown className="h-3 w-3 text-[#E87722]" />;
  }

  function fmt(when: string | null) {
    if (!when) return "—";
    const d = new Date(when);
    return (
      d.toLocaleDateString() +
      " · " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  }

  function openRow(r: Row) {
    if (r.kind === "oc") setOpenOcId(r.raw.id);
    else setOpenAward({ requestId: r.raw.request_id, number: r.raw.request_number });
  }

  /* ─────────────────────────── render ─────────────────────────── */

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

  if (rows.length === 0) {
    return (
      <Card className="text-center py-16">
        <CardContent>
          <HistoryIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-1">Sin decisiones aún</h3>
          <p className="text-muted-foreground text-sm">
            Cuando apruebes OCs o adjudiques cotizaciones, aparecerán acá.
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasActiveFilter =
    typeFilter.size > 0 || statusFilter.size > 0 || counterpartFilter.size > 0 || search.trim().length > 0;

  return (
    <>
      {/* Búsqueda libre y total visible */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[280px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar por número, proveedor, comentario…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {visible.length} de {rows.length}
          {hasActiveFilter && " · con filtros aplicados"}
        </p>
        {hasActiveFilter && (
          <button
            className="text-xs text-[#E87722] hover:underline"
            onClick={() => {
              setSearch("");
              setTypeFilter(new Set());
              setStatusFilter(new Set());
              setCounterpartFilter(new Set());
            }}
          >
            Limpiar todos los filtros
          </button>
        )}
      </div>

      {/* Tabla */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-neutral-100 border-b">
            <tr className="text-left">
              <th className="px-3 py-2 font-semibold w-[160px]">
                <button
                  className="inline-flex items-center gap-1 hover:text-[#E87722]"
                  onClick={() => toggleSort("decided_at")}
                >
                  Fecha de decisión {sortIndicator("decided_at")}
                </button>
              </th>
              <th className="px-3 py-2 font-semibold w-[130px]">
                <div className="inline-flex items-center gap-1">
                  <button
                    className="inline-flex items-center gap-1 hover:text-[#E87722]"
                    onClick={() => toggleSort("type_label")}
                  >
                    Tipo {sortIndicator("type_label")}
                  </button>
                  <ColumnFilter
                    label=""
                    values={typeValues}
                    selected={typeFilter}
                    onChange={setTypeFilter}
                  />
                </div>
              </th>
              <th className="px-3 py-2 font-semibold w-[130px]">
                <button
                  className="inline-flex items-center gap-1 hover:text-[#E87722]"
                  onClick={() => toggleSort("doc_number")}
                >
                  Documento {sortIndicator("doc_number")}
                </button>
              </th>
              <th className="px-3 py-2 font-semibold">
                <div className="inline-flex items-center gap-1">
                  <button
                    className="inline-flex items-center gap-1 hover:text-[#E87722]"
                    onClick={() => toggleSort("counterpart")}
                  >
                    Proveedor / Cotizaciones {sortIndicator("counterpart")}
                  </button>
                  <ColumnFilter
                    label=""
                    values={counterpartValues}
                    selected={counterpartFilter}
                    onChange={setCounterpartFilter}
                  />
                </div>
              </th>
              <th className="px-3 py-2 font-semibold w-[170px]">
                <div className="inline-flex items-center gap-1">
                  <button
                    className="inline-flex items-center gap-1 hover:text-[#E87722]"
                    onClick={() => toggleSort("status_label")}
                  >
                    Estado {sortIndicator("status_label")}
                  </button>
                  <ColumnFilter
                    label=""
                    values={statusValues}
                    selected={statusFilter}
                    onChange={setStatusFilter}
                  />
                </div>
              </th>
              <th className="px-3 py-2 font-semibold text-right w-[130px]">
                <button
                  className="inline-flex items-center gap-1 hover:text-[#E87722]"
                  onClick={() => toggleSort("total")}
                >
                  Total {sortIndicator("total")}
                </button>
              </th>
              <th className="px-3 py-2 font-semibold">Comentario</th>
              <th className="px-2 py-2 w-[60px]"></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground italic">
                  Sin resultados con los filtros actuales.
                </td>
              </tr>
            ) : visible.map((r) => {
              const Icon = r.kind === "oc" ? FileText : Scale;
              const isApproved = r.status_value === "approved";
              return (
                <tr
                  key={r.id}
                  className="border-t hover:bg-[#E87722]/5 cursor-pointer"
                  onClick={() => openRow(r)}
                >
                  <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">
                    {fmt(r.decided_at)}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
                      <Icon className={`h-3 w-3 ${r.kind === "oc" ? "text-neutral-600" : "text-[#E87722]"}`} />
                      {r.type_label}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono">{r.doc_number}</td>
                  <td className="px-3 py-2 truncate max-w-[280px]">{r.counterpart}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider ${
                      isApproved ? "text-emerald-700" : "text-red-700"
                    }`}>
                      {isApproved
                        ? <CheckCircle2 className="h-3 w-3" />
                        : <XCircle className="h-3 w-3" />}
                      {r.status_label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.total > 0
                      ? <>{formatNumber(r.total, 0)} <span className="text-muted-foreground">{r.currency}</span></>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground italic truncate max-w-[260px]">
                    {r.note ? `“${r.note}”` : <span className="text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <Eye className="h-3.5 w-3.5 text-muted-foreground inline-block" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modales de detalle */}
      {openOcId && (
        <OcHistoryDetail
          ocId={openOcId}
          onClose={() => setOpenOcId(null)}
        />
      )}
      {openAward && (
        <AwardHistoryDetail
          requestId={openAward.requestId}
          requestNumber={openAward.number}
          onClose={() => setOpenAward(null)}
        />
      )}
    </>
  );
}
