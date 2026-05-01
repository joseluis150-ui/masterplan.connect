"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Scale, Paperclip, Download, Loader2, Building, FileText,
  CheckCircle2, XCircle, Clock,
} from "lucide-react";
import { formatNumber } from "@/lib/utils/formula";
import { toast } from "sonner";
import { ApprovalTimeline } from "./approval-timeline";

interface RequestLineRow {
  id: string;
  description: string;
  quantity: number;
  unit: string;
}

interface QuotationRow {
  id: string;
  number: string;
  supplier_id: string | null;
  supplier_name_legacy: string | null;
  currency: string;
  status: "awarded" | "rejected";
  decided_at: string | null;
  approval_note: string | null;
  has_advance: boolean | null;
  advance_amount: number | null;
  advance_type: string | null;
  retention_pct: number | null;
  payment_terms_type: string | null;
  credit_days: number | null;
  payment_notes: string | null;
  valid_until: string | null;
  justification: string | null;
  supplier_name?: string | null;
}

interface QuotationLineRow {
  id: string;
  quotation_id: string;
  request_line_id: string;
  unit_price: number | null;
  awarded: boolean | null;
}

interface QuotationAttachment {
  id: string;
  quotation_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string | null;
}

/**
 * Modal de consulta de una adjudicación pasada. Muestra el cuadro comparativo
 * con los precios finales, marca claramente qué cotización ganó cada línea, y
 * lista los adjuntos de cada cotización con descarga via signed URL (el bucket
 * `quotation-attachments` es privado).
 */
export function AwardHistoryDetail({
  requestId,
  requestNumber,
  onClose,
}: {
  requestId: string;
  requestNumber: string | null;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [requestLines, setRequestLines] = useState<RequestLineRow[]>([]);
  const [quotations, setQuotations] = useState<QuotationRow[]>([]);
  const [quotationLines, setQuotationLines] = useState<QuotationLineRow[]>([]);
  const [attachments, setAttachments] = useState<QuotationAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [rlRes, qRes, qlRes] = await Promise.all([
      supabase.from("purchase_request_lines").select("id, description, quantity, unit").eq("request_id", requestId).order("created_at"),
      supabase
        .from("quotations")
        .select(`
          id, number, supplier_id, supplier_name_legacy, currency, status,
          decided_at, approval_note, has_advance, advance_amount, advance_type,
          retention_pct, payment_terms_type, credit_days, payment_notes,
          valid_until, justification,
          supplier:suppliers(name)
        `)
        .eq("request_id", requestId)
        .in("status", ["awarded", "rejected"])
        .order("created_at"),
      supabase
        .from("quotation_lines")
        .select("*, quotation:quotations!inner(request_id, status)")
        .eq("quotation.request_id", requestId)
        .in("quotation.status", ["awarded", "rejected"]),
    ]);

    setRequestLines((rlRes.data ?? []) as RequestLineRow[]);

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

    // Adjuntos de TODAS las cotizaciones de esta SC
    const qIds = qs.map((q) => q.id);
    if (qIds.length > 0) {
      const { data: aRes } = await supabase
        .from("quotation_attachments")
        .select("id, quotation_id, file_name, storage_path, mime_type, size_bytes, uploaded_at")
        .in("quotation_id", qIds)
        .order("uploaded_at", { ascending: false });
      setAttachments((aRes ?? []) as QuotationAttachment[]);
    }

    setLoading(false);
  }, [requestId, supabase]);

  useEffect(() => { load(); }, [load]);

  /** Bucket privado → necesitamos signed URL para abrir. Generamos al click. */
  async function downloadAttachment(att: QuotationAttachment) {
    setDownloadingId(att.id);
    const { data, error } = await supabase
      .storage
      .from("quotation-attachments")
      .createSignedUrl(att.storage_path, 60); // 60s para abrir / descargar
    setDownloadingId(null);
    if (error || !data?.signedUrl) {
      toast.error(error?.message || "No se pudo generar el link");
      return;
    }
    // Abrimos en nueva pestaña — el browser maneja preview/download según mime
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function priceFor(quotationId: string, requestLineId: string): number | null {
    const ql = quotationLines.find(
      (x) => x.quotation_id === quotationId && x.request_line_id === requestLineId
    );
    return ql?.unit_price ?? null;
  }

  function isLineAwardedTo(quotationId: string, requestLineId: string): boolean {
    const ql = quotationLines.find(
      (x) => x.quotation_id === quotationId && x.request_line_id === requestLineId
    );
    return !!ql?.awarded;
  }

  function awardedTotalFor(quotationId: string): number {
    let s = 0;
    for (const line of requestLines) {
      if (!isLineAwardedTo(quotationId, line.id)) continue;
      const p = priceFor(quotationId, line.id) ?? 0;
      s += p * Number(line.quantity || 0);
    }
    return s;
  }

  function fmt(when: string | null) {
    if (!when) return "—";
    const d = new Date(when);
    return d.toLocaleDateString() + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function fmtBytes(b: number | null) {
    if (!b) return "";
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }

  // Decisión "global" de la adjudicación — agarro el decided_at/note de
  // cualquier cotización (todas tienen el mismo).
  const globalDecision = quotations[0];
  const winners = quotations.filter((q) => q.status === "awarded");

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[1300px] max-h-[92vh] overflow-y-auto">
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 mx-auto animate-spin mb-2" />
            Cargando…
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-[#E87722]" />
                Adjudicación · SC {requestNumber ?? "—"}
                {winners.length > 0 ? (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-200">
                    {winners.length} adjudicada{winners.length === 1 ? "" : "s"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-red-50 text-red-800 border-red-200">
                    Todas rechazadas
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription>
                {quotations.length} cotización{quotations.length === 1 ? "" : "es"} · decidida{" "}
                {fmt(globalDecision?.decided_at ?? null)}
              </DialogDescription>
            </DialogHeader>

            {/* Comentario global */}
            {globalDecision?.approval_note && (
              <div className="border rounded-md p-3 text-xs bg-emerald-50/40 border-emerald-200">
                <p className="font-semibold uppercase tracking-wider text-[10px] mb-1">
                  Comentario de la decisión
                </p>
                <p className="italic">“{globalDecision.approval_note}”</p>
              </div>
            )}

            {/* Cuadro comparativo histórico */}
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="text-left px-2 py-2 font-semibold sticky left-0 bg-neutral-100 z-20 min-w-[260px]">Ítem</th>
                    <th className="text-right px-2 py-2 font-semibold w-[70px]">Cant.</th>
                    <th className="text-center px-2 py-2 font-semibold w-[50px]">Un.</th>
                    {quotations.map((q) => {
                      const isWinner = q.status === "awarded";
                      return (
                        <th
                          key={q.id}
                          className={`text-center px-2 py-2 font-semibold border-l-2 border-neutral-300 min-w-[140px] ${
                            isWinner ? "bg-emerald-100" : "bg-red-50"
                          }`}
                        >
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-[10px] text-muted-foreground font-mono">{q.number}</span>
                            <span className="truncate max-w-[160px] inline-flex items-center gap-1">
                              <Building className="h-3 w-3 shrink-0" />
                              {q.supplier_name ?? "(sin proveedor)"}
                            </span>
                            <span className="text-[10px] font-normal text-muted-foreground">{q.currency}</span>
                            {isWinner ? (
                              <span className="text-[10px] font-bold text-emerald-700 inline-flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                Adjudicada · {formatNumber(awardedTotalFor(q.id), 0)}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-red-700 inline-flex items-center gap-1">
                                <XCircle className="h-3 w-3" />
                                Rechazada
                              </span>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {requestLines.map((line) => (
                    <tr key={line.id} className="border-t">
                      <td className="px-2 py-1 align-top sticky left-0 bg-white z-10">
                        <p className="font-medium leading-snug">{line.description}</p>
                      </td>
                      <td className="px-2 py-1 text-right font-mono">{formatNumber(line.quantity)}</td>
                      <td className="px-2 py-1 text-center text-muted-foreground">{line.unit}</td>
                      {quotations.map((q) => {
                        const p = priceFor(q.id, line.id);
                        const subtotal = (p ?? 0) * Number(line.quantity || 0);
                        const won = isLineAwardedTo(q.id, line.id);
                        return (
                          <td
                            key={q.id}
                            className={`px-2 py-1 border-l-2 border-neutral-200 text-center align-middle ${
                              won ? "bg-emerald-50 ring-1 ring-emerald-300" : ""
                            }`}
                          >
                            {p == null ? (
                              <span className="text-muted-foreground italic text-[11px]">—</span>
                            ) : (
                              <div className="flex flex-col items-center">
                                <span className={`font-mono text-[11px] ${won ? "font-bold text-emerald-800" : ""}`}>
                                  {formatNumber(p, 2)}
                                </span>
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  = {formatNumber(subtotal, 0)}
                                </span>
                                {won && (
                                  <span className="text-[9px] text-emerald-700 font-semibold uppercase tracking-wider inline-flex items-center gap-0.5">
                                    <CheckCircle2 className="h-2.5 w-2.5" />
                                    Ganadora
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Condiciones de las adjudicadas */}
            {winners.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Condiciones · cotización{winners.length === 1 ? "" : "es"} adjudicada{winners.length === 1 ? "" : "s"}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {winners.map((q) => (
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

            {/* Adjuntos por cotización */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
                <Paperclip className="h-3 w-3" />
                Adjuntos ({attachments.length})
              </h4>
              {attachments.length === 0 ? (
                <p className="text-xs italic text-muted-foreground py-2">
                  No hay archivos adjuntos en estas cotizaciones.
                </p>
              ) : (
                <div className="space-y-3">
                  {quotations.map((q) => {
                    const qAtts = attachments.filter((a) => a.quotation_id === q.id);
                    if (qAtts.length === 0) return null;
                    const isWinner = q.status === "awarded";
                    return (
                      <div key={q.id} className="border rounded-md">
                        <div className={`px-3 py-2 text-[11px] font-semibold inline-flex items-center gap-2 ${
                          isWinner ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"
                        } w-full`}>
                          <Building className="h-3 w-3" />
                          {q.supplier_name ?? "(sin proveedor)"}
                          <span className="font-mono text-muted-foreground">· {q.number}</span>
                          <span className={`text-[10px] uppercase tracking-wider ml-auto ${
                            isWinner ? "text-emerald-700" : "text-red-700"
                          }`}>
                            {isWinner ? "adjudicada" : "rechazada"}
                          </span>
                        </div>
                        <ul className="divide-y">
                          {qAtts.map((a) => (
                            <li key={a.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="truncate font-medium">{a.file_name}</p>
                                <p className="text-[10px] text-muted-foreground">
                                  {fmtBytes(a.size_bytes)}
                                  {a.uploaded_at && ` · subido ${new Date(a.uploaded_at).toLocaleDateString()}`}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2"
                                onClick={() => downloadAttachment(a)}
                                disabled={downloadingId === a.id}
                              >
                                {downloadingId === a.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <><Download className="h-3.5 w-3.5 mr-1" /> Abrir</>
                                )}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Timeline del proceso de adjudicación */}
            <div className="space-y-2 pt-2 border-t">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Línea de tiempo del proceso
              </h4>
              <ApprovalTimeline type="award" refId={requestId} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
