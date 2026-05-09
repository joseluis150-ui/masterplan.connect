/**
 * Tipos del dominio del módulo Modelo de Negocio.
 *
 * Independiente del resto del programa: NO importa nada de
 * src/lib/types/database.ts (salvo Project flag, que es global). Mantenemos
 * los tipos del módulo aquí para evitar contaminar los tipos globales con
 * interfaces específicas de un módulo opcional.
 *
 * Convención: las interfaces siguen camelCase (TS) y la capa api.ts hace
 * el mapeo desde snake_case (DB) a camelCase. Los enums son string unions.
 */

export type Currency = "USD" | "PYG" | "GTQ";
export type Granularity = "monthly" | "quarterly";
export type ScenarioType = "base" | "optimistic" | "pessimistic" | "custom";
export type DistributionCurve = "linear" | "s_curve" | "front_loaded" | "back_loaded" | "custom";
export type PaymentStructure = "lump_sum" | "installments";
export type ExpenseType =
  | "professional_fees" | "taxes" | "sales_commission" | "marketing"
  | "financial" | "permits" | "admin" | "contingency" | "other";
export type CalculationBasis =
  | "fixed_amount" | "pct_of_construction" | "pct_of_sales" | "pct_of_land";
export type TimingType = "one_time" | "recurring" | "distributed" | "on_event";
export type ModelStatus = "draft" | "active" | "archived";

// ─── Configuración del modelo ───────────────────────────────────────────

export interface BusinessModel {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  granularity: Granularity;
  /** ISO date YYYY-MM-DD (sin tiempo). Define el período 0 del modelo. */
  startDate: string;
  /** Cantidad de períodos del horizonte (1-120). Si granularity=monthly,
   *  son meses; si quarterly, trimestres. */
  horizonPeriods: number;
  reportingCurrency: Currency;
  baseExchangeRate: number | null;
  /** Devaluación anual estimada (ej. 0.05 = 5%). Aplica composición sobre
   *  el TC base por período. */
  annualDevaluation: number;
  /** Tasa de descuento anual usada para VAN (ej. 0.12 = 12%). */
  discountRate: number;
  status: ModelStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

// ─── Escenario ───────────────────────────────────────────────────────────

export interface Scenario {
  id: string;
  businessModelId: string;
  name: string;
  scenarioType: ScenarioType | null;
  isDefault: boolean;
  notes: string | null;
  displayOrder: number;
  createdAt: string;
}

// ─── Costos ──────────────────────────────────────────────────────────────

export interface LandCost {
  id: string;
  scenarioId: string;
  description: string;
  totalAmount: number;
  currency: Currency;
  paymentStructure: PaymentStructure;
  paymentStartPeriod: number;
  installmentsCount: number | null;
  installmentFrequencyPeriods: number | null;
  notes: string | null;
  displayOrder: number;
}

export interface ConstructionCategory {
  id: string;
  scenarioId: string;
  categoryName: string;
  categoryOrder: number;
  totalAmount: number;
  currency: Currency;
  startPeriod: number;
  durationPeriods: number;
  distributionCurve: DistributionCurve;
  /** Sólo se usa cuando distributionCurve = "custom". Array de pesos
   *  (no necesariamente normalizados — el motor normaliza). */
  customDistribution: number[] | null;
  notes: string | null;
}

export interface OtherExpense {
  id: string;
  scenarioId: string;
  expenseType: ExpenseType;
  description: string;
  calculationBasis: CalculationBasis;
  fixedAmount: number | null;
  /** Decimal (ej. 0.08 = 8%). Sólo se usa si calculationBasis !== fixed_amount. */
  percentage: number | null;
  currency: Currency | null;
  timingType: TimingType;
  periodStart: number | null;
  periodEnd: number | null;
  recurrencePeriods: number | null;
  triggeredByEvent: string | null;
  displayOrder: number;
  notes: string | null;
}

// ─── Ingresos ────────────────────────────────────────────────────────────

export interface SellableUnit {
  id: string;
  scenarioId: string;
  unitName: string;
  unitType: string | null;
  surfaceM2: number | null;
  quantity: number;
  displayOrder: number;
  notes: string | null;
  /** Cargado opcionalmente cuando se trae con join. */
  salesPhases?: SalesPhase[];
}

export interface SalesPhase {
  id: string;
  sellableUnitId: string;
  phaseName: string;
  phaseOrder: number;
  unitsToSell: number;
  pricePerUnit: number;
  currency: Currency;
  salePeriodStart: number;
  salePeriodEnd: number;
  /** Decimal 0-1. Suma de down + installments + final debe ser ≈ 1 (validado
   *  en UI; el motor no fuerza la suma). */
  downPaymentPct: number;
  installmentsCount: number;
  installmentsPct: number;
  finalPaymentPct: number;
  finalPaymentPeriod: number | null;
  notes: string | null;
}

// ─── Resultados calculados ──────────────────────────────────────────────

export interface CashflowPeriod {
  period: number;
  /** ISO YYYY-MM-DD del primer día del período. */
  date: string;
  /** TC del período aplicado a las conversiones (LOCAL→reportingCurrency). */
  fxRate: number;
  inflows: {
    sales: number;
    /** Breakdown por unidad-fase, key = `${unitName} / ${phaseName}`. */
    breakdown: Record<string, number>;
  };
  outflows: {
    land: number;
    construction: number;
    /** Breakdown por categoryName. */
    constructionByCategory: Record<string, number>;
    otherExpenses: number;
    /** Breakdown por expenseType. */
    otherExpensesByType: Record<string, number>;
    total: number;
  };
  netCashflow: number;
  accumulatedCashflow: number;
}

export interface Kpis {
  totalInvestment: number;
  totalRevenue: number;
  grossProfit: number;
  netProfit: number;
  /** Decimal 0-1 (ej. 0.18 = 18%). */
  grossMarginPct: number;
  netMarginPct: number;
  roiPct: number;
  irrPeriodPct: number;
  irrAnnualPct: number;
  npv: number;
  discountRateUsed: number;
  /** Primer período donde acumulado >= 0; -1 si nunca. */
  paybackPeriod: number;
  breakEvenUnits: number;
  /** Primer período donde ingresos acumulados >= costos acumulados; -1 si nunca. */
  breakEvenPeriod: number;
}

export interface ScenarioCalculationResult {
  scenario: Scenario;
  cashflow: CashflowPeriod[];
  kpis: Kpis;
}

/** Bundle de inputs para calcular un escenario. Se construye en el cliente
 *  agregando los datos del scenario activo + sus hijos. */
export interface ScenarioInput {
  model: BusinessModel;
  scenario: Scenario;
  land: LandCost[];
  construction: ConstructionCategory[];
  otherExpenses: OtherExpense[];
  units: SellableUnit[]; // con salesPhases anidadas
}
