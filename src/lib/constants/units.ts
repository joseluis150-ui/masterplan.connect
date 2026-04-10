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
  { value: "listo", label: "Listo para compra" },
  { value: "en_proceso", label: "En proceso" },
  { value: "adjudicado", label: "Adjudicado" },
  { value: "cerrado", label: "Cerrado" },
] as const;
