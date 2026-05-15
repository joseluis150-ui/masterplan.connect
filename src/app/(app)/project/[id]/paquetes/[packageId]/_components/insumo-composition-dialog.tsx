"use client";

import { useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, PackagePlus, Lock, Layers, ChevronDown, ChevronRight } from "lucide-react";
import { formatNumber } from "@/lib/utils/formula";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import type {
  Articulo, EdtCategory, EdtSubcategory, Sector, Insumo, ProcurementPackage,
} from "@/lib/types/database";

/** Una línea individual asignable: la combinación de (quantification_line +
 *  articulo_composition) que da la granularidad pedida — el insumo en un
 *  artículo específico EN una línea específica de cuantificación (con su
 *  propio sector/categoría/subcategoría). */
export interface QlineCompEntry {
  qline_id: string;
  composition_id: string;
  articulo: Articulo | null;
  sector: Sector | null;
  category: EdtCategory | null;
  subcategory: EdtSubcategory | null;
  /** Cantidad del insumo necesaria para ESTA línea de cuantificación:
   *  qty_qline × qty_composition × (1+waste/100) × (1+margin/100). */
  quantity: number;
  /** Si null = no asignada; sino el paquete donde está. */
  assigned_to: { packageId: string; packageName: string } | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  insumo: Insumo | null;
  /** Lista de todas las entries del insumo (1 por qline donde aparece). */
  entries: QlineCompEntry[];
  /** Paquete actual. */
  currentPackage: ProcurementPackage;
  supabase: SupabaseClient;
  projectId: string;
  onApplied: () => Promise<void>;
}

/**
 * Modal de detalle de un insumo — selección por LÍNEA DE CUANTIFICACIÓN.
 *
 * Lista todas las entries (qline × composition) del insumo, AGRUPADAS POR
 * SECTOR. Permite expandir/contraer cada sector, ver las líneas con su
 * categoría/subcategoría/cantidad, y marcar individualmente o por sector
 * entero ("Seleccionar todo el sector X").
 *
 * Líneas ya en este paquete → pre-marcadas. Líneas en otro paquete →
 * disabled con badge. Líneas libres → checkbox vacío.
 */
export function InsumoCompositionDialog({
  open, onClose, insumo, entries, currentPackage, supabase, projectId, onApplied,
}: Props) {
  /** Key compuesta de cada entry: `qline::comp` */
  const keyOf = (e: QlineCompEntry) => `${e.qline_id}::${e.composition_id}`;

  /** State de selección: Set de keys (qline::comp) marcadas por el usuario. */
  const initialSelected = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) {
      if (e.assigned_to?.packageId === currentPackage.id) s.add(keyOf(e));
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, currentPackage.id]);

  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const [applying, setApplying] = useState(false);
  const [collapsedSectors, setCollapsedSectors] = useState<Set<string>>(new Set());

  // Re-sync cuando cambian las entries o se reabre el modal
  useEffect(() => {
    if (open) setSelected(new Set(initialSelected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, insumo?.id]);

  const isApproved = currentPackage.status === "aprobado";

  /** Agrupar entries por sector. Las "sin sector" van al final. */
  const grouped = useMemo(() => {
    const m = new Map<string, { sector: Sector | null; entries: QlineCompEntry[] }>();
    for (const e of entries) {
      const key = e.sector?.id ?? "__no_sector__";
      if (!m.has(key)) m.set(key, { sector: e.sector, entries: [] });
      m.get(key)!.entries.push(e);
    }
    // Convertir a array, ordenar por sector.order si existe
    return [...m.values()].sort((a, b) => {
      if (!a.sector) return 1;
      if (!b.sector) return -1;
      return (a.sector.order ?? 0) - (b.sector.order ?? 0);
    });
  }, [entries]);

  /** Total seleccionable y total bloqueado por sector — para "Seleccionar todo". */
  function sectorStats(sectorEntries: QlineCompEntry[]) {
    const selectable = sectorEntries.filter((e) =>
      !e.assigned_to || e.assigned_to.packageId === currentPackage.id
    );
    const allSelectableSelected = selectable.length > 0 &&
      selectable.every((e) => selected.has(keyOf(e)));
    return { selectable, allSelectableSelected };
  }

  /** Seleccionables y seleccionadas globales. */
  const globalSelectable = entries.filter((e) =>
    !e.assigned_to || e.assigned_to.packageId === currentPackage.id
  );
  const allGlobalSelected = globalSelectable.length > 0 &&
    globalSelectable.every((e) => selected.has(keyOf(e)));

  function toggleEntry(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleSector(sectorEntries: QlineCompEntry[]) {
    const { selectable, allSelectableSelected } = sectorStats(sectorEntries);
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectableSelected) {
        for (const e of selectable) next.delete(keyOf(e));
      } else {
        for (const e of selectable) next.add(keyOf(e));
      }
      return next;
    });
  }

  function toggleGlobalAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allGlobalSelected) {
        for (const e of globalSelectable) next.delete(keyOf(e));
      } else {
        for (const e of globalSelectable) next.add(keyOf(e));
      }
      return next;
    });
  }

  function toggleSectorCollapse(sectorKey: string) {
    setCollapsedSectors((prev) => {
      const next = new Set(prev);
      if (next.has(sectorKey)) next.delete(sectorKey); else next.add(sectorKey);
      return next;
    });
  }

  async function apply() {
    if (isApproved) {
      toast.error("Paquete aprobado — no se puede modificar");
      return;
    }
    // Diff: qué hay que asignar / qué hay que remover
    const toAssign: { qline_id: string; comp_id: string }[] = [];
    const toRemove: { qline_id: string; comp_id: string }[] = [];
    for (const e of entries) {
      const k = keyOf(e);
      const wasHere = e.assigned_to?.packageId === currentPackage.id;
      const wantsHere = selected.has(k);
      if (wantsHere && !wasHere && !e.assigned_to) {
        toAssign.push({ qline_id: e.qline_id, comp_id: e.composition_id });
      }
      if (!wantsHere && wasHere) {
        toRemove.push({ qline_id: e.qline_id, comp_id: e.composition_id });
      }
      // Las en otro paquete (assigned_to && !wasHere) se ignoran — están disabled
    }

    if (toAssign.length === 0 && toRemove.length === 0) {
      toast.info("Sin cambios para aplicar");
      onClose();
      return;
    }

    setApplying(true);
    try {
      if (toAssign.length > 0) {
        const { data, error } = await supabase.rpc("assign_qline_compositions_to_package", {
          p_project_id: projectId,
          p_pairs: toAssign,
          p_package_id: currentPackage.id,
        });
        if (error) throw error;
        const r = (data ?? {}) as { assigned: number; conflicts: number; already_in_package: number };
        if (r.assigned > 0) toast.success(`${r.assigned} línea${r.assigned === 1 ? "" : "s"} asignada${r.assigned === 1 ? "" : "s"}`);
        if (r.conflicts > 0) toast.warning(`${r.conflicts} ya estaban en otro paquete`);
      }
      if (toRemove.length > 0) {
        const { data, error } = await supabase.rpc("remove_qline_compositions_from_package", {
          p_project_id: projectId,
          p_pairs: toRemove,
          p_package_id: currentPackage.id,
        });
        if (error) throw error;
        const r = (data ?? {}) as { removed: number };
        if (r.removed > 0) toast.success(`${r.removed} línea${r.removed === 1 ? "" : "s"} removida${r.removed === 1 ? "" : "s"}`);
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
      <DialogContent className="sm:max-w-4xl max-h-[88vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-[#E87722]" />
            <span className="text-xs font-mono text-muted-foreground">#{insumo.code}</span>
            <span>{insumo.description}</span>
          </DialogTitle>
          <DialogDescription>
            Asigná línea por línea de cuantificación al paquete{" "}
            <span className="font-semibold">"{currentPackage.name}"</span>.
            Cada línea representa el insumo en un artículo dentro de un
            sector/categoría/subcategoría específicos. Las líneas
            bloqueadas (🔒) ya están en otro paquete.
          </DialogDescription>
        </DialogHeader>

        {/* Toolbar global */}
        <div className="flex items-center gap-2 px-1 py-2 border-y">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={allGlobalSelected}
              onChange={toggleGlobalAll}
              disabled={globalSelectable.length === 0 || isApproved}
              className="h-3.5 w-3.5 rounded cursor-pointer accent-[#E87722]"
            />
            <span className="font-medium">Seleccionar todas las disponibles</span>
            <span className="text-muted-foreground">({globalSelectable.length})</span>
          </label>
          <span className="ml-auto text-xs text-muted-foreground">
            {entries.length} línea{entries.length === 1 ? "" : "s"} totales · Unidad: {insumo.unit}
          </span>
        </div>

        {/* Lista por sector */}
        <div className="overflow-auto flex-1 -mx-6 px-6">
          {grouped.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Este insumo no se usa en ninguna línea de cuantificación del proyecto.
            </p>
          ) : (
            <div className="space-y-3 py-2">
              {grouped.map((group) => {
                const sectorKey = group.sector?.id ?? "__no_sector__";
                const collapsed = collapsedSectors.has(sectorKey);
                const { selectable, allSelectableSelected } = sectorStats(group.entries);
                const sectorAssignedHere = group.entries.filter((e) => e.assigned_to?.packageId === currentPackage.id).length;
                const sectorAssignedOther = group.entries.filter((e) => e.assigned_to && e.assigned_to.packageId !== currentPackage.id).length;
                const sectorTotalQty = group.entries.reduce((a, e) => a + e.quantity, 0);

                return (
                  <div key={sectorKey} className="border rounded-md overflow-hidden">
                    {/* Sector header — grayscale alto contraste estilo cuantificación */}
                    <div
                      className="flex items-center gap-2 px-3 py-2"
                      style={{ background: "#262626", color: "#fff" }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSectorCollapse(sectorKey)}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold hover:opacity-80"
                      >
                        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        <Layers className="h-3.5 w-3.5" />
                        {group.sector?.name ?? "Sin sector"}
                      </button>
                      <span className="text-[10px] uppercase tracking-wider opacity-70 font-mono">
                        {group.entries.length} línea{group.entries.length === 1 ? "" : "s"}
                        {sectorAssignedHere > 0 && ` · ${sectorAssignedHere} aquí`}
                        {sectorAssignedOther > 0 && ` · ${sectorAssignedOther} en otro`}
                      </span>
                      <span className="ml-auto text-[11px] font-mono opacity-90">
                        Total: {formatNumber(sectorTotalQty, 2)} {insumo.unit}
                      </span>
                      {selectable.length > 0 && (
                        <label className="inline-flex items-center gap-1 text-[11px] cursor-pointer bg-white/10 px-2 py-1 rounded ml-2">
                          <input
                            type="checkbox"
                            checked={allSelectableSelected}
                            onChange={() => toggleSector(group.entries)}
                            disabled={isApproved}
                            className="h-3 w-3 rounded cursor-pointer accent-[#E87722]"
                          />
                          <span>Sector entero</span>
                        </label>
                      )}
                    </div>

                    {!collapsed && (
                      <ul className="divide-y">
                        {group.entries.map((e) => {
                          const k = keyOf(e);
                          const wasHere = e.assigned_to?.packageId === currentPackage.id;
                          const inOther = e.assigned_to && !wasHere;
                          const checked = selected.has(k);
                          const disabled = isApproved || !!inOther;
                          return (
                            <li
                              key={k}
                              className={cn(
                                "px-3 py-2 transition-colors",
                                wasHere && "bg-emerald-50",
                                inOther && "bg-amber-50 opacity-75",
                                !wasHere && !inOther && "hover:bg-muted/30",
                                disabled && "cursor-not-allowed",
                              )}
                            >
                              <div className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={disabled}
                                  onChange={() => toggleEntry(k)}
                                  className="mt-1 h-4 w-4 rounded cursor-pointer accent-[#E87722] disabled:cursor-not-allowed"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-baseline gap-2 flex-wrap">
                                    <span className="font-medium text-sm">
                                      {e.articulo ? `#${e.articulo.number} ${e.articulo.description}` : "(Artículo sin nombre)"}
                                    </span>
                                    {wasHere && (
                                      <Badge className="text-[10px] bg-emerald-600 text-white">
                                        <PackagePlus className="h-3 w-3 mr-0.5" /> Asignada
                                      </Badge>
                                    )}
                                    {inOther && e.assigned_to && (
                                      <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50">
                                        <Lock className="h-3 w-3 mr-0.5" /> En "{e.assigned_to.packageName}"
                                      </Badge>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground flex-wrap">
                                    <Badge variant="outline" className="text-[10px]">
                                      {e.category ? `${e.category.code} ${e.category.name}` : "(sin cat.)"}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px]">
                                      {e.subcategory ? `${e.subcategory.code} ${e.subcategory.name}` : "(sin subcat.)"}
                                    </Badge>
                                    <span className="ml-auto font-mono">
                                      <span className="font-semibold text-foreground">
                                        {formatNumber(e.quantity, 2)} {insumo.unit}
                                      </span>
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
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
