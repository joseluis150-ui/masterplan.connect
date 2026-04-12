export type ProjectType = "costo" | "venta";
export type SectorType = "fisico" | "gastos_generales";
export type InsumoType = "material" | "mano_de_obra" | "servicio" | "global";
export type CurrencyInput = "LOCAL" | "USD";
export type PurchaseType = "directa" | "licitacion";
export type PackageStatus = "borrador" | "listo" | "en_proceso" | "adjudicado" | "cerrado";
export type DependencyType = "FS" | "SS" | "FF" | "SF";
export type ProrationCriteria = "area" | "monto";

export interface Project {
  id: string;
  name: string;
  project_type: ProjectType;
  local_currency: string;
  exchange_rate: number;
  client: string | null;
  location: string | null;
  estimated_start: string | null;
  responsible: string | null;
  proration_criteria: ProrationCriteria;
  current_version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectVersion {
  id: string;
  project_id: string;
  version: number;
  changes: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

export interface ExchangeRateVersion {
  id: string;
  project_id: string;
  version: number;
  rate: number;
  created_at: string;
}

export interface Sector {
  id: string;
  project_id: string;
  name: string;
  type: SectorType;
  area_m2: number | null;
  order: number;
}

export interface EdtCategory {
  id: string;
  project_id: string;
  code: string;
  name: string;
  order: number;
}

export interface EdtSubcategory {
  id: string;
  category_id: string;
  project_id: string;
  code: string;
  name: string;
  order: number;
}

export interface EdtTemplate {
  id: string;
  name: string;
  data: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

export interface Insumo {
  id: string;
  project_id: string;
  code: number;
  family: string | null;
  type: string;
  description: string;
  unit: string;
  pu_local: number | null;
  pu_usd: number | null;
  tc_used: number | null;
  currency_input: CurrencyInput | null;
  comment: string | null;
  reference: string | null;
  needs_review: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsumoPriceHistory {
  id: string;
  insumo_id: string;
  pu_local_old: number | null;
  pu_local_new: number | null;
  pu_usd_old: number | null;
  pu_usd_new: number | null;
  tc_used: number | null;
  created_by: string | null;
  created_at: string;
}

export interface Articulo {
  id: string;
  project_id: string;
  number: number;
  description: string;
  unit: string;
  profit_pct: number;
  comment: string | null;
  needs_review: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArticuloComposition {
  id: string;
  articulo_id: string;
  insumo_id: string;
  quantity: number;
  waste_pct: number;
  margin_pct: number;
  insumo?: Insumo;
}

export interface QuantificationLine {
  id: string;
  project_id: string;
  articulo_id: string | null;
  quantity: number | null;
  quantity_formula: string | null;
  category_id: string;
  subcategory_id: string;
  sector_id: string;
  line_number: number;
  comment: string | null;
  import_batch: string | null;
  import_batch_date: string | null;
  needs_review: boolean;
  created_at: string;
  updated_at: string;
  articulo?: Articulo;
}

export interface ScheduleConfig {
  id: string;
  project_id: string;
  start_date: string;
}

export interface ScheduleWeek {
  id: string;
  quantification_line_id: string;
  week_number: number;
  active: boolean;
}

export interface Milestone {
  id: string;
  project_id: string;
  name: string;
  date: string;
  color: string;
  articulo_id: string | null;
}

export interface Dependency {
  id: string;
  project_id: string;
  predecessor_line_id: string;
  successor_line_id: string;
  type: DependencyType;
}

export interface ProcurementPackage {
  id: string;
  project_id: string;
  name: string;
  purchase_type: PurchaseType;
  advance_days: number;
  status: PackageStatus;
  suggested_supplier: string | null;
  awarded_supplier: string | null;
  created_at: string;
}

export interface ProcurementLine {
  id: string;
  package_id: string;
  insumo_id: string;
  composition_id: string | null;
  quantity: number;
  need_date: string | null;
  subcategory_origin: string | null;
  insumo?: Insumo;
}
