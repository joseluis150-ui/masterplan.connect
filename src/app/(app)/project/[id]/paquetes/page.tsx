"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select";
import { Plus, Package, Truck, ShoppingCart, Pencil, Trash2, ChevronRight, Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ProcurementPackage, PurchaseType } from "@/lib/types/database";

/**
 * Lista de paquetes de procurement del proyecto. Entry point del módulo:
 * acá se ven todos los paquetes existentes y se crean nuevos. Click en un
 * paquete navega a su vista de detalle (`paquetes/[packageId]`) donde se
 * ven sus insumos asignados y se puede asignar más líneas desde una tabla
 * tipo cuantificación read-only.
 *
 * Reemplaza la pantalla anterior monolítica que mostraba toda la tabla de
 * cuantificación con drag-to-paint para asignar — ahora la asignación
 * vive en el detalle del paquete.
 */
export default function PaquetesListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const supabase = createClient();

  const [packages, setPackages] = useState<ProcurementPackage[]>([]);
  /** Conteo de procurement_lines (insumos asignados) por paquete — se
   *  muestra en cada card para ver de un vistazo qué tan armado está. */
  const [pkgLineCounts, setPkgLineCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  // Crear/editar
  const [editingPkg, setEditingPkg] = useState<Partial<ProcurementPackage> | null>(null);
  const [saving, setSaving] = useState(false);

  // Eliminar
  const [deletingPkg, setDeletingPkg] = useState<ProcurementPackage | null>(null);

  const loadData = useCallback(async () => {
    const [pkgsRes, plRes] = await Promise.all([
      supabase.from("procurement_packages").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
      // Sólo necesitamos package_id para el conteo — reduce payload
      supabase.from("procurement_lines").select("package_id"),
    ]);
    const pkgs = (pkgsRes.data ?? []) as ProcurementPackage[];
    setPackages(pkgs);

    // Conteo de insumos por paquete — sólo lineas que pertenezcan a
    // paquetes del proyecto actual (la query no puede filtrar
    // directamente porque procurement_lines no tiene project_id).
    const pkgIdSet = new Set(pkgs.map((p) => p.id));
    const counts = new Map<string, number>();
    for (const row of (plRes.data ?? []) as { package_id: string }[]) {
      if (!pkgIdSet.has(row.package_id)) continue;
      counts.set(row.package_id, (counts.get(row.package_id) || 0) + 1);
    }
    setPkgLineCounts(counts);
    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  async function savePackage() {
    if (!editingPkg || !editingPkg.name?.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }
    setSaving(true);
    if (editingPkg.id) {
      // Update
      const { error } = await supabase
        .from("procurement_packages")
        .update({
          name: editingPkg.name,
          purchase_type: editingPkg.purchase_type,
          advance_days: editingPkg.advance_days ?? 0,
          suggested_supplier: editingPkg.suggested_supplier ?? null,
        })
        .eq("id", editingPkg.id);
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Paquete actualizado");
    } else {
      // Create
      const { error } = await supabase
        .from("procurement_packages")
        .insert({
          project_id: projectId,
          name: editingPkg.name,
          purchase_type: editingPkg.purchase_type ?? "licitacion",
          advance_days: editingPkg.advance_days ?? 0,
          status: "borrador",
          suggested_supplier: editingPkg.suggested_supplier ?? null,
        });
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Paquete creado");
    }
    setEditingPkg(null);
    await loadData();
  }

  async function deletePackage() {
    if (!deletingPkg) return;
    if (deletingPkg.status === "aprobado") {
      toast.error("No se puede eliminar un paquete aprobado");
      setDeletingPkg(null);
      return;
    }
    // Eliminar también las procurement_lines asociadas (la FK no tiene
    // ON DELETE CASCADE en algunas instalaciones — más seguro borrar
    // explícitamente).
    await supabase.from("procurement_lines").delete().eq("package_id", deletingPkg.id);
    const { error } = await supabase.from("procurement_packages").delete().eq("id", deletingPkg.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Paquete eliminado");
    setDeletingPkg(null);
    await loadData();
  }

  if (loading) {
    return <div className="p-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  // Agrupar por tipo para mostrar Licitaciones primero
  const licitaciones = packages.filter((p) => p.purchase_type === "licitacion");
  const directas = packages.filter((p) => p.purchase_type === "directa");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Paquetes de procurement</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Agrupá insumos de la cuantificación en paquetes para licitar o comprar directo.
          </p>
        </div>
        <Button
          onClick={() => setEditingPkg({ name: "", purchase_type: "licitacion", advance_days: 0 })}
          className="bg-[#E87722] hover:bg-[#E87722]/90 text-white"
        >
          <Plus className="h-4 w-4 mr-2" /> Nuevo paquete
        </Button>
      </div>

      {packages.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <Package className="h-10 w-10 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Aún no hay paquetes. Creá el primero para empezar a agrupar insumos.
            </p>
            <Button
              onClick={() => setEditingPkg({ name: "", purchase_type: "licitacion", advance_days: 0 })}
              className="bg-[#E87722] hover:bg-[#E87722]/90 text-white"
            >
              <Plus className="h-4 w-4 mr-2" /> Crear primer paquete
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {[
            { label: "Licitaciones", icon: Truck, list: licitaciones },
            { label: "Compra directa", icon: ShoppingCart, list: directas },
          ].map(({ label, icon: Icon, list }) => list.length > 0 && (
            <div key={label}>
              <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                <Icon className="h-3.5 w-3.5" />
                {label} <span className="text-muted-foreground/60 font-normal">({list.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map((pkg) => (
                  <PackageCard
                    key={pkg.id}
                    pkg={pkg}
                    lineCount={pkgLineCounts.get(pkg.id) ?? 0}
                    onOpen={() => router.push(`/project/${projectId}/paquetes/${pkg.id}`)}
                    onEdit={() => setEditingPkg(pkg)}
                    onDelete={() => setDeletingPkg(pkg)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog crear / editar */}
      <Dialog open={!!editingPkg} onOpenChange={(o) => { if (!o && !saving) setEditingPkg(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-[#E87722]" />
              {editingPkg?.id ? "Editar paquete" : "Nuevo paquete"}
            </DialogTitle>
            <DialogDescription>
              {editingPkg?.id
                ? "Cambiá el nombre, tipo o días de anticipación del paquete."
                : "Creá un paquete vacío. Después agregás insumos desde la vista del paquete."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Nombre *</Label>
              <Input
                autoFocus
                value={editingPkg?.name ?? ""}
                onChange={(e) => setEditingPkg((prev) => prev ? { ...prev, name: e.target.value } : prev)}
                placeholder="Ej. Compra de hormigón"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select
                value={editingPkg?.purchase_type ?? "licitacion"}
                onValueChange={(v) => setEditingPkg((prev) => prev ? { ...prev, purchase_type: v as PurchaseType } : prev)}
              >
                <SelectTrigger>
                  <span>{editingPkg?.purchase_type === "directa" ? "Compra directa" : "Licitación"}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="licitacion">Licitación</SelectItem>
                  <SelectItem value="directa">Compra directa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Días de anticipación de pedido</Label>
              <Input
                type="number"
                min={0}
                value={editingPkg?.advance_days ?? 0}
                onChange={(e) => setEditingPkg((prev) => prev ? { ...prev, advance_days: Number(e.target.value) || 0 } : prev)}
              />
              <p className="text-[11px] text-muted-foreground">
                Cuántos días antes del need date arranca el flow de pedido.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPkg(null)} disabled={saving}>Cancelar</Button>
            <Button
              onClick={savePackage}
              disabled={saving || !editingPkg?.name?.trim()}
              className="bg-[#E87722] hover:bg-[#E87722]/90 text-white"
            >
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</> : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog eliminar */}
      <Dialog open={!!deletingPkg} onOpenChange={(o) => { if (!o) setDeletingPkg(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600">Eliminar paquete</DialogTitle>
            <DialogDescription>
              {deletingPkg && (
                <>
                  Estás por eliminar <span className="font-semibold">{deletingPkg.name}</span>.
                  {(pkgLineCounts.get(deletingPkg.id) ?? 0) > 0 && (
                    <> Esto también desasignará <span className="font-semibold">{pkgLineCounts.get(deletingPkg.id)} insumo{pkgLineCounts.get(deletingPkg.id) === 1 ? "" : "s"}</span> que tenía adentro.</>
                  )}
                  {" "}Esta acción no se puede deshacer.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingPkg(null)}>Cancelar</Button>
            <Button onClick={deletePackage} className="bg-red-600 hover:bg-red-700 text-white">
              <Trash2 className="h-4 w-4 mr-2" /> Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function PackageCard({
  pkg, lineCount, onOpen, onEdit, onDelete,
}: {
  pkg: ProcurementPackage;
  lineCount: number;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isApproved = pkg.status === "aprobado";
  return (
    <Card
      className={cn(
        "group cursor-pointer hover:shadow-md transition-shadow",
        isApproved && "ring-1 ring-emerald-500/30"
      )}
      onClick={onOpen}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate" title={pkg.name}>{pkg.name}</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Creado {new Date(pkg.created_at).toLocaleDateString("es")}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground transition-colors flex-shrink-0 mt-0.5" />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant="outline"
            className={pkg.purchase_type === "licitacion"
              ? "text-xs border-[#E87722]/30 text-[#E87722] bg-[#E87722]/5"
              : "text-xs"}
          >
            {pkg.purchase_type === "licitacion" ? "Licitación" : "Compra directa"}
          </Badge>
          {isApproved ? (
            <Badge className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
              <Lock className="h-3 w-3 mr-0.5" /> Aprobado
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Borrador
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            <Package className="h-3 w-3 mr-0.5" /> {lineCount} insumo{lineCount === 1 ? "" : "s"}
          </Badge>
        </div>

        {/* Acciones — solo si no está aprobado y al hover de la card */}
        {!isApproved && (
          <div
            className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onEdit}>
              <Pencil className="h-3 w-3 mr-1" /> Editar
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50" onClick={onDelete}>
              <Trash2 className="h-3 w-3 mr-1" /> Eliminar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
