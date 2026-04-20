export type ProjectType = "costo" | "venta";
export type SectorType = "fisico" | "gastos_generales";
export type InsumoType = "material" | "mano_de_obra" | "servicio" | "global";
export type CurrencyInput = "LOCAL" | "USD";
export type PurchaseType = "directa" | "licitacion";
export type PackageStatus = "borrador" | "aprobado";
export type DependencyType = "FS" | "SS" | "FF" | "SF";
export type ProrationCriteria = "area" | "monto";

export type PurchaseRequestStatus = "pending" | "partial" | "completed" | "cancelled";
export type PurchaseRequestOrigin = "package" | "manual";
export type PurchaseOrderStatus = "open" | "closed" | "cancelled";
export type AdvanceType = "amount" | "percentage";
export type AmortizationMode = "percentage" | "per_certification";
export type PaymentType = "advance" | "regular" | "retention_return";
export type PurchaseDocumentType = "sc" | "oc" | "delivery" | "invoice" | "payment";
export type InvoiceStatus = "pending" | "paid" | "cancelled";

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
  compras_enabled: boolean;
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

export type InsumoOrigin = "planning" | "execution";

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
  origin: InsumoOrigin;
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

// ─── Módulo Compras ───

export interface PurchaseRequest {
  id: string;
  project_id: string;
  number: string;
  origin: PurchaseRequestOrigin;
  package_id: string | null;
  date: string;
  status: PurchaseRequestStatus;
  comment: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // enriched
  lines?: PurchaseRequestLine[];
  package_name?: string;
}

export interface PurchaseRequestLine {
  id: string;
  request_id: string;
  subcategory_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  need_date: string | null;
  created_at: string;
}

export type PaymentTermsType = "contado" | "credito" | "contrato" | "contra_entrega";
export type MeasurementFrequency = "semanal" | "quincenal" | "mensual";

export interface PurchaseOrder {
  id: string;
  project_id: string;
  number: string;
  request_id: string | null;
  supplier: string;
  issue_date: string;
  status: PurchaseOrderStatus;
  currency: string;
  has_advance: boolean;
  advance_amount: number;
  advance_type: AdvanceType | null;
  amortization_mode: AmortizationMode;
  amortization_pct: number;
  retention_pct: number;
  return_condition: string | null;
  comment: string | null;
  // Payment terms
  payment_terms_type: PaymentTermsType;
  credit_days: number | null;
  measurement_frequency: MeasurementFrequency | null;
  payment_notes: string | null;
  audit_log: AuditEntry[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // enriched
  lines?: PurchaseOrderLine[];
  request_number?: string;
}

export interface AuditEntry {
  at: string;           // ISO date
  by?: string | null;   // user id (optional)
  changes: { field: string; from: string | number | boolean | null; to: string | number | boolean | null }[];
  note?: string;
}

export interface PurchaseOrderLine {
  id: string;
  order_id: string;
  request_line_id: string | null;
  subcategory_id: string;
  sector_id: string | null;
  insumo_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
  created_at: string;
}

export type ReceptionStatus = "pending_approval" | "received" | "invoiced" | "cancelled";
export type ReceptionType = "regular" | "advance";

export interface ReceptionNote {
  id: string;
  order_id: string;
  number: number;
  date: string;
  status: ReceptionStatus;
  type: ReceptionType;
  comment: string | null;
  created_by: string | null;
  created_at: string;
  // enriched
  lines?: DeliveryNote[];
  total_gross?: number;
}

export interface DeliveryNote {
  id: string;
  reception_id: string | null;
  order_line_id: string | null;
  date: string | null;
  quantity_received: number;
  unit_price: number;
  gross_amount: number;
  amortization_pct: number;
  amortization_amount: number;
  retention_pct: number;
  retention_amount: number;
  payable_amount: number;
  comment: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Invoice {
  id: string;
  project_id: string | null;
  reception_id: string | null;
  delivery_note_id: string | null;
  invoice_number: string;
  invoice_date: string;
  amount: number;
  status: InvoiceStatus;
  comment: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  project_id: string;
  invoice_id: string | null;
  order_id: string | null;
  type: PaymentType;
  payment_date: string;
  amount: number;
  currency: string | null;       // Currency of the payment (can differ from OC)
  exchange_rate: number | null;  // Rate used at payment time (1 USD = N local)
  comment: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PurchaseAttachment {
  id: string;
  project_id: string;
  document_type: PurchaseDocumentType;
  document_id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  url: string;
  uploaded_by: string | null;
  uploaded_at: string;
}
