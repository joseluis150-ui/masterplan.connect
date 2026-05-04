"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DollarSign, History, Loader2, ArrowRight, AlertCircle, Save,
} from "lucide-react";
import { toast } from "sonner";
import { formatNumber, convertCurrency, evaluateFormula } from "@/lib/utils/formula";
import type { Insumo, InsumoPriceHistory } from "@/lib/types/database";

/**
 * Dialog para actualizar el precio unitario de un insumo + dejar un
 * histórico con descripción opcional. Reusable desde cualquier lugar
 * donde el usuario quiera editar un insumo (p.ej. la tabla de
 * composición de un artículo).
 *
 * Funcionalidad:
 *   - Edición del PU en USD o moneda local. El otro valor se calcula
 *     automáticamente con el TC del proyecto.
 *   - Soporta fórmulas (=A+B*1.1) vía evaluateFormula.
 *   - Inserta una fila en insumo_price_history sólo si el precio
 *     realmente cambió. Si la descripción es no-vacía y el precio NO
 *     cambió, igual deja registro como anotación pura.
 *   - Lista de los últimos cambios al final del modal con el actor,
 *     timestamp, salto de precio y la nota.
 */
export function InsumoPriceEditDialog({
  insumoId,
  exchangeRate,
  localCurrencyCode,
  onClose,
  onSaved,
}: {
  insumoId: string;
  /** TC del proyecto. Si <=0 se asume 1 y se ignora la conversión. */
  exchangeRate: number;
  /** Código de moneda local del proyecto (ej. "PYG"). */
  localCurrencyCode: string;
  onClose: () => void;
  /** Callback al guardar exitosamente. El padre debería refrescar la
   *  composición / cuantificación para mostrar el nuevo PU. */
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [insumo, setInsumo] = useState<Insumo | null>(null);
  const [history, setHistory] = useState<InsumoPriceHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [priceInput, setPriceInput] = useState("");
  const [currencyMode, setCurrencyMode] = useState<"USD" | "LOCAL">("USD");
  const [description, setDescription] = useState("");

  const tc = exchangeRate > 0 ? exchangeRate : 1;

  const load = useCallback(async () => {
    setLoading(true);
    const [insRes, histRes] = await Promise.all([
      supabase.from("insumos").select("*").eq("id", insumoId).single(),
      supabase
        .from("insumo_price_history")
        .select("*")
        .eq("insumo_id", insumoId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    const ins = insRes.data as Insumo | null;
    if (ins) {
      setInsumo(ins);
      // Modo inicial: el que el usuario haya cargado la última vez en el insumo
      // (currency_input). Default a USD.
      const mode = (ins.currency_input as "USD" | "LOCAL" | null) === "LOCAL" ? "LOCAL" : "USD";
      setCurrencyMode(mode);
      setPriceInput(String(mode === "USD" ? Number(ins.pu_usd || 0) : Number(ins.pu_local || 0)));
    }

    setHistory((histRes.data ?? []) as InsumoPriceHistory[]);
    setLoading(false);
  }, [insumoId, supabase]);

  useEffect(() => { load(); }, [load]);

  /** Calcula el PU "opuesto" del que ingresó el usuario, usando el TC. */
  const evaluatedInput = (() => {
    const ev = evaluateFormula(priceInput);
    if (ev == null) return null;
    return ev;
  })();

  const newPuUsd = currencyMode === "USD"
    ? evaluatedInput
    : (evaluatedInput == null ? null : convertCurrency(evaluatedInput, tc, "local_to_usd"));
  const newPuLocal = currencyMode === "LOCAL"
    ? evaluatedInput
    : (evaluatedInput == null ? null : convertCurrency(evaluatedInput, tc, "usd_to_local"));

  const oldPuUsd = Number(insumo?.pu_usd || 0);
  const oldPuLocal = Number(insumo?.pu_local || 0);
  const priceChanged = newPuUsd != null && Math.abs(newPuUsd - oldPuUsd) > 0.0001;

  async function save() {
    if (!insumo) return;
    if (evaluatedInput == null) {
      toast.error("El precio ingresado no es válido");
      return;
    }
    setSaving(true);

    // Sólo logueamos en history si el precio cambió o si el usuario dejó
    // descripción (anotación sin cambio de precio = registro válido).
    const trimDesc = description.trim();
    if (priceChanged || trimDesc) {
      const { error: histErr } = await supabase.from("insumo_price_history").insert({
        insumo_id: insumo.id,
        pu_local_old: oldPuLocal,
        pu_local_new: newPuLocal,
        pu_usd_old: oldPuUsd,
        pu_usd_new: newPuUsd,
        tc_used: tc,
        description: trimDesc || null,
      });
      if (histErr) {
        toast.error(`No se pudo registrar el histórico: ${histErr.message}`);
        setSaving(false);
        return;
      }
    }

    if (priceChanged) {
      const { error: updErr } = await supabase
        .from("insumos")
        .update({
          pu_usd: newPuUsd,
          pu_local: newPuLocal,
          tc_used: tc,
          currency_input: currencyMode,
        })
        .eq("id", insumo.id);
      if (updErr) {
        toast.error(updErr.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    toast.success(priceChanged ? "Precio actualizado" : "Anotación guardada");
    onSaved();
    onClose();
  }

  function fmtDate(when: string) {
    const d = new Date(when);
    return d.toLocaleDateString() + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        {loading || !insumo ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 mx-auto animate-spin mb-2" />
            Cargando insumo…
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-[#E87722]" />
                Actualizar precio · {insumo.code != null ? `#${insumo.code} ` : ""}{insumo.description}
              </DialogTitle>
              <DialogDescription>
                Unidad: <span className="font-mono">{insumo.unit}</span>
                {" · "}Precio actual: <span className="font-mono">{formatNumber(oldPuUsd, 2)} USD</span>
                {oldPuLocal > 0 && <> · <span className="font-mono">{formatNumber(oldPuLocal, 0)} {localCurrencyCode}</span></>}
              </DialogDescription>
            </DialogHeader>

            {/* Formulario de actualización */}
            <div className="border rounded-md p-4 space-y-3 bg-muted/20">
              <div className="grid grid-cols-[1fr_120px] gap-2 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">
                    Precio nuevo en {currencyMode === "USD" ? "USD" : localCurrencyCode}
                  </Label>
                  <Input
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    placeholder="0"
                    className="h-9 font-mono"
                    autoFocus
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Moneda de carga</Label>
                  <div className="inline-flex rounded-md border bg-background overflow-hidden h-9">
                    <button
                      type="button"
                      onClick={() => setCurrencyMode("USD")}
                      className={`px-3 text-xs font-medium ${currencyMode === "USD" ? "bg-[#E87722] text-white" : "text-muted-foreground"}`}
                    >USD</button>
                    <button
                      type="button"
                      onClick={() => setCurrencyMode("LOCAL")}
                      className={`px-3 text-xs font-medium border-l ${currencyMode === "LOCAL" ? "bg-[#E87722] text-white" : "text-muted-foreground"}`}
                    >{localCurrencyCode}</button>
                  </div>
                </div>
              </div>
              {/* Preview de la conversión */}
              {evaluatedInput != null && (
                <div className="text-[11px] text-muted-foreground inline-flex items-center gap-2">
                  <ArrowRight className="h-3 w-3" />
                  USD: <span className="font-mono">{formatNumber(newPuUsd ?? 0, 2)}</span>
                  {" · "}
                  {localCurrencyCode}: <span className="font-mono">{formatNumber(newPuLocal ?? 0, 0)}</span>
                  {tc > 0 && <span className="ml-2">(TC: 1 USD = {formatNumber(tc, 0)} {localCurrencyCode})</span>}
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs">Descripción del cambio (opcional)</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ej: Cotización Cementos PY al 04/05, sube 12% por nuevo proveedor"
                  rows={2}
                  className="text-xs"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t">
                {priceChanged ? (
                  <span className="text-[11px] text-emerald-700">
                    El precio cambia de <span className="font-mono font-semibold">{formatNumber(oldPuUsd, 2)}</span> → <span className="font-mono font-semibold">{formatNumber(newPuUsd ?? 0, 2)}</span> USD
                  </span>
                ) : description.trim() ? (
                  <span className="text-[11px] text-muted-foreground">
                    Se guardará como anotación (sin cambio de precio).
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    No hay cambios para guardar.
                  </span>
                )}
                <Button
                  onClick={save}
                  disabled={saving || (!priceChanged && !description.trim())}
                  className="bg-[#E87722] hover:bg-[#E87722]/90 text-white"
                >
                  {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Guardar
                </Button>
              </div>
            </div>

            {/* Histórico */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
                <History className="h-3 w-3" />
                Histórico de cambios ({history.length})
              </h4>
              {history.length === 0 ? (
                <p className="text-xs italic text-muted-foreground py-2">
                  Sin cambios registrados todavía.
                </p>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 uppercase tracking-wider font-semibold w-[150px]">Fecha</th>
                        <th className="text-right px-3 py-2 uppercase tracking-wider font-semibold w-[110px]">USD</th>
                        <th className="text-right px-3 py-2 uppercase tracking-wider font-semibold w-[120px]">{localCurrencyCode}</th>
                        <th className="text-left px-3 py-2 uppercase tracking-wider font-semibold">Nota</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => {
                        const usdOld = Number(h.pu_usd_old || 0);
                        const usdNew = Number(h.pu_usd_new || 0);
                        const localOld = Number(h.pu_local_old || 0);
                        const localNew = Number(h.pu_local_new || 0);
                        const usdDelta = usdNew - usdOld;
                        const isAnnotation = Math.abs(usdDelta) < 0.0001;
                        return (
                          <tr key={h.id} className="border-t">
                            <td className="px-3 py-1.5 font-mono text-muted-foreground whitespace-nowrap">
                              {fmtDate(h.created_at)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">
                              {isAnnotation ? (
                                <span className="text-muted-foreground">{formatNumber(usdNew, 2)}</span>
                              ) : (
                                <>
                                  <span className="text-muted-foreground">{formatNumber(usdOld, 2)}</span>
                                  <span className={`ml-1 font-semibold ${usdDelta > 0 ? "text-emerald-700" : "text-amber-700"}`}>
                                    → {formatNumber(usdNew, 2)}
                                  </span>
                                </>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">
                              {isAnnotation ? (
                                <span className="text-muted-foreground">{formatNumber(localNew, 0)}</span>
                              ) : (
                                <>
                                  <span className="text-muted-foreground">{formatNumber(localOld, 0)}</span>
                                  <span className="ml-1 font-semibold">→ {formatNumber(localNew, 0)}</span>
                                </>
                              )}
                            </td>
                            <td className="px-3 py-1.5 italic text-muted-foreground">
                              {h.description || (isAnnotation ? "(anotación)" : "—")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
