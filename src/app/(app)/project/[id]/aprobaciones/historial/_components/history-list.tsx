"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2, XCircle, FileText, Scale,
  Search, Loader2, ArrowUp, ArrowDown, ArrowUpDown,
  History as HistoryIcon, Eye, Building, Link2,
  TrendingUp,
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
  request_number: string | null;
  total: number | string;
  total_usd: number | string;
  total_local: number | string;
  local_currency: string;
  exchange_rate: number | string;
  decided_at: string | null;
}

interface AwardDecision {
  request_id: string;
  request_number: string | null;
  decided_at: string;
  approval_note: string | null;
  awarded_count: number;
  rejected_count: number;
  total_quotations: number;
}

/** Una fila de la tabla representa una decisión específica:
 *   - una OC aprobada/rechazada (puede haber venido de adjudicación o ser directa)
 *   - o una adjudicación donde TODO se rechazó (no generó OC pero es una decisión registrada) */
type Row =
  | {
      kind: "oc";
      id: string;
      decided_at: string;
      origin: string;          // 'OC directa' | 'Adj. SC-XXXX'
      origin_request_id: string | null; // si viene de adjudicación, la SC origen
      doc_number: string;       // 'OC-XXXX'
      supplier: string;
      status_label: string;
      status_value: "approved" | "rejected";
      total_usd: number;
      total_local: number;
      local_currency: string;
      orig_currency: string;
      note: string;
      raw: OcDecision;
    }
  | {
      kind: "rejected_award";
      id: string;
      decided_at: string;
      origin: string;          // 'Adj. SC-XXXX'
      origin_request_id: string;
      doc_number: string;       // 'SC-XXXX'
      supplier: string;         // 'N cotizaciones rechazadas'
      status_label: string;
      status_value: "rejected";
      total_usd: number;
      total_local: number;
      local_currency: string;
      orig_currency: string;
      note: string;
      raw: AwardDecision;
    };

type SortKey =
  | "decided_at" | "origin" | "doc_number" | "supplier"
  | "status_label" | "total_usd" | "total_local";
type SortDir = "asc" | "desc";

/* ─────────────────────────── componente ─────────────────────────── */

export function ApprovalHistoryList({ projectId }: { projectId: string }) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [localCurrency, setLocalCurrency] = useState<string>("LOCAL");

  // Filtros
  const [search, setSearch] = useState("");
  const [originFilter, setOriginFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [supplierFilter, setSupplierFilter] = useState<Set<string>>(new Set());

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

    const cur = ocs[0]?.local_currency ?? "LOCAL";
    setLocalCurrency(cur);

    const ocRows: Row[] = ocs.map((oc) => ({
      kind: "oc",
      id: `oc-${oc.id}`,
      decided_at: oc.decided_at ?? "",
      origin: oc.request_number ? `Adj. SC-${oc.request_number}` : "OC directa",
      origin_request_id: oc.request_id,
      doc_number: oc.number ?? "—",
      supplier: oc.supplier ?? "(sin proveedor)",
      status_label: oc.approval_status === "approved" ? "Aprobada" : "Rechazada",
      status_value: (oc.approval_status ?? "rejected") as "approved" | "rejected",
      total_usd: Number(oc.total_usd ?? 0),
      total_local: Number(oc.total_local ?? 0),
      local_currency: oc.local_currency ?? "LOCAL",
      orig_currency: oc.currency ?? "",
      note: oc.approval_note ?? "",
      raw: oc,
    }));

    // Adjudicaciones donde TODO fue rechazado: no generan OCs, pero son una
    // decisión que el aprobador firmó. Las mostramos como su propia fila.
    // Las que sí generaron OCs no las incluimos acá: cada OC ya está en ocRows.
    const rejectedAwardRows: Row[] = awards
      .filter((a) => a.awarded_count === 0)
      .map((a) => ({
        kind: "rejected_award",
        id: `award-${a.request_id}`,
        decided_at: a.decided_at,
        origin: `Adj. SC-${a.request_number ?? "—"}`,
        origin_request_id: a.request_id,
        doc_number: `SC-${a.request_number ?? "—"}`,
        supplier: `${a.total_quotations} cotización${a.total_quotations === 1 ? "" : "es"} rechazada${a.total_quotations === 1 ? "" : "s"}`,
        status_label: "Todas rechazadas",
        status_value: "rejected",
        total_usd: 0,
        total_local: 0,
        local_currency: cur,
        orig_currency: "",
        note: a.approval_note ?? "",
        raw: a,
      }));

    setRows([...ocRows, ...rejectedAwardRows]);
    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => { load(); }, [load]);

  /* Totales aprobados (excluyendo rechazados) */
  const totals = useMemo(() => {
    let usd = 0;
    let local = 0;
    for (const r of rows) {
      if (r.status_value !== "approved") continue;
      usd += r.total_usd;
      local += r.total_local;
    }
    return { usd, local };
  }, [rows]);

  /* Valores únicos para los filtros de columna */
  const originValues = useMemo(() => Array.from(new Set(rows.map((r) => r.origin))), [rows]);
  const statusValues = useMemo(() => Array.from(new Set(rows.map((r) => r.status_label))), [rows]);
  const supplierValues = useMemo(() => Array.from(new Set(rows.map((r) => r.supplier))), [rows]);

  /* Filtrado + sort */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (!matchesColumnFilter(originFilter, r.origin)) return false;
      if (!matchesColumnFilter(statusFilter, r.status_label)) return false;
      if (!matchesColumnFilter(supplierFilter, r.supplier)) return false;
      if (q) {
        const hay = `${r.doc_number} ${r.supplier} ${r.note} ${r.origin}`.toLowerCase();
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
  }, [rows, search, originFilter, statusFilter, supplierFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "decided_at" || key === "total_usd" || key === "total_local" ? "desc" : "asc");
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
    return d.toLocaleDateString() + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function openOriginAward(requestId: string, number: string | null, e?: React.MouseEvent) {
    e?.stopPropagation();
    setOpenAward({ requestId, number });
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
    originFilter.size > 0 || statusFilter.size > 0 || supplierFilter.size > 0 || search.trim().length > 0;
  const filteredTotals = visible.reduce(
    (acc, r) => {
      if (r.status_value === "approved") {
        acc.usd += r.total_usd;
        acc.local += r.total_local;
      }
      return acc;
    },
    { usd: 0, local: 0 }
  );

  return (
    <>
      {/* Cards de totales */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">
                  Total aprobado · USD
                </p>
                <p className="text-2xl font-bold text-emerald-900 font-mono mt-1">
                  {formatNumber(totals.usd, 0)}
                  <span className="text-sm text-emerald-700 ml-1 font-normal">USD</span>
                </p>
                {hasActiveFilter && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Con filtros: {formatNumber(filteredTotals.usd, 0)} USD
                  </p>
                )}
              </div>
              <TrendingUp className="h-8 w-8 text-emerald-300" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">
                  Total aprobado · {localCurrency}
                </p>
                <p className="text-2xl font-bold text-emerald-900 font-mono mt-1">
                  {formatNumber(totals.local, 0)}
                  <span className="text-sm text-emerald-700 ml-1 font-normal">{localCurrency}</span>
                </p>
                {hasActiveFilter && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Con filtros: {formatNumber(filteredTotals.local, 0)} {localCurrency}
                  </p>
                )}
              </div>
              <TrendingUp className="h-8 w-8 text-emerald-300" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Búsqueda + status global */}
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
          {hasActiveFilter && " · con filtros"}
        </p>
        {hasActiveFilter && (
          <button
            className="text-xs text-[#E87722] hover:underline"
            onClick={() => {
              setSearch("");
              setOriginFilter(new Set());
              setStatusFilter(new Set());
              setSupplierFilter(new Set());
            }}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Tabla */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-neutral-100 border-b">
            <tr className="text-left">
              <th className="px-3 py-2 font-semibold w-[150px]">
                <button className="inline-flex items-center gap-1 hover:text-[#E87722]" onClick={() => toggleSort("decided_at")}>
                  Fecha {sortIndicator("decided_at")}
                </button>
              </th>
              <th className="px-3 py-2 font-semibold w-[140px]">
                <div className="inline-flex items-center gap-1">
                  <button className="inline-flex items-center gap-1 hover:text-[#E87722]" onClick={() => toggleSort("origin")}>
                    Origen {sortIndicator("origin")}
                  </button>
                  <ColumnFilter label="" values={originValues} selected={originFilter} onChange={setOriginFilter} />
                </div>
              </th>
              <th className="px-3 py-2 font-semibold w-[120px]">
                <button className="inline-flex items-center gap-1 hover:text-[#E87722]" onClick={() => toggleSort("doc_number")}>
                  Documento {sortIndicator("doc_number")}
                </button>
              </th>
              <th className="px-3 py-2 font-semibold">
                <div className="inline-flex items-center gap-1">
                  <button className="inline-flex items-center gap-1 hover:text-[#E87722]" onClick={() => toggleSort("supplier")}>
                    Proveedor {sortIndicator("supplier")}
                  </button>
                  <ColumnFilter label="" values={supplierValues} selected={supplierFilter} onChange={setSupplierFilter} />
                </div>
              </th>
              <th className="px-3 py-2 font-semibold w-[150px]">
                <div className="inline-flex items-center gap-1">
                  <button className="inline-flex items-center gap-1 hover:text-[#E87722]" onClick={() => toggleSort("status_label")}>
                    Estado {sortIndicator("status_label")}
                  </button>
                  <ColumnFilter label="" values={statusValues} selected={statusFilter} onChange={setStatusFilter} />
                </div>
              </th>
              <th className="px-3 py-2 font-semibold text-right w-[120px]">
                <button className="inline-flex items-center gap-1 hover:text-[#E87722] ml-auto" onClick={() => toggleSort("total_usd")}>
                  USD {sortIndicator("total_usd")}
                </button>
              </th>
              <th className="px-3 py-2 font-semibold text-right w-[140px]">
                <button className="inline-flex items-center gap-1 hover:text-[#E87722] ml-auto" onClick={() => toggleSort("total_local")}>
                  {localCurrency} {sortIndicator("total_local")}
                </button>
              </th>
              <th className="px-2 py-2 w-[40px]"></th>
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
              const isApproved = r.status_value === "approved";
              const fromAward = r.kind === "oc" && r.origin_request_id;
              const isAward = r.kind === "rejected_award";
              const Icon = isAward ? Scale : FileText;
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
                    {fromAward || isAward ? (
                      <button
                        onClick={(e) => openOriginAward(
                          r.kind === "oc" ? r.origin_request_id! : r.origin_request_id,
                          r.kind === "oc" ? r.raw.request_number : r.raw.request_number,
                          e
                        )}
                        className="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#E87722]/10 text-[#E87722] hover:bg-[#E87722]/20 hover:underline"
                        title="Ver detalle de la adjudicación"
                      >
                        <Link2 className="h-3 w-3" />
                        {r.origin}
                      </button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">{r.origin}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 font-mono">
                      <Icon className={`h-3 w-3 ${isAward ? "text-[#E87722]" : "text-neutral-600"}`} />
                      {r.doc_number}
                    </span>
                  </td>
                  <td className="px-3 py-2 truncate max-w-[260px]">
                    <span className="inline-flex items-center gap-1">
                      {r.kind === "oc" && <Building className="h-3 w-3 text-muted-foreground shrink-0" />}
                      <span className={isAward ? "italic text-muted-foreground" : ""}>{r.supplier}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider ${
                      isApproved ? "text-emerald-700" : "text-red-700"
                    }`}>
                      {isApproved ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {r.status_label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.total_usd > 0 ? (
                      <span className={isApproved ? "" : "line-through text-muted-foreground"}>
                        {formatNumber(r.total_usd, 0)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.total_local > 0 ? (
                      <span className={isApproved ? "" : "line-through text-muted-foreground"}>
                        {formatNumber(r.total_local, 0)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <Eye className="h-3.5 w-3.5 text-muted-foreground inline-block" />
                  </td>
                </tr>
              );
            })}
            {/* Footer con totales filtrados */}
            {visible.length > 0 && (
              <tr className="border-t-2 border-neutral-900 bg-neutral-50 font-bold">
                <td colSpan={5} className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                  Total aprobado {hasActiveFilter ? "(filtrado)" : ""}
                </td>
                <td className="px-3 py-2 text-right font-mono text-emerald-800">
                  {formatNumber(filteredTotals.usd, 0)} USD
                </td>
                <td className="px-3 py-2 text-right font-mono text-emerald-800">
                  {formatNumber(filteredTotals.local, 0)} {localCurrency}
                </td>
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modales de detalle */}
      {openOcId && (
        <OcHistoryDetail ocId={openOcId} onClose={() => setOpenOcId(null)} />
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
