"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  FileText, CheckCircle2, XCircle, Paperclip, Download, Loader2, Building,
} from "lucide-react";
import { formatNumber } from "@/lib/utils/formula";

interface OcRow {
  id: string;
  number: string | null;
  issue_date: string | null;
  supplier: string | null;
  currency: string | null;
  approval_status: "approved" | "rejected" | null;
  decided_at: string | null;
  approval_note: string | null;
  submitted_at: string | null;
  comment: string | null;
}

interface OcLineRow {
  id: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total: number | null;
}

interface OcAttachment {
  id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  url: string;
  uploaded_at: string | null;
}

/**
 * Modal de consulta read-only para una OC ya decidida. Muestra los datos
 * principales, las líneas, la decisión (aprobada/rechazada + comentario) y
 * los adjuntos guardados en `purchase_attachments`.
 */
export function OcHistoryDetail({
  ocId,
  onClose,
}: {
  ocId: string;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [oc, setOc] = useState<OcRow | null>(null);
  const [lines, setLines] = useState<OcLineRow[]>([]);
  const [attachments, setAttachments] = useState<OcAttachment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [ocRes, linesRes, attRes] = await Promise.all([
      supabase
        .from("purchase_orders")
        .select("id, number, issue_date, supplier, currency, approval_status, decided_at, approval_note, submitted_at, comment")
        .eq("id", ocId)
        .single(),
      supabase
        .from("purchase_order_lines")
        .select("id, description, quantity, unit, unit_price, total")
        .eq("order_id", ocId),
      // Adjuntos del módulo compras: document_type='purchase_order' o 'oc' — la
      // app guarda con varios tags; consultamos ambos para no perder ninguno.
      supabase
        .from("purchase_attachments")
        .select("id, file_name, file_type, file_size, url, uploaded_at")
        .eq("document_id", ocId)
        .order("uploaded_at", { ascending: false }),
    ]);
    if (ocRes.data) setOc(ocRes.data as OcRow);
    setLines((linesRes.data ?? []) as OcLineRow[]);
    setAttachments((attRes.data ?? []) as OcAttachment[]);
    setLoading(false);
  }, [ocId, supabase]);

  useEffect(() => { load(); }, [load]);

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

  const total = lines.reduce((s, l) => s + Number(l.total ?? 0), 0);
  const isApproved = oc?.approval_status === "approved";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        {loading || !oc ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 mx-auto animate-spin mb-2" />
            Cargando…
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-[#E87722]" />
                OC #{oc.number ?? "—"}
                <Badge
                  variant="outline"
                  className={isApproved
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : "bg-red-50 text-red-800 border-red-200"
                  }
                >
                  {isApproved ? (
                    <><CheckCircle2 className="h-3 w-3 mr-1" /> Aprobada</>
                  ) : (
                    <><XCircle className="h-3 w-3 mr-1" /> Rechazada</>
                  )}
                </Badge>
              </DialogTitle>
              <DialogDescription className="inline-flex items-center gap-1">
                <Building className="h-3 w-3" />
                {oc.supplier ?? "(sin proveedor)"}
                {" · "}
                Emitida {oc.issue_date ? new Date(oc.issue_date).toLocaleDateString() : "—"}
              </DialogDescription>
            </DialogHeader>

            {/* Decisión registrada */}
            <div className={`border rounded-md p-3 text-xs space-y-1 ${
              isApproved ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
            }`}>
              <p className="font-semibold uppercase tracking-wider text-[10px]">
                Tu decisión · {fmt(oc.decided_at)}
              </p>
              {oc.approval_note ? (
                <p className="italic">“{oc.approval_note}”</p>
              ) : (
                <p className="italic text-muted-foreground">Sin comentario.</p>
              )}
              {oc.submitted_at && (
                <p className="text-[10px] text-muted-foreground pt-1">
                  Enviada a aprobación: {fmt(oc.submitted_at)}
                </p>
              )}
            </div>

            {/* Líneas */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Detalle ({lines.length} ítems)
              </h4>
              {lines.length === 0 ? (
                <p className="text-sm italic text-muted-foreground py-2">
                  Sin líneas cargadas.
                </p>
              ) : (
                <div className="border rounded-md overflow-hidden max-h-[280px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-neutral-100 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 uppercase tracking-wider font-semibold">Descripción</th>
                        <th className="text-right px-3 py-2 uppercase tracking-wider font-semibold w-[70px]">Cant.</th>
                        <th className="text-center px-3 py-2 uppercase tracking-wider font-semibold w-[50px]">Un.</th>
                        <th className="text-right px-3 py-2 uppercase tracking-wider font-semibold w-[90px]">P.U.</th>
                        <th className="text-right px-3 py-2 uppercase tracking-wider font-semibold w-[100px]">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.id} className="border-t">
                          <td className="px-3 py-1.5">{l.description ?? ""}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{formatNumber(Number(l.quantity ?? 0))}</td>
                          <td className="px-3 py-1.5 text-center text-muted-foreground">{l.unit ?? ""}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{formatNumber(Number(l.unit_price ?? 0), 0)}</td>
                          <td className="px-3 py-1.5 text-right font-mono font-semibold">{formatNumber(Number(l.total ?? 0), 0)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-neutral-900 bg-neutral-900 font-bold">
                        <td colSpan={4} className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-white">Total</td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: "#E87722" }}>
                          {formatNumber(total, 0)} {oc.currency}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Adjuntos */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
                <Paperclip className="h-3 w-3" />
                Adjuntos ({attachments.length})
              </h4>
              {attachments.length === 0 ? (
                <p className="text-xs italic text-muted-foreground py-2">
                  No hay archivos adjuntos en esta OC.
                </p>
              ) : (
                <ul className="border rounded-md divide-y">
                  {attachments.map((a) => (
                    <li key={a.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium">{a.file_name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {fmtBytes(a.file_size)}
                          {a.uploaded_at && ` · subido ${new Date(a.uploaded_at).toLocaleDateString()}`}
                        </p>
                      </div>
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={a.file_name}
                        className="h-7 px-2 inline-flex items-center text-xs font-medium rounded hover:bg-neutral-100 transition-colors"
                      >
                        <Download className="h-3.5 w-3.5 mr-1" />
                        Abrir
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
