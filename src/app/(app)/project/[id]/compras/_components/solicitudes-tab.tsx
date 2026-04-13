"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
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
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, ChevronDown, ChevronRight, Package as PackageIcon } from "lucide-react";
import { toast } from "sonner";
import { SC_STATUSES, DEFAULT_UNITS } from "@/lib/constants/units";
import { formatNumber } from "@/lib/utils/formula";
import type {
  PurchaseRequest,
  PurchaseRequestLine,
  EdtSubcategory,
  EdtCategory,
  ProcurementPackage,
  ProcurementLine,
  PurchaseRequestStatus,
} from "@/lib/types/database";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
}

export function SolicitudesTab({ projectId }: Props) {
  const supabase = createClient();
  const [requests, setRequests] = useState<(PurchaseRequest & { lines: PurchaseRequestLine[] })[]>([]);
  const [categories, setCategories] = useState<EdtCategory[]>([]);
  const [subcategories, setSubcategories] = useState<EdtSubcategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  // Import from packages
  const [packageDialogOpen, setPackageDialogOpen] = useState(false);
  const [packages, setPackages] = useState<(ProcurementPackage & { procurement_lines: (ProcurementLine & { insumo: { description: string; unit: string } })[] })[]>([]);
  const [selectedPackages, setSelectedPackages] = useState<Set<string>>(new Set());
  const [importingPackages, setImportingPackages] = useState(false);

  const loadData = useCallback(async () => {
    const [reqRes, catsRes, subsRes] = await Promise.all([
      supabase
        .from("purchase_requests")
        .select("*, lines:purchase_request_lines(*)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      supabase.from("edt_categories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
    ]);
    setRequests((reqRes.data || []) as (PurchaseRequest & { lines: PurchaseRequestLine[] })[]);
    setCategories(catsRes.data || []);
    setSubcategories(subsRes.data || []);
    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // Create a new manual SC
  async function createManualSC() {
    setCreating(true);
    try {
      // Get next number
      const { data: numData } = await supabase.rpc("next_document_number", {
        p_project_id: projectId,
        p_doc_type: "SC",
      });
      const number = numData || `SC-${new Date().getFullYear()}-???`;

      const { data, error } = await supabase
        .from("purchase_requests")
        .insert({
          project_id: projectId,
          number,
          origin: "manual",
          status: "pending",
        })
        .select("*, lines:purchase_request_lines(*)")
        .single();

      if (error) { toast.error("Error al crear SC"); return; }
      setRequests([data as PurchaseRequest & { lines: PurchaseRequestLine[] }, ...requests]);
      setExpanded(new Set([...expanded, data.id]));
      toast.success(`Solicitud ${number} creada`);
    } finally {
      setCreating(false);
    }
  }

  // Add line to SC
  async function addLine(requestId: string) {
    const defaultSub = subcategories[0];
    const { data, error } = await supabase
      .from("purchase_request_lines")
      .insert({
        request_id: requestId,
        subcategory_id: defaultSub?.id || null,
        description: "",
        quantity: 1,
        unit: "U",
      })
      .select()
      .single();

    if (error) { toast.error("Error al agregar línea"); return; }
    setRequests(
      requests.map((r) =>
        r.id === requestId ? { ...r, lines: [...r.lines, data as PurchaseRequestLine] } : r
      )
    );
  }

  // Update line field
  async function updateLine(requestId: string, lineId: string, field: string, value: unknown) {
    await supabase.from("purchase_request_lines").update({ [field]: value }).eq("id", lineId);
    setRequests(
      requests.map((r) =>
        r.id === requestId
          ? { ...r, lines: r.lines.map((l) => (l.id === lineId ? { ...l, [field]: value } : l)) }
          : r
      )
    );
  }

  // Delete line
  async function deleteLine(requestId: string, lineId: string) {
    await supabase.from("purchase_request_lines").delete().eq("id", lineId);
    setRequests(
      requests.map((r) =>
        r.id === requestId ? { ...r, lines: r.lines.filter((l) => l.id !== lineId) } : r
      )
    );
  }

  // Update SC header
  async function updateSC(id: string, field: string, value: unknown) {
    await supabase.from("purchase_requests").update({ [field]: value }).eq("id", id);
    setRequests(requests.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  // Delete SC
  async function deleteSC(id: string) {
    if (!confirm("¿Eliminar esta solicitud y todas sus líneas?")) return;
    await supabase.from("purchase_requests").delete().eq("id", id);
    setRequests(requests.filter((r) => r.id !== id));
    toast.success("Solicitud eliminada");
  }

  // Import from packages
  async function openPackageImport() {
    const { data } = await supabase
      .from("procurement_packages")
      .select("*, procurement_lines(*, insumo:insumos(description, unit))")
      .eq("project_id", projectId)
      .eq("status", "aprobado")
      .order("created_at", { ascending: false });
    setPackages((data || []) as typeof packages);
    setSelectedPackages(new Set());
    setPackageDialogOpen(true);
  }

  async function importFromPackages() {
    if (selectedPackages.size === 0) return;
    setImportingPackages(true);
    try {
      for (const pkgId of selectedPackages) {
        const pkg = packages.find((p) => p.id === pkgId);
        if (!pkg || pkg.procurement_lines.length === 0) continue;

        // Create SC
        const { data: numData } = await supabase.rpc("next_document_number", {
          p_project_id: projectId,
          p_doc_type: "SC",
        });
        const number = numData || `SC-${new Date().getFullYear()}-???`;

        const { data: sc, error: scErr } = await supabase
          .from("purchase_requests")
          .insert({
            project_id: projectId,
            number,
            origin: "package",
            package_id: pkgId,
            status: "pending",
            comment: `Desde paquete: ${pkg.name}`,
          })
          .select()
          .single();

        if (scErr || !sc) continue;

        // Create lines from procurement_lines
        const lines = pkg.procurement_lines.map((pl) => ({
          request_id: sc.id,
          subcategory_id: pl.subcategory_origin || null,
          description: pl.insumo?.description || "Sin descripción",
          quantity: pl.quantity,
          unit: pl.insumo?.unit || "U",
          need_date: pl.need_date || null,
        }));

        await supabase.from("purchase_request_lines").insert(lines);
      }

      toast.success(`${selectedPackages.size} solicitud(es) creada(s) desde paquetes`);
      setPackageDialogOpen(false);
      loadData();
    } finally {
      setImportingPackages(false);
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function getSubName(subId: string | null) {
    if (!subId) return "—";
    const sub = subcategories.find((s) => s.id === subId);
    if (!sub) return "—";
    const cat = categories.find((c) => c.id === sub.category_id);
    return `${cat?.code || ""}.${sub.code?.split(".")[1] || ""} ${sub.name}`;
  }

  function getStatusBadge(status: PurchaseRequestStatus) {
    const s = SC_STATUSES.find((st) => st.value === status);
    return (
      <Badge variant="outline" className="text-xs" style={{ borderColor: s?.color, color: s?.color }}>
        {s?.label || status}
      </Badge>
    );
  }

  if (loading) return <div className="p-6 text-muted-foreground">Cargando solicitudes...</div>;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Solicitudes de Compra</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={openPackageImport}>
            <PackageIcon className="h-4 w-4 mr-1" /> Desde Paquetes
          </Button>
          <Button size="sm" onClick={createManualSC} disabled={creating}>
            <Plus className="h-4 w-4 mr-1" /> Nueva Solicitud
          </Button>
        </div>
      </div>

      {requests.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No hay solicitudes de compra. Crea una nueva o importa desde paquetes.
        </div>
      )}

      {/* SC List */}
      <div className="space-y-3">
        {requests.map((sc) => {
          const isExpanded = expanded.has(sc.id);
          return (
            <div key={sc.id} className="border rounded-lg overflow-hidden">
              {/* SC Header */}
              <div
                className="flex items-center gap-3 px-4 py-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => toggleExpand(sc.id)}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className="font-mono text-sm font-semibold">{sc.number}</span>
                {getStatusBadge(sc.status)}
                <span className="text-xs text-muted-foreground">
                  {sc.origin === "package" ? "Paquete" : "Manual"} &middot; {sc.date} &middot; {sc.lines.length} línea(s)
                </span>
                <div className="flex-1" />
                <Select
                  value={sc.status}
                  onValueChange={(v) => updateSC(sc.id, "status", v)}
                >
                  <SelectTrigger className="w-[140px] h-8 text-xs" onClick={(e) => e.stopPropagation()}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SC_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); deleteSC(sc.id); }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {/* SC Lines */}
              {isExpanded && (
                <div className="p-4 space-y-2">
                  {sc.comment !== null && sc.comment !== "" && (
                    <p className="text-xs text-muted-foreground italic mb-2">{sc.comment}</p>
                  )}

                  {/* Lines table header */}
                  {sc.lines.length > 0 && (
                    <div className="grid grid-cols-[1fr_2fr_100px_80px_120px_40px] gap-2 text-xs text-muted-foreground font-medium px-2">
                      <span>EDT</span>
                      <span>Descripción</span>
                      <span>Cantidad</span>
                      <span>Unidad</span>
                      <span>F. Necesidad</span>
                      <span />
                    </div>
                  )}

                  {sc.lines.map((line) => (
                    <div
                      key={line.id}
                      className="grid grid-cols-[1fr_2fr_100px_80px_120px_40px] gap-2 items-center"
                    >
                      <Select
                        value={line.subcategory_id || ""}
                        onValueChange={(v) => updateLine(sc.id, line.id, "subcategory_id", v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="EDT..." />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((cat) => {
                            const subs = subcategories.filter((s) => s.category_id === cat.id);
                            return subs.map((sub) => (
                              <SelectItem key={sub.id} value={sub.id} className="text-xs">
                                {cat.code}.{sub.code?.split(".")[1]} {sub.name}
                              </SelectItem>
                            ));
                          })}
                        </SelectContent>
                      </Select>

                      <Input
                        className="h-8 text-xs"
                        defaultValue={line.description}
                        placeholder="Descripción..."
                        onBlur={(e) => updateLine(sc.id, line.id, "description", e.target.value)}
                      />

                      <Input
                        className="h-8 text-xs text-right"
                        type="number"
                        defaultValue={line.quantity}
                        onBlur={(e) =>
                          updateLine(sc.id, line.id, "quantity", parseFloat(e.target.value) || 1)
                        }
                      />

                      <Select
                        value={line.unit}
                        onValueChange={(v) => updateLine(sc.id, line.id, "unit", v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DEFAULT_UNITS.map((u) => (
                            <SelectItem key={u} value={u} className="text-xs">
                              {u}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Input
                        className="h-8 text-xs"
                        type="date"
                        defaultValue={line.need_date || ""}
                        onBlur={(e) =>
                          updateLine(sc.id, line.id, "need_date", e.target.value || null)
                        }
                      />

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => deleteLine(sc.id, line.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}

                  <Button variant="outline" size="sm" className="mt-2" onClick={() => addLine(sc.id)}>
                    <Plus className="h-4 w-4 mr-1" /> Agregar línea
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Package Import Dialog */}
      <Dialog open={packageDialogOpen} onOpenChange={setPackageDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Importar desde Paquetes</DialogTitle>
          </DialogHeader>
          {packages.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No hay paquetes aprobados para importar.
            </p>
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-auto">
              {packages.map((pkg) => (
                <label
                  key={pkg.id}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                    selectedPackages.has(pkg.id)
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedPackages.has(pkg.id)}
                    onChange={() => {
                      setSelectedPackages((prev) => {
                        const next = new Set(prev);
                        if (next.has(pkg.id)) next.delete(pkg.id);
                        else next.add(pkg.id);
                        return next;
                      });
                    }}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{pkg.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {pkg.purchase_type} &middot; {pkg.procurement_lines.length} insumo(s) &middot; {pkg.status}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setPackageDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={importFromPackages}
              disabled={selectedPackages.size === 0 || importingPackages}
            >
              {importingPackages
                ? "Importando..."
                : `Importar ${selectedPackages.size} paquete(s)`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
