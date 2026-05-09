/**
 * Capa de acceso a Supabase para el módulo Modelo de Negocio.
 *
 * Mapea snake_case de DB ↔ camelCase de TS. Funciones devuelven los
 * objetos del dominio listos para usar.
 *
 * Cada función toma un `supabase` client (no lo importa internamente)
 * para que sea fácilmente testeable y compatible con SSR/CSR.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BusinessModel, ConstructionCategory, LandCost, OtherExpense,
  Scenario, ScenarioInput, SellableUnit, SalesPhase,
} from "./types";

/* ─── Mappers DB → Domain ─────────────────────────────────────────── */

type DbRow = Record<string, unknown>;

function mapModel(r: DbRow): BusinessModel {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    granularity: r.granularity as BusinessModel["granularity"],
    startDate: r.start_date as string,
    horizonPeriods: r.horizon_periods as number,
    reportingCurrency: r.reporting_currency as BusinessModel["reportingCurrency"],
    baseExchangeRate: r.base_exchange_rate != null ? Number(r.base_exchange_rate) : null,
    annualDevaluation: Number(r.annual_devaluation ?? 0),
    discountRate: Number(r.discount_rate ?? 0),
    status: r.status as BusinessModel["status"],
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    createdBy: (r.created_by as string | null) ?? null,
  };
}

function mapScenario(r: DbRow): Scenario {
  return {
    id: r.id as string,
    businessModelId: r.business_model_id as string,
    name: r.name as string,
    scenarioType: (r.scenario_type as Scenario["scenarioType"]) ?? null,
    isDefault: Boolean(r.is_default),
    notes: (r.notes as string | null) ?? null,
    displayOrder: r.display_order as number,
    createdAt: r.created_at as string,
  };
}

function mapLand(r: DbRow): LandCost {
  return {
    id: r.id as string,
    scenarioId: r.scenario_id as string,
    description: r.description as string,
    totalAmount: Number(r.total_amount),
    currency: r.currency as LandCost["currency"],
    paymentStructure: r.payment_structure as LandCost["paymentStructure"],
    paymentStartPeriod: r.payment_start_period as number,
    installmentsCount: (r.installments_count as number | null) ?? null,
    installmentFrequencyPeriods: (r.installment_frequency_periods as number | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    displayOrder: r.display_order as number,
  };
}

function mapConstruction(r: DbRow): ConstructionCategory {
  return {
    id: r.id as string,
    scenarioId: r.scenario_id as string,
    categoryName: r.category_name as string,
    categoryOrder: r.category_order as number,
    totalAmount: Number(r.total_amount),
    currency: r.currency as ConstructionCategory["currency"],
    startPeriod: r.start_period as number,
    durationPeriods: r.duration_periods as number,
    distributionCurve: r.distribution_curve as ConstructionCategory["distributionCurve"],
    customDistribution: (r.custom_distribution as number[] | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  };
}

function mapOther(r: DbRow): OtherExpense {
  return {
    id: r.id as string,
    scenarioId: r.scenario_id as string,
    expenseType: r.expense_type as OtherExpense["expenseType"],
    description: r.description as string,
    calculationBasis: r.calculation_basis as OtherExpense["calculationBasis"],
    fixedAmount: r.fixed_amount != null ? Number(r.fixed_amount) : null,
    percentage: r.percentage != null ? Number(r.percentage) : null,
    currency: (r.currency as OtherExpense["currency"]) ?? null,
    timingType: r.timing_type as OtherExpense["timingType"],
    periodStart: (r.period_start as number | null) ?? null,
    periodEnd: (r.period_end as number | null) ?? null,
    recurrencePeriods: (r.recurrence_periods as number | null) ?? null,
    triggeredByEvent: (r.triggered_by_event as string | null) ?? null,
    displayOrder: r.display_order as number,
    notes: (r.notes as string | null) ?? null,
  };
}

function mapUnit(r: DbRow): SellableUnit {
  return {
    id: r.id as string,
    scenarioId: r.scenario_id as string,
    unitName: r.unit_name as string,
    unitType: (r.unit_type as string | null) ?? null,
    surfaceM2: r.surface_m2 != null ? Number(r.surface_m2) : null,
    quantity: r.quantity as number,
    displayOrder: r.display_order as number,
    notes: (r.notes as string | null) ?? null,
  };
}

function mapPhase(r: DbRow): SalesPhase {
  return {
    id: r.id as string,
    sellableUnitId: r.sellable_unit_id as string,
    phaseName: r.phase_name as string,
    phaseOrder: r.phase_order as number,
    unitsToSell: r.units_to_sell as number,
    pricePerUnit: Number(r.price_per_unit),
    currency: r.currency as SalesPhase["currency"],
    salePeriodStart: r.sale_period_start as number,
    salePeriodEnd: r.sale_period_end as number,
    downPaymentPct: Number(r.down_payment_pct),
    installmentsCount: r.installments_count as number,
    installmentsPct: Number(r.installments_pct),
    finalPaymentPct: Number(r.final_payment_pct),
    finalPaymentPeriod: (r.final_payment_period as number | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  };
}

/* ─── Loaders ─────────────────────────────────────────────────────── */

/** Carga el modelo de un proyecto + todos sus escenarios. Devuelve
 *  null si no existe modelo aún. */
export async function loadBusinessModel(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ model: BusinessModel; scenarios: Scenario[] } | null> {
  const { data: modelRow } = await supabase
    .from("business_models")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!modelRow) return null;
  const model = mapModel(modelRow as DbRow);
  const { data: scenarioRows } = await supabase
    .from("business_model_scenarios")
    .select("*")
    .eq("business_model_id", model.id)
    .order("display_order");
  const scenarios = ((scenarioRows ?? []) as DbRow[]).map(mapScenario);
  return { model, scenarios };
}

/** Carga todos los datos de un escenario (land + construction + others +
 *  units con fases). Listo para alimentar el motor. */
export async function loadScenarioInput(
  supabase: SupabaseClient,
  model: BusinessModel,
  scenario: Scenario,
): Promise<ScenarioInput> {
  const [landRes, constrRes, othersRes, unitsRes] = await Promise.all([
    supabase.from("bm_land_costs").select("*").eq("scenario_id", scenario.id).order("display_order"),
    supabase.from("bm_construction_categories").select("*").eq("scenario_id", scenario.id).order("category_order"),
    supabase.from("bm_other_expenses").select("*").eq("scenario_id", scenario.id).order("display_order"),
    supabase.from("bm_sellable_units").select("*").eq("scenario_id", scenario.id).order("display_order"),
  ]);
  const units = ((unitsRes.data ?? []) as DbRow[]).map(mapUnit);
  let phases: SalesPhase[] = [];
  if (units.length > 0) {
    const { data: phaseRows } = await supabase
      .from("bm_sales_phases")
      .select("*")
      .in("sellable_unit_id", units.map((u) => u.id))
      .order("phase_order");
    phases = ((phaseRows ?? []) as DbRow[]).map(mapPhase);
  }
  // Anidar fases en sus unidades
  const phasesByUnit = new Map<string, SalesPhase[]>();
  for (const p of phases) {
    if (!phasesByUnit.has(p.sellableUnitId)) phasesByUnit.set(p.sellableUnitId, []);
    phasesByUnit.get(p.sellableUnitId)!.push(p);
  }
  const unitsWithPhases = units.map((u) => ({ ...u, salesPhases: phasesByUnit.get(u.id) ?? [] }));

  return {
    model, scenario,
    land: ((landRes.data ?? []) as DbRow[]).map(mapLand),
    construction: ((constrRes.data ?? []) as DbRow[]).map(mapConstruction),
    otherExpenses: ((othersRes.data ?? []) as DbRow[]).map(mapOther),
    units: unitsWithPhases,
  };
}

/* ─── Creators / Updaters ─────────────────────────────────────────── */

/** Crea un modelo nuevo + escenario "Base" por defecto. Devuelve el modelo. */
export async function createBusinessModel(
  supabase: SupabaseClient,
  projectId: string,
  defaults: {
    name?: string;
    granularity?: BusinessModel["granularity"];
    startDate?: string;
    horizonPeriods?: number;
    reportingCurrency?: BusinessModel["reportingCurrency"];
    baseExchangeRate?: number;
  } = {},
): Promise<{ model: BusinessModel; baseScenario: Scenario }> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: modelData, error: modelErr } = await supabase
    .from("business_models")
    .insert({
      project_id: projectId,
      name: defaults.name ?? "Modelo de negocio",
      granularity: defaults.granularity ?? "monthly",
      start_date: defaults.startDate ?? new Date().toISOString().slice(0, 10),
      horizon_periods: defaults.horizonPeriods ?? 24,
      reporting_currency: defaults.reportingCurrency ?? "USD",
      base_exchange_rate: defaults.baseExchangeRate ?? 7400,
      annual_devaluation: 0.05,
      discount_rate: 0.12,
      status: "draft",
      created_by: user?.id ?? null,
    })
    .select()
    .single();
  if (modelErr || !modelData) throw modelErr ?? new Error("No se pudo crear el modelo");
  const model = mapModel(modelData as DbRow);

  const { data: scData, error: scErr } = await supabase
    .from("business_model_scenarios")
    .insert({
      business_model_id: model.id,
      name: "Base",
      scenario_type: "base",
      is_default: true,
      display_order: 0,
    })
    .select()
    .single();
  if (scErr || !scData) throw scErr ?? new Error("No se pudo crear el escenario");
  return { model, baseScenario: mapScenario(scData as DbRow) };
}

/** Actualiza campos del modelo. */
export async function updateBusinessModel(
  supabase: SupabaseClient,
  modelId: string,
  patch: Partial<{
    name: string; description: string | null; granularity: BusinessModel["granularity"];
    startDate: string; horizonPeriods: number; reportingCurrency: BusinessModel["reportingCurrency"];
    baseExchangeRate: number | null; annualDevaluation: number; discountRate: number;
    status: BusinessModel["status"];
  }>,
): Promise<void> {
  const dbPatch: DbRow = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.description !== undefined) dbPatch.description = patch.description;
  if (patch.granularity !== undefined) dbPatch.granularity = patch.granularity;
  if (patch.startDate !== undefined) dbPatch.start_date = patch.startDate;
  if (patch.horizonPeriods !== undefined) dbPatch.horizon_periods = patch.horizonPeriods;
  if (patch.reportingCurrency !== undefined) dbPatch.reporting_currency = patch.reportingCurrency;
  if (patch.baseExchangeRate !== undefined) dbPatch.base_exchange_rate = patch.baseExchangeRate;
  if (patch.annualDevaluation !== undefined) dbPatch.annual_devaluation = patch.annualDevaluation;
  if (patch.discountRate !== undefined) dbPatch.discount_rate = patch.discountRate;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  await supabase.from("business_models").update(dbPatch).eq("id", modelId);
}

/* ─── Scenarios ───────────────────────────────────────────────────── */

export async function createScenario(
  supabase: SupabaseClient,
  modelId: string,
  name: string,
  scenarioType: Scenario["scenarioType"] = "custom",
  displayOrder = 0,
): Promise<Scenario> {
  const { data, error } = await supabase
    .from("business_model_scenarios")
    .insert({
      business_model_id: modelId,
      name,
      scenario_type: scenarioType,
      is_default: false,
      display_order: displayOrder,
    })
    .select()
    .single();
  if (error || !data) throw error ?? new Error("No se pudo crear el escenario");
  return mapScenario(data as DbRow);
}

export async function deleteScenario(supabase: SupabaseClient, scenarioId: string): Promise<void> {
  await supabase.from("business_model_scenarios").delete().eq("id", scenarioId);
}

export async function updateScenario(
  supabase: SupabaseClient,
  scenarioId: string,
  patch: Partial<{ name: string; scenarioType: Scenario["scenarioType"]; isDefault: boolean; notes: string | null; displayOrder: number }>,
): Promise<void> {
  const dbPatch: DbRow = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.scenarioType !== undefined) dbPatch.scenario_type = patch.scenarioType;
  if (patch.isDefault !== undefined) dbPatch.is_default = patch.isDefault;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;
  if (patch.displayOrder !== undefined) dbPatch.display_order = patch.displayOrder;
  await supabase.from("business_model_scenarios").update(dbPatch).eq("id", scenarioId);
}

/** Duplica todo el contenido de un escenario en otro nuevo. Server-side
 *  con un único round trip vía RPC sería más limpio; por simplicidad
 *  hacemos client-side: cargo todo del origen, inserto cabecera y
 *  copias secuenciales. */
export async function duplicateScenario(
  supabase: SupabaseClient,
  sourceScenarioId: string,
  newName: string,
): Promise<Scenario> {
  // 1. cargar fuente
  const { data: srcData } = await supabase.from("business_model_scenarios").select("*").eq("id", sourceScenarioId).single();
  if (!srcData) throw new Error("Escenario origen no encontrado");
  const src = mapScenario(srcData as DbRow);

  // calcular nuevo display_order = max + 1
  const { data: allScenarios } = await supabase
    .from("business_model_scenarios")
    .select("display_order")
    .eq("business_model_id", src.businessModelId);
  const maxOrder = ((allScenarios ?? []) as DbRow[]).reduce((a, r) => Math.max(a, (r.display_order as number) ?? 0), -1);

  // 2. crear cabecera nueva
  const { data: newScData, error: scErr } = await supabase.from("business_model_scenarios").insert({
    business_model_id: src.businessModelId,
    name: newName,
    scenario_type: "custom",
    is_default: false,
    display_order: maxOrder + 1,
  }).select().single();
  if (scErr || !newScData) throw scErr ?? new Error("No se pudo duplicar");
  const newScenario = mapScenario(newScData as DbRow);

  // 3. copiar tablas hijas
  const tables: { from: string; columns: string[] }[] = [
    { from: "bm_land_costs", columns: ["description", "total_amount", "currency", "payment_structure", "payment_start_period", "installments_count", "installment_frequency_periods", "notes", "display_order"] },
    { from: "bm_construction_categories", columns: ["category_name", "category_order", "total_amount", "currency", "start_period", "duration_periods", "distribution_curve", "custom_distribution", "notes"] },
    { from: "bm_other_expenses", columns: ["expense_type", "description", "calculation_basis", "fixed_amount", "percentage", "currency", "timing_type", "period_start", "period_end", "recurrence_periods", "triggered_by_event", "display_order", "notes"] },
  ];
  for (const t of tables) {
    const { data: srcRows } = await supabase.from(t.from).select(t.columns.join(",")).eq("scenario_id", sourceScenarioId);
    if (srcRows && srcRows.length > 0) {
      const inserts = (srcRows as unknown as DbRow[]).map((r) => ({ scenario_id: newScenario.id, ...Object.fromEntries(t.columns.map((c) => [c, r[c]])) }));
      await supabase.from(t.from).insert(inserts);
    }
  }

  // Unidades + fases (necesita mapeo de IDs)
  const { data: srcUnits } = await supabase
    .from("bm_sellable_units")
    .select("id, unit_name, unit_type, surface_m2, quantity, display_order, notes")
    .eq("scenario_id", sourceScenarioId);
  if (srcUnits && srcUnits.length > 0) {
    const oldToNew = new Map<string, string>();
    for (const u of srcUnits as DbRow[]) {
      const { data: newU } = await supabase.from("bm_sellable_units").insert({
        scenario_id: newScenario.id,
        unit_name: u.unit_name,
        unit_type: u.unit_type,
        surface_m2: u.surface_m2,
        quantity: u.quantity,
        display_order: u.display_order,
        notes: u.notes,
      }).select("id").single();
      if (newU) oldToNew.set(u.id as string, (newU as DbRow).id as string);
    }
    // copiar fases
    const oldUnitIds = (srcUnits as DbRow[]).map((u) => u.id as string);
    const { data: srcPhases } = await supabase
      .from("bm_sales_phases")
      .select("*")
      .in("sellable_unit_id", oldUnitIds);
    if (srcPhases && srcPhases.length > 0) {
      const inserts = (srcPhases as DbRow[]).map((p) => ({
        sellable_unit_id: oldToNew.get(p.sellable_unit_id as string),
        phase_name: p.phase_name,
        phase_order: p.phase_order,
        units_to_sell: p.units_to_sell,
        price_per_unit: p.price_per_unit,
        currency: p.currency,
        sale_period_start: p.sale_period_start,
        sale_period_end: p.sale_period_end,
        down_payment_pct: p.down_payment_pct,
        installments_count: p.installments_count,
        installments_pct: p.installments_pct,
        final_payment_pct: p.final_payment_pct,
        final_payment_period: p.final_payment_period,
        notes: p.notes,
      })).filter((i) => i.sellable_unit_id);
      if (inserts.length > 0) await supabase.from("bm_sales_phases").insert(inserts);
    }
  }

  return newScenario;
}

/* ─── Land costs CRUD ─────────────────────────────────────────────── */

export async function createLandCost(supabase: SupabaseClient, scenarioId: string, displayOrder: number): Promise<LandCost> {
  const { data, error } = await supabase.from("bm_land_costs").insert({
    scenario_id: scenarioId,
    description: "Costo de tierra",
    total_amount: 0,
    currency: "USD",
    payment_structure: "lump_sum",
    payment_start_period: 0,
    display_order: displayOrder,
  }).select().single();
  if (error || !data) throw error ?? new Error("No se pudo crear el costo de tierra");
  return mapLand(data as DbRow);
}

export async function updateLandCost(
  supabase: SupabaseClient, id: string, patch: Partial<Omit<LandCost, "id" | "scenarioId">>,
): Promise<void> {
  const db: DbRow = {};
  if (patch.description !== undefined) db.description = patch.description;
  if (patch.totalAmount !== undefined) db.total_amount = patch.totalAmount;
  if (patch.currency !== undefined) db.currency = patch.currency;
  if (patch.paymentStructure !== undefined) db.payment_structure = patch.paymentStructure;
  if (patch.paymentStartPeriod !== undefined) db.payment_start_period = patch.paymentStartPeriod;
  if (patch.installmentsCount !== undefined) db.installments_count = patch.installmentsCount;
  if (patch.installmentFrequencyPeriods !== undefined) db.installment_frequency_periods = patch.installmentFrequencyPeriods;
  if (patch.notes !== undefined) db.notes = patch.notes;
  if (patch.displayOrder !== undefined) db.display_order = patch.displayOrder;
  await supabase.from("bm_land_costs").update(db).eq("id", id);
}

export async function deleteLandCost(supabase: SupabaseClient, id: string): Promise<void> {
  await supabase.from("bm_land_costs").delete().eq("id", id);
}

/* ─── Construction CRUD ────────────────────────────────────────────── */

export async function createConstructionCategory(
  supabase: SupabaseClient, scenarioId: string, categoryOrder: number,
): Promise<ConstructionCategory> {
  const { data, error } = await supabase.from("bm_construction_categories").insert({
    scenario_id: scenarioId,
    category_name: "Nuevo rubro",
    category_order: categoryOrder,
    total_amount: 0,
    currency: "USD",
    start_period: 0,
    duration_periods: 1,
    distribution_curve: "linear",
  }).select().single();
  if (error || !data) throw error ?? new Error("No se pudo crear la categoría");
  return mapConstruction(data as DbRow);
}

export async function updateConstructionCategory(
  supabase: SupabaseClient, id: string,
  patch: Partial<Omit<ConstructionCategory, "id" | "scenarioId">>,
): Promise<void> {
  const db: DbRow = {};
  if (patch.categoryName !== undefined) db.category_name = patch.categoryName;
  if (patch.categoryOrder !== undefined) db.category_order = patch.categoryOrder;
  if (patch.totalAmount !== undefined) db.total_amount = patch.totalAmount;
  if (patch.currency !== undefined) db.currency = patch.currency;
  if (patch.startPeriod !== undefined) db.start_period = patch.startPeriod;
  if (patch.durationPeriods !== undefined) db.duration_periods = patch.durationPeriods;
  if (patch.distributionCurve !== undefined) db.distribution_curve = patch.distributionCurve;
  if (patch.customDistribution !== undefined) db.custom_distribution = patch.customDistribution;
  if (patch.notes !== undefined) db.notes = patch.notes;
  await supabase.from("bm_construction_categories").update(db).eq("id", id);
}

export async function deleteConstructionCategory(supabase: SupabaseClient, id: string): Promise<void> {
  await supabase.from("bm_construction_categories").delete().eq("id", id);
}

/* ─── Other expenses CRUD ──────────────────────────────────────────── */

export async function createOtherExpense(
  supabase: SupabaseClient, scenarioId: string, displayOrder: number,
): Promise<OtherExpense> {
  const { data, error } = await supabase.from("bm_other_expenses").insert({
    scenario_id: scenarioId,
    expense_type: "other",
    description: "Nuevo gasto",
    calculation_basis: "fixed_amount",
    fixed_amount: 0,
    currency: "USD",
    timing_type: "one_time",
    period_start: 0,
    display_order: displayOrder,
  }).select().single();
  if (error || !data) throw error ?? new Error("No se pudo crear el gasto");
  return mapOther(data as DbRow);
}

export async function updateOtherExpense(
  supabase: SupabaseClient, id: string,
  patch: Partial<Omit<OtherExpense, "id" | "scenarioId">>,
): Promise<void> {
  const db: DbRow = {};
  if (patch.expenseType !== undefined) db.expense_type = patch.expenseType;
  if (patch.description !== undefined) db.description = patch.description;
  if (patch.calculationBasis !== undefined) db.calculation_basis = patch.calculationBasis;
  if (patch.fixedAmount !== undefined) db.fixed_amount = patch.fixedAmount;
  if (patch.percentage !== undefined) db.percentage = patch.percentage;
  if (patch.currency !== undefined) db.currency = patch.currency;
  if (patch.timingType !== undefined) db.timing_type = patch.timingType;
  if (patch.periodStart !== undefined) db.period_start = patch.periodStart;
  if (patch.periodEnd !== undefined) db.period_end = patch.periodEnd;
  if (patch.recurrencePeriods !== undefined) db.recurrence_periods = patch.recurrencePeriods;
  if (patch.triggeredByEvent !== undefined) db.triggered_by_event = patch.triggeredByEvent;
  if (patch.displayOrder !== undefined) db.display_order = patch.displayOrder;
  if (patch.notes !== undefined) db.notes = patch.notes;
  await supabase.from("bm_other_expenses").update(db).eq("id", id);
}

export async function deleteOtherExpense(supabase: SupabaseClient, id: string): Promise<void> {
  await supabase.from("bm_other_expenses").delete().eq("id", id);
}

/* ─── Sellable units CRUD ──────────────────────────────────────────── */

export async function createSellableUnit(
  supabase: SupabaseClient, scenarioId: string, displayOrder: number,
): Promise<SellableUnit> {
  const { data, error } = await supabase.from("bm_sellable_units").insert({
    scenario_id: scenarioId,
    unit_name: "Nueva unidad",
    quantity: 1,
    display_order: displayOrder,
  }).select().single();
  if (error || !data) throw error ?? new Error("No se pudo crear la unidad");
  return mapUnit(data as DbRow);
}

export async function updateSellableUnit(
  supabase: SupabaseClient, id: string,
  patch: Partial<Omit<SellableUnit, "id" | "scenarioId" | "salesPhases">>,
): Promise<void> {
  const db: DbRow = {};
  if (patch.unitName !== undefined) db.unit_name = patch.unitName;
  if (patch.unitType !== undefined) db.unit_type = patch.unitType;
  if (patch.surfaceM2 !== undefined) db.surface_m2 = patch.surfaceM2;
  if (patch.quantity !== undefined) db.quantity = patch.quantity;
  if (patch.displayOrder !== undefined) db.display_order = patch.displayOrder;
  if (patch.notes !== undefined) db.notes = patch.notes;
  await supabase.from("bm_sellable_units").update(db).eq("id", id);
}

export async function deleteSellableUnit(supabase: SupabaseClient, id: string): Promise<void> {
  await supabase.from("bm_sellable_units").delete().eq("id", id);
}

/* ─── Sales phases CRUD ────────────────────────────────────────────── */

export async function createSalesPhase(
  supabase: SupabaseClient, sellableUnitId: string, phaseOrder: number,
): Promise<SalesPhase> {
  const { data, error } = await supabase.from("bm_sales_phases").insert({
    sellable_unit_id: sellableUnitId,
    phase_name: "Nueva fase",
    phase_order: phaseOrder,
    units_to_sell: 1,
    price_per_unit: 0,
    currency: "USD",
    sale_period_start: 0,
    sale_period_end: 0,
    down_payment_pct: 0.2,
    installments_count: 0,
    installments_pct: 0,
    final_payment_pct: 0.8,
  }).select().single();
  if (error || !data) throw error ?? new Error("No se pudo crear la fase");
  return mapPhase(data as DbRow);
}

export async function updateSalesPhase(
  supabase: SupabaseClient, id: string,
  patch: Partial<Omit<SalesPhase, "id" | "sellableUnitId">>,
): Promise<void> {
  const db: DbRow = {};
  if (patch.phaseName !== undefined) db.phase_name = patch.phaseName;
  if (patch.phaseOrder !== undefined) db.phase_order = patch.phaseOrder;
  if (patch.unitsToSell !== undefined) db.units_to_sell = patch.unitsToSell;
  if (patch.pricePerUnit !== undefined) db.price_per_unit = patch.pricePerUnit;
  if (patch.currency !== undefined) db.currency = patch.currency;
  if (patch.salePeriodStart !== undefined) db.sale_period_start = patch.salePeriodStart;
  if (patch.salePeriodEnd !== undefined) db.sale_period_end = patch.salePeriodEnd;
  if (patch.downPaymentPct !== undefined) db.down_payment_pct = patch.downPaymentPct;
  if (patch.installmentsCount !== undefined) db.installments_count = patch.installmentsCount;
  if (patch.installmentsPct !== undefined) db.installments_pct = patch.installmentsPct;
  if (patch.finalPaymentPct !== undefined) db.final_payment_pct = patch.finalPaymentPct;
  if (patch.finalPaymentPeriod !== undefined) db.final_payment_period = patch.finalPaymentPeriod;
  if (patch.notes !== undefined) db.notes = patch.notes;
  await supabase.from("bm_sales_phases").update(db).eq("id", id);
}

export async function deleteSalesPhase(supabase: SupabaseClient, id: string): Promise<void> {
  await supabase.from("bm_sales_phases").delete().eq("id", id);
}
