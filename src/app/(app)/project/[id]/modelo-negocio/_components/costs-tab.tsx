"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Plus, Trash2, ChevronDown, ChevronRight, Building2, Banknote, Receipt } from "lucide-react";
import { toast } from "sonner";
import {
  createConstructionCategory, createLandCost, createOtherExpense,
  deleteConstructionCategory, deleteLandCost, deleteOtherExpense,
  updateConstructionCategory, updateLandCost, updateOtherExpense,
} from "../_lib/api";
import { formatNumber } from "../_lib/formatters";
import type {
  CalculationBasis, ConstructionCategory, Currency, DistributionCurve,
  ExpenseType, LandCost, OtherExpense, PaymentStructure, ScenarioInput, TimingType,
} from "../_lib/types";
import { NumericInput } from "./numeric-input";

const CURRENCIES: Currency[] = ["USD", "PYG", "GTQ"];
const CURVES: { value: DistributionCurve; label: string }[] = [
  { value: "linear", label: "Lineal" },
  { value: "front_loaded", label: "Frente cargado" },
  { value: "back_loaded", label: "Atrás cargado" },
  { value: "s_curve", label: "Curva S" },
  { value: "custom", label: "Custom" },
];
const EXPENSE_TYPES: { value: ExpenseType; label: string }[] = [
  { value: "professional_fees", label: "Honorarios" },
  { value: "taxes", label: "Impuestos" },
  { value: "sales_commission", label: "Comisión venta" },
  { value: "marketing", label: "Marketing" },
  { value: "financial", label: "Gastos financieros" },
  { value: "permits", label: "Permisos" },
  { value: "admin", label: "Administración" },
  { value: "contingency", label: "Imprevistos" },
  { value: "other", label: "Otro" },
];
const BASIS: { value: CalculationBasis; label: string }[] = [
  { value: "fixed_amount", label: "Monto fijo" },
  { value: "pct_of_construction", label: "% construcción" },
  { value: "pct_of_sales", label: "% ventas" },
  { value: "pct_of_land", label: "% tierra" },
];
const TIMINGS: { value: TimingType; label: string }[] = [
  { value: "one_time", label: "Una vez" },
  { value: "recurring", label: "Recurrente" },
  { value: "distributed", label: "Distribuido" },
  { value: "on_event", label: "Sobre evento (venta)" },
];

/**
 * Tab Costos. Refactor para que NO recargue todo el escenario al editar:
 * cada cambio se persiste en DB y se aplica localmente al state del padre
 * vía `setInput`. Esto evita el "parpadeo" / pérdida de foco que sucedía
 * antes con el `await onChange()` que hacía un loadScenarioInput entero.
 */
export function CostsTab({
  input, setInput, canEdit,
}: {
  input: ScenarioInput;
  setInput: React.Dispatch<React.SetStateAction<ScenarioInput | null>>;
  canEdit: boolean;
}) {
  // Persistimos el estado de las secciones colapsables en localStorage
  // para que sobreviva tanto remontajes del tab como cambios de
  // escenario / proyecto. Antes vivía en useState y se perdía al
  // desmontar el componente.
  const [openLand, setOpenLand] = usePersistedBool("bm:costs:openLand", true);
  const [openConstr, setOpenConstr] = usePersistedBool("bm:costs:openConstr", true);
  const [openOthers, setOpenOthers] = usePersistedBool("bm:costs:openOthers", true);

  return (
    <div className="p-4 space-y-3">
      <Section
        icon={Banknote}
        title="Costo de tierra"
        total={input.land.reduce((a, l) => a + l.totalAmount, 0)}
        currencyHint={input.land[0]?.currency ?? "USD"}
        open={openLand}
        onToggle={() => setOpenLand(!openLand)}
      >
        <LandTable lands={input.land} scenarioId={input.scenario.id} setInput={setInput} canEdit={canEdit} />
      </Section>

      <Section
        icon={Building2}
        title="Costos de construcción"
        total={input.construction.reduce((a, c) => a + c.totalAmount, 0)}
        currencyHint={input.construction[0]?.currency ?? "USD"}
        open={openConstr}
        onToggle={() => setOpenConstr(!openConstr)}
      >
        <ConstructionTable cats={input.construction} scenarioId={input.scenario.id} setInput={setInput} canEdit={canEdit} />
      </Section>

      <Section
        icon={Receipt}
        title="Otros gastos"
        total={input.otherExpenses.reduce((a, e) => a + (e.fixedAmount ?? 0), 0)}
        totalLabel="Suma de fijos"
        currencyHint={input.otherExpenses[0]?.currency ?? "USD"}
        open={openOthers}
        onToggle={() => setOpenOthers(!openOthers)}
      >
        <OthersTable items={input.otherExpenses} scenarioId={input.scenario.id} setInput={setInput} canEdit={canEdit} />
      </Section>
    </div>
  );
}

/** Mini-hook para persistir el state colapsable en localStorage. Si no
 *  está en window (SSR) o el JSON falla, cae al default. */
function usePersistedBool(key: string, defaultValue: boolean): [boolean, (v: boolean) => void] {
  const [value, _setValue] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return defaultValue;
      return raw === "true";
    } catch { return defaultValue; }
  });
  const setValue = (v: boolean) => {
    _setValue(v);
    try { window.localStorage.setItem(key, String(v)); } catch { /* ignore */ }
  };
  return [value, setValue];
}

/* ─── Section wrapper ─────────────────────────────────────────────── */

function Section({
  icon: Icon, title, total, currencyHint, totalLabel, open, onToggle, children,
}: {
  icon: typeof Banknote;
  title: string;
  total: number;
  currencyHint: Currency;
  totalLabel?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="py-3 cursor-pointer select-none" onClick={onToggle}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Icon className="h-4 w-4 text-[#E87722]" />
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            {totalLabel ?? "Total"}: {currencyHint} {formatNumber(total, 0)}
          </div>
        </div>
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

/* ─── Helpers de mutación local ───────────────────────────────────── */

type SetInput = React.Dispatch<React.SetStateAction<ScenarioInput | null>>;

function patchLandLocally(setInput: SetInput, id: string, patch: Partial<LandCost>) {
  setInput((prev) => prev ? { ...prev, land: prev.land.map((l) => l.id === id ? { ...l, ...patch } : l) } : prev);
}
function patchConstrLocally(setInput: SetInput, id: string, patch: Partial<ConstructionCategory>) {
  setInput((prev) => prev ? { ...prev, construction: prev.construction.map((c) => c.id === id ? { ...c, ...patch } : c) } : prev);
}
function patchOtherLocally(setInput: SetInput, id: string, patch: Partial<OtherExpense>) {
  setInput((prev) => prev ? { ...prev, otherExpenses: prev.otherExpenses.map((e) => e.id === id ? { ...e, ...patch } : e) } : prev);
}

/* ─── Tabla Tierra ────────────────────────────────────────────────── */

function LandTable({
  lands, scenarioId, setInput, canEdit,
}: {
  lands: LandCost[];
  scenarioId: string;
  setInput: SetInput;
  canEdit: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);

  /** Persiste el patch a DB y actualiza el state local del padre.
   *  Lo hace con un toast silencioso para no inundar al usuario; sólo
   *  mostramos toast si hay error. */
  async function commit(id: string, patch: Partial<LandCost>) {
    patchLandLocally(setInput, id, patch);
    try {
      await updateLandCost(supabase, id, patch);
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`);
    }
  }

  async function add() {
    try {
      const newLand = await createLandCost(supabase, scenarioId, lands.length);
      setInput((prev) => prev ? { ...prev, land: [...prev.land, newLand] } : prev);
    } catch (e) {
      toast.error(`No se pudo crear: ${(e as Error).message}`);
    }
  }
  async function del(id: string) {
    if (!confirm("¿Eliminar esta línea?")) return;
    try {
      await deleteLandCost(supabase, id);
      setInput((prev) => prev ? { ...prev, land: prev.land.filter((l) => l.id !== id) } : prev);
    } catch (e) {
      toast.error(`No se pudo eliminar: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "26%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-2 py-1.5 font-semibold">Descripción</th>
              <th className="text-right px-2 py-1.5 font-semibold">Monto</th>
              <th className="text-center px-2 py-1.5 font-semibold">Moneda</th>
              <th className="text-center px-2 py-1.5 font-semibold">Estructura</th>
              <th className="text-center px-2 py-1.5 font-semibold">Período</th>
              <th className="text-center px-2 py-1.5 font-semibold"># cuotas</th>
              <th className="text-center px-2 py-1.5 font-semibold">Frec.</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lands.map((l) => (
              <tr key={l.id} className="border-t hover:bg-muted/30">
                <td className="px-2 py-1">
                  <Input
                    defaultValue={l.description}
                    onBlur={(e) => { if (e.target.value !== l.description) commit(l.id, { description: e.target.value }); }}
                    disabled={!canEdit}
                    className="h-8 text-sm"
                  />
                </td>
                <td className="px-2 py-1">
                  <NumericInput
                    value={l.totalAmount}
                    onCommit={(v) => commit(l.id, { totalAmount: v ?? 0 })}
                    required
                    min={0}
                    disabled={!canEdit}
                    className="h-8 text-sm text-right tabular-nums"
                  />
                </td>
                <td className="px-2 py-1">
                  <Select value={l.currency} onValueChange={(v) => v && commit(l.id, { currency: v as Currency })}>
                    <SelectTrigger disabled={!canEdit} className="h-8 text-xs">{l.currency}</SelectTrigger>
                    <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-1">
                  <Select
                    value={l.paymentStructure}
                    onValueChange={(v) => v && commit(l.id, { paymentStructure: v as PaymentStructure })}
                  >
                    <SelectTrigger disabled={!canEdit} className="h-8 text-xs">
                      {l.paymentStructure === "lump_sum" ? "Único pago" : "Cuotas"}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lump_sum">Único pago</SelectItem>
                      <SelectItem value="installments">Cuotas</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-1">
                  <NumericInput
                    value={l.paymentStartPeriod}
                    onCommit={(v) => commit(l.id, { paymentStartPeriod: Math.max(0, v ?? 0) })}
                    required
                    min={0}
                    disabled={!canEdit}
                    className="h-8 text-sm text-center tabular-nums"
                  />
                </td>
                <td className="px-2 py-1">
                  {l.paymentStructure === "installments" ? (
                    <NumericInput
                      value={l.installmentsCount}
                      onCommit={(v) => commit(l.id, { installmentsCount: v == null ? null : Math.max(1, v) })}
                      min={1}
                      disabled={!canEdit}
                      className="h-8 text-sm text-center tabular-nums"
                      placeholder="—"
                    />
                  ) : <span className="text-xs text-muted-foreground/50">—</span>}
                </td>
                <td className="px-2 py-1">
                  {l.paymentStructure === "installments" ? (
                    <NumericInput
                      value={l.installmentFrequencyPeriods}
                      onCommit={(v) => commit(l.id, { installmentFrequencyPeriods: v == null ? null : Math.max(1, v) })}
                      min={1}
                      disabled={!canEdit}
                      className="h-8 text-sm text-center tabular-nums"
                      placeholder="—"
                    />
                  ) : <span className="text-xs text-muted-foreground/50">—</span>}
                </td>
                <td className="px-2 py-1 text-center">
                  {canEdit && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => del(l.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {lands.length === 0 && (
              <tr><td colSpan={8} className="text-center text-xs text-muted-foreground py-4">Sin terrenos cargados</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <Button variant="outline" size="sm" onClick={add} className="text-xs">
          <Plus className="h-3 w-3 mr-1" /> Agregar terreno
        </Button>
      )}
    </div>
  );
}

/* ─── Tabla Construcción ──────────────────────────────────────────── */

function ConstructionTable({
  cats, scenarioId, setInput, canEdit,
}: {
  cats: ConstructionCategory[];
  scenarioId: string;
  setInput: SetInput;
  canEdit: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);

  async function commit(id: string, patch: Partial<ConstructionCategory>) {
    patchConstrLocally(setInput, id, patch);
    try {
      await updateConstructionCategory(supabase, id, patch);
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`);
    }
  }
  async function add() {
    try {
      const created = await createConstructionCategory(supabase, scenarioId, cats.length);
      setInput((prev) => prev ? { ...prev, construction: [...prev.construction, created] } : prev);
    } catch (e) {
      toast.error(`No se pudo crear: ${(e as Error).message}`);
    }
  }
  async function del(id: string) {
    if (!confirm("¿Eliminar este rubro?")) return;
    try {
      await deleteConstructionCategory(supabase, id);
      setInput((prev) => prev ? { ...prev, construction: prev.construction.filter((c) => c.id !== id) } : prev);
    } catch (e) {
      toast.error(`No se pudo eliminar: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "24%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "6%" }} />
          </colgroup>
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-2 py-1.5 font-semibold">Rubro</th>
              <th className="text-right px-2 py-1.5 font-semibold">Monto</th>
              <th className="text-center px-2 py-1.5 font-semibold">Moneda</th>
              <th className="text-center px-2 py-1.5 font-semibold">Inicio</th>
              <th className="text-center px-2 py-1.5 font-semibold">Duración</th>
              <th className="text-center px-2 py-1.5 font-semibold">Curva</th>
              <th className="text-right px-2 py-1.5 font-semibold">Total acum.</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.id} className="border-t hover:bg-muted/30">
                <td className="px-2 py-1">
                  <Input defaultValue={c.categoryName}
                    onBlur={(e) => { if (e.target.value !== c.categoryName) commit(c.id, { categoryName: e.target.value }); }}
                    disabled={!canEdit} className="h-8 text-sm" />
                </td>
                <td className="px-2 py-1">
                  <NumericInput
                    value={c.totalAmount}
                    onCommit={(v) => commit(c.id, { totalAmount: v ?? 0 })}
                    required min={0} disabled={!canEdit}
                    className="h-8 text-sm text-right tabular-nums"
                  />
                </td>
                <td className="px-2 py-1">
                  <Select value={c.currency} onValueChange={(v) => v && commit(c.id, { currency: v as Currency })}>
                    <SelectTrigger disabled={!canEdit} className="h-8 text-xs">{c.currency}</SelectTrigger>
                    <SelectContent>{CURRENCIES.map((cu) => <SelectItem key={cu} value={cu}>{cu}</SelectItem>)}</SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-1">
                  <NumericInput
                    value={c.startPeriod}
                    onCommit={(v) => commit(c.id, { startPeriod: Math.max(0, v ?? 0) })}
                    required min={0} disabled={!canEdit}
                    className="h-8 text-sm text-center tabular-nums"
                  />
                </td>
                <td className="px-2 py-1">
                  <NumericInput
                    value={c.durationPeriods}
                    onCommit={(v) => commit(c.id, { durationPeriods: Math.max(1, v ?? 1) })}
                    required min={1} disabled={!canEdit}
                    className="h-8 text-sm text-center tabular-nums"
                  />
                </td>
                <td className="px-2 py-1">
                  <Select value={c.distributionCurve} onValueChange={(v) => v && commit(c.id, { distributionCurve: v as DistributionCurve })}>
                    <SelectTrigger disabled={!canEdit} className="h-8 text-xs">
                      {CURVES.find((cv) => cv.value === c.distributionCurve)?.label}
                    </SelectTrigger>
                    <SelectContent>{CURVES.map((cv) => <SelectItem key={cv.value} value={cv.value}>{cv.label}</SelectItem>)}</SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-1 text-right text-xs tabular-nums text-muted-foreground">
                  {c.currency} {formatNumber(c.totalAmount, 0)}
                </td>
                <td className="px-2 py-1 text-center">
                  {canEdit && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => del(c.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {cats.length === 0 && (
              <tr><td colSpan={8} className="text-center text-xs text-muted-foreground py-4">Sin rubros de construcción</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <Button variant="outline" size="sm" onClick={add} className="text-xs">
          <Plus className="h-3 w-3 mr-1" /> Agregar rubro
        </Button>
      )}
    </div>
  );
}

/* ─── Tabla Otros Gastos ──────────────────────────────────────────── */

function OthersTable({
  items, scenarioId, setInput, canEdit,
}: {
  items: OtherExpense[];
  scenarioId: string;
  setInput: SetInput;
  canEdit: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);

  async function commit(id: string, patch: Partial<OtherExpense>) {
    patchOtherLocally(setInput, id, patch);
    try {
      await updateOtherExpense(supabase, id, patch);
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`);
    }
  }

  /** Cambio de calculationBasis: limpia el campo no usado (fixedAmount o
   *  percentage) e inicializa el otro en 0 si está vacío. */
  async function changeBasis(item: OtherExpense, basis: CalculationBasis) {
    if (basis === item.calculationBasis) return;
    const patch: Partial<OtherExpense> = { calculationBasis: basis };
    if (basis === "fixed_amount") {
      patch.percentage = null;
      if (item.fixedAmount == null) patch.fixedAmount = 0;
    } else {
      patch.fixedAmount = null;
      if (item.percentage == null) patch.percentage = 0;
    }
    await commit(item.id, patch);
  }

  async function add() {
    try {
      const created = await createOtherExpense(supabase, scenarioId, items.length);
      setInput((prev) => prev ? { ...prev, otherExpenses: [...prev.otherExpenses, created] } : prev);
    } catch (e) {
      toast.error(`No se pudo crear: ${(e as Error).message}`);
    }
  }
  async function del(id: string) {
    if (!confirm("¿Eliminar este gasto?")) return;
    try {
      await deleteOtherExpense(supabase, id);
      setInput((prev) => prev ? { ...prev, otherExpenses: prev.otherExpenses.filter((e) => e.id !== id) } : prev);
    } catch (e) {
      toast.error(`No se pudo eliminar: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "20%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "6%" }} />
          </colgroup>
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-2 py-1.5 font-semibold">Concepto</th>
              <th className="text-center px-2 py-1.5 font-semibold">Tipo</th>
              <th className="text-center px-2 py-1.5 font-semibold">Base</th>
              <th className="text-right px-2 py-1.5 font-semibold">Valor / %</th>
              <th className="text-center px-2 py-1.5 font-semibold">Mon</th>
              <th className="text-center px-2 py-1.5 font-semibold">Timing</th>
              <th className="text-center px-2 py-1.5 font-semibold">Inicio</th>
              <th className="text-center px-2 py-1.5 font-semibold">Fin</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => {
              const isPct = e.calculationBasis !== "fixed_amount";
              return (
                <tr key={e.id} className="border-t hover:bg-muted/30">
                  <td className="px-2 py-1">
                    <Input defaultValue={e.description}
                      onBlur={(ev) => { if (ev.target.value !== e.description) commit(e.id, { description: ev.target.value }); }}
                      disabled={!canEdit} className="h-8 text-sm" />
                  </td>
                  <td className="px-2 py-1">
                    <Select value={e.expenseType} onValueChange={(v) => v && commit(e.id, { expenseType: v as ExpenseType })}>
                      <SelectTrigger disabled={!canEdit} className="h-8 text-xs">
                        {EXPENSE_TYPES.find((t) => t.value === e.expenseType)?.label}
                      </SelectTrigger>
                      <SelectContent>{EXPENSE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1">
                    <Select
                      value={e.calculationBasis}
                      onValueChange={(v) => v && changeBasis(e, v as CalculationBasis)}
                    >
                      <SelectTrigger disabled={!canEdit} className="h-8 text-xs">
                        {BASIS.find((b) => b.value === e.calculationBasis)?.label}
                      </SelectTrigger>
                      <SelectContent>{BASIS.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1">
                    {isPct ? (
                      <div className="relative">
                        <NumericInput
                          value={e.percentage}
                          onCommit={(v) => commit(e.id, { percentage: v })}
                          displayMultiplier={100}
                          min={0} max={100}
                          disabled={!canEdit}
                          className="h-8 text-sm text-right tabular-nums pr-6"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground pointer-events-none">%</span>
                      </div>
                    ) : (
                      <NumericInput
                        value={e.fixedAmount}
                        onCommit={(v) => commit(e.id, { fixedAmount: v })}
                        min={0}
                        disabled={!canEdit}
                        className="h-8 text-sm text-right tabular-nums"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {isPct ? (
                      <span className="text-[11px] text-muted-foreground/60 italic">—</span>
                    ) : (
                      <Select value={e.currency ?? "USD"} onValueChange={(v) => v && commit(e.id, { currency: v as Currency })}>
                        <SelectTrigger disabled={!canEdit} className="h-8 text-xs">{e.currency ?? "USD"}</SelectTrigger>
                        <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <Select value={e.timingType} onValueChange={(v) => v && commit(e.id, { timingType: v as TimingType })}>
                      <SelectTrigger disabled={!canEdit} className="h-8 text-xs">
                        {TIMINGS.find((t) => t.value === e.timingType)?.label}
                      </SelectTrigger>
                      <SelectContent>{TIMINGS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1">
                    <NumericInput
                      value={e.periodStart}
                      onCommit={(v) => commit(e.id, { periodStart: v == null ? null : Math.max(0, v) })}
                      min={0}
                      disabled={!canEdit}
                      className="h-8 text-sm text-center tabular-nums"
                      placeholder="—"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <NumericInput
                      value={e.periodEnd}
                      onCommit={(v) => commit(e.id, { periodEnd: v == null ? null : Math.max(0, v) })}
                      min={0}
                      disabled={!canEdit}
                      className="h-8 text-sm text-center tabular-nums"
                      placeholder="—"
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    {canEdit && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => del(e.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr><td colSpan={9} className="text-center text-xs text-muted-foreground py-4">Sin otros gastos</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <Button variant="outline" size="sm" onClick={add} className="text-xs">
          <Plus className="h-3 w-3 mr-1" /> Agregar gasto
        </Button>
      )}
    </div>
  );
}
