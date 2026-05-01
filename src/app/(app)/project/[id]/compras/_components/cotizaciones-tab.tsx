"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
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
  SelectValue,
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
} from "lucide-react";
import { toast } from "sonner";
import { formatNumber } from "@/lib/utils/formula";
import type {
  EdtSubcategory,
  Sector,
  Insumo,
  Supplier,
} from "@/lib/types/database";
import { usePermission } from "@/lib/permissions";

interface Quotation {
  id: string;
  project_id: string;
  request_id: string | null;
  number: string;
  title: string | null;
  status: "draft" | "pending_approval" | "awarded" | "rejected" | "cancelled";
  justification: string | null;
  created_at: string;
  updated_at: string;
}

interface PurchaseRequestRef {
  id: string;
  number: string;
}

interface QuotationLine {
  id: string;
  quotation_id: string;
  subcategory_id: string | null;
  sector_id: string | null;
  insumo_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  awarded_offer_id: string | null;
  line_order: number;
  comment: string | null;
}

interface QuotationOffer {
  id: string;
  quotation_id: string;
  supplier_id: string | null;
  supplier_name_legacy: string | null;
  currency: string;
  payment_terms_type: string | null;
  credit_days: number | null;
  has_advance: boolean;
  advance_amount: number | null;
  advance_type: string | null;
  retention_pct: number | null;
  comment: string | null;
  valid_until: string | null;
}

interface QuotationOfferLine {
  id: string;
  offer_id: string;
  quotation_line_id: string;
  unit_price: number | null;
  lead_time_days: number | null;
  comment: string | null;
}

interface Attachment {
  id: string;
  quotation_id: string;
  offer_id: string | null;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string;
}

const STATUS_LABELS: Record<Quotation["status"], { label: string; bg: string; color: string }> = {
  draft: { label: "Borrador", bg: "#F5F5F5", color: "#525252" },
  pending_approval: { label: "Pendiente", bg: "#FFF3E6", color: "#E87722" },
  awarded: { label: "Adjudicada", bg: "#ECFDF5", color: "#047857" },
  rejected: { label: "Rechazada", bg: "#FEF2F2", color: "#B91C1C" },
  cancelled: { label: "Cancelada", bg: "#F5F5F5", color: "#737373" },
};

export function CotizacionesTab({ projectId }: { projectId: string }) {
  const supabase = createClient();
  const canWrite = usePermission("oc.write"); // por ahora reusamos oc.write para cotizaciones
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [requestsById, setRequestsById] = useState<Map<string, PurchaseRequestRef>>(new Map());
  const [loading, setLoading] = useState(true);

  // Catálogos para los selects
  const [subcategories, setSubcategories] = useState<EdtSubcategory[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // Editar / abrir detalle
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [qRes, subRes, secRes, insRes, supRes, reqRes] = await Promise.all([
      supabase.from("quotations").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("sectors").select("*").eq("project_id", projectId).order("order"),
      supabase.from("insumos").select("*").eq("project_id", projectId).order("code"),
      supabase.from("suppliers").select("*").eq("project_id", projectId).order("name"),
      supabase.from("purchase_requests").select("id, number").eq("project_id", projectId),
    ]);
    setQuotations((qRes.data ?? []) as Quotation[]);
    setSubcategories((subRes.data ?? []) as EdtSubcategory[]);
    setSectors((secRes.data ?? []) as Sector[]);
    setInsumos((insRes.data ?? []) as Insumo[]);
    setSuppliers((supRes.data ?? []) as Supplier[]);
    const rmap = new Map<string, PurchaseRequestRef>();
    for (const r of (reqRes.data ?? []) as PurchaseRequestRef[]) rmap.set(r.id, r);
    setRequestsById(rmap);
    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4 py-4">
      <div>
        <p className="text-sm text-muted-foreground">
          Las cotizaciones nacen siempre de una <span className="font-medium">Solicitud de Compra</span>. Para iniciar una nueva cotización, andá a la pestaña Solicitudes y usá el botón &quot;Nueva cotización&quot; en la SC correspondiente.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-12 text-center">Cargando…</div>
      ) : quotations.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Scale className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-1">Sin cotizaciones</h3>
            <p className="text-muted-foreground text-sm">
              Iniciá una cotización desde la pestaña Solicitudes.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {quotations.map((q) => {
            const sl = STATUS_LABELS[q.status];
            const sc = q.request_id ? requestsById.get(q.request_id) : null;
            return (
              <Card
                key={q.id}
                className="cursor-pointer hover:border-[#E87722]/40 transition-colors"
                onClick={() => setOpenId(q.id)}
              >
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center gap-3">
                    <Scale className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="font-mono text-sm font-semibold">{q.number}</span>
                        <span
                          className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                          style={{ background: sl.bg, color: sl.color }}
                        >
                          {sl.label}
                        </span>
                        {sc && (
                          <span className="text-[11px] text-muted-foreground">
                            ← SC <span className="font-mono">{sc.number}</span>
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium truncate">{q.title || "(sin título)"}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(q.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Diálogo detalle/edición */}
      {openId && (
        <QuotationDialog
          quotationId={openId}
          projectId={projectId}
          subcategories={subcategories}
          sectors={sectors}
          insumos={insumos}
          suppliers={suppliers}
          canWrite={canWrite}
          onClose={() => { setOpenId(null); load(); }}
        />
      )}
    </div>
  );
}

/* =====================================================================
   Diálogo grande para editar una cotización: ítems, ofertas, adjuntos.
   ===================================================================== */

function QuotationDialog({
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
  const [offers, setOffers] = useState<QuotationOffer[]>([]);
  const [offerLines, setOfferLines] = useState<QuotationOfferLine[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [qRes, lRes, oRes, olRes, aRes] = await Promise.all([
      supabase.from("quotations").select("*").eq("id", quotationId).single(),
      supabase.from("quotation_lines").select("*").eq("quotation_id", quotationId).order("line_order"),
      supabase.from("quotation_offers").select("*").eq("quotation_id", quotationId).order("created_at"),
      supabase.from("quotation_offer_lines").select("*, offer:quotation_offers!inner(quotation_id)").eq("offer.quotation_id", quotationId),
      supabase.from("quotation_attachments").select("*").eq("quotation_id", quotationId).order("uploaded_at", { ascending: false }),
    ]);
    if (qRes.data) setQuotation(qRes.data as Quotation);
    setLines((lRes.data ?? []) as QuotationLine[]);
    setOffers((oRes.data ?? []) as QuotationOffer[]);
    setOfferLines((olRes.data ?? []) as QuotationOfferLine[]);
    setAttachments((aRes.data ?? []) as Attachment[]);
    setLoading(false);
  }, [quotationId, supabase]);

  useEffect(() => { load(); }, [load]);

  const isLocked = !canWrite || (quotation && quotation.status !== "draft" && quotation.status !== "rejected");

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
    if (!confirm("¿Borrar este ítem?")) return;
    const { error } = await supabase.from("quotation_lines").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setLines((prev) => prev.filter((l) => l.id !== id));
    setOfferLines((prev) => prev.filter((ol) => ol.quotation_line_id !== id));
  }

  /* ------------------------------- OFERTAS ------------------------------ */
  async function addOffer() {
    const { data, error } = await supabase
      .from("quotation_offers")
      .insert({
        quotation_id: quotationId,
        supplier_name_legacy: "Nuevo proveedor",
        currency: "USD",
      })
      .select()
      .single();
    if (error) { toast.error(error.message); return; }
    setOffers((prev) => [...prev, data as QuotationOffer]);
  }

  async function updateOffer(id: string, patch: Partial<QuotationOffer>) {
    setOffers((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    const { error } = await supabase.from("quotation_offers").update(patch).eq("id", id);
    if (error) toast.error(error.message);
  }

  async function removeOffer(id: string) {
    if (!confirm("¿Borrar esta oferta y todos sus precios?")) return;
    const { error } = await supabase.from("quotation_offers").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setOffers((prev) => prev.filter((o) => o.id !== id));
    setOfferLines((prev) => prev.filter((ol) => ol.offer_id !== id));
  }

  /* ----------------------- PRECIO POR (OFERTA × LÍNEA) ----------------------- */
  async function setPrice(offerId: string, lineId: string, unit_price: number | null) {
    const existing = offerLines.find((ol) => ol.offer_id === offerId && ol.quotation_line_id === lineId);
    if (existing) {
      setOfferLines((prev) => prev.map((ol) => (ol.id === existing.id ? { ...ol, unit_price } : ol)));
      const { error } = await supabase.from("quotation_offer_lines").update({ unit_price }).eq("id", existing.id);
      if (error) toast.error(error.message);
    } else {
      const { data, error } = await supabase
        .from("quotation_offer_lines")
        .insert({ offer_id: offerId, quotation_line_id: lineId, unit_price })
        .select()
        .single();
      if (error) { toast.error(error.message); return; }
      setOfferLines((prev) => [...prev, data as QuotationOfferLine]);
    }
  }

  function priceFor(offerId: string, lineId: string): number | null {
    const ol = offerLines.find((x) => x.offer_id === offerId && x.quotation_line_id === lineId);
    return ol?.unit_price ?? null;
  }

  function offerTotal(offerId: string): number {
    let sum = 0;
    for (const line of lines) {
      const p = priceFor(offerId, line.id);
      if (p != null) sum += p * Number(line.quantity || 0);
    }
    return sum;
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
                  onBlur={() => supabase.from("quotations").update({ title: quotation.title }).eq("id", quotation.id)}
                  className="flex-1 h-8"
                  disabled={!!isLocked}
                  placeholder="Título"
                />
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: STATUS_LABELS[quotation.status].bg, color: STATUS_LABELS[quotation.status].color }}
                >
                  {STATUS_LABELS[quotation.status].label}
                </span>
              </DialogTitle>
              <DialogDescription>
                Cargá los ítems a cotizar, después agregá ofertas de cada proveedor con sus precios y subí los adjuntos del legajo.
              </DialogDescription>
            </DialogHeader>

            {/* Justificación: obligatoria si una sola oferta o como contexto general */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                Justificación
                {offers.length === 1 && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    Obligatoria · oferta única
                  </span>
                )}
              </Label>
              <textarea
                value={quotation.justification || ""}
                onChange={(e) => setQuotation({ ...quotation, justification: e.target.value })}
                onBlur={() => supabase.from("quotations").update({ justification: quotation.justification }).eq("id", quotation.id)}
                placeholder={
                  offers.length === 1
                    ? "Explicá por qué se cotizó con un solo proveedor (ej. único oferente disponible, urgencia, exclusividad, etc.)"
                    : "Notas, criterios de selección, observaciones del proceso de cotización…"
                }
                rows={2}
                disabled={!!isLocked}
                className="w-full text-sm rounded-md border border-input bg-transparent px-3 py-2 placeholder:text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            {/* Sección 1: ÍTEMS A COTIZAR */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Ítems a cotizar ({lines.length})
                </h3>
                {!isLocked && (
                  <Button size="sm" variant="outline" onClick={addLine}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Agregar ítem
                  </Button>
                )}
              </div>
              {lines.length === 0 ? (
                <p className="text-xs italic text-muted-foreground py-3 text-center border rounded-md">
                  Agregá los ítems que querés cotizar.
                </p>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-neutral-100">
                      <tr>
                        <th className="text-left px-2 py-2 font-semibold">Descripción</th>
                        <th className="text-left px-2 py-2 font-semibold w-[160px]">Subcategoría</th>
                        <th className="text-left px-2 py-2 font-semibold w-[120px]">Sector</th>
                        <th className="text-left px-2 py-2 font-semibold w-[140px]">Insumo</th>
                        <th className="text-right px-2 py-2 font-semibold w-[80px]">Cantidad</th>
                        <th className="text-center px-2 py-2 font-semibold w-[60px]">Unidad</th>
                        <th className="w-[40px]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => (
                        <tr key={line.id} className="border-t">
                          <td className="px-2 py-1">
                            <Input
                              value={line.description}
                              onChange={(e) => setLines((p) => p.map((l) => l.id === line.id ? { ...l, description: e.target.value } : l))}
                              onBlur={() => updateLine(line.id, { description: line.description })}
                              className="h-7 text-xs"
                              disabled={!!isLocked}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <Select
                              value={line.subcategory_id || ""}
                              onValueChange={(v) => v && updateLine(line.id, { subcategory_id: v })}
                              disabled={!!isLocked}
                            >
                              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                              <SelectContent>
                                {subcategories.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {s.code} · {s.name}
                                  </SelectItem>
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
                              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                              <SelectContent>
                                {sectors.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <Select
                              value={line.insumo_id || ""}
                              onValueChange={(v) => v && updateLine(line.id, { insumo_id: v })}
                              disabled={!!isLocked}
                            >
                              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                              <SelectContent>
                                {insumos.map((i) => (
                                  <SelectItem key={i.id} value={i.id}>{i.code} · {i.description.slice(0, 50)}</SelectItem>
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
                          <td className="px-1 py-1 text-center">
                            {!isLocked && (
                              <Button variant="ghost" size="icon" onClick={() => removeLine(line.id)} className="h-6 w-6">
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Sección 2: OFERTAS DE PROVEEDORES */}
            <section className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Ofertas ({offers.length})
                </h3>
                {!isLocked && (
                  <Button size="sm" variant="outline" onClick={addOffer} disabled={lines.length === 0}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Agregar oferta
                  </Button>
                )}
              </div>
              {offers.length === 0 ? (
                <p className="text-xs italic text-muted-foreground py-3 text-center border rounded-md">
                  {lines.length === 0
                    ? "Primero cargá los ítems a cotizar."
                    : "Agregá ofertas de proveedores para comparar precios."}
                </p>
              ) : (
                <div className="space-y-3">
                  {offers.map((offer) => (
                    <Card key={offer.id} className="overflow-hidden">
                      <CardContent className="p-3 space-y-2">
                        {/* Header oferta */}
                        <div className="flex items-center gap-2">
                          <Building className="h-4 w-4 text-muted-foreground shrink-0" />
                          <Select
                            value={offer.supplier_id || "_legacy"}
                            onValueChange={(v) => v && updateOffer(offer.id, {
                              supplier_id: v === "_legacy" ? null : v,
                              supplier_name_legacy: v === "_legacy" ? offer.supplier_name_legacy : null,
                            })}
                            disabled={!!isLocked}
                          >
                            <SelectTrigger className="h-7 text-xs w-[200px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_legacy">(Manual / nuevo)</SelectItem>
                              {suppliers.map((s) => (
                                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {!offer.supplier_id && (
                            <Input
                              value={offer.supplier_name_legacy || ""}
                              onChange={(e) => setOffers((p) => p.map((o) => o.id === offer.id ? { ...o, supplier_name_legacy: e.target.value } : o))}
                              onBlur={() => updateOffer(offer.id, { supplier_name_legacy: offer.supplier_name_legacy })}
                              placeholder="Nombre del proveedor"
                              className="h-7 text-xs flex-1"
                              disabled={!!isLocked}
                            />
                          )}
                          <Select
                            value={offer.currency}
                            onValueChange={(v) => v && updateOffer(offer.id, { currency: v })}
                            disabled={!!isLocked}
                          >
                            <SelectTrigger className="h-7 text-xs w-[80px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {CURRENCIES.map((c) => (
                                <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span className="text-xs text-muted-foreground">Vence:</span>
                          <Input
                            type="date"
                            value={offer.valid_until || ""}
                            onChange={(e) => setOffers((p) => p.map((o) => o.id === offer.id ? { ...o, valid_until: e.target.value || null } : o))}
                            onBlur={() => updateOffer(offer.id, { valid_until: offer.valid_until })}
                            className="h-7 text-xs w-[140px]"
                            disabled={!!isLocked}
                          />
                          <div className="flex-1" />
                          <span className="text-sm font-bold" style={{ color: "#E87722" }}>
                            {formatNumber(offerTotal(offer.id), 0)} {offer.currency}
                          </span>
                          {!isLocked && (
                            <Button variant="ghost" size="icon" onClick={() => removeOffer(offer.id)} className="h-7 w-7">
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          )}
                        </div>

                        {/* Tabla de precios por línea */}
                        {lines.length > 0 && (
                          <div className="border rounded-md overflow-hidden">
                            <table className="w-full text-xs">
                              <thead className="bg-neutral-50">
                                <tr>
                                  <th className="text-left px-2 py-1 font-medium text-muted-foreground">Ítem</th>
                                  <th className="text-right px-2 py-1 font-medium text-muted-foreground w-[80px]">Cantidad</th>
                                  <th className="text-right px-2 py-1 font-medium text-muted-foreground w-[120px]">Precio unit.</th>
                                  <th className="text-right px-2 py-1 font-medium text-muted-foreground w-[120px]">Subtotal</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((line) => {
                                  const p = priceFor(offer.id, line.id);
                                  const subtotal = (p ?? 0) * Number(line.quantity || 0);
                                  return (
                                    <tr key={line.id} className="border-t">
                                      <td className="px-2 py-1 truncate max-w-[300px]" title={line.description}>
                                        {line.description}
                                      </td>
                                      <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                                        {formatNumber(line.quantity)} {line.unit}
                                      </td>
                                      <td className="px-2 py-1">
                                        <Input
                                          type="number"
                                          value={p ?? ""}
                                          onChange={(e) => {
                                            const v = e.target.value === "" ? null : Number(e.target.value);
                                            setOfferLines((prev) => {
                                              const ex = prev.find((ol) => ol.offer_id === offer.id && ol.quotation_line_id === line.id);
                                              if (ex) return prev.map((ol) => ol.id === ex.id ? { ...ol, unit_price: v } : ol);
                                              return [...prev, { id: `tmp_${Math.random()}`, offer_id: offer.id, quotation_line_id: line.id, unit_price: v, lead_time_days: null, comment: null }];
                                            });
                                          }}
                                          onBlur={() => setPrice(offer.id, line.id, p)}
                                          placeholder="—"
                                          className="h-6 text-xs text-right"
                                          disabled={!!isLocked}
                                        />
                                      </td>
                                      <td className="px-2 py-1 text-right font-mono">
                                        {p != null ? formatNumber(subtotal, 0) : <span className="text-muted-foreground">—</span>}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            {/* Sección 3: ADJUNTOS */}
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
                  Subí PDFs / Excel con las cotizaciones del proveedor, formularios o planillas para conformar el legajo.
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
