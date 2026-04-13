export const DEFAULT_UNITS = [
  "Kg",
  "M",
  "M²",
  "M³",
  "U",
  "Bolsa",
  "Día",
  "Hora",
  "GL",
  "L",
  "Ton",
  "Viaje",
  "Sem",
  "Global",
  "Libras",
  "Quintales",
  "Kit",
] as const;

export const DEFAULT_INSUMO_TYPES = [
  { value: "material", label: "Material" },
  { value: "mano_de_obra", label: "Mano de obra" },
  { value: "servicio", label: "Servicio" },
  { value: "global", label: "Global" },
] as const;

export const CURRENCIES = [
  { code: "USD", name: "Dólar estadounidense", symbol: "$" },
  { code: "PYG", name: "Guaraní paraguayo", symbol: "₲" },
  { code: "GTQ", name: "Quetzal guatemalteco", symbol: "Q" },
  { code: "MXN", name: "Peso mexicano", symbol: "$" },
  { code: "COP", name: "Peso colombiano", symbol: "$" },
  { code: "PEN", name: "Sol peruano", symbol: "S/" },
  { code: "CLP", name: "Peso chileno", symbol: "$" },
  { code: "ARS", name: "Peso argentino", symbol: "$" },
  { code: "BRL", name: "Real brasileño", symbol: "R$" },
  { code: "BOB", name: "Boliviano", symbol: "Bs" },
  { code: "UYU", name: "Peso uruguayo", symbol: "$U" },
  { code: "HNL", name: "Lempira hondureño", symbol: "L" },
  { code: "NIO", name: "Córdoba nicaragüense", symbol: "C$" },
  { code: "CRC", name: "Colón costarricense", symbol: "₡" },
  { code: "PAB", name: "Balboa panameño", symbol: "B/." },
  { code: "DOP", name: "Peso dominicano", symbol: "RD$" },
  { code: "EUR", name: "Euro", symbol: "€" },
] as const;

export const PACKAGE_STATUSES = [
  { value: "borrador", label: "Borrador" },
  { value: "aprobado", label: "Aprobado" },
] as const;

// Módulo Compras
export const SC_STATUSES = [
  { value: "pending", label: "Pendiente", color: "#F59E0B" },
  { value: "in_progress", label: "En proceso", color: "#3B82F6" },
  { value: "completed", label: "Completada", color: "#10B981" },
  { value: "cancelled", label: "Cancelada", color: "#EF4444" },
] as const;

export const OC_STATUSES = [
  { value: "open", label: "Abierta", color: "#3B82F6" },
  { value: "closed", label: "Cerrada", color: "#10B981" },
  { value: "cancelled", label: "Cancelada", color: "#EF4444" },
] as const;

export const PAYMENT_TYPES = [
  { value: "advance", label: "Anticipo" },
  { value: "regular", label: "Regular" },
  { value: "retention_return", label: "Devolución retención" },
] as const;

export const INVOICE_STATUSES = [
  { value: "pending", label: "Pendiente", color: "#F59E0B" },
  { value: "paid", label: "Pagada", color: "#10B981" },
  { value: "cancelled", label: "Cancelada", color: "#EF4444" },
] as const;
