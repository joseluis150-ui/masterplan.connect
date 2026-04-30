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
import { CheckCircle2, XCircle, Mail, Calendar, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";

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

interface OCLine {
  id: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total: number | null;
}

export function ApprovalQueue({
  projectId,
  initialPending,
}: {
  projectId: string;
  initialPending: PendingOC[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const [pending, setPending] = useState<PendingOC[]>(initialPending);
  const [selected, setSelected] = useState<PendingOC | null>(null);
  const [lines, setLines] = useState<OCLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [decisionMode, setDecisionMode] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function openDetail(oc: PendingOC) {
    setSelected(oc);
    setDecisionMode(null);
    setNote("");
    setLoadingLines(true);
    const { data } = await supabase
      .from("purchase_order_lines")
      .select("id, description, quantity, unit, unit_price, total")
      .eq("order_id", oc.id);
    setLines((data ?? []) as OCLine[]);
    setLoadingLines(false);
  }

  async function decide(decision: "approve" | "reject") {
    if (!selected) return;
    if (decision === "reject" && !note.trim()) {
      toast.error("Para rechazar, ingresá un motivo en el comentario");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc("decide_oc_approval", {
      p_oc_id: selected.id,
      p_decision: decision,
      p_note: note.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(decision === "approve" ? "OC aprobada" : "OC rechazada");
    setPending((prev) => prev.filter((p) => p.id !== selected.id));
    setSelected(null);
    setDecisionMode(null);
    setNote("");
    router.refresh(); // refresca el badge del sidebar
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

  if (pending.length === 0) {
    return (
      <Card className="text-center py-16">
        <CardContent>
          <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-500 mb-4" />
          <h3 className="text-lg font-medium mb-1">Todo al día</h3>
          <p className="text-muted-foreground text-sm">
            No tenés órdenes de compra pendientes de aprobar.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {pending.map((oc) => {
          const total = Number(oc.total ?? 0);
          return (
            <Card
              key={oc.id}
              className="cursor-pointer hover:border-[#E87722]/40 transition-colors"
              onClick={() => openDetail(oc)}
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

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setDecisionMode(null); } }}>
        <DialogContent className="sm:max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-[#E87722]" />
                  OC #{selected.number ?? "—"} · {selected.supplier_name ?? ""}
                </DialogTitle>
                <DialogDescription>
                  Enviada por {selected.submitted_by_email ?? "—"} · {fmtRel(selected.submitted_at)}
                </DialogDescription>
              </DialogHeader>

              {/* Líneas de la OC */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Detalle ({lines.length} ítems)
                </h4>
                {loadingLines ? (
                  <p className="text-sm text-muted-foreground py-3">Cargando…</p>
                ) : lines.length === 0 ? (
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
                          <td colSpan={4} className="px-3 py-2 text-right text-xs uppercase tracking-wider text-white">Total</td>
                          <td className="px-3 py-2 text-right font-mono" style={{ color: "#E87722" }}>
                            {formatNumber(Number(selected.total ?? 0), 0)} {selected.currency}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Comentario y botones */}
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
                      onClick={() => decide(decisionMode)}
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
    </>
  );
}
