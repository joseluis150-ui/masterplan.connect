"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, PackagePlus, X, Lock } from "lucide-react";
import { formatNumber } from "@/lib/utils/formula";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import type {
  Articulo, EdtCategory, EdtSubcategory, Sector, Insumo, ProcurementPackage,
} from "@/lib/types/database";

/** Composición de un insumo + el artículo donde aparece + dónde se usa
 *  ese artículo en el proyecto (sector/categoría/subcategoría) +
 *  cantidad total proyectada. Se computa en el componente padre y se
 *  pasa al modal vía prop. */
export interface CompositionDetail {
  composition_id: string;
  articulo: Articulo | null;
  /** Cantidad total del insumo necesaria a través de esta composición.
   *  Suma sobre todas las quantification_lines del artículo:
   *    qty_qline × qty_comp × (1 + waste/100) × (1 + margin/100). */
  total_quantity: number;
  /** Lugares donde aparece el artículo (cada qline da uno). */
  used_in: { sector: Sector | null; category: EdtCategory | null; subcategory: EdtSubcategory | null; quantity: number }[];
  /** Si null = no asignada; si es una entry, ya está en algún paquete. */
  assigned_to: { packageId: string; packageName: string } | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  insumo: Insumo | null;
  compositions: CompositionDetail[];
  /** Paquete actual al que se está asignando. Usado para distinguir
   *  composiciones "ya en este paquete" vs "en otro". */
  currentPackage: ProcurementPackage;
  supabase: SupabaseClient;
  projectId: string;
  /** Se llama tras aplicar cambios para que el padre recargue datos. */
  onApplied: () => Promise<void>;
}

/**
 * Modal de detalle de un insumo en el tab "Asignar".
 *
 * Lista cada composición del insumo (1 por artículo donde aparece) y
 * muestra todas las ubicaciones del artículo en cuantificación
 * (sector / categoría / subcategoría / cantidad parcial).
 *
 * El usuario marca/desmarca cada composición independientemente:
 *   - Composiciones ya en este paquete → pre-marcadas (toggleables)
 *   - Composiciones en otro paquete → bloqueadas con badge (no se pueden
 *     mover sin antes quitarlas del otro paquete)
 *   - Composiciones sin asignar → checkbox vacío
 *
 * Al hacer "Aplicar":
 *   - Las que se marcaron y no estaban en este paquete → ASSIGN
 *   - Las que se desmarcaron y estaban en este paquete → REMOVE
 *   - Las bloqueadas se ignoran
 */
export function InsumoCompositionDialog({
  open, onClose, insumo, compositions, currentPackage, supabase, projectId, onApplied,
}: Props) {
  /** Estado de selección actual del usuario. Inicializado desde
   *  `compositions` (las que están en este paquete arrancan marcadas). */
  const initialSelected = useMemo(() => {
    const s = new Set<string>();
    for (const c of compositions) {
      if (c.assigned_to?.packageId === currentPackage.id) s.add(c.composition_id);
    }
    return s;
  }, [compositions, currentPackage.id]);

  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const [applying, setApplying] = useState(false);

  // Re-sync cuando cambian las compositions (ej. el padre cargó datos
  // frescos). Sólo si el modal está abierto.
  useMemo(() => {
    if (open) setSelected(new Set(initialSelected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, insumo?.id]);

  const isApproved = currentPackage.status === "aprobado";

  /** Composiciones que el usuario puede tocar (no están bloqueadas en
   *  otro paquete). Sirve para el "Seleccionar todo". */
  const selectableComps = compositions.filter((c) =>
    !c.assigned_to || c.assigned_to.packageId === currentPackage.id
  );
  const allSelectableSelected = selectableComps.length > 0 &&
    selectableComps.every((c) => selected.has(c.composition_id));

  function toggleComp(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelectableSelected) {
      // Deseleccionar todas las seleccionables
      setSelected((prev) => {
        const next = new Set(prev);
        for (const c of selectableComps) next.delete(c.composition_id);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const c of selectableComps) next.add(c.composition_id);
        return next;
      });
    }
  }

  async function apply() {
    if (isApproved) {
      toast.error("Paquete aprobado — no se puede modificar");
      return;
    }
    // Calcular qué hay que asignar y qué hay que remover
    const toAssign: string[] = [];
    const toRemove: string[] = [];
    for (const c of compositions) {
      const wasHere = c.assigned_to?.packageId === currentPackage.id;
      const wantsHere = selected.has(c.composition_id);
      if (wantsHere && !wasHere && !c.assigned_to) toAssign.push(c.composition_id);
      if (!wantsHere && wasHere) toRemove.push(c.composition_id);
      // Composiciones en otro paquete (c.assigned_to && !wasHere) se
      // ignoran — el checkbox debería estar disabled.
    }

    if (toAssign.length === 0 && toRemove.length === 0) {
      toast.info("Sin cambios para aplicar");
      onClose();
      return;
    }

    setApplying(true);
    try {
      if (toAssign.length > 0) {
        const { data, error } = await supabase.rpc("assign_compositions_to_package", {
          p_project_id: projectId,
          p_composition_ids: toAssign,
          p_package_id: currentPackage.id,
        });
        if (error) throw error;
        const r = (data ?? {}) as { assigned: number; conflicts: number; already_in_package: number };
        if (r.assigned > 0) toast.success(`${r.assigned} composición${r.assigned === 1 ? "" : "es"} asignada${r.assigned === 1 ? "" : "s"}`);
        if (r.conflicts > 0) toast.warning(`${r.conflicts} ya estaban en otro paquete`);
      }
      if (toRemove.length > 0) {
        const { data, error } = await supabase.rpc("remove_compositions_from_package", {
          p_project_id: projectId,
          p_composition_ids: toRemove,
          p_package_id: currentPackage.id,
        });
        if (error) throw error;
        const r = (data ?? {}) as { removed: number };
        if (r.removed > 0) toast.success(`${r.removed} composición${r.removed === 1 ? "" : "es"} removida${r.removed === 1 ? "" : "s"}`);
      }
      await onApplied();
      onClose();
    } catch (e) {
      toast.error(`Error: ${(e as Error).message}`);
    }
    setApplying(false);
  }

  if (!insumo) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !applying) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-[#E87722]" />
            <span className="text-xs font-mono text-muted-foreground">#{insumo.code}</span>
            <span>{insumo.description}</span>
          </DialogTitle>
          <DialogDescription>
            Seleccioná en qué artículos asignar este insumo al paquete{" "}
            <span className="font-semibold">"{currentPackage.name}"</span>. Las
            composiciones bloqueadas (🔒) ya están en otro paquete del proyecto
            y no se pueden mover desde acá — primero quitalas en el otro paquete.
          </DialogDescription>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-1 py-2 border-y">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={allSelectableSelected}
              onChange={toggleAll}
              disabled={selectableComps.length === 0 || isApproved}
              className="h-3.5 w-3.5 rounded cursor-pointer accent-[#E87722]"
            />
            <span className="font-medium">Seleccionar todas las disponibles</span>
            <span className="text-muted-foreground">({selectableComps.length})</span>
          </label>
          <span className="ml-auto text-xs text-muted-foreground">
            {compositions.length} uso{compositions.length === 1 ? "" : "s"} totales · Unidad: {insumo.unit}
          </span>
        </div>

        {/* Lista de composiciones */}
        <div className="overflow-auto flex-1 -mx-6 px-6">
          {compositions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Este insumo no se usa en ningún artículo cuantificado del proyecto.
            </p>
          ) : (
            <ul className="space-y-2 py-2">
              {compositions.map((c) => {
                const wasHere = c.assigned_to?.packageId === currentPackage.id;
                const inOther = c.assigned_to && !wasHere;
                const checked = selected.has(c.composition_id);
                const disabled = isApproved || !!inOther;
                return (
                  <li
                    key={c.composition_id}
                    className={cn(
                      "border rounded-md p-3 transition-colors",
                      wasHere && "bg-emerald-50 border-emerald-200",
                      inOther && "bg-amber-50 border-amber-200 opacity-75",
                      !wasHere && !inOther && "hover:bg-muted/30",
                      disabled && "cursor-not-allowed",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleComp(c.composition_id)}
                        className="mt-1 h-4 w-4 rounded cursor-pointer accent-[#E87722] disabled:cursor-not-allowed"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                          <span className="font-medium text-sm">
                            {c.articulo ? `#${c.articulo.number} ${c.articulo.description}` : "(Artículo sin nombre)"}
                          </span>
                          {wasHere && (
                            <Badge className="text-[10px] bg-emerald-600 text-white">
                              <PackagePlus className="h-3 w-3 mr-0.5" /> En este paquete
                            </Badge>
                          )}
                          {inOther && c.assigned_to && (
                            <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50">
                              <Lock className="h-3 w-3 mr-0.5" /> En "{c.assigned_to.packageName}"
                            </Badge>
                          )}
                        </div>

                        {/* Cantidad total de este uso */}
                        <p className="text-[11px] text-muted-foreground font-mono">
                          Cantidad total proyectada:{" "}
                          <span className="font-semibold text-foreground">
                            {formatNumber(c.total_quantity, 2)} {insumo.unit}
                          </span>
                        </p>

                        {/* Lugares donde se usa el artículo */}
                        {c.used_in.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                              Aparece en {c.used_in.length} línea{c.used_in.length === 1 ? "" : "s"} de cuantificación:
                            </p>
                            <ul className="space-y-0.5">
                              {c.used_in.map((u, idx) => (
                                <li key={idx} className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5 flex-wrap">
                                  <Badge variant="outline" className="text-[10px] font-mono">
                                    {u.sector?.name ?? "(sin sector)"}
                                  </Badge>
                                  <span>·</span>
                                  <span>{u.category ? `${u.category.code} ${u.category.name}` : "(sin cat.)"}</span>
                                  <span>·</span>
                                  <span>{u.subcategory ? `${u.subcategory.code} ${u.subcategory.name}` : "(sin subcat.)"}</span>
                                  <span className="ml-1 font-mono text-muted-foreground/70">
                                    qty: {formatNumber(u.quantity, 2)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="pt-3 border-t">
          <Button variant="outline" onClick={onClose} disabled={applying}>
            Cancelar
          </Button>
          <Button
            onClick={apply}
            disabled={applying || isApproved}
            className="bg-[#E87722] hover:bg-[#E87722]/90 text-white"
          >
            {applying
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Aplicando...</>
              : <>Aplicar cambios</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
