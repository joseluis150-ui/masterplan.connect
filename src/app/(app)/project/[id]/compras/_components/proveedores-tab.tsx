"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getNumberLocale } from "@/lib/utils/number-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Plus, Users, Trash2, Mail, Phone, Hash, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import type {
  Supplier,
  PurchaseOrder,
  PurchaseOrderLine,
  ReceptionNote,
  DeliveryNote,
  Project,
  PaymentTermsType,
} from "@/lib/types/database";
import { ColumnFilter, matchesColumnFilter } from "./column-filter";
import { cn } from "@/lib/utils";
import { logActivity } from "@/lib/utils/activity-log";

interface Props {
  projectId: string;
}

type OCWithLinesAndRecs = PurchaseOrder & {
  lines: PurchaseOrderLine[];
  receptions: (ReceptionNote & { lines: DeliveryNote[] })[];
};

interface SupplierStats {
  ocCount: number;
  totalLocal: number;
  totalUsd: number;
  totalUsdEq: number;
  certificadoUsdEq: number;
  pendienteCertUsdEq: number;
  desembolsadoUsdEq: number;
}

const PAYMENT_TERMS_OPTIONS: { value: PaymentTermsType; label: string }[] = [
  { value: "contado", label: "Contado" },
  { value: "credito", label: "Crédito" },
  { value: "contrato", label: "Según contrato" },
  { value: "contra_entrega", label: "Contra entrega" },
];
const PAYMENT_TERMS_LABELS: Record<string, string> = Object.fromEntries(
  PAYMENT_TERMS_OPTIONS.map((o) => [o.value, o.label])
);

export function ProveedoresTab({ projectId }: Props) {
  const supabase = createClient();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<OCWithLinesAndRecs[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  // Search + column filters
  const [searchText, setSearchText] = useState("");
  const [colFilterName, setColFilterName] = useState<Set<string>>(new Set());
  const [colFilterTaxId, setColFilterTaxId] = useState<Set<string>>(new Set());
  const [colFilterTerms, setColFilterTerms] = useState<Set<string>>(new Set());

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // Detail dialog
  const [detailId, setDetailId] = useState<string | null>(null);

  // Import dialog
  const [importOpen, setImportOpen] = useState(false);
  const [otherProjects, setOtherProjects] = useState<Project[]>([]);
  const [importFromProjectId, setImportFromProjectId] = useState<string | null>(null);
  const [importCandidates, setImportCandidates] = useState<Supplier[]>([]);
  const [importChecked, setImportChecked] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const loadData = useCallback(async () => {
    const [projRes, supsRes, ordsRes] = await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).single(),
      supabase.from("suppliers").select("*").eq("project_id", projectId).order("name"),
      supabase
        .from("purchase_orders")
        .select("*, lines:purchase_order_lines(*), receptions:reception_notes(*, lines:delivery_notes(*))")
        .eq("project_id", projectId),
    ]);
    if (projRes.data) setProject(projRes.data as Project);
    setSuppliers((supsRes.data || []) as Supplier[]);
    setOrders((ordsRes.data || []) as OCWithLinesAndRecs[]);
    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const tc = Number(project?.exchange_rate || 0);
  const localCurrency = project?.local_currency || "PYG";

  const toUsd = useCallback((amount: number, currency: string) => {
    if (currency === "USD") return amount;
    return tc > 0 ? amount / tc : 0;
  }, [tc]);

  // Per-supplier aggregated stats
  function computeStats(supplierId: string): SupplierStats {
    const supplierOrders = orders.filter(
      (o) => o.supplier_id === supplierId && o.status !== "cancelled"
    );
    let totalLocal = 0, totalUsd = 0, totalUsdEq = 0;
    let certificadoUsdEq = 0, desembolsadoUsdEq = 0;
    for (const oc of supplierOrders) {
      const total = oc.lines.reduce((s, l) => s + Number(l.total || 0), 0);
      if (oc.currency === "USD") {
        totalUsd += total;
      } else {
        totalLocal += total;
      }
      totalUsdEq += toUsd(total, oc.currency);

      // Regular receptions (not advance, not cancelled) — for certificado / desembolsado breakdown
      const regularRecs = oc.receptions.filter(
        (r) => r.type !== "advance" && r.status !== "cancelled"
      );
      const certificado = regularRecs.reduce(
        (s, r) => s + r.lines.reduce((ss, l) => ss + Number(l.gross_amount || 0), 0),
        0
      );
      certificadoUsdEq += toUsd(certificado, oc.currency);

      // Desembolsado = payable_amount across ALL live receptions (incl. advance)
      const liveRecs = oc.receptions.filter((r) => r.status !== "cancelled");
      const desembolsado = liveRecs.reduce(
        (s, r) => s + r.lines.reduce((ss, l) => ss + Number(l.payable_amount || 0), 0),
        0
      );
      desembolsadoUsdEq += toUsd(desembolsado, oc.currency);
    }
    return {
      ocCount: supplierOrders.length,
      totalLocal,
      totalUsd,
      totalUsdEq,
      certificadoUsdEq,
      pendienteCertUsdEq: Math.max(0, totalUsdEq - certificadoUsdEq),
      desembolsadoUsdEq,
    };
  }

  function ocCountFor(supplierId: string): number {
    return orders.filter((o) => o.supplier_id === supplierId).length;
  }

  // Create
  async function submitCreate() {
    const name = newName.trim();
    if (!name) {
      toast.error("El nombre es requerido");
      return;
    }
    const normalized = name.toLowerCase();
    const existing = suppliers.find((s) => s.name.trim().toLowerCase() === normalized);
    if (existing) {
      toast.error(`Ya existe "${existing.name}". Usá el existente.`);
      return;
    }
    setCreating(true);
    const { data, error } = await supabase
      .from("suppliers")
      .insert({ project_id: projectId, name })
      .select()
      .single();
    setCreating(false);
    if (error || !data) {
      if (error?.code === "23505") {
        toast.error("Ya existe un proveedor con ese nombre.");
      } else {
        toast.error(`Error: ${error?.message || "desconocido"}`);
      }
      return;
    }
    await logActivity({
      projectId,
      actionType: "supplier_created",
      entityType: "supplier",
      entityId: (data as Supplier).id,
      description: `Proveedor "${name}" creado`,
      metadata: { supplierId: (data as Supplier).id, name },
    });
    setSuppliers((prev) => [...prev, data as Supplier].sort((a, b) => a.name.localeCompare(b.name)));
    setNewName("");
    setCreateOpen(false);
    toast.success(`Proveedor "${name}" creado`);
  }

  // Update field (called from detail dialog on blur)
  async function updateField(id: string, field: keyof Supplier, value: string | number | null) {
    const { error } = await supabase
      .from("suppliers")
      .update({ [field]: value })
      .eq("id", id);
    if (error) {
      toast.error(`Error al guardar: ${error.message}`);
      return;
    }
    setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value as never } : s)));
  }

  // Delete
  async function deleteSupplier(s: Supplier) {
    if (ocCountFor(s.id) > 0) {
      toast.error("No se puede eliminar: tiene OCs asociadas");
      return;
    }
    if (!confirm(`¿Eliminar al proveedor "${s.name}"? Esta acción no se puede deshacer.`)) return;
    const { error } = await supabase.from("suppliers").delete().eq("id", s.id);
    if (error) {
      toast.error(`Error: ${error.message}`);
      return;
    }
    setSuppliers((prev) => prev.filter((x) => x.id !== s.id));
    setDetailId(null);
    toast.success(`Proveedor "${s.name}" eliminado`);
  }

  // Import dialog handlers
  async function openImport() {
    setImportOpen(true);
    setImportFromProjectId(null);
    setImportCandidates([]);
    setImportChecked(new Set());
    // Load other projects (excluding current)
    const { data } = await supabase
      .from("projects")
      .select("*")
      .neq("id", projectId)
      .order("name");
    setOtherProjects((data || []) as Project[]);
  }

  async function loadImportCandidates(otherProjectId: string) {
    setImportFromProjectId(otherProjectId);
    const { data } = await supabase
      .from("suppliers")
      .select("*")
      .eq("project_id", otherProjectId)
      .order("name");
    const list = (data || []) as Supplier[];
    setImportCandidates(list);
    // Default: check the ones not already in this project
    const existingNorm = new Set(suppliers.map((s) => s.name_normalized));
    setImportChecked(new Set(list.filter((s) => !existingNorm.has(s.name_normalized)).map((s) => s.id)));
  }

  async function submitImport() {
    const toImport = importCandidates.filter((s) => importChecked.has(s.id));
    if (toImport.length === 0) {
      toast.error("No hay proveedores seleccionados");
      return;
    }
    setImporting(true);
    const payload = toImport.map((s) => ({
      project_id: projectId,
      name: s.name,
      tax_id: s.tax_id,
      email: s.email,
      phone: s.phone,
      payment_terms: s.payment_terms,
      credit_days: s.credit_days,
      notes: s.notes,
    }));
    // Insert one-by-one to count conflicts
    let imported = 0;
    let skipped = 0;
    for (const row of payload) {
      const { error } = await supabase.from("suppliers").insert(row);
      if (error?.code === "23505") {
        skipped++;
      } else if (error) {
        toast.error(`Error con "${row.name}": ${error.message}`);
      } else {
        imported++;
      }
    }
    setImporting(false);
    setImportOpen(false);
    await loadData();
    toast.success(`Importados: ${imported} · Omitidos (ya existían): ${skipped}`);
  }

  // Filters / rendering
  const filtered = suppliers.filter((s) => {
    const q = searchText.trim().toLowerCase();
    if (q) {
      const hay = `${s.name} ${s.tax_id || ""} ${s.email || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (!matchesColumnFilter(colFilterName, s.name)) return false;
    if (!matchesColumnFilter(colFilterTaxId, s.tax_id || "")) return false;
    if (!matchesColumnFilter(colFilterTerms, s.payment_terms || "")) return false;
    return true;
  });

  function fmt(n: number, decimals = 0): string {
    return n > 0
      ? n.toLocaleString(getNumberLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : "—";
  }

  if (loading) return <div className="py-6 text-muted-foreground">Cargando proveedores...</div>;

  const allNames = Array.from(new Set(suppliers.map((s) => s.name))).sort();
  const allTaxIds = Array.from(new Set(suppliers.map((s) => s.tax_id || ""))).filter(Boolean).sort();
  const allTerms = Array.from(new Set(suppliers.map((s) => s.payment_terms || "")));

  return (
    <div className="py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5" /> Proveedores
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Lista de proveedores del proyecto. Click en una fila para ver la ficha y el estado de cuenta.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openImport}>
            <Download className="h-4 w-4 mr-1" /> Importar de otro proyecto
          </Button>
          <Button onClick={() => { setNewName(""); setCreateOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Nuevo Proveedor
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Buscar por nombre, N° fiscal o email…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="max-w-md h-9 text-sm"
        />
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} de {suppliers.length} proveedores
        </span>
      </div>

      {/* Empty state */}
      {suppliers.length === 0 ? (
        <div className="border rounded-lg px-6 py-16 text-center text-sm text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="mb-2">No hay proveedores cargados todavía.</p>
          <p className="text-xs">Agregá el primero o importá desde otro proyecto.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_140px_200px_130px_140px_90px_160px_80px] gap-3 px-4 py-2 bg-muted/60 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <ColumnFilter label="Nombre" values={allNames} selected={colFilterName} onChange={setColFilterName} />
            <ColumnFilter label="N° Fiscal" values={allTaxIds} selected={colFilterTaxId} onChange={setColFilterTaxId} />
            <span>Email</span>
            <span>Teléfono</span>
            <ColumnFilter label="Crédito" values={allTerms} valueLabels={PAYMENT_TERMS_LABELS} selected={colFilterTerms} onChange={setColFilterTerms} />
            <span className="text-right"># OCs</span>
            <span className="text-right">Total (USD eq.)</span>
            <span className="text-right">Acciones</span>
          </div>
          {filtered.map((s) => {
            const stats = computeStats(s.id);
            return (
              <div
                key={s.id}
                className="grid grid-cols-[1fr_140px_200px_130px_140px_90px_160px_80px] gap-3 px-4 py-2.5 items-center text-xs border-t hover:bg-muted/20 cursor-pointer transition-colors"
                onClick={() => setDetailId(s.id)}
              >
                <span className="font-medium truncate" title={s.name}>{s.name}</span>
                <span className="font-mono text-muted-foreground truncate" title={s.tax_id || ""}>
                  {s.tax_id || <span className="opacity-50">—</span>}
                </span>
                <span className="text-muted-foreground truncate" title={s.email || ""}>
                  {s.email || <span className="opacity-50">—</span>}
                </span>
                <span className="text-muted-foreground truncate" title={s.phone || ""}>
                  {s.phone || <span className="opacity-50">—</span>}
                </span>
                <span className="text-muted-foreground">
                  {s.payment_terms ? PAYMENT_TERMS_LABELS[s.payment_terms] : <span className="opacity-50">—</span>}
                </span>
                <span className="text-right text-muted-foreground">
                  {stats.ocCount > 0 ? stats.ocCount : <span className="opacity-50">—</span>}
                </span>
                <span className="text-right font-mono font-semibold">
                  {stats.totalUsdEq > 0 ? fmt(stats.totalUsdEq, 2) : <span className="opacity-50">—</span>}
                </span>
                <div className="flex items-center justify-end gap-1">
                  {stats.ocCount === 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); deleteSupplier(s); }}
                      title="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─────── Create Dialog ─────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" /> Nuevo Proveedor
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre *</label>
              <Input
                className="mt-1"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre del proveedor"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); }}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Los demás campos (RUC, email, teléfono, crédito) se completan desde el detalle después de crearlo.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancelar</Button>
              <Button onClick={submitCreate} disabled={creating || !newName.trim()}>
                {creating ? "Creando…" : "Crear proveedor"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─────── Detail Dialog ─────── */}
      <Dialog open={detailId !== null} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="sm:max-w-[90vw] w-[90vw] max-h-[92vh] p-0 gap-0 flex flex-col">
          {(() => {
            const s = suppliers.find((x) => x.id === detailId);
            if (!s) return null;
            const stats = computeStats(s.id);
            const supplierOrders = orders
              .filter((o) => o.supplier_id === s.id)
              .sort((a, b) => (b.issue_date || "").localeCompare(a.issue_date || ""));
            const ocCount = supplierOrders.filter((o) => o.status !== "cancelled").length;

            return (
              <>
                {/* Header */}
                <div className="flex-none px-6 py-4 border-b">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-3">
                      <Users className="h-5 w-5" />
                      {s.name}
                    </DialogTitle>
                  </DialogHeader>
                  <p className="text-xs text-muted-foreground mt-1">
                    {ocCount} OC{ocCount !== 1 ? "s" : ""} activa{ocCount !== 1 ? "s" : ""} · Total {fmt(stats.totalUsdEq, 2)} USD equivalente
                  </p>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-auto bg-neutral-50 px-6 py-5 space-y-5">
                  {/* ══════ SECTION 1 · Ficha del proveedor ══════ */}
                  <section className="bg-background rounded-lg border shadow-sm overflow-hidden">
                    <header className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Ficha del proveedor
                      </h3>
                    </header>
                    <div className="p-4 grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Nombre</label>
                        <Input
                          className="mt-1"
                          defaultValue={s.name}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v && v !== s.name) updateField(s.id, "name", v);
                          }}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                          <Hash className="h-3 w-3" /> N° Fiscal / RUC
                        </label>
                        <Input
                          className="mt-1"
                          defaultValue={s.tax_id || ""}
                          onBlur={(e) => {
                            const v = e.target.value.trim() || null;
                            if (v !== s.tax_id) updateField(s.id, "tax_id", v);
                          }}
                          placeholder="—"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                          <Mail className="h-3 w-3" /> Email
                        </label>
                        <Input
                          className="mt-1"
                          type="email"
                          defaultValue={s.email || ""}
                          onBlur={(e) => {
                            const v = e.target.value.trim() || null;
                            if (v !== s.email) updateField(s.id, "email", v);
                          }}
                          placeholder="—"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3" /> Teléfono
                        </label>
                        <Input
                          className="mt-1"
                          defaultValue={s.phone || ""}
                          onBlur={(e) => {
                            const v = e.target.value.trim() || null;
                            if (v !== s.phone) updateField(s.id, "phone", v);
                          }}
                          placeholder="—"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Forma de pago</label>
                        <Select
                          value={s.payment_terms || ""}
                          onValueChange={(v) => {
                            if (!v) return;
                            const newVal = (v as PaymentTermsType) || null;
                            updateField(s.id, "payment_terms", newVal);
                          }}
                        >
                          <SelectTrigger className="mt-1">
                            <span>
                              {s.payment_terms ? PAYMENT_TERMS_LABELS[s.payment_terms] : "— sin definir —"}
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            {PAYMENT_TERMS_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {s.payment_terms === "credito" && (
                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground">Días de crédito</label>
                          <Input
                            className="mt-1"
                            type="number"
                            defaultValue={s.credit_days || ""}
                            onBlur={(e) => {
                              const v = e.target.value.trim() === "" ? null : parseInt(e.target.value);
                              if (v !== s.credit_days) updateField(s.id, "credit_days", v);
                            }}
                            placeholder="—"
                          />
                        </div>
                      )}
                      <div className="col-span-2">
                        <label className="text-[11px] font-medium text-muted-foreground">Notas</label>
                        <Input
                          className="mt-1"
                          defaultValue={s.notes || ""}
                          onBlur={(e) => {
                            const v = e.target.value.trim() || null;
                            if (v !== s.notes) updateField(s.id, "notes", v);
                          }}
                          placeholder="—"
                        />
                      </div>
                    </div>
                  </section>

                  {/* ══════ SECTION 2 · Estado de cuenta ══════ */}
                  <section className="bg-background rounded-lg border shadow-sm overflow-hidden">
                    <header className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Estado de cuenta
                      </h3>
                    </header>
                    <div className="p-4 space-y-4">
                      {/* KPIs — local / USD / equiv */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="border rounded-md p-3 bg-neutral-100 border-neutral-300">
                          <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Total OCs ({stats.ocCount})</p>
                          <div className="grid grid-cols-3 gap-2 mt-1">
                            <div>
                              <p className="text-[9px] uppercase font-mono text-muted-foreground">{localCurrency}</p>
                              <p className="text-sm font-bold">{fmt(stats.totalLocal, 0)}</p>
                            </div>
                            <div>
                              <p className="text-[9px] uppercase font-mono text-muted-foreground">USD</p>
                              <p className="text-sm font-bold">{fmt(stats.totalUsd, 2)}</p>
                            </div>
                            <div className="border-l pl-2">
                              <p className="text-[9px] uppercase font-mono text-muted-foreground">Equiv. USD</p>
                              <p className="text-sm font-bold">{fmt(stats.totalUsdEq, 2)}</p>
                            </div>
                          </div>
                        </div>
                        <div className="border rounded-md p-3 bg-neutral-100 border-neutral-300">
                          <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Certificado</p>
                          <p className="text-base font-bold text-[#E87722] mt-1">{fmt(stats.certificadoUsdEq, 2)} <span className="text-[10px] text-muted-foreground">USD eq.</span></p>
                          <p className="text-[10px] text-muted-foreground">
                            {stats.totalUsdEq > 0 ? `${((stats.certificadoUsdEq / stats.totalUsdEq) * 100).toFixed(1)}%` : "—"} del total
                          </p>
                        </div>
                        <div className="border rounded-md p-3 bg-neutral-100 border-neutral-300">
                          <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Desembolsado</p>
                          <p className="text-base font-bold text-emerald-700 mt-1">{fmt(stats.desembolsadoUsdEq, 2)} <span className="text-[10px] text-muted-foreground">USD eq.</span></p>
                          <p className="text-[10px] text-muted-foreground">
                            {stats.totalUsdEq > 0 ? `${((stats.desembolsadoUsdEq / stats.totalUsdEq) * 100).toFixed(1)}%` : "—"} del total
                          </p>
                        </div>
                      </div>

                      {/* OCs table */}
                      {supplierOrders.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic text-center py-4">
                          Este proveedor no tiene OCs asociadas.
                        </p>
                      ) : (
                        <div className="border rounded-md overflow-hidden">
                          <div className="grid grid-cols-[130px_110px_110px_80px_140px_140px] gap-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2 bg-muted/40 border-b">
                            <span>N° OC</span>
                            <span>Fecha</span>
                            <span>Estado</span>
                            <span>Moneda</span>
                            <span className="text-right">Total</span>
                            <span className="text-right">Certificado</span>
                          </div>
                          {supplierOrders.map((oc) => {
                            const total = oc.lines.reduce((s, l) => s + Number(l.total || 0), 0);
                            const regularRecs = oc.receptions.filter((r) => r.type !== "advance" && r.status !== "cancelled");
                            const certificado = regularRecs.reduce(
                              (s, r) => s + r.lines.reduce((ss, l) => ss + Number(l.gross_amount || 0), 0),
                              0
                            );
                            return (
                              <div
                                key={oc.id}
                                className="grid grid-cols-[130px_110px_110px_80px_140px_140px] gap-2 text-xs px-3 py-1.5 items-center border-b last:border-b-0 hover:bg-muted/20"
                              >
                                <span className="font-mono font-semibold">{oc.number}</span>
                                <span className="text-muted-foreground">{oc.issue_date}</span>
                                <span>
                                  <Badge
                                    className={cn(
                                      "text-[10px]",
                                      oc.status === "open" && "bg-amber-100 text-amber-700 hover:bg-amber-100",
                                      oc.status === "closed" && "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
                                      oc.status === "cancelled" && "bg-muted text-muted-foreground hover:bg-muted"
                                    )}
                                  >
                                    {oc.status === "open" ? "Abierta" : oc.status === "closed" ? "Cerrada" : "Cancelada"}
                                  </Badge>
                                </span>
                                <span className="font-mono text-muted-foreground">{oc.currency}</span>
                                <span className="text-right font-mono font-semibold">{fmt(total, 2)}</span>
                                <span className="text-right font-mono text-[#E87722]">{fmt(certificado, 2)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                {/* Footer */}
                <div className="flex-none border-t bg-muted/30 px-6 py-3 flex items-center gap-2">
                  <Button variant="outline" onClick={() => setDetailId(null)}>Cerrar</Button>
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={stats.ocCount > 0 || supplierOrders.some((o) => o.status !== "cancelled")}
                    onClick={() => deleteSupplier(s)}
                    title={supplierOrders.length > 0 ? "No se puede eliminar: tiene OCs asociadas" : "Eliminar proveedor"}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Eliminar
                  </Button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ─────── Import Dialog ─────── */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" /> Importar proveedores de otro proyecto
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Proyecto origen</label>
              <Select
                value={importFromProjectId || ""}
                onValueChange={(v) => v && loadImportCandidates(v)}
              >
                <SelectTrigger className="mt-1">
                  <span>
                    {importFromProjectId
                      ? otherProjects.find((p) => p.id === importFromProjectId)?.name
                      : "— seleccionar proyecto —"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {otherProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {otherProjects.length === 0 && (
                <p className="text-[11px] text-muted-foreground italic mt-1">
                  No hay otros proyectos disponibles.
                </p>
              )}
            </div>

            {importCandidates.length > 0 && (
              <>
                <div className="flex items-center justify-between text-xs border-t pt-2">
                  <span className="text-muted-foreground">
                    {importChecked.size} de {importCandidates.length} seleccionados
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-[#B85A0F] hover:underline"
                      onClick={() => setImportChecked(new Set(importCandidates.map((s) => s.id)))}
                    >
                      Todos
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:underline"
                      onClick={() => setImportChecked(new Set())}
                    >
                      Ninguno
                    </button>
                  </div>
                </div>
                <div className="border rounded-md max-h-[320px] overflow-auto">
                  {importCandidates.map((s) => {
                    const dup = suppliers.some((mine) => mine.name_normalized === s.name_normalized);
                    return (
                      <label
                        key={s.id}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 border-b last:border-b-0 text-xs cursor-pointer hover:bg-muted/20",
                          dup && "opacity-50"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={importChecked.has(s.id)}
                          disabled={dup}
                          onChange={(e) => {
                            setImportChecked((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(s.id);
                              else next.delete(s.id);
                              return next;
                            });
                          }}
                        />
                        <span className="flex-1 font-medium">{s.name}</span>
                        {dup && <span className="text-[10px] text-amber-700">ya existe</span>}
                        {s.tax_id && <span className="text-[10px] font-mono text-muted-foreground">{s.tax_id}</span>}
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>
                Cancelar
              </Button>
              <Button
                onClick={submitImport}
                disabled={importing || importChecked.size === 0}
              >
                {importing ? "Importando…" : `Importar ${importChecked.size} proveedor${importChecked.size === 1 ? "" : "es"}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
