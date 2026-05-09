"use client";

import { useState } from "react";
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

export function CostsTab({
  input, onChange, canEdit,
}: {
  input: ScenarioInput;
  onChange: () => Promise<void>;
  canEdit: boolean;
}) {
  const [openLand, setOpenLand] = useState(true);
  const [openConstr, setOpenConstr] = useState(true);
  const [openOthers, setOpenOthers] = useState(true);

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
        <LandTable lands={input.land} scenarioId={input.scenario.id} onChange={onChange} canEdit={canEdit} />
      </Section>

      <Section
        icon={Building2}
        title="Costos de construcción"
        total={input.construction.reduce((a, c) => a + c.totalAmount, 0)}
        currencyHint={input.construction[0]?.currency ?? "USD"}
        open={openConstr}
        onToggle={() => setOpenConstr(!openConstr)}
      >
        <ConstructionTable cats={input.construction} scenarioId={input.scenario.id} onChange={onChange} canEdit={canEdit} />
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
        <OthersTable items={input.otherExpenses} scenarioId={input.scenario.id} onChange={onChange} canEdit={canEdit} />
      </Section>
    </div>
  );
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
            {totalLabel ?? "Total"}: {currencyHint} {formatNumber(total, currencyHint === "USD" ? 0 : 0)}
          </div>
        </div>
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

/* ─── Tabla Tierra ────────────────────────────────────────────────── */

function LandTable({
  lands, scenarioId, onChange, canEdit,
}: {
  lands: LandCost[];
  scenarioId: string;
  onChange: () => Promise<void>;
  canEdit: boolean;
}) {
  const supabase = createClient();
  const [drafts, setDrafts] = useState<Record<string, LandCost>>({});

  const get = (l: LandCost) => drafts[l.id] ?? l;
  function set(l: LandCost, p: Partial<LandCost>) {
    setDrafts({ ...drafts, [l.id]: { ...get(l), ...p } });
  }
  async function commit(l: LandCost) {
    const next = drafts[l.id];
    if (!next) return;
    await updateLandCost(supabase, l.id, next);
    setDrafts((d) => { const n = { ...d }; delete n[l.id]; return n; });
    await onChange();
  }
  async function add() {
    await createLandCost(supabase, scenarioId, lands.length);
    await onChange();
  }
  async function del(id: string) {
    if (!confirm("¿Eliminar esta línea?")) return;
    await deleteLandCost(supabase, id);
    await onChange();
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
            {lands.map((l) => {
              const d = get(l);
              return (
                <tr key={l.id} className="border-t hover:bg-muted/30">
                  <td className="px-2 py-1">
                    <Input
                      value={d.description}
                      onChange={(e) => set(l, { description: e.target.value })}
                      onBlur={() => commit(l)}
                      disabled={!canEdit}
                      className="h-8 text-sm"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="number" min={0} step="0.01"
                      value={d.totalAmount}
                      onChange={(e) => set(l, { totalAmount: Number(e.target.value) || 0 })}
                      onBlur={() => commit(l)}
                      disabled={!canEdit}
                      className="h-8 text-sm text-right tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Select value={d.currency} onValueChange={(v) => { set(l, { currency: v as Currency }); commit({ ...l, ...d, currency: v as Currency }); }}>
                      <SelectTrigger disabled={!canEdit} className="h-8 text-xs">{d.currency}</SelectTrigger>
                      <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1">
                    <Select
                      value={d.paymentStructure}
                      onValueChange={(v) => { set(l, { paymentStructure: v as PaymentStructure }); commit({ ...l, ...d, paymentStructure: v as PaymentStructure }); }}
                    >
                      <SelectTrigger disabled={!canEdit} className="h-8 text-xs">
                        {d.paymentStructure === "lump_sum" ? "Único pago" : "Cuotas"}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lump_sum">Único pago</SelectItem>
                        <SelectItem value="installments">Cuotas</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1">
                    <Input type="number" min={0}
                      value={d.paymentStartPeriod}
                      onChange={(e) => set(l, { paymentStartPeriod: Math.max(0, Number(e.target.value) || 0) })}
                      onBlur={() => commit(l)}
                      disabled={!canEdit}
                      className="h-8 text-sm text-center tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-1">
                    {d.paymentStructure === "installments" ? (
                      <Input type="number" min={1}
                        value={d.installmentsCount ?? ""}
                        onChange={(e) => set(l, { installmentsCount: e.target.value === "" ? null : Math.max(1, Number(e.target.value)) })}
                        onBlur={() => commit(l)}
                        disabled={!canEdit}
                        className="h-8 text-sm text-center tabular-nums"
                      />
                    ) : <span className="text-xs text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-2 py-1">
                    {d.paymentStructure === "installments" ? (
                      <Input type="number" min={1}
                        value={d.installmentFrequencyPeriods ?? ""}
                        onChange={(e) => set(l, { installmentFrequencyPeriods: e.target.value === "" ? null : Math.max(1, Number(e.target.value)) })}
                        onBlur={() => commit(l)}
                        disabled={!canEdit}
                        className="h-8 text-sm text-center tabular-nums"
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
              );
            })}
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
  cats, scenarioId, onChange, canEdit,
}: {
  cats: ConstructionCategory[];
  scenarioId: string;
  onChange: () => Promise<void>;
  canEdit: boolean;
}) {
  const supabase = createClient();
  const [drafts, setDrafts] = useState<Record<string, ConstructionCategory>>({});
  const get = (c: ConstructionCategory) => drafts[c.id] ?? c;
  function set(c: ConstructionCategory, p: Partial<ConstructionCategory>) {
    setDrafts({ ...drafts, [c.id]: { ...get(c), ...p } });
  }
  async function commit(c: ConstructionCategory) {
    const next = drafts[c.id]; if (!next) return;
    await updateConstructionCategory(supabase, c.id, next);
    setDrafts((d) => { const n = { ...d }; delete n[c.id]; return n; });
    await onChange();
  }
  async function add() {
    await createConstructionCategory(supabase, scenarioId, cats.length);
    await onChange();
  }
  async function del(id: string) {
    if (!confirm("¿Eliminar este rubro?")) return;
    await deleteConstructionCategory(supabase, id);
    await onChange();
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
            {cats.map((c) => {
              const d = get(c);
              return (
                <tr key={c.id} className="border-t hover:bg-muted/30">
                  <td className="px-2 py-1">
                    <Input value={d.categoryName}
                      onChange={(e) => set(c, { categoryName: e.target.value })}
                      onBlur={() => commit(c)} disabled={!canEdit} className="h-8 text-sm" />
                  </td>
                  <td className="px-2 py-1">
                    <Input type="number" min={0} step="0.01" value={d.totalAmount}
                      onChange={(e) => set(c, { totalAmount: Number(e.target.value) || 0 })}
                      onBlur={() => commit(c)} disabled={!canEdit} className="h-8 text-sm text-right tabular-nums" />
                  </td>
                  <td className="px-2 py-1">
                    <Select value={d.currency} onValueChange={(v) => { set(c, { currency: v as Currency }); commit({ ...c, ...d, currency: v as Currency }); }}>
                      <SelectTrigger disabled={!canEdit} className="h-8 text-xs">{d.currency}</SelectTrigger>
                      <SelectContent>{CURRENCIES.map((cu) => <SelectItem key={cu} value={cu}>{cu}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1">
                    <Input type="number" min={0} value={d.startPeriod}
                      onChange={(e) => set(c, { startPeriod: Math.max(0, Number(e.target.value) || 0) })}
                      onBlur={() => commit(c)} disabled={!canEdit} className="h-8 text-sm text-center tabular-nums" />
                  </td>
                  <td className="px-2 py-1">
                    <Input type="number" min={1} value={d.durationPeriods}
                      onChange={(e) => set(c, { durationPeriods: Math.max(1, Number(e.target.value) || 1) })}
                      onBlur={() => commit(c)} disabled={!canEdit} className="h-8 text-sm text-center tabular-nums" />
                  </td>
                  <td className="px-2 py-1">
                    <Select value={d.distributionCurve} onValueChange={(v) => { set(c, { distributionCurve: v as DistributionCurve }); commit({ ...c, ...d, distributionCurve: v as DistributionCurve }); }}>
                      <SelectTrigger disabled={!canEdit} className="h-8 text-xs">
                        {CURVES.find((cv) => cv.value === d.distributionCurve)?.label}
                      </SelectTrigger>
                      <SelectContent>{CURVES.map((cv) => <SelectItem key={cv.value} value={cv.value}>{cv.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1 text-right text-xs tabular-nums text-muted-foreground">
                    {d.currency} {formatNumber(d.totalAmount, 0)}
                  </td>
                  <td className="px-2 py-1 text-center">
                    {canEdit && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => del(c.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
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
  items, scenarioId, onChange, canEdit,
}: {
  items: OtherExpense[];
  scenarioId: string;
  onChange: () => Promise<void>;
  canEdit: boolean;
}) {
  const supabase = createClient();
  const [drafts, setDrafts] = useState<Record<string, OtherExpense>>({});
  const get = (e: OtherExpense) => drafts[e.id] ?? e;
  function set(e: OtherExpense, p: Partial<OtherExpense>) {
    setDrafts({ ...drafts, [e.id]: { ...get(e), ...p } });
  }
  async function commit(e: OtherExpense) {
    const next = drafts[e.id]; if (!next) return;
    await updateOtherExpense(supabase, e.id, next);
    setDrafts((d) => { const n = { ...d }; delete n[e.id]; return n; });
    await onChange();
  }
  /** Cambio de calculationBasis: limpia el campo no usado (fixedAmount o
   *  percentage) e inicializa el otro en 0 si está vacío. Evita valores
   *  residuales raros al cambiar entre "monto fijo" y "% de algo". */
  async function changeBasis(e: OtherExpense, basis: CalculationBasis) {
    const cur = get(e);
    const next: OtherExpense = { ...cur, calculationBasis: basis };
    if (basis === "fixed_amount") {
      next.percentage = null;
      if (next.fixedAmount == null) next.fixedAmount = 0;
    } else {
      next.fixedAmount = null;
      if (next.percentage == null) next.percentage = 0;
    }
    await updateOtherExpense(supabase, e.id, next);
    setDrafts((d) => { const n = { ...d }; delete n[e.id]; return n; });
    await onChange();
  }
  async function add() {
    await createOtherExpense(supabase, scenarioId, items.length);
    await onChange();
  }
  async function del(id: string) {
    if (!confirm("¿Eliminar este gasto?")) return;
    await deleteOtherExpense(supabase, id);
    await onChange();
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
              const d = get(e);
              const isPct = d.calculationBasis !== "fixed_amount";
              return (
                <tr key={e.id} className="border-t hover:bg-muted/30">
                  <td className="px-2 py-1">
                    <Input value={d.description}
                      onChange={(ev) => set(e, { description: ev.target.value })}
                      onBlur={() => commit(e)} disabled={!canEdit} className="h-8 text-sm" />
                  </td>
                  <td className="px-2 py-1">
                    <Select value={d.expenseType} onValueChange={(v) => { set(e, { expenseType: v as ExpenseType }); commit({ ...e, ...d, expenseType: v as ExpenseType }); }}>
                      <SelectTrigger disabled={!canEdit} className="h-8 text-xs">
                        {EXPENSE_TYPES.find((t) => t.value === d.expenseType)?.label}
                      </SelectTrigger>
                      <SelectContent>{EXPENSE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1">
                    <Select
                      value={d.calculationBasis}
                      onValueChange={(v) => {
                        if (!v || v === d.calculationBasis) return;
                        // Limpia el campo no usado y persiste — evita valores
                        // residuales al alternar entre monto fijo y %.
                        changeBasis(e, v as CalculationBasis);
                      }}
                    >
                      <SelectTrigger disabled={!canEdit} className="h-8 text-xs">
                        {BASIS.find((b) => b.value === d.calculationBasis)?.label}
                      </SelectTrigger>
                      <SelectContent>{BASIS.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1">
                    {isPct ? (
                      <div className="relative">
                        <Input type="number" min={0} step="0.01" max={100}
                          value={d.percentage == null ? "" : d.percentage * 100}
                          onChange={(ev) => set(e, { percentage: ev.target.value === "" ? 0 : (Number(ev.target.value) || 0) / 100 })}
                          onBlur={() => commit(e)} disabled={!canEdit}
                          className="h-8 text-sm text-right tabular-nums pr-6"
                          placeholder="0"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground pointer-events-none">%</span>
                      </div>
                    ) : (
                      <Input type="number" min={0} step="0.01"
                        value={d.fixedAmount ?? 0}
                        onChange={(ev) => set(e, { fixedAmount: Number(ev.target.value) || 0 })}
                        onBlur={() => commit(e)} disabled={!canEdit}
                        className="h-8 text-sm text-right tabular-nums"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {isPct ? (
                      // Cuando el valor es %, la moneda se hereda de la base
                      // (sales/construction/land) — no aplica selector.
                      <span className="text-[11px] text-muted-foreground/60 italic">—</span>
                    ) : (
                      <Select value={d.currency ?? "USD"} onValueChange={(v) => { set(e, { currency: v as Currency }); commit({ ...e, ...d, currency: v as Currency }); }}>
                        <SelectTrigger disabled={!canEdit} className="h-8 text-xs">{d.currency ?? "USD"}</SelectTrigger>
                        <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <Select value={d.timingType} onValueChange={(v) => { set(e, { timingType: v as TimingType }); commit({ ...e, ...d, timingType: v as TimingType }); }}>
                      <SelectTrigger disabled={!canEdit} className="h-8 text-xs">
                        {TIMINGS.find((t) => t.value === d.timingType)?.label}
                      </SelectTrigger>
                      <SelectContent>{TIMINGS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1">
                    <Input type="number" min={0}
                      value={d.periodStart ?? ""}
                      onChange={(ev) => set(e, { periodStart: ev.target.value === "" ? null : Math.max(0, Number(ev.target.value)) })}
                      onBlur={() => commit(e)} disabled={!canEdit}
                      className="h-8 text-sm text-center tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input type="number" min={0}
                      value={d.periodEnd ?? ""}
                      onChange={(ev) => set(e, { periodEnd: ev.target.value === "" ? null : Math.max(0, Number(ev.target.value)) })}
                      onBlur={() => commit(e)} disabled={!canEdit}
                      className="h-8 text-sm text-center tabular-nums"
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
