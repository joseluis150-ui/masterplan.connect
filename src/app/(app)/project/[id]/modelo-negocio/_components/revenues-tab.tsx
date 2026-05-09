"use client";

import { useState } from "react";
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
import { formatNumber, formatPct } from "../_lib/formatters";
import type { Currency, SalesPhase, ScenarioInput, SellableUnit } from "../_lib/types";

const CURRENCIES: Currency[] = ["USD", "PYG", "GTQ"];

export function RevenuesTab({
  input, onChange, canEdit,
}: {
  input: ScenarioInput;
  onChange: () => Promise<void>;
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
          <UnitsTable input={input} onChange={onChange} canEdit={canEdit} />
        </CardContent>
      </Card>
    </div>
  );
}

function UnitsTable({
  input, onChange, canEdit,
}: {
  input: ScenarioInput;
  onChange: () => Promise<void>;
  canEdit: boolean;
}) {
  const supabase = createClient();
  const [drafts, setDrafts] = useState<Record<string, SellableUnit>>({});
  const [phaseDrafts, setPhaseDrafts] = useState<Record<string, SalesPhase>>({});

  const get = (u: SellableUnit) => drafts[u.id] ?? u;
  const getP = (p: SalesPhase) => phaseDrafts[p.id] ?? p;

  function setUnit(u: SellableUnit, p: Partial<SellableUnit>) {
    setDrafts({ ...drafts, [u.id]: { ...get(u), ...p } });
  }
  function setPhase(p: SalesPhase, patch: Partial<SalesPhase>) {
    setPhaseDrafts({ ...phaseDrafts, [p.id]: { ...getP(p), ...patch } });
  }

  async function commitUnit(u: SellableUnit) {
    const next = drafts[u.id]; if (!next) return;
    await updateSellableUnit(supabase, u.id, next);
    setDrafts((d) => { const n = { ...d }; delete n[u.id]; return n; });
    await onChange();
  }
  async function commitPhase(p: SalesPhase) {
    const next = phaseDrafts[p.id]; if (!next) return;
    await updateSalesPhase(supabase, p.id, next);
    setPhaseDrafts((d) => { const n = { ...d }; delete n[p.id]; return n; });
    await onChange();
  }

  async function addUnit() {
    await createSellableUnit(supabase, input.scenario.id, input.units.length);
    await onChange();
  }
  async function delUnit(id: string) {
    if (!confirm("¿Eliminar esta unidad y todas sus fases?")) return;
    await deleteSellableUnit(supabase, id);
    await onChange();
  }
  async function addPhase(unitId: string, currentCount: number) {
    await createSalesPhase(supabase, unitId, currentCount);
    await onChange();
  }
  async function delPhase(id: string) {
    if (!confirm("¿Eliminar esta fase?")) return;
    await deleteSalesPhase(supabase, id);
    await onChange();
  }

  return (
    <div className="space-y-3">
      {input.units.map((u) => {
        const d = get(u);
        const phases = u.salesPhases ?? [];
        return (
          <Card key={u.id} className="bg-muted/20">
            <CardContent className="p-3 space-y-3">
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4 space-y-1">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Nombre</label>
                  <Input value={d.unitName}
                    onChange={(e) => setUnit(u, { unitName: e.target.value })}
                    onBlur={() => commitUnit(u)} disabled={!canEdit} className="h-8 text-sm" />
                </div>
                <div className="col-span-3 space-y-1">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Tipo</label>
                  <Input value={d.unitType ?? ""}
                    onChange={(e) => setUnit(u, { unitType: e.target.value || null })}
                    onBlur={() => commitUnit(u)} disabled={!canEdit} className="h-8 text-sm"
                    placeholder="Depto, local, etc." />
                </div>
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">m²</label>
                  <Input type="number" min={0} step="0.01" value={d.surfaceM2 ?? ""}
                    onChange={(e) => setUnit(u, { surfaceM2: e.target.value === "" ? null : Number(e.target.value) })}
                    onBlur={() => commitUnit(u)} disabled={!canEdit} className="h-8 text-sm tabular-nums" />
                </div>
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Cantidad</label>
                  <Input type="number" min={1} value={d.quantity}
                    onChange={(e) => setUnit(u, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                    onBlur={() => commitUnit(u)} disabled={!canEdit} className="h-8 text-sm tabular-nums" />
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
                          const pd = getP(p);
                          const sumPct = pd.downPaymentPct + pd.installmentsPct + pd.finalPaymentPct;
                          const valid = Math.abs(sumPct - 1) < 0.001;
                          return (
                            <tr key={p.id} className={cn("border-t hover:bg-muted/30", !valid && "bg-amber-50")}>
                              <td className="px-1.5 py-1">
                                <Input value={pd.phaseName}
                                  onChange={(e) => setPhase(p, { phaseName: e.target.value })}
                                  onBlur={() => commitPhase(p)} disabled={!canEdit} className="h-7 text-xs" />
                              </td>
                              <td className="px-1.5 py-1">
                                <Input type="number" min={1} value={pd.unitsToSell}
                                  onChange={(e) => setPhase(p, { unitsToSell: Math.max(1, Number(e.target.value) || 1) })}
                                  onBlur={() => commitPhase(p)} disabled={!canEdit}
                                  className="h-7 text-xs text-center tabular-nums" />
                              </td>
                              <td className="px-1.5 py-1">
                                <Input type="number" min={0} step="0.01" value={pd.pricePerUnit}
                                  onChange={(e) => setPhase(p, { pricePerUnit: Number(e.target.value) || 0 })}
                                  onBlur={() => commitPhase(p)} disabled={!canEdit}
                                  className="h-7 text-xs text-right tabular-nums" />
                              </td>
                              <td className="px-1.5 py-1">
                                <Select value={pd.currency} onValueChange={(v) => { setPhase(p, { currency: v as Currency }); commitPhase({ ...p, ...pd, currency: v as Currency }); }}>
                                  <SelectTrigger disabled={!canEdit} className="h-7 text-[11px]">{pd.currency}</SelectTrigger>
                                  <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                                </Select>
                              </td>
                              <td className="px-1.5 py-1">
                                <Input type="number" min={0} value={pd.salePeriodStart}
                                  onChange={(e) => setPhase(p, { salePeriodStart: Math.max(0, Number(e.target.value) || 0) })}
                                  onBlur={() => commitPhase(p)} disabled={!canEdit}
                                  className="h-7 text-xs text-center tabular-nums" />
                              </td>
                              <td className="px-1.5 py-1">
                                <Input type="number" min={pd.salePeriodStart} value={pd.salePeriodEnd}
                                  onChange={(e) => setPhase(p, { salePeriodEnd: Math.max(pd.salePeriodStart, Number(e.target.value) || pd.salePeriodStart) })}
                                  onBlur={() => commitPhase(p)} disabled={!canEdit}
                                  className="h-7 text-xs text-center tabular-nums" />
                              </td>
                              <td className="px-1.5 py-1">
                                <Input type="number" min={0} max={100} step="0.01"
                                  value={pd.downPaymentPct * 100}
                                  onChange={(e) => setPhase(p, { downPaymentPct: (Number(e.target.value) || 0) / 100 })}
                                  onBlur={() => commitPhase(p)} disabled={!canEdit}
                                  className="h-7 text-xs text-center tabular-nums" />
                              </td>
                              <td className="px-1.5 py-1">
                                <Input type="number" min={0}
                                  value={pd.installmentsCount}
                                  onChange={(e) => setPhase(p, { installmentsCount: Math.max(0, Number(e.target.value) || 0) })}
                                  onBlur={() => commitPhase(p)} disabled={!canEdit}
                                  className="h-7 text-xs text-center tabular-nums" />
                              </td>
                              <td className="px-1.5 py-1">
                                <Input type="number" min={0} max={100} step="0.01"
                                  value={pd.installmentsPct * 100}
                                  onChange={(e) => setPhase(p, { installmentsPct: (Number(e.target.value) || 0) / 100 })}
                                  onBlur={() => commitPhase(p)} disabled={!canEdit}
                                  className="h-7 text-xs text-center tabular-nums" />
                              </td>
                              <td className="px-1.5 py-1">
                                <Input type="number" min={0} max={100} step="0.01"
                                  value={pd.finalPaymentPct * 100}
                                  onChange={(e) => setPhase(p, { finalPaymentPct: (Number(e.target.value) || 0) / 100 })}
                                  onBlur={() => commitPhase(p)} disabled={!canEdit}
                                  className="h-7 text-xs text-center tabular-nums" />
                              </td>
                              <td className="px-1.5 py-1 text-center">
                                {canEdit && (
                                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => delPhase(p.id)}>
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
