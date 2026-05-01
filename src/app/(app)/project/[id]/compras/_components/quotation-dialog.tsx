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
import { InsumoPicker } from "./insumo-picker";
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
} from "lucide-react";
import { toast } from "sonner";
import { formatNumber } from "@/lib/utils/formula";
import type {
  EdtSubcategory,
  Sector,
  Insumo,
  Supplier,
} from "@/lib/types/database";

export interface Quotation {
  id: string;
  project_id: string;
  request_id: string | null;
  number: string;
  title: string | null;
  status: "draft" | "pending_approval" | "awarded" | "rejected" | "cancelled";
  justification: string | null;
  // Proveedor + condiciones (ahora directo en la cotización)
  supplier_id: string | null;
  supplier_name_legacy: string | null;
  currency: string;
  valid_until: string | null;
  has_advance: boolean;
  advance_amount: number | null;
  advance_type: string | null;
  retention_pct: number | null;
  payment_notes: string | null;
  created_at: string;
  updated_at: string;
}

interface QuotationLine {
  id: string;
  quotation_id: string;
  request_line_id: string | null;
  subcategory_id: string | null;
  sector_id: string | null;
  insumo_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number | null;
  lead_time_days: number | null;
  awarded: boolean;
  line_order: number;
  comment: string | null;
}

interface Attachment {
  id: string;
  quotation_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string;
}

export const QUOTATION_STATUS_LABELS: Record<Quotation["status"], { label: string; bg: string; color: string }> = {
  draft: { label: "Borrador", bg: "#F5F5F5", color: "#525252" },
  pending_approval: { label: "Pendiente", bg: "#FFF3E6", color: "#E87722" },
  awarded: { label: "Adjudicada", bg: "#ECFDF5", color: "#047857" },
  rejected: { label: "Rechazada", bg: "#FEF2F2", color: "#B91C1C" },
  cancelled: { label: "Cancelada", bg: "#F5F5F5", color: "#737373" },
};

export function QuotationDialog({
  quotationId,
  projectId,
  subcategories,
  sectors,
  insumos,
  suppliers,
  canWrite,
  onClose,
}: {
  quotationId: string;
  projectId: string;
  subcategories: EdtSubcategory[];
  sectors: Sector[];
  insumos: Insumo[];
  suppliers: Supplier[];
  canWrite: boolean;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [lines, setLines] = useState<QuotationLine[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [qRes, lRes, aRes] = await Promise.all([
      supabase.from("quotations").select("*").eq("id", quotationId).single(),
      supabase.from("quotation_lines").select("*").eq("quotation_id", quotationId).order("line_order"),
      supabase.from("quotation_attachments").select("*").eq("quotation_id", quotationId).order("uploaded_at", { ascending: false }),
    ]);
    if (qRes.data) setQuotation(qRes.data as Quotation);
    setLines((lRes.data ?? []) as QuotationLine[]);
    setAttachments((aRes.data ?? []) as Attachment[]);
    setLoading(false);
  }, [quotationId, supabase]);

  useEffect(() => { load(); }, [load]);

  const isLocked = !canWrite || (quotation && quotation.status !== "draft" && quotation.status !== "rejected");

  /* --------------------------- META DE COTIZACIÓN --------------------------- */
  async function updateQuotation(patch: Partial<Quotation>) {
    if (!quotation) return;
    setQuotation({ ...quotation, ...patch });
    const { error } = await supabase.from("quotations").update(patch).eq("id", quotation.id);
    if (error) toast.error(error.message);
  }

  /* ------------------------------- LÍNEAS ------------------------------- */
  async function addLine() {
    const { data, error } = await supabase
      .from("quotation_lines")
      .insert({
        quotation_id: quotationId,
        description: "Nuevo ítem",
        quantity: 1,
        unit: "u",
        line_order: lines.length,
      })
      .select()
      .single();
    if (error) { toast.error(error.message); return; }
    setLines((prev) => [...prev, data as QuotationLine]);
  }

  async function updateLine(id: string, patch: Partial<QuotationLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const { error } = await supabase.from("quotation_lines").update(patch).eq("id", id);
    if (error) toast.error(error.message);
  }

  async function removeLine(id: string) {
    if (!confirm("¿Borrar este ítem de la cotización? (No afecta a la SC original.)")) return;
    const { error } = await supabase.from("quotation_lines").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  /* ------------------------------ ADJUNTOS ------------------------------ */
  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const path = `${projectId}/${quotationId}/${Date.now()}_${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("quotation-attachments")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) { toast.error(`${file.name}: ${upErr.message}`); continue; }
        const { error: insErr } = await supabase.from("quotation_attachments").insert({
          quotation_id: quotationId,
          file_name: file.name,
          storage_path: path,
          mime_type: file.type,
          size_bytes: file.size,
        });
        if (insErr) toast.error(insErr.message);
      }
      toast.success("Adjuntos subidos");
      await load();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function downloadAttachment(att: Attachment) {
    const { data, error } = await supabase.storage
      .from("quotation-attachments")
      .createSignedUrl(att.storage_path, 60);
    if (error || !data) { toast.error(error?.message || "Error"); return; }
    window.open(data.signedUrl, "_blank");
  }

  async function deleteAttachment(att: Attachment) {
    if (!confirm(`¿Eliminar ${att.file_name}?`)) return;
    await supabase.storage.from("quotation-attachments").remove([att.storage_path]);
    await supabase.from("quotation_attachments").delete().eq("id", att.id);
    setAttachments((prev) => prev.filter((a) => a.id !== att.id));
  }

  /* --------------------------- COMPUTADOS --------------------------- */
  const supplierItem = quotation?.supplier_id ? suppliers.find((s) => s.id === quotation.supplier_id) : null;
  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);
  // Validación: cada línea debe tener subcategoría + sector definidos (centro de costo)
  const linesMissingCC = lines.filter((l) => !l.subcategory_id || !l.sector_id).length;
  const supplierMissing = !quotation?.supplier_id && !quotation?.supplier_name_legacy?.trim();

  /* ------------------------------ RENDER ------------------------------ */
  if (!quotation && !loading) return null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[1100px] max-h-[90vh] overflow-y-auto">
        {loading || !quotation ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Cargando…</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <Scale className="h-5 w-5 text-[#E87722]" />
                <span className="font-mono">{quotation.number}</span>
                <Input
                  value={quotation.title || ""}
                  onChange={(e) => setQuotation({ ...quotation, title: e.target.value })}
                  onBlur={() => updateQuotation({ title: quotation.title })}
                  className="flex-1 h-8"
                  disabled={!!isLocked}
                  placeholder="Título"
                />
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: QUOTATION_STATUS_LABELS[quotation.status].bg, color: QUOTATION_STATUS_LABELS[quotation.status].color }}
                >
                  {QUOTATION_STATUS_LABELS[quotation.status].label}
                </span>
              </DialogTitle>
              <DialogDescription>
                Esta cotización corresponde a <strong>un solo proveedor</strong>. Si querés comparar con otro proveedor, creá una segunda cotización desde la misma SC.
              </DialogDescription>
            </DialogHeader>

            {/* PROVEEDOR + condiciones */}
            <section className="border rounded-md p-3 space-y-3 bg-muted/20">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Building className="h-4 w-4" /> Proveedor cotizante
              </h3>

              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-5 space-y-1">
                  <Label className="text-xs">Proveedor</Label>
                  <Select
                    value={quotation.supplier_id || "_legacy"}
                    onValueChange={(v) => v && updateQuotation({
                      supplier_id: v === "_legacy" ? null : v,
                      supplier_name_legacy: v === "_legacy" ? quotation.supplier_name_legacy : null,
                    })}
                    disabled={!!isLocked}
                  >
                    <SelectTrigger className="h-8 text-sm w-full">
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
                      onChange={(e) => setQuotation({ ...quotation, supplier_name_legacy: e.target.value })}
                      onBlur={() => updateQuotation({ supplier_name_legacy: quotation.supplier_name_legacy })}
                      placeholder="Nombre del proveedor (manual)"
                      className="h-7 text-sm mt-1"
                      disabled={!!isLocked}
                    />
                  )}
                </div>

                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Moneda</Label>
                  <Select
                    value={quotation.currency}
                    onValueChange={(v) => v && updateQuotation({ currency: v })}
                    disabled={!!isLocked}
                  >
                    <SelectTrigger className="h-8 text-sm w-full">
                      <span>{quotation.currency}</span>
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Vence</Label>
                  <Input
                    type="date"
                    value={quotation.valid_until || ""}
                    onChange={(e) => setQuotation({ ...quotation, valid_until: e.target.value || null })}
                    onBlur={() => updateQuotation({ valid_until: quotation.valid_until })}
                    className="h-8 text-sm"
                    disabled={!!isLocked}
                  />
                </div>

                <div className="col-span-1 space-y-1">
                  <Label className="text-xs flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={quotation.has_advance}
                      onChange={(e) => updateQuotation({ has_advance: e.target.checked })}
                      disabled={!!isLocked}
                    />
                    Anticipo
                  </Label>
                </div>

                {quotation.has_advance && (
                  <>
                    <div className="col-span-1 space-y-1">
                      <Label className="text-xs">Anticipo %</Label>
                      <Input
                        type="number"
                        value={quotation.advance_amount ?? ""}
                        onChange={(e) => setQuotation({ ...quotation, advance_amount: e.target.value === "" ? null : Number(e.target.value) })}
                        onBlur={() => updateQuotation({ advance_amount: quotation.advance_amount, advance_type: "percentage" })}
                        className="h-8 text-sm"
                        disabled={!!isLocked}
                        placeholder="%"
                      />
                    </div>
                    <div className="col-span-1 space-y-1">
                      <Label className="text-xs">Retención %</Label>
                      <Input
                        type="number"
                        value={quotation.retention_pct ?? ""}
                        onChange={(e) => setQuotation({ ...quotation, retention_pct: e.target.value === "" ? null : Number(e.target.value) })}
                        onBlur={() => updateQuotation({ retention_pct: quotation.retention_pct })}
                        className="h-8 text-sm"
                        disabled={!!isLocked}
                        placeholder="%"
                      />
                    </div>
                  </>
                )}
              </div>
            </section>

            {/* Justificación */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                Justificación
              </Label>
              <textarea
                value={quotation.justification || ""}
                onChange={(e) => setQuotation({ ...quotation, justification: e.target.value })}
                onBlur={() => updateQuotation({ justification: quotation.justification })}
                placeholder="Notas sobre el proceso de cotización: criterios elegidos, contexto, observaciones."
                rows={2}
                disabled={!!isLocked}
                className="w-full text-sm rounded-md border border-input bg-transparent px-3 py-2 placeholder:text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            {/* ÍTEMS A COTIZAR — con precio */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Ítems cotizados ({lines.length})
                </h3>
                {!isLocked && (
                  <Button size="sm" variant="outline" onClick={addLine}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Agregar ítem
                  </Button>
                )}
              </div>

              {/* Aviso: líneas sin centro de costo o sector */}
              {linesMissingCC > 0 && (
                <div className="mb-2 flex items-center gap-2 text-xs px-3 py-1.5 rounded-md border border-amber-200 bg-amber-50 text-amber-900">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Hay {linesMissingCC} {linesMissingCC === 1 ? "línea" : "líneas"} sin centro de costo (subcategoría) o sector definido. Completalos antes de enviar a aprobación.
                </div>
              )}

              {lines.length === 0 ? (
                <p className="text-xs italic text-muted-foreground py-3 text-center border rounded-md">
                  Agregá los ítems cotizados.
                </p>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-neutral-100">
                      <tr>
                        <th className="text-left px-2 py-2 font-semibold">Ítem</th>
                        <th className="text-left px-2 py-2 font-semibold w-[150px]">Centro de costo *</th>
                        <th className="text-left px-2 py-2 font-semibold w-[120px]">Sector *</th>
                        <th className="text-right px-2 py-2 font-semibold w-[80px]">Cantidad</th>
                        <th className="text-center px-2 py-2 font-semibold w-[60px]">Unidad</th>
                        <th className="text-right px-2 py-2 font-semibold w-[100px]">P. unit.</th>
                        <th className="text-right px-2 py-2 font-semibold w-[110px]">Subtotal</th>
                        <th className="w-[36px]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => {
                        const subItem = subcategories.find((s) => s.id === line.subcategory_id);
                        const sectorItem = sectors.find((s) => s.id === line.sector_id);
                        const subtotal = Number(line.quantity || 0) * Number(line.unit_price || 0);
                        const missingCC = !line.subcategory_id || !line.sector_id;
                        return (
                          <tr key={line.id} className={`border-t ${missingCC ? "bg-amber-50/50" : ""}`}>
                            <td className="px-2 py-1 align-top">
                              {/* Selector de insumo: la descripción ES el insumo del catálogo.
                                  Si la línea heredó texto libre desde la SC, lo mostramos como
                                  referencia debajo hasta que se vincule un insumo concreto. */}
                              <InsumoPicker
                                projectId={projectId}
                                insumos={insumos}
                                selectedInsumoId={line.insumo_id}
                                onSelect={(ins) => updateLine(line.id, {
                                  insumo_id: ins.id,
                                  description: ins.description,
                                  unit: ins.unit,
                                })}
                              />
                              {!line.insumo_id && line.description && (
                                <p className="text-[10px] text-amber-700 mt-0.5 truncate" title={line.description}>
                                  De la SC: <span className="italic">{line.description}</span>
                                </p>
                              )}
                            </td>
                            <td className="px-2 py-1">
                              <Select
                                value={line.subcategory_id || ""}
                                onValueChange={(v) => v && updateLine(line.id, { subcategory_id: v })}
                                disabled={!!isLocked}
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
                                onValueChange={(v) => v && updateLine(line.id, { sector_id: v })}
                                disabled={!!isLocked}
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
                            <td className="px-2 py-1">
                              <Input
                                type="number"
                                value={line.quantity}
                                onChange={(e) => setLines((p) => p.map((l) => l.id === line.id ? { ...l, quantity: Number(e.target.value) } : l))}
                                onBlur={() => updateLine(line.id, { quantity: line.quantity })}
                                className="h-7 text-xs text-right"
                                disabled={!!isLocked}
                              />
                            </td>
                            <td className="px-2 py-1">
                              <Input
                                value={line.unit}
                                onChange={(e) => setLines((p) => p.map((l) => l.id === line.id ? { ...l, unit: e.target.value } : l))}
                                onBlur={() => updateLine(line.id, { unit: line.unit })}
                                className="h-7 text-xs text-center"
                                disabled={!!isLocked}
                              />
                            </td>
                            <td className="px-2 py-1">
                              <Input
                                type="number"
                                value={line.unit_price ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value === "" ? null : Number(e.target.value);
                                  setLines((p) => p.map((l) => l.id === line.id ? { ...l, unit_price: v } : l));
                                }}
                                onBlur={() => updateLine(line.id, { unit_price: line.unit_price })}
                                className="h-7 text-xs text-right"
                                disabled={!!isLocked}
                                placeholder="—"
                              />
                            </td>
                            <td className="px-2 py-1 text-right font-mono">
                              {line.unit_price != null ? formatNumber(subtotal, 0) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-1 py-1 text-center">
                              {!isLocked && (
                                <Button variant="ghost" size="icon" onClick={() => removeLine(line.id)} className="h-6 w-6">
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 border-neutral-900 bg-neutral-900 font-bold">
                        <td colSpan={6} className="px-2 py-2 text-right text-xs uppercase tracking-wider text-white">
                          Total cotización ({quotation.currency})
                        </td>
                        <td className="px-2 py-2 text-right font-mono" style={{ color: "#E87722" }}>
                          {formatNumber(total, 0)}
                        </td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {supplierMissing && (
                <div className="mt-2 flex items-center gap-2 text-xs px-3 py-1.5 rounded-md border border-amber-200 bg-amber-50 text-amber-900">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Falta indicar el proveedor de la cotización.
                </div>
              )}
            </section>

            {/* ADJUNTOS */}
            <section className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Paperclip className="h-3.5 w-3.5" />
                  Adjuntos ({attachments.length})
                </h3>
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
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Subiendo…</>
                                 : <><Upload className="h-3.5 w-3.5 mr-1" />Subir archivos</>}
                    </Button>
                  </>
                )}
              </div>
              {attachments.length === 0 ? (
                <p className="text-xs italic text-muted-foreground py-3 text-center border rounded-md">
                  Subí PDF/Excel con la cotización formal del proveedor.
                </p>
              ) : (
                <div className="space-y-1">
                  {attachments.map((att) => (
                    <div key={att.id} className="flex items-center gap-2 px-3 py-2 border rounded-md bg-muted/20">
                      <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="flex-1 text-sm truncate cursor-pointer hover:underline" onClick={() => downloadAttachment(att)}>
                        {att.file_name}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {att.size_bytes ? `${(att.size_bytes / 1024).toFixed(0)} KB` : ""}
                      </span>
                      {!isLocked && (
                        <Button variant="ghost" size="icon" onClick={() => deleteAttachment(att)} className="h-6 w-6">
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
