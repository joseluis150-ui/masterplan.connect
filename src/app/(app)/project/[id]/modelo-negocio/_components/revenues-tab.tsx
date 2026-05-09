"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Plus, Trash2, Building, Layers } from "lucide-react";
import { toast } from "sonner";
import {
  createSalesPhase, createSellableUnit, deleteSalesPhase, deleteSellableUnit,
  updateSalesPhase, updateSellableUnit,
} from "../_lib/api";
import type { Currency, SalesPhase, ScenarioInput, SellableUnit } from "../_lib/types";
import { NumericInput } from "./numeric-input";

const CURRENCIES: Currency[] = ["USD", "PYG", "GTQ"];

type SetInput = React.Dispatch<React.SetStateAction<ScenarioInput | null>>;

/* ─── Helpers de mutación local ───────────────────────────────────── */

function patchUnit(setInput: SetInput, id: string, patch: Partial<SellableUnit>) {
  setInput((prev) => prev ? {
    ...prev,
    units: prev.units.map((u) => u.id === id ? { ...u, ...patch } : u),
  } : prev);
}
function patchPhase(setInput: SetInput, unitId: string, phaseId: string, patch: Partial<SalesPhase>) {
  setInput((prev) => prev ? {
    ...prev,
    units: prev.units.map((u) => u.id !== unitId ? u : {
      ...u,
      salesPhases: (u.salesPhases ?? []).map((p) => p.id === phaseId ? { ...p, ...patch } : p),
    }),
  } : prev);
}

/* ─── Tab ─────────────────────────────────────────────────────────── */

export function RevenuesTab({
  input, setInput, canEdit,
}: {
  input: ScenarioInput;
  setInput: SetInput;
  canEdit: boolean;
}) {
  return (
    <div className="p-4 space-y-3">
      <Card>
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Building className="h-4 w-4 text-[#E87722]" /> Unidades vendibles
            </CardTitle>
            <span className="text-xs text-muted-foreground">{input.units.length} unidad{input.units.length === 1 ? "" : "es"}</span>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <UnitsTable input={input} setInput={setInput} canEdit={canEdit} />
        </CardContent>
      </Card>
    </div>
  );
}

function UnitsTable({
  input, setInput, canEdit,
}: {
  input: ScenarioInput;
  setInput: SetInput;
  canEdit: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);

  /* ─── Unit operations ─── */
  async function commitUnit(id: string, patch: Partial<SellableUnit>) {
    patchUnit(setInput, id, patch);
    try {
      await updateSellableUnit(supabase, id, patch);
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`);
    }
  }
  async function addUnit() {
    try {
      const created = await createSellableUnit(supabase, input.scenario.id, input.units.length);
      setInput((prev) => prev ? { ...prev, units: [...prev.units, { ...created, salesPhases: [] }] } : prev);
    } catch (e) {
      toast.error(`No se pudo crear: ${(e as Error).message}`);
    }
  }
  async function delUnit(id: string) {
    if (!confirm("¿Eliminar esta unidad y todas sus fases?")) return;
    try {
      await deleteSellableUnit(supabase, id);
      setInput((prev) => prev ? { ...prev, units: prev.units.filter((u) => u.id !== id) } : prev);
    } catch (e) {
      toast.error(`No se pudo eliminar: ${(e as Error).message}`);
    }
  }

  /* ─── Phase operations ─── */
  async function commitPhase(unitId: string, phaseId: string, patch: Partial<SalesPhase>) {
    patchPhase(setInput, unitId, phaseId, patch);
    try {
      await updateSalesPhase(supabase, phaseId, patch);
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`);
    }
  }
  async function addPhase(unitId: string, currentCount: number) {
    try {
      const created = await createSalesPhase(supabase, unitId, currentCount);
      setInput((prev) => prev ? {
        ...prev,
        units: prev.units.map((u) => u.id !== unitId ? u : {
          ...u,
          salesPhases: [...(u.salesPhases ?? []), created],
        }),
      } : prev);
    } catch (e) {
      toast.error(`No se pudo crear: ${(e as Error).message}`);
    }
  }
  async function delPhase(unitId: string, phaseId: string) {
    if (!confirm("¿Eliminar esta fase?")) return;
    try {
      await deleteSalesPhase(supabase, phaseId);
      setInput((prev) => prev ? {
        ...prev,
        units: prev.units.map((u) => u.id !== unitId ? u : {
          ...u,
          salesPhases: (u.salesPhases ?? []).filter((p) => p.id !== phaseId),
        }),
      } : prev);
    } catch (e) {
      toast.error(`No se pudo eliminar: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-3">
      {input.units.map((u) => {
        const phases = u.salesPhases ?? [];
        return (
          <Card key={u.id} className="bg-muted/20">
            <CardContent className="p-3 space-y-3">
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4 space-y-1">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Nombre</label>
                  <Input defaultValue={u.unitName}
                    onBlur={(e) => { if (e.target.value !== u.unitName) commitUnit(u.id, { unitName: e.target.value }); }}
                    disabled={!canEdit} className="h-8 text-sm" />
                </div>
                <div className="col-span-3 space-y-1">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Tipo</label>
                  <Input defaultValue={u.unitType ?? ""}
                    onBlur={(e) => { const v = e.target.value || null; if (v !== u.unitType) commitUnit(u.id, { unitType: v }); }}
                    disabled={!canEdit} className="h-8 text-sm" placeholder="Depto, local, etc." />
                </div>
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">m²</label>
                  <NumericInput
                    value={u.surfaceM2}
                    onCommit={(v) => commitUnit(u.id, { surfaceM2: v })}
                    min={0} disabled={!canEdit}
                    className="h-8 text-sm tabular-nums"
                    placeholder="—"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Cantidad</label>
                  <NumericInput
                    value={u.quantity}
                    onCommit={(v) => commitUnit(u.id, { quantity: Math.max(1, v ?? 1) })}
                    required min={1} disabled={!canEdit}
                    className="h-8 text-sm tabular-nums"
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  {canEdit && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => delUnit(u.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Fases */}
              <div className="space-y-2 pl-3 border-l-2 border-[#E87722]/30">
                <div className="flex items-center gap-2">
                  <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-mono">
                    Fases de venta ({phases.length})
                  </span>
                </div>
                {phases.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
                      <colgroup>
                        <col style={{ width: "16%" }} /><col style={{ width: "8%" }} />
                        <col style={{ width: "13%" }} /><col style={{ width: "7%" }} />
                        <col style={{ width: "8%" }} /><col style={{ width: "8%" }} />
                        <col style={{ width: "9%" }} /><col style={{ width: "8%" }} />
                        <col style={{ width: "9%" }} /><col style={{ width: "9%" }} />
                        <col style={{ width: "5%" }} />
                      </colgroup>
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          <th className="text-left px-1.5 py-1 font-semibold">Fase</th>
                          <th className="text-center px-1.5 py-1 font-semibold">Unidades</th>
                          <th className="text-right px-1.5 py-1 font-semibold">Precio</th>
                          <th className="text-center px-1.5 py-1 font-semibold">Mon</th>
                          <th className="text-center px-1.5 py-1 font-semibold">Inicio</th>
                          <th className="text-center px-1.5 py-1 font-semibold">Fin</th>
                          <th className="text-center px-1.5 py-1 font-semibold">% Anticipo</th>
                          <th className="text-center px-1.5 py-1 font-semibold"># cuotas</th>
                          <th className="text-center px-1.5 py-1 font-semibold">% Cuotas</th>
                          <th className="text-center px-1.5 py-1 font-semibold">% Saldo</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {phases.map((p) => {
                          const sumPct = p.downPaymentPct + p.installmentsPct + p.finalPaymentPct;
                          const valid = Math.abs(sumPct - 1) < 0.001;
                          return (
                            <tr key={p.id} className={cn("border-t hover:bg-muted/30", !valid && "bg-amber-50")}>
                              <td className="px-1.5 py-1">
                                <Input defaultValue={p.phaseName}
                                  onBlur={(e) => { if (e.target.value !== p.phaseName) commitPhase(u.id, p.id, { phaseName: e.target.value }); }}
                                  disabled={!canEdit} className="h-7 text-xs" />
                              </td>
                              <td className="px-1.5 py-1">
                                <NumericInput value={p.unitsToSell}
                                  onCommit={(v) => commitPhase(u.id, p.id, { unitsToSell: Math.max(1, v ?? 1) })}
                                  required min={1} disabled={!canEdit}
                                  className="h-7 text-xs text-center tabular-nums" />
                              </td>
                              <td className="px-1.5 py-1">
                                <NumericInput value={p.pricePerUnit}
                                  onCommit={(v) => commitPhase(u.id, p.id, { pricePerUnit: v ?? 0 })}
                                  required min={0} disabled={!canEdit}
                                  className="h-7 text-xs text-right tabular-nums" />
                              </td>
                              <td className="px-1.5 py-1">
                                <Select value={p.currency} onValueChange={(v) => v && commitPhase(u.id, p.id, { currency: v as Currency })}>
                                  <SelectTrigger disabled={!canEdit} className="h-7 text-[11px]">{p.currency}</SelectTrigger>
                                  <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                                </Select>
                              </td>
                              <td className="px-1.5 py-1">
                                <NumericInput value={p.salePeriodStart}
                                  onCommit={(v) => commitPhase(u.id, p.id, { salePeriodStart: Math.max(0, v ?? 0) })}
                                  required min={0} disabled={!canEdit}
                                  className="h-7 text-xs text-center tabular-nums" />
                              </td>
                              <td className="px-1.5 py-1">
                                <NumericInput value={p.salePeriodEnd}
                                  onCommit={(v) => commitPhase(u.id, p.id, { salePeriodEnd: Math.max(p.salePeriodStart, v ?? p.salePeriodStart) })}
                                  required min={p.salePeriodStart} disabled={!canEdit}
                                  className="h-7 text-xs text-center tabular-nums" />
                              </td>
                              <td className="px-1.5 py-1">
                                <NumericInput value={p.downPaymentPct}
                                  onCommit={(v) => commitPhase(u.id, p.id, { downPaymentPct: v ?? 0 })}
                                  required displayMultiplier={100} min={0} max={100}
                                  disabled={!canEdit}
                                  className="h-7 text-xs text-center tabular-nums" />
                              </td>
                              <td className="px-1.5 py-1">
                                <NumericInput value={p.installmentsCount}
                                  onCommit={(v) => commitPhase(u.id, p.id, { installmentsCount: Math.max(0, v ?? 0) })}
                                  required min={0} disabled={!canEdit}
                                  className="h-7 text-xs text-center tabular-nums" />
                              </td>
                              <td className="px-1.5 py-1">
                                <NumericInput value={p.installmentsPct}
                                  onCommit={(v) => commitPhase(u.id, p.id, { installmentsPct: v ?? 0 })}
                                  required displayMultiplier={100} min={0} max={100}
                                  disabled={!canEdit}
                                  className="h-7 text-xs text-center tabular-nums" />
                              </td>
                              <td className="px-1.5 py-1">
                                <NumericInput value={p.finalPaymentPct}
                                  onCommit={(v) => commitPhase(u.id, p.id, { finalPaymentPct: v ?? 0 })}
                                  required displayMultiplier={100} min={0} max={100}
                                  disabled={!canEdit}
                                  className="h-7 text-xs text-center tabular-nums" />
                              </td>
                              <td className="px-1.5 py-1 text-center">
                                {canEdit && (
                                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => delPhase(u.id, p.id)}>
                                    <Trash2 className="h-3 w-3 text-destructive" />
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="text-[10px] text-muted-foreground px-2 pt-1">
                      Validación: anticipo + cuotas + saldo debe sumar 100%. Filas en amarillo no cumplen.
                    </div>
                  </div>
                )}
                {canEdit && (
                  <Button variant="outline" size="sm" onClick={() => addPhase(u.id, phases.length)} className="text-xs">
                    <Plus className="h-3 w-3 mr-1" /> Agregar fase
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
      {input.units.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-6">
          Sin unidades vendibles cargadas. Agregá al menos una para proyectar ingresos.
        </p>
      )}
      {canEdit && (
        <Button variant="outline" size="sm" onClick={addUnit} className="text-xs">
          <Plus className="h-3 w-3 mr-1" /> Agregar unidad
        </Button>
      )}
    </div>
  );
}
