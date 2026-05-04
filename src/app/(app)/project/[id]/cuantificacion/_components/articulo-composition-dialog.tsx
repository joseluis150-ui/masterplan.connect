"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { FormulaInput } from "@/components/shared/formula-input";
import { formatNumber, convertCurrency } from "@/lib/utils/formula";
import {
  Plus, Trash2, Loader2, Puzzle, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { Articulo, ArticuloComposition, Insumo } from "@/lib/types/database";
import { InsumoPriceEditDialog } from "./insumo-price-edit-dialog";

/** Calcula el PU USD del artículo a partir de su composición.
 *  Misma fórmula que `calcArticuloTotals` en articulos/page.tsx — copia
 *  pequeña porque la pestaña Cuantificación no está cerca y no vale la
 *  pena exportarla todavía. */
function calcArticuloPU(
  comps: CompRow[],
  profitPct: number
): { pu_costo: number; pu_venta: number } {
  let pu_costo = 0;
  for (const comp of comps) {
    if (!comp.insumo) continue;
    const qtyTotal = Number(comp.quantity) * (1 + Number(comp.waste_pct) / 100);
    pu_costo += qtyTotal * Number(comp.insumo.pu_usd || 0) * (1 + Number(comp.margin_pct) / 100);
  }
  return { pu_costo, pu_venta: pu_costo * (1 + profitPct / 100) };
}

type CompRow = Omit<ArticuloComposition, "insumo"> & {
  insumo: Insumo | null;
  /** Marca para nuevas filas no guardadas todavía */
  _isNew?: boolean;
};

/**
 * Dialog flotante con la composición de un artículo (APU). Permite
 * editar cantidades / waste / margin de cada componente, agregar
 * insumos nuevos, eliminar componentes, y cambiar la metadata del
 * artículo (descripción, unidad, % ganancia).
 *
 * Usado desde la pestaña Cuantificación: click en el PU USD de una
 * línea abre este dialog con el `articuloId` de esa línea.
 *
 * Al cerrar, dispara `onChanged` si hubo modificaciones (para que la
 * página padre re-fetchee los PUs y refleje el cambio en la tabla).
 */
export function ArticuloCompositionDialog({
  articuloId,
  insumos: insumosCatalog,
  projectProfitDefault,
  showLocal = false,
  exchangeRate = 0,
  localCurrencyCode = "LOCAL",
  onClose,
  onChanged,
}: {
  articuloId: string;
  /** Catálogo de insumos del proyecto, para el SearchableSelect del agregar. */
  insumos: Insumo[];
  /** % ganancia por defecto (ej. del proyecto) — se usa solo si el artículo
   *  no tiene uno cargado, pero igual se respeta el del artículo. */
  projectProfitDefault?: number;
  /** Si true, los montos se muestran en moneda local (TC × USD). Si false,
   *  se muestran en USD. La conversión es solo de presentación — los datos
   *  en DB siempre están en USD (insumos.pu_usd). */
  showLocal?: boolean;
  /** TC del proyecto para la conversión USD → local. */
  exchangeRate?: number;
  /** Código de moneda local del proyecto (ej. "PYG"). */
  localCurrencyCode?: string;
  onClose: () => void;
  /** Callback que se dispara si hubo CUALQUIER cambio (insert/update/delete
   *  en composiciones o en metadata). El padre debe refrescar los PUs. */
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [articulo, setArticulo] = useState<Articulo | null>(null);
  const [comps, setComps] = useState<CompRow[]>([]);
  /** Insumo cuyo precio está siendo editado en el sub-dialog (click en
   *  nombre del insumo en la tabla de composición). */
  const [editingInsumoId, setEditingInsumoId] = useState<string | null>(null);
  const [savingMeta, setSavingMeta] = useState(false);
  const [addingInsumoId, setAddingInsumoId] = useState<string>("");
  const [hasAnyChange, setHasAnyChange] = useState(false);
  void projectProfitDefault;

  const load = useCallback(async () => {
    setLoading(true);
    const [artRes, compRes] = await Promise.all([
      supabase.from("articulos").select("*").eq("id", articuloId).single(),
      supabase
        .from("articulo_compositions")
        .select("*, insumo:insumos(*)")
        .eq("articulo_id", articuloId),
    ]);
    if (artRes.data) setArticulo(artRes.data as Articulo);
    setComps(((compRes.data ?? []) as CompRow[]));
    setLoading(false);
  }, [articuloId, supabase]);

  useEffect(() => { load(); }, [load]);

  const totals = articulo ? calcArticuloPU(comps, Number(articulo.profit_pct || 0)) : { pu_costo: 0, pu_venta: 0 };

  // Conversión de display USD ↔ local. Idéntica al patrón de presupuesto-tab
  // y de la página padre (cuantificacion). Si TC ≤ 0 o showLocal=false, no
  // convierte nada. En moneda local SIEMPRE forzamos 0 decimales (PYG son
  // montos grandes; los decimales son ruido).
  const fmtMoney = (val: number, decimals = 2) =>
    showLocal && exchangeRate > 0
      ? formatNumber(convertCurrency(val, exchangeRate, "usd_to_local"), 0)
      : formatNumber(val, decimals);
  const moneyCurrency = showLocal ? localCurrencyCode : "USD";

  /* ─────── Handlers ─────── */

  function markChanged() { setHasAnyChange(true); }

  async function updateMeta(field: "description" | "unit" | "profit_pct", value: string | number) {
    if (!articulo) return;
    setSavingMeta(true);
    const { error } = await supabase.from("articulos").update({ [field]: value }).eq("id", articulo.id);
    setSavingMeta(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setArticulo({ ...articulo, [field]: value } as Articulo);
    markChanged();
  }

  /** Update local + DB de un campo de la composición. */
  async function updateCompField(compId: string, field: "quantity" | "waste_pct" | "margin_pct", value: number) {
    setComps((prev) => prev.map((c) => (c.id === compId ? { ...c, [field]: value } : c)));
    const { error } = await supabase.from("articulo_compositions").update({ [field]: value }).eq("id", compId);
    if (error) {
      toast.error(error.message);
      return;
    }
    markChanged();
  }

  async function deleteComp(compId: string) {
    if (!confirm("¿Eliminar este componente del artículo?")) return;
    const prev = comps;
    setComps((p) => p.filter((c) => c.id !== compId));
    const { error } = await supabase.from("articulo_compositions").delete().eq("id", compId);
    if (error) {
      toast.error(error.message);
      setComps(prev);
      return;
    }
    markChanged();
  }

  async function addNewComp() {
    if (!addingInsumoId) {
      toast.error("Elegí un insumo primero");
      return;
    }
    if (comps.some((c) => c.insumo_id === addingInsumoId)) {
      toast.error("Este insumo ya está en la composición");
      return;
    }
    const { data, error } = await supabase
      .from("articulo_compositions")
      .insert({
        articulo_id: articuloId,
        insumo_id: addingInsumoId,
        quantity: 1,
        waste_pct: 0,
        margin_pct: 0,
      })
      .select("*, insumo:insumos(*)")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setComps((p) => [...p, data as CompRow]);
    setAddingInsumoId("");
    markChanged();
  }

  function handleClose() {
    if (hasAnyChange) onChanged();
    onClose();
  }

  /* ─────── Render ─────── */

  return (
    <Dialog open onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        {loading || !articulo ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 mx-auto animate-spin mb-2" />
            Cargando composición…
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Puzzle className="h-5 w-5 text-[#E87722]" />
                Composición · #{articulo.number} {articulo.description}
              </DialogTitle>
              <DialogDescription>
                Editá cantidades, mermas y márgenes. Los cambios se guardan automáticamente
                y el PU se recalcula.
              </DialogDescription>
            </DialogHeader>

            {/* Metadata del artículo */}
            <div className="grid grid-cols-[1fr_120px_120px] gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Descripción</Label>
                <Input
                  defaultValue={articulo.description}
                  onBlur={(e) => {
                    if (e.target.value !== articulo.description) updateMeta("description", e.target.value);
                  }}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Unidad</Label>
                <Input
                  defaultValue={articulo.unit}
                  onBlur={(e) => {
                    if (e.target.value !== articulo.unit) updateMeta("unit", e.target.value);
                  }}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">% Ganancia</Label>
                <Input
                  type="number"
                  defaultValue={Number(articulo.profit_pct)}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== Number(articulo.profit_pct)) updateMeta("profit_pct", v);
                  }}
                  className="h-9 text-sm text-right font-mono"
                />
              </div>
            </div>

            {/* Composición */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Componentes ({comps.length})
              </h4>

              {comps.length === 0 ? (
                <div className="text-center py-6 border rounded-md bg-muted/20 text-sm text-muted-foreground">
                  <AlertCircle className="h-5 w-5 mx-auto mb-2 text-amber-500" />
                  Este artículo no tiene composición — el PU será 0.
                </div>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 uppercase tracking-wider font-semibold">Insumo</th>
                        <th className="text-center px-2 py-2 uppercase tracking-wider font-semibold w-[60px]">Un.</th>
                        <th className="text-right px-2 py-2 uppercase tracking-wider font-semibold w-[100px]">PU {moneyCurrency}</th>
                        <th className="text-right px-2 py-2 uppercase tracking-wider font-semibold w-[110px]">Cantidad</th>
                        <th className="text-right px-2 py-2 uppercase tracking-wider font-semibold w-[80px]">Merma %</th>
                        <th className="text-right px-2 py-2 uppercase tracking-wider font-semibold w-[80px]">Margen %</th>
                        <th className="text-right px-2 py-2 uppercase tracking-wider font-semibold w-[100px]">Subtotal {moneyCurrency}</th>
                        <th className="px-2 py-2 w-[40px]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {comps.map((c) => {
                        const insumo = c.insumo;
                        const qtyTotal = Number(c.quantity) * (1 + Number(c.waste_pct) / 100);
                        const subtotal = insumo ? qtyTotal * Number(insumo.pu_usd || 0) * (1 + Number(c.margin_pct) / 100) : 0;
                        return (
                          <tr key={c.id} className="border-t">
                            <td className="px-3 py-1.5">
                              {insumo ? (
                                <button
                                  type="button"
                                  onClick={() => setEditingInsumoId(insumo.id)}
                                  className="text-left hover:text-[#E87722] transition-colors group"
                                  title="Click para actualizar el precio de este insumo"
                                >
                                  <p className="font-medium leading-tight group-hover:underline decoration-dotted underline-offset-2">
                                    {insumo.description}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {insumo.code != null ? `#${insumo.code}` : ""}
                                    {insumo.type ? ` · ${insumo.type}` : ""}
                                  </p>
                                </button>
                              ) : (
                                <p className="font-medium leading-tight italic text-muted-foreground">
                                  (insumo eliminado)
                                </p>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-center text-muted-foreground">{insumo?.unit ?? ""}</td>
                            <td className="px-2 py-1.5 text-right font-mono">
                              {insumo ? fmtMoney(Number(insumo.pu_usd || 0), 2) : "—"}
                            </td>
                            <td className="px-2 py-1.5">
                              <FormulaInput
                                value={Number(c.quantity)}
                                onValueChange={(v) => updateCompField(c.id, "quantity", v)}
                                className="h-7 w-full text-right text-xs"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <Input
                                type="number"
                                defaultValue={Number(c.waste_pct)}
                                onBlur={(e) => {
                                  const v = Number(e.target.value);
                                  if (v !== Number(c.waste_pct)) updateCompField(c.id, "waste_pct", v);
                                }}
                                className="h-7 w-full text-right text-xs font-mono"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <Input
                                type="number"
                                defaultValue={Number(c.margin_pct)}
                                onBlur={(e) => {
                                  const v = Number(e.target.value);
                                  if (v !== Number(c.margin_pct)) updateCompField(c.id, "margin_pct", v);
                                }}
                                className="h-7 w-full text-right text-xs font-mono"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono font-semibold">
                              {fmtMoney(subtotal, 2)}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteComp(c.id)}>
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                      {/* Total */}
                      <tr className="border-t-2 border-neutral-900 bg-neutral-50 font-bold">
                        <td colSpan={6} className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                          PU costo
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-[#E87722]">
                          {fmtMoney(totals.pu_costo, 2)} {moneyCurrency}
                        </td>
                        <td></td>
                      </tr>
                      {Number(articulo.profit_pct || 0) > 0 && (
                        <tr className="bg-neutral-50 font-bold">
                          <td colSpan={6} className="px-3 py-1.5 text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                            PU venta (+{Number(articulo.profit_pct)}%)
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-emerald-700">
                            {fmtMoney(totals.pu_venta, 2)} {moneyCurrency}
                          </td>
                          <td></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Agregar insumo nuevo */}
            <div className="border rounded-md p-3 bg-muted/20 space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider">Agregar insumo</Label>
              <div className="flex gap-2 items-center">
                <div className="flex-1">
                  <SearchableSelect
                    options={insumosCatalog
                      .filter((i) => !comps.some((c) => c.insumo_id === i.id))
                      .map((i) => ({
                        value: i.id,
                        label: i.code != null ? `#${i.code} ${i.description}` : i.description,
                        sublabel: `${i.unit} · ${fmtMoney(Number(i.pu_usd || 0), 2)} ${moneyCurrency}`,
                      }))}
                    value={addingInsumoId}
                    onChange={(v) => setAddingInsumoId(v || "")}
                    placeholder="Elegir insumo del catálogo…"
                  />
                </div>
                <Button onClick={addNewComp} disabled={!addingInsumoId} className="bg-[#E87722] hover:bg-[#E87722]/90 text-white">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Agregar
                </Button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={handleClose} disabled={savingMeta}>
                Cerrar
              </Button>
            </div>
          </>
        )}
      </DialogContent>
      {/* Sub-dialog: actualizar precio del insumo + histórico. Se abre
          al click en el nombre de cualquier insumo de la composición.
          Al guardar, refrescamos el listado para que aparezca el nuevo
          PU y se recalcule el subtotal del artículo. */}
      {editingInsumoId && (
        <InsumoPriceEditDialog
          insumoId={editingInsumoId}
          exchangeRate={exchangeRate}
          localCurrencyCode={localCurrencyCode}
          onClose={() => setEditingInsumoId(null)}
          onSaved={() => {
            // Reload tanto la composición (para refrescar pu_usd del insumo)
            // como notificar al padre (cuantificación) para que refresque
            // los PU de los artículos.
            load();
            onChanged();
          }}
        />
      )}
    </Dialog>
  );
}
