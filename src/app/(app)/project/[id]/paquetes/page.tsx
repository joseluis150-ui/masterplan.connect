"use client";

import { useEffect, useState, useCallback, use } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { PACKAGE_STATUSES } from "@/lib/constants/units";
import { formatNumber } from "@/lib/utils/formula";
import { SearchableSelect } from "@/components/shared/searchable-select";
import type { ProcurementPackage, ProcurementLine, Insumo, PackageStatus, PurchaseType } from "@/lib/types/database";
import { Plus, Trash2, Truck, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface PackageWithLines extends ProcurementPackage {
  lines: (ProcurementLine & { insumo: Insumo })[];
  estimated_amount: number;
}

export default function PaquetesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const [packages, setPackages] = useState<PackageWithLines[]>([]);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState<Partial<ProcurementPackage> | null>(null);
  const [addLineDialogOpen, setAddLineDialogOpen] = useState(false);
  const [linePackageId, setLinePackageId] = useState<string | null>(null);
  const [newLine, setNewLine] = useState({ insumo_id: "", quantity: "1" });
  const supabase = createClient();

  const loadData = useCallback(async () => {
    const [pkgRes, insRes] = await Promise.all([
      supabase.from("procurement_packages").select("*").eq("project_id", projectId).order("created_at"),
      supabase.from("insumos").select("*").eq("project_id", projectId).order("description"),
    ]);

    const pkgs = pkgRes.data || [];
    const pkgIds = pkgs.map((p) => p.id);
    let allLines: (ProcurementLine & { insumo: Insumo })[] = [];
    if (pkgIds.length > 0) {
      const { data } = await supabase.from("procurement_lines").select("*, insumo:insumos(*)").in("package_id", pkgIds);
      allLines = (data || []) as (ProcurementLine & { insumo: Insumo })[];
    }

    const enriched: PackageWithLines[] = pkgs.map((pkg) => {
      const lines = allLines.filter((l) => l.package_id === pkg.id);
      const estimated_amount = lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.insumo?.pu_usd || 0), 0);
      return { ...pkg, lines, estimated_amount };
    });

    setPackages(enriched);
    setInsumos(insRes.data || []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  function openNew() {
    setEditingPkg({ name: "", purchase_type: "directa" as PurchaseType, advance_days: 7, suggested_supplier: "", awarded_supplier: "" });
    setDialogOpen(true);
  }

  async function savePackage() {
    if (!editingPkg) return;
    const record = {
      project_id: projectId,
      name: editingPkg.name || "",
      purchase_type: editingPkg.purchase_type || "directa",
      advance_days: Number(editingPkg.advance_days) || 0,
      suggested_supplier: editingPkg.suggested_supplier || null,
      awarded_supplier: editingPkg.awarded_supplier || null,
    };
    if (editingPkg.id) {
      await supabase.from("procurement_packages").update(record).eq("id", editingPkg.id);
      toast.success("Paquete actualizado");
    } else {
      await supabase.from("procurement_packages").insert(record);
      toast.success("Paquete creado");
    }
    setDialogOpen(false);
    loadData();
  }

  async function updateStatus(pkgId: string, status: PackageStatus) {
    await supabase.from("procurement_packages").update({ status }).eq("id", pkgId);
    toast.success("Estado actualizado");
    loadData();
  }

  async function deletePackage(id: string) {
    if (!confirm("¿Eliminar este paquete?")) return;
    await supabase.from("procurement_packages").delete().eq("id", id);
    toast.success("Paquete eliminado");
    loadData();
  }

  function openAddLine(pkgId: string) {
    setLinePackageId(pkgId);
    setNewLine({ insumo_id: "", quantity: "1" });
    setAddLineDialogOpen(true);
  }

  async function addLine() {
    if (!linePackageId || !newLine.insumo_id) return;
    await supabase.from("procurement_lines").insert({
      package_id: linePackageId,
      insumo_id: newLine.insumo_id,
      quantity: Number(newLine.quantity) || 1,
    });
    setAddLineDialogOpen(false);
    toast.success("Insumo agregado al paquete");
    loadData();
  }

  async function deleteLine(lineId: string) {
    await supabase.from("procurement_lines").delete().eq("id", lineId);
    toast.success("Línea eliminada");
    loadData();
  }

  function toggleExpanded(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  }

  const statusColor = (status: string) => {
    switch (status) {
      case "borrador": return "secondary";
      case "listo": return "outline";
      case "en_proceso": return "default";
      case "adjudicado": return "default";
      case "cerrado": return "secondary";
      default: return "outline";
    }
  };

  const statusLabel = (status: string) => PACKAGE_STATUSES.find((s) => s.value === status)?.label || status;

  const statusFlow: PackageStatus[] = ["borrador", "listo", "en_proceso", "adjudicado", "cerrado"];
  const nextStatus = (current: string) => {
    const idx = statusFlow.indexOf(current as PackageStatus);
    return idx >= 0 && idx < statusFlow.length - 1 ? statusFlow[idx + 1] : null;
  };

  if (loading) return <div className="animate-pulse h-96 bg-muted rounded-lg" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Paquetes de Contratación</h1>
          <p className="text-muted-foreground">Paso 8: Agrupa insumos para gestión de compras</p>
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Nuevo Paquete</Button>
      </div>

      {packages.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Truck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Sin paquetes</h3>
            <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Nuevo Paquete</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {packages.map((pkg) => (
            <Card key={pkg.id}>
              <Collapsible open={expanded.has(pkg.id)} onOpenChange={() => toggleExpanded(pkg.id)}>
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                    {expanded.has(pkg.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="flex-1 text-left font-medium">{pkg.name}</span>
                    <Badge variant={pkg.purchase_type === "licitacion" ? "default" : "secondary"}>{pkg.purchase_type === "licitacion" ? "Licitación" : "Compra directa"}</Badge>
                    <Badge variant={statusColor(pkg.status) as "default" | "secondary" | "outline"}>{statusLabel(pkg.status)}</Badge>
                    <span className="font-mono text-sm">{formatNumber(pkg.estimated_amount)} USD</span>
                    <span className="text-xs text-muted-foreground">{pkg.lines.length} insumos</span>
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      {nextStatus(pkg.status) && (
                        <Button variant="outline" size="sm" onClick={() => updateStatus(pkg.id, nextStatus(pkg.status)!)}>
                          → {statusLabel(nextStatus(pkg.status)!)}
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deletePackage(pkg.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </div>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Separator />
                  <div className="p-4">
                    <div className="flex gap-4 mb-3 text-sm text-muted-foreground">
                      <span>Anticipación: {pkg.advance_days} días</span>
                      {pkg.suggested_supplier && <span>Sugerido: {pkg.suggested_supplier}</span>}
                      {pkg.awarded_supplier && <span>Adjudicado: {pkg.awarded_supplier}</span>}
                    </div>
                    {pkg.lines.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Insumo</TableHead>
                            <TableHead>Unidad</TableHead>
                            <TableHead className="text-right">Cantidad</TableHead>
                            <TableHead className="text-right">PU USD</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pkg.lines.map((line) => (
                            <TableRow key={line.id}>
                              <TableCell>{line.insumo?.description || "—"}</TableCell>
                              <TableCell>{line.insumo?.unit || "—"}</TableCell>
                              <TableCell className="text-right font-mono">{Number(line.quantity)}</TableCell>
                              <TableCell className="text-right font-mono">{formatNumber(Number(line.insumo?.pu_usd || 0))}</TableCell>
                              <TableCell className="text-right font-mono font-medium">{formatNumber(Number(line.quantity) * Number(line.insumo?.pu_usd || 0))}</TableCell>
                              <TableCell><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteLine(line.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">Sin insumos</p>
                    )}
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => openAddLine(pkg.id)}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Agregar Insumo
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))}
        </div>
      )}

      {/* Package Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingPkg?.id ? "Editar" : "Nuevo"} Paquete</DialogTitle></DialogHeader>
          {editingPkg && (
            <div className="space-y-4">
              <div className="space-y-2"><Label>Nombre</Label><Input value={editingPkg.name || ""} onChange={(e) => setEditingPkg({ ...editingPkg, name: e.target.value })} placeholder="Ej: Paquete de acero" required /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo de compra</Label>
                  <Select value={editingPkg.purchase_type || "directa"} onValueChange={(v) => v && setEditingPkg({ ...editingPkg, purchase_type: v as PurchaseType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="directa">Compra directa</SelectItem>
                      <SelectItem value="licitacion">Licitación</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Días anticipación</Label><Input type="number" value={editingPkg.advance_days || 0} onChange={(e) => setEditingPkg({ ...editingPkg, advance_days: Number(e.target.value) })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Proveedor sugerido</Label><Input value={editingPkg.suggested_supplier || ""} onChange={(e) => setEditingPkg({ ...editingPkg, suggested_supplier: e.target.value })} /></div>
                <div className="space-y-2"><Label>Proveedor adjudicado</Label><Input value={editingPkg.awarded_supplier || ""} onChange={(e) => setEditingPkg({ ...editingPkg, awarded_supplier: e.target.value })} /></div>
              </div>
              <Button onClick={savePackage} className="w-full" disabled={!editingPkg.name}>{editingPkg.id ? "Actualizar" : "Crear"}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Line Dialog */}
      <Dialog open={addLineDialogOpen} onOpenChange={setAddLineDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Agregar Insumo al Paquete</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Insumo</Label>
              <SearchableSelect
                options={insumos.map((i) => ({
                  value: i.id,
                  label: i.description,
                  sublabel: i.unit,
                }))}
                value={newLine.insumo_id}
                onChange={(v) => setNewLine({ ...newLine, insumo_id: v })}
                placeholder="Buscar insumo..."
              />
            </div>
            <div className="space-y-2"><Label>Cantidad</Label><Input type="number" step="any" value={newLine.quantity} onChange={(e) => setNewLine({ ...newLine, quantity: e.target.value })} /></div>
            <Button onClick={addLine} className="w-full" disabled={!newLine.insumo_id}>Agregar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
