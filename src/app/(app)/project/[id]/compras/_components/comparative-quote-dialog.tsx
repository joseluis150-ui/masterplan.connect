"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { CURRENCIES } from "@/lib/constants/units";
import {
  Plus,
  Trash2,
  Scale,
  Paperclip,
  Upload,
  FileText as FileIcon,
  Loader2,
  Building,
  AlertTriangle,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { formatNumber } from "@/lib/utils/formula";
import type {
  EdtSubcategory,
  Sector,
  Insumo,
  Supplier,
} from "@/lib/types/database";
import { InsumoPicker } from "./insumo-picker";

interface RequestRow {
  id: string;
  number: string;
  project_id: string;
  status: string;
}

interface RequestLine {
  id: string;
  request_id: string;
  subcategory_id: string | null;
  sector_id: string | null;
  insumo_id: string | null;
  description: string;
  quantity: number;
  unit: string;
}

interface Quotation {
  id: string;
  request_id: string;
  number: string;
  supplier_id: string | null;
  supplier_name_legacy: string | null;
  currency: string;
  payment_terms_type: string | null;
  credit_days: number | null;
  has_advance: boolean;
  advance_amount: number | null;
  advance_type: string | null;
  retention_pct: number | null;
  payment_notes: string | null;
  valid_until: string | null;
  justification: string | null;
  status: "draft" | "pending_approval" | "awarded" | "rejected" | "cancelled";
}

interface QuotationLine {
  id: string;
  quotation_id: string;
  request_line_id: string;
  unit_price: number | null;
  lead_time_days: number | null;
  awarded: boolean;
}

const PAYMENT_TYPES = [
  { value: "contado", label: "Contado" },
  { value: "credito", label: "Crédito" },
  { value: "contra_entrega", label: "Contra entrega" },
  { value: "segun_contrato", label: "Según contrato" },
];

export function ComparativeQuoteDialog({
  requestId,
  projectId,
  subcategories,
  sectors,
  insumos: insumosCatalog,
  suppliers,
  onClose,
}: {
  requestId: string;
  projectId: string;
  subcategories: EdtSubcategory[];
  sectors: Sector[];
  insumos: Insumo[];
  suppliers: Supplier[];
  onClose: () => void;
}) {
  const supabase = createClient();
  const [request, setRequest] = useState<RequestRow | null>(null);
  const [requestLines, setRequestLines] = useState<RequestLine[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [quotationLines, setQuotationLines] = useState<QuotationLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [rRes, rlRes, qRes, qlRes] = await Promise.all([
      supabase.from("purchase_requests").select("*").eq("id", requestId).single(),
      supabase.from("purchase_request_lines").select("*").eq("request_id", requestId).order("created_at"),
      supabase.from("quotations").select("*").eq("request_id", requestId).order("created_at"),
      supabase
        .from("quotation_lines")
        .select("*, quotation:quotations!inner(request_id)")
        .eq("quotation.request_id", requestId),
    ]);
    if (rRes.data) setRequest(rRes.data as RequestRow);
    let rlines = (rlRes.data ?? []) as RequestLine[];

    // Auto-vincular: si la línea NO tiene insumo_id pero su descripción matchea
    // (case-insensitive) con un insumo del catálogo, lo vinculamos automáticamente.
    // Útil para SCs creadas antes de que el modelo soportara insumo_id.
    const linesToAutoLink: { id: string; insumo_id: string; unit: string }[] = [];
    for (const line of rlines) {
      if (line.insumo_id) continue;
      if (!line.description) continue;
      const desc = line.description.trim().toLowerCase();
      const match = insumosCatalog.find((i) => i.description.trim().toLowerCase() === desc);
      if (match) linesToAutoLink.push({ id: line.id, insumo_id: match.id, unit: match.unit });
    }
    if (linesToAutoLink.length > 0) {
      // UPDATE en lote (uno por uno; pocos casos en la práctica)
      await Promise.all(linesToAutoLink.map((u) =>
        supabase.from("purchase_request_lines").update({ insumo_id: u.insumo_id, unit: u.unit }).eq("id", u.id)
      ));
      rlines = rlines.map((l) => {
        const u = linesToAutoLink.find((x) => x.id === l.id);
        return u ? { ...l, insumo_id: u.insumo_id, unit: u.unit } : l;
      });
    }

    setRequestLines(rlines);
    setQuotations((qRes.data ?? []) as Quotation[]);
    setQuotationLines((qlRes.data ?? []) as QuotationLine[]);
    setLoading(false);
  }, [requestId, supabase, insumosCatalog]);

  useEffect(() => { load(); }, [load]);

  /* ----------------------- LÍNEAS DE LA SC (editables) ---------------------- */
  async function updateRequestLine(id: string, patch: Partial<RequestLine>) {
    setRequestLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const { error } = await supabase.from("purchase_request_lines").update(patch).eq("id", id);
    if (error) toast.error(error.message);
  }

  /** Agregar una línea nueva a la SC. Se ofrece a todas las cotizaciones existentes
   * (la matriz crece automáticamente al agregarse en quotation_lines vacíos). */
  async function addRequestLine() {
    const { data: newLine, error } = await supabase
      .from("purchase_request_lines")
      .insert({
        request_id: requestId,
        description: "Nuevo ítem",
        quantity: 1,
        unit: "u",
      })
      .select()
      .single();
    if (error || !newLine) { toast.error(error?.message || "Error al agregar línea"); return; }
    setRequestLines((prev) => [...prev, newLine as RequestLine]);

    // Crear quotation_lines vacíos en cada cotización existente para que la
    // matriz quede consistente (la nueva línea aparece en todas las columnas).
    if (quotations.length > 0) {
      const inserts = quotations.map((q) => ({
        quotation_id: q.id,
        request_line_id: (newLine as RequestLine).id,
        unit_price: null,
      }));
      const { data: newQls } = await supabase.from("quotation_lines").insert(inserts).select();
      if (newQls) setQuotationLines((prev) => [...prev, ...(newQls as QuotationLine[])]);
    }
  }

  async function removeRequestLine(id: string) {
    if (!confirm("¿Eliminar este ítem de la cotización? Se borra también de la SC.")) return;
    const { error } = await supabase.from("purchase_request_lines").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setRequestLines((prev) => prev.filter((l) => l.id !== id));
    setQuotationLines((prev) => prev.filter((ql) => ql.request_line_id !== id));
  }

  /* ----------------------- COTIZACIONES (PROVEEDORES) ---------------------- */
  async function addQuotation() {
    const { data, error } = await supabase.rpc("create_quotation_from_request", {
      p_request_id: requestId,
      p_title: null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Cotización agregada");
    await load();
    if (data) {
      // marcar foco en la nueva
      setTimeout(() => {
        const el = document.getElementById(`quotation-${data}`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }

  async function updateQuotation(id: string, patch: Partial<Quotation>) {
    setQuotations((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
    const { error } = await supabase.from("quotations").update(patch).eq("id", id);
    if (error) toast.error(error.message);
  }

  async function removeQuotation(id: string) {
    if (!confirm("¿Eliminar esta cotización completa?")) return;
    const { error } = await supabase.from("quotations").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setQuotations((prev) => prev.filter((q) => q.id !== id));
    setQuotationLines((prev) => prev.filter((ql) => ql.quotation_id !== id));
  }

  async function setPrice(quotationId: string, requestLineId: string, unit_price: number | null) {
    const existing = quotationLines.find(
      (ql) => ql.quotation_id === quotationId && ql.request_line_id === requestLineId
    );
    if (existing) {
      setQuotationLines((prev) => prev.map((ql) => (ql.id === existing.id ? { ...ql, unit_price } : ql)));
      const { error } = await supabase.from("quotation_lines").update({ unit_price }).eq("id", existing.id);
      if (error) toast.error(error.message);
    } else {
      const { data, error } = await supabase
        .from("quotation_lines")
        .insert({ quotation_id: quotationId, request_line_id: requestLineId, unit_price })
        .select()
        .single();
      if (error) { toast.error(error.message); return; }
      setQuotationLines((prev) => [...prev, data as QuotationLine]);
    }
  }

  function priceFor(quotationId: string, requestLineId: string): number | null {
    const ql = quotationLines.find(
      (x) => x.quotation_id === quotationId && x.request_line_id === requestLineId
    );
    return ql?.unit_price ?? null;
  }

  function quotationTotal(quotationId: string): number {
    let sum = 0;
    for (const line of requestLines) {
      const p = priceFor(quotationId, line.id);
      if (p != null) sum += p * Number(line.quantity || 0);
    }
    return sum;
  }

  /* --------------------------- ENVIO A APROBACIÓN --------------------------- */
  async function submitToApproval() {
    if (quotations.length === 0) {
      toast.error("Agregá al menos una cotización antes de enviar a aprobación");
      return;
    }
    const linesMissingCC = requestLines.filter((l) => !l.subcategory_id || !l.sector_id);
    if (linesMissingCC.length > 0) {
      toast.error(`Faltan centro de costo o sector en ${linesMissingCC.length} línea(s)`);
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("quotations")
        .update({ status: "pending_approval", submitted_at: new Date().toISOString() })
        .in("id", quotations.map((q) => q.id));
      if (error) { toast.error(error.message); return; }
      toast.success("Cotización enviada a aprobación");
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  /* ------------------------------- RENDER ------------------------------- */
  const linesMissingCC = requestLines.filter((l) => !l.subcategory_id || !l.sector_id).length;
  const allLocked = quotations.every((q) => q.status !== "draft" && q.status !== "rejected");

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[1400px] max-h-[92vh] overflow-y-auto">
        {loading || !request ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Cargando…</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-[#E87722]" />
                Cuadro comparativo · {request.number}
              </DialogTitle>
              <DialogDescription>
                Cargá los precios que cotizó cada proveedor. Cada columna es una cotización. Cuando esté completo, enviá a aprobación.
              </DialogDescription>
            </DialogHeader>

            {/* Aviso si hay líneas sin centro de costo o sector */}
            {linesMissingCC > 0 && (
              <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-md border border-amber-200 bg-amber-50 text-amber-900">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Hay {linesMissingCC} {linesMissingCC === 1 ? "línea" : "líneas"} sin Centro de costo (subcategoría EDT) o Sector definido. Completalos antes de enviar a aprobación.
              </div>
            )}

            {/* CUADRO COMPARATIVO */}
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="text-left px-2 py-2 font-semibold sticky left-0 bg-neutral-100 z-10 min-w-[280px]">Ítem</th>
                    <th className="text-left px-2 py-2 font-semibold w-[150px]">Centro de costo *</th>
                    <th className="text-left px-2 py-2 font-semibold w-[110px]">Sector *</th>
                    <th className="text-right px-2 py-2 font-semibold w-[80px]">Cantidad</th>
                    <th className="text-center px-2 py-2 font-semibold w-[55px]">Unidad</th>
                    {quotations.map((q, idx) => {
                      const sup = q.supplier_id ? suppliers.find((s) => s.id === q.supplier_id) : null;
                      const supName = sup?.name || q.supplier_name_legacy || `Proveedor ${idx + 1}`;
                      return (
                        <th key={q.id} className="text-center px-2 py-2 font-semibold border-l-2 border-neutral-300 min-w-[140px]">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-[10px] text-muted-foreground font-mono">{q.number}</span>
                            <span className="truncate max-w-[140px]" title={supName}>{supName}</span>
                            <span className="text-[10px] font-normal text-muted-foreground">{q.currency}</span>
                          </div>
                        </th>
                      );
                    })}
                    <th className="px-2 py-2 w-[70px]">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={addQuotation}
                        title="Agregar otra cotización (proveedor)"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {requestLines.map((line) => {
                    const subItem = subcategories.find((s) => s.id === line.subcategory_id);
                    const sectorItem = sectors.find((s) => s.id === line.sector_id);
                    const missingCC = !line.subcategory_id || !line.sector_id;
                    return (
                      <tr key={line.id} className={`border-t ${missingCC ? "bg-amber-50/50" : ""}`}>
                        <td className="px-2 py-1 align-top sticky left-0 bg-inherit">
                          <InsumoPicker
                            projectId={projectId}
                            insumos={insumosCatalog}
                            selectedInsumoId={line.insumo_id}
                            onSelect={(ins) => updateRequestLine(line.id, {
                              insumo_id: ins.id,
                              description: ins.description,
                              unit: ins.unit,
                            })}
                          />
                          {!line.insumo_id && line.description && (
                            <p className="text-[10px] text-amber-700 mt-0.5 truncate" title={line.description}>
                              SC: <span className="italic">{line.description}</span>
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <Select
                            value={line.subcategory_id || ""}
                            onValueChange={(v) => v && updateRequestLine(line.id, { subcategory_id: v })}
                          >
                            <SelectTrigger className={`h-7 text-xs ${!line.subcategory_id ? "border-amber-400" : ""}`}>
                              {subItem ? (
                                <span className="truncate">{subItem.code} · {subItem.name}</span>
                              ) : (
                                <span className="text-amber-700">— elegir</span>
                              )}
                            </SelectTrigger>
                            <SelectContent>
                              {subcategories.map((s) => (
                                <SelectItem key={s.id} value={s.id}>{s.code} · {s.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1">
                          <Select
                            value={line.sector_id || ""}
                            onValueChange={(v) => v && updateRequestLine(line.id, { sector_id: v })}
                          >
                            <SelectTrigger className={`h-7 text-xs ${!line.sector_id ? "border-amber-400" : ""}`}>
                              {sectorItem ? (
                                <span className="truncate">{sectorItem.name}</span>
                              ) : (
                                <span className="text-amber-700">— elegir</span>
                              )}
                            </SelectTrigger>
                            <SelectContent>
                              {sectors.map((s) => (
                                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1 text-right font-mono">
                          {formatNumber(line.quantity)}
                        </td>
                        <td className="px-2 py-1 text-center text-muted-foreground">{line.unit}</td>
                        {quotations.map((q) => {
                          const p = priceFor(q.id, line.id);
                          const subtotal = (p ?? 0) * Number(line.quantity || 0);
                          return (
                            <td key={q.id} className="px-2 py-1 border-l-2 border-neutral-200">
                              <Input
                                type="number"
                                value={p ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value === "" ? null : Number(e.target.value);
                                  setQuotationLines((prev) => {
                                    const ex = prev.find((ql) => ql.quotation_id === q.id && ql.request_line_id === line.id);
                                    if (ex) return prev.map((ql) => ql.id === ex.id ? { ...ql, unit_price: v } : ql);
                                    return [...prev, { id: `tmp_${Math.random()}`, quotation_id: q.id, request_line_id: line.id, unit_price: v, lead_time_days: null, awarded: false }];
                                  });
                                }}
                                onBlur={() => setPrice(q.id, line.id, p)}
                                placeholder="—"
                                className="h-6 text-xs text-right"
                                disabled={q.status !== "draft" && q.status !== "rejected"}
                              />
                              {p != null && (
                                <p className="text-[10px] text-muted-foreground text-right mt-0.5 font-mono">
                                  = {formatNumber(subtotal, 0)}
                                </p>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-1 py-1 text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeRequestLine(line.id)}
                            className="h-6 w-6"
                            title="Quitar este ítem de la cotización"
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {/* Fila para agregar línea extra */}
                  <tr className="border-t bg-muted/20">
                    <td colSpan={5 + quotations.length + 1} className="px-2 py-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground hover:text-foreground"
                        onClick={addRequestLine}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Agregar ítem extra (que no estaba en la SC)
                      </Button>
                    </td>
                  </tr>
                  {/* Fila TOTAL */}
                  <tr className="border-t-2 border-neutral-900 bg-neutral-900 font-bold">
                    <td colSpan={5} className="px-2 py-2 text-right text-xs uppercase tracking-wider text-white sticky left-0 bg-neutral-900">
                      Total
                    </td>
                    {quotations.map((q) => (
                      <td key={q.id} className="px-2 py-2 text-right font-mono border-l-2 border-neutral-700" style={{ color: "#E87722" }}>
                        {formatNumber(quotationTotal(q.id), 0)}
                      </td>
                    ))}
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>

            {/* PANELES DE CONDICIONES POR COTIZACIÓN */}
            {quotations.length === 0 ? (
              <div className="border rounded-md p-6 text-center bg-muted/20">
                <Scale className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground mb-3">
                  Aún no hay cotizaciones. Agregá al menos una para empezar.
                </p>
                <Button onClick={addQuotation}>
                  <Plus className="h-4 w-4 mr-2" />
                  Agregar primera cotización
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Condiciones por cotización
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {quotations.map((q, idx) => (
                    <QuotationConditionsCard
                      key={q.id}
                      quotation={q}
                      idx={idx}
                      suppliers={suppliers}
                      projectId={projectId}
                      onUpdate={(patch) => updateQuotation(q.id, patch)}
                      onRemove={() => removeQuotation(q.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* FOOTER: enviar a aprobación */}
            <div className="flex items-center justify-between border-t pt-3">
              <div className="text-xs text-muted-foreground">
                {quotations.length === 0
                  ? "Agregá al menos una cotización para enviar a aprobación."
                  : `${quotations.length} cotización${quotations.length === 1 ? "" : "es"} cargada${quotations.length === 1 ? "" : "s"}`}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={onClose}>Cerrar</Button>
                <Button
                  onClick={submitToApproval}
                  disabled={submitting || quotations.length === 0 || linesMissingCC > 0 || allLocked}
                  className="bg-[#E87722] hover:bg-[#B85A0F]"
                >
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Enviando…</>
                  ) : (
                    <><Send className="h-4 w-4 mr-2" />Enviar a aprobación</>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* =====================================================================
   Card lateral con condiciones de UNA cotización (proveedor).
   ===================================================================== */
function QuotationConditionsCard({
  quotation,
  idx,
  suppliers,
  projectId,
  onUpdate,
  onRemove,
}: {
  quotation: Quotation;
  idx: number;
  suppliers: Supplier[];
  projectId: string;
  onUpdate: (patch: Partial<Quotation>) => void;
  onRemove: () => void;
}) {
  const supabase = createClient();
  const [attachments, setAttachments] = useState<{ id: string; file_name: string; storage_path: string; size_bytes: number | null }[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isLocked = quotation.status !== "draft" && quotation.status !== "rejected";
  const supplierItem = quotation.supplier_id ? suppliers.find((s) => s.id === quotation.supplier_id) : null;

  const loadAttachments = useCallback(async () => {
    const { data } = await supabase
      .from("quotation_attachments")
      .select("id, file_name, storage_path, size_bytes")
      .eq("quotation_id", quotation.id)
      .order("uploaded_at", { ascending: false });
    setAttachments(data ?? []);
  }, [quotation.id, supabase]);

  useEffect(() => { loadAttachments(); }, [loadAttachments]);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const path = `${projectId}/${quotation.id}/${Date.now()}_${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("quotation-attachments")
          .upload(path, file, { contentType: file.type });
        if (upErr) { toast.error(`${file.name}: ${upErr.message}`); continue; }
        await supabase.from("quotation_attachments").insert({
          quotation_id: quotation.id,
          file_name: file.name,
          storage_path: path,
          mime_type: file.type,
          size_bytes: file.size,
        });
      }
      await loadAttachments();
      toast.success("Adjuntos subidos");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function downloadAttachment(att: { storage_path: string }) {
    const { data } = await supabase.storage.from("quotation-attachments").createSignedUrl(att.storage_path, 60);
    if (data) window.open(data.signedUrl, "_blank");
  }

  async function deleteAttachment(att: { id: string; storage_path: string; file_name: string }) {
    if (!confirm(`¿Eliminar ${att.file_name}?`)) return;
    await supabase.storage.from("quotation-attachments").remove([att.storage_path]);
    await supabase.from("quotation_attachments").delete().eq("id", att.id);
    setAttachments((prev) => prev.filter((a) => a.id !== att.id));
  }

  return (
    <div id={`quotation-${quotation.id}`} className="border rounded-md p-3 space-y-2 bg-muted/20">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Building className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{quotation.number}</span>
            <span className="text-[10px] text-muted-foreground">· Proveedor #{idx + 1}</span>
          </div>
          <Select
            value={quotation.supplier_id || "_legacy"}
            onValueChange={(v) => v && onUpdate({
              supplier_id: v === "_legacy" ? null : v,
              supplier_name_legacy: v === "_legacy" ? quotation.supplier_name_legacy : null,
            })}
            disabled={isLocked}
          >
            <SelectTrigger className="h-7 text-xs w-full">
              {quotation.supplier_id ? (
                <span className="truncate">{supplierItem?.name ?? "(proveedor)"}</span>
              ) : (
                <span className="text-muted-foreground">(Manual / nuevo)</span>
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_legacy">(Manual / nuevo)</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!quotation.supplier_id && (
            <Input
              value={quotation.supplier_name_legacy || ""}
              onChange={(e) => onUpdate({ supplier_name_legacy: e.target.value })}
              placeholder="Nombre del proveedor (manual)"
              className="h-7 text-xs"
              disabled={isLocked}
            />
          )}
        </div>
        {!isLocked && (
          <Button variant="ghost" size="icon" onClick={onRemove} className="h-7 w-7 shrink-0">
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        )}
      </div>

      {/* Condiciones */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <Label className="text-[10px] uppercase tracking-wider">Moneda</Label>
          <Select
            value={quotation.currency}
            onValueChange={(v) => v && onUpdate({ currency: v })}
            disabled={isLocked}
          >
            <SelectTrigger className="h-7 text-xs w-full">
              <span>{quotation.currency}</span>
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-0.5">
          <Label className="text-[10px] uppercase tracking-wider">Vence</Label>
          <Input
            type="date"
            value={quotation.valid_until || ""}
            onChange={(e) => onUpdate({ valid_until: e.target.value || null })}
            className="h-7 text-xs"
            disabled={isLocked}
          />
        </div>
        <div className="col-span-2 space-y-0.5">
          <Label className="text-[10px] uppercase tracking-wider">Forma de pago</Label>
          <Select
            value={quotation.payment_terms_type || ""}
            onValueChange={(v) => v && onUpdate({ payment_terms_type: v })}
            disabled={isLocked}
          >
            <SelectTrigger className="h-7 text-xs w-full">
              <span>
                {PAYMENT_TYPES.find((p) => p.value === quotation.payment_terms_type)?.label || "—"}
              </span>
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_TYPES.map((pt) => (
                <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {quotation.payment_terms_type === "credito" && (
          <div className="col-span-2 space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wider">Días de crédito</Label>
            <Input
              type="number"
              value={quotation.credit_days ?? ""}
              onChange={(e) => onUpdate({ credit_days: e.target.value === "" ? null : Number(e.target.value) })}
              className="h-7 text-xs"
              disabled={isLocked}
            />
          </div>
        )}
        <div className="space-y-0.5">
          <Label className="text-[10px] uppercase tracking-wider">% Anticipo</Label>
          <Input
            type="number"
            value={quotation.advance_amount ?? ""}
            onChange={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value);
              onUpdate({ advance_amount: v, has_advance: v !== null && v > 0, advance_type: "percentage" });
            }}
            placeholder="0"
            className="h-7 text-xs text-right"
            disabled={isLocked}
          />
        </div>
        <div className="space-y-0.5">
          <Label className="text-[10px] uppercase tracking-wider">% Retención</Label>
          <Input
            type="number"
            value={quotation.retention_pct ?? ""}
            onChange={(e) => onUpdate({ retention_pct: e.target.value === "" ? null : Number(e.target.value) })}
            placeholder="0"
            className="h-7 text-xs text-right"
            disabled={isLocked}
          />
        </div>
      </div>

      {/* Notas / justificación */}
      <div className="space-y-0.5">
        <Label className="text-[10px] uppercase tracking-wider">Notas / justificación</Label>
        <textarea
          value={quotation.justification || ""}
          onChange={(e) => onUpdate({ justification: e.target.value })}
          placeholder="Observaciones, plazo, condiciones especiales…"
          rows={2}
          disabled={isLocked}
          className="w-full text-xs rounded-md border border-input bg-transparent px-2 py-1 placeholder:text-muted-foreground disabled:opacity-50"
        />
      </div>

      {/* Adjuntos */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] uppercase tracking-wider flex items-center gap-1">
            <Paperclip className="h-3 w-3" />
            Adjuntos ({attachments.length})
          </Label>
          {!isLocked && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.png,.jpg,.jpeg"
                onChange={(e) => uploadFiles(e.target.files)}
                className="hidden"
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />…</> : <><Upload className="h-3 w-3 mr-1" />Subir</>}
              </Button>
            </>
          )}
        </div>
        {attachments.length > 0 && (
          <div className="space-y-0.5">
            {attachments.map((att) => (
              <div key={att.id} className="flex items-center gap-1 px-2 py-1 border rounded text-[11px] bg-background">
                <FileIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate cursor-pointer hover:underline" onClick={() => downloadAttachment(att)}>
                  {att.file_name}
                </span>
                {!isLocked && (
                  <Button variant="ghost" size="icon" onClick={() => deleteAttachment(att)} className="h-5 w-5">
                    <Trash2 className="h-2.5 w-2.5 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
