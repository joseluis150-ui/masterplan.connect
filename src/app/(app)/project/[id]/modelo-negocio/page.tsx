"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Loader2, Settings as SettingsIcon, Wallet, Banknote, LineChart, BarChart3, GitCompareArrows, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { usePermission } from "@/lib/permissions";
import {
  loadBusinessModel, loadScenarioInput, createBusinessModel,
  createScenario, deleteScenario, updateScenario, duplicateScenario,
} from "./_lib/api";
import type {
  BusinessModel, Scenario, ScenarioInput, ScenarioCalculationResult,
} from "./_lib/types";
import { calculateCashflow } from "./_lib/calculations/cashflow";
import { calculateKpis } from "./_lib/calculations/kpis";
import { EmptyState } from "./_components/empty-state";
import { ScenariosBar } from "./_components/scenarios-bar";
import { ConfigurationTab } from "./_components/configuration-tab";
import { CostsTab } from "./_components/costs-tab";
import { RevenuesTab } from "./_components/revenues-tab";
import { CashflowTab } from "./_components/cashflow-tab";
import { KpisTab } from "./_components/kpis-tab";
import { ScenarioComparisonTab } from "./_components/scenario-comparison-tab";
import { ExportButton } from "./_components/export-button";

type TabKey = "config" | "costos" | "ingresos" | "flujo" | "kpis" | "comparativa";

const TABS: { key: TabKey; label: string; icon: typeof SettingsIcon }[] = [
  { key: "config", label: "Configuración", icon: SettingsIcon },
  { key: "costos", label: "Costos", icon: Wallet },
  { key: "ingresos", label: "Ingresos", icon: Banknote },
  { key: "flujo", label: "Flujo de caja", icon: LineChart },
  { key: "kpis", label: "KPIs", icon: BarChart3 },
  { key: "comparativa", label: "Comparativa", icon: GitCompareArrows },
];

export default function ModeloNegocioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const supabase = createClient();
  const canEdit = usePermission("modelo_negocio.write");

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [model, setModel] = useState<BusinessModel | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<string>("");
  /** Inputs cargados del escenario activo. Se recalcula al cambiar el
   *  escenario o al hacer reload de datos. */
  const [activeInput, setActiveInput] = useState<ScenarioInput | null>(null);
  /** Inputs de TODOS los escenarios — usado para la tab Comparativa. Se
   *  carga lazy cuando el usuario abre esa tab. */
  const [allInputs, setAllInputs] = useState<Map<string, ScenarioInput>>(new Map());
  const [activeTab, setActiveTab] = useState<TabKey>("config");

  /* ─── Carga inicial ─────────────────────────────────────────────── */
  const reload = useCallback(async () => {
    setLoading(true);
    const res = await loadBusinessModel(supabase, projectId);
    if (!res) {
      setModel(null);
      setScenarios([]);
      setActiveScenarioId("");
      setActiveInput(null);
      setLoading(false);
      return;
    }
    setModel(res.model);
    setScenarios(res.scenarios);
    // Mantener el activo si sigue existiendo, sino default
    let newActive = activeScenarioId && res.scenarios.find((s) => s.id === activeScenarioId)
      ? activeScenarioId
      : res.scenarios.find((s) => s.isDefault)?.id ?? res.scenarios[0]?.id ?? "";
    if (!newActive) newActive = "";
    setActiveScenarioId(newActive);
    setLoading(false);
  }, [supabase, projectId, activeScenarioId]);

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  /* ─── Carga del input del escenario activo ──────────────────────── */
  useEffect(() => {
    if (!model || !activeScenarioId) { setActiveInput(null); return; }
    const scenario = scenarios.find((s) => s.id === activeScenarioId);
    if (!scenario) { setActiveInput(null); return; }
    let cancelled = false;
    (async () => {
      const input = await loadScenarioInput(supabase, model, scenario);
      if (!cancelled) setActiveInput(input);
    })();
    return () => { cancelled = true; };
  }, [model, activeScenarioId, scenarios, supabase]);

  /* ─── Cálculos del escenario activo ─────────────────────────────── */
  const activeResult = useMemo<ScenarioCalculationResult | null>(() => {
    if (!activeInput) return null;
    const cashflow = calculateCashflow(activeInput);
    const kpis = calculateKpis(cashflow, activeInput);
    return { scenario: activeInput.scenario, cashflow, kpis };
  }, [activeInput]);

  /* ─── Cuando se abre Comparativa, cargar todos los inputs ───────── */
  useEffect(() => {
    if (activeTab !== "comparativa" || !model) return;
    let cancelled = false;
    (async () => {
      const m = new Map<string, ScenarioInput>();
      for (const s of scenarios) {
        const input = await loadScenarioInput(supabase, model, s);
        m.set(s.id, input);
      }
      if (!cancelled) setAllInputs(m);
    })();
    return () => { cancelled = true; };
  }, [activeTab, model, scenarios, supabase]);

  const allResults = useMemo<ScenarioCalculationResult[]>(() => {
    const out: ScenarioCalculationResult[] = [];
    for (const s of scenarios) {
      const input = allInputs.get(s.id);
      if (!input) continue;
      const cashflow = calculateCashflow(input);
      const kpis = calculateKpis(cashflow, input);
      out.push({ scenario: s, cashflow, kpis });
    }
    return out;
  }, [scenarios, allInputs]);

  /* ─── Handlers ──────────────────────────────────────────────────── */

  async function handleCreate() {
    setCreating(true);
    try {
      const { model: m, baseScenario } = await createBusinessModel(supabase, projectId, {
        name: "Modelo de negocio",
        granularity: "monthly",
        startDate: new Date().toISOString().slice(0, 10),
        horizonPeriods: 24,
        reportingCurrency: "USD",
      });
      setModel(m);
      setScenarios([baseScenario]);
      setActiveScenarioId(baseScenario.id);
      toast.success("Modelo creado");
    } catch (e) {
      toast.error(`Error: ${(e as Error).message}`);
    }
    setCreating(false);
  }

  async function handleAddScenario(name: string) {
    if (!model) return;
    const max = scenarios.reduce((a, s) => Math.max(a, s.displayOrder), -1);
    const sc = await createScenario(supabase, model.id, name, "custom", max + 1);
    setScenarios([...scenarios, sc]);
    setActiveScenarioId(sc.id);
  }

  async function handleDuplicateScenario(sourceId: string, name: string) {
    const sc = await duplicateScenario(supabase, sourceId, name);
    setScenarios([...scenarios, sc]);
    setActiveScenarioId(sc.id);
  }

  async function handleRenameScenario(id: string, name: string) {
    await updateScenario(supabase, id, { name });
    setScenarios(scenarios.map((s) => s.id === id ? { ...s, name } : s));
    toast.success("Renombrado");
  }

  async function handleDeleteScenario(id: string) {
    await deleteScenario(supabase, id);
    const remaining = scenarios.filter((s) => s.id !== id);
    setScenarios(remaining);
    if (id === activeScenarioId) setActiveScenarioId(remaining[0]?.id ?? "");
  }

  async function handleSetDefault(id: string) {
    // Quitar default de los otros + setear éste
    await Promise.all([
      ...scenarios.filter((s) => s.isDefault).map((s) => updateScenario(supabase, s.id, { isDefault: false })),
      updateScenario(supabase, id, { isDefault: true }),
    ]);
    setScenarios(scenarios.map((s) => ({ ...s, isDefault: s.id === id })));
    toast.success("Default actualizado");
  }

  /* ─── Render ────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!model) {
    return <EmptyState onCreate={handleCreate} creating={creating} />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 border-b border-border">
        <div className="flex items-start justify-between mb-3 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <TrendingUp className="h-5 w-5 text-[#E87722] shrink-0" />
            <h1 className="truncate">Modelo de Negocio</h1>
            <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {model.status}
            </span>
          </div>
          {activeResult && (
            <ExportButton
              model={model}
              results={allResults.length > 0 ? allResults : (activeResult ? [activeResult] : [])}
              activeResult={activeResult}
              projectId={projectId}
            />
          )}
        </div>
        {/* Tabs */}
        <div className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2.5 text-[13px] font-medium transition-colors relative whitespace-nowrap",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <span aria-hidden className="absolute left-0 right-0 -bottom-px h-[2px]" style={{ background: "#E87722" }} />
                )}
                <tab.icon className={cn("h-4 w-4", active && "text-[#E87722]")} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Scenarios bar (siempre visible salvo en config global del modelo) */}
      {scenarios.length > 0 && activeTab !== "comparativa" && (
        <ScenariosBar
          scenarios={scenarios}
          activeId={activeScenarioId}
          onSelect={setActiveScenarioId}
          onAdd={handleAddScenario}
          onDuplicate={handleDuplicateScenario}
          onRename={handleRenameScenario}
          onDelete={handleDeleteScenario}
          onSetDefault={handleSetDefault}
          canEdit={canEdit}
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "config" && (
          <ConfigurationTab model={model} onUpdate={async () => { await reload(); }} canEdit={canEdit} />
        )}
        {activeTab === "costos" && activeInput && (
          <CostsTab
            input={activeInput}
            onChange={async () => {
              const updated = await loadScenarioInput(supabase, model, activeInput.scenario);
              setActiveInput(updated);
            }}
            canEdit={canEdit}
          />
        )}
        {activeTab === "ingresos" && activeInput && (
          <RevenuesTab
            input={activeInput}
            onChange={async () => {
              const updated = await loadScenarioInput(supabase, model, activeInput.scenario);
              setActiveInput(updated);
            }}
            canEdit={canEdit}
          />
        )}
        {activeTab === "flujo" && activeResult && (
          <CashflowTab result={activeResult} model={model} />
        )}
        {activeTab === "kpis" && activeResult && (
          <KpisTab result={activeResult} model={model} />
        )}
        {activeTab === "comparativa" && (
          <ScenarioComparisonTab results={allResults} model={model} loading={allResults.length === 0 && scenarios.length > 0} />
        )}
      </div>
    </div>
  );
}
