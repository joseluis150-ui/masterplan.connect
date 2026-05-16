import * as XLSX from "xlsx";
import { DEFAULT_INSUMO_TYPES } from "@/lib/constants/units";

// --- INSUMOS ---

export interface InsumoRow {
  familia?: string;
  tipo: string;
  descripcion: string;
  unidad: string;
  pu_local?: number;
  tc_usado?: number;
  comentario?: string;
  referencia?: string;
}

export interface InsumoImportResult {
  valid: InsumoRow[];
  errors: { row: number; message: string }[];
}

const INSUMO_TEMPLATE_HEADERS = [
  "Familia",
  "Tipo",
  "Descripcion",
  "Unidad",
  "PU Local",
  "TC Usado",
  "Comentario",
  "Referencia",
];

const VALID_TYPES = DEFAULT_INSUMO_TYPES.map((t) => t.value);
const TYPE_ALIASES: Record<string, string> = {
  material: "material",
  materiales: "material",
  mat: "material",
  "mano de obra": "mano_de_obra",
  "mano obra": "mano_de_obra",
  mo: "mano_de_obra",
  mano_de_obra: "mano_de_obra",
  servicio: "servicio",
  servicios: "servicio",
  serv: "servicio",
  global: "global",
  globales: "global",
  glo: "global",
};

export function generateInsumoTemplate(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const wsData = [
    INSUMO_TEMPLATE_HEADERS,
    ["Aglomerantes", "Material", "Cemento Portland Tipo I", "Kg", 73500, 7350, "", "Ferretería Central"],
    ["Aglomerantes", "Material", "Cal hidratada", "Kg", 22050, 7350, "", ""],
    ["Acero", "Material", "Hierro corrugado 12mm", "Kg", 11025, 7350, "", "Acepar"],
    ["", "Mano de obra", "Oficial albañil", "Día", 220500, 7350, "", ""],
    ["", "Mano de obra", "Ayudante", "Día", 147000, 7350, "", ""],
    ["", "Servicio", "Diseño estructural", "Global", 7350000, 7350, "", "Ing. López"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Set column widths
  ws["!cols"] = [
    { wch: 15 }, // Familia
    { wch: 15 }, // Tipo
    { wch: 35 }, // Descripcion
    { wch: 10 }, // Unidad
    { wch: 15 }, // PU Local
    { wch: 12 }, // TC Usado
    { wch: 20 }, // Comentario
    { wch: 20 }, // Referencia
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Insumos");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

export function parseInsumoExcel(data: ArrayBuffer): InsumoImportResult {
  const wb = XLSX.read(data, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  const valid: InsumoRow[] = [];
  const errors: { row: number; message: string }[] = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // 1-indexed + header

    // Normalize keys to lowercase
    const normalized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      normalized[key.toLowerCase().trim()] = val;
    }

    const descripcion = String(normalized["descripcion"] || normalized["descripción"] || "").trim();
    const unidad = String(normalized["unidad"] || "").trim();
    const tipoRaw = String(normalized["tipo"] || "").trim().toLowerCase();
    const tipo = TYPE_ALIASES[tipoRaw];

    if (!descripcion) {
      errors.push({ row: rowNum, message: "Descripción es requerida" });
      return;
    }
    if (!unidad) {
      errors.push({ row: rowNum, message: "Unidad es requerida" });
      return;
    }
    if (!tipo) {
      errors.push({ row: rowNum, message: `Tipo "${tipoRaw}" no válido. Use: Material, Mano de obra, Servicio, Global` });
      return;
    }

    const puLocal = normalized["pu local"] || normalized["pu_local"];
    const tcUsado = normalized["tc usado"] || normalized["tc_usado"];

    const puLocalNum = puLocal !== "" && puLocal != null ? Number(puLocal) : undefined;
    const tcUsadoNum = tcUsado !== "" && tcUsado != null ? Number(tcUsado) : undefined;

    if (puLocalNum != null && isNaN(puLocalNum)) {
      errors.push({ row: rowNum, message: "PU Local debe ser numérico" });
      return;
    }
    if (puLocalNum != null && (tcUsadoNum == null || isNaN(tcUsadoNum) || tcUsadoNum <= 0)) {
      errors.push({ row: rowNum, message: "TC Usado es requerido cuando hay PU Local" });
      return;
    }

    valid.push({
      familia: String(normalized["familia"] || "").trim() || undefined,
      tipo,
      descripcion,
      unidad,
      pu_local: puLocalNum,
      tc_usado: tcUsadoNum,
      comentario: String(normalized["comentario"] || "").trim() || undefined,
      referencia: String(normalized["referencia"] || "").trim() || undefined,
    });
  });

  return { valid, errors };
}

// --- EDT ---

export interface EdtRow {
  categoria: string;
  subcategoria: string;
}

export interface EdtImportResult {
  valid: EdtRow[];
  errors: { row: number; message: string }[];
}

export function generateEdtTemplate(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const wsData = [
    ["Categoria", "Subcategoria"],
    ["Obra Gris", "Fundaciones"],
    ["Obra Gris", "Estructura"],
    ["Obra Gris", "Mampostería"],
    ["Instalaciones", "Electricidad"],
    ["Instalaciones", "Plomería"],
    ["Acabados", "Pisos"],
    ["Acabados", "Pintura"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws["!cols"] = [{ wch: 30 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws, "EDT");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

export function parseEdtExcel(data: ArrayBuffer): EdtImportResult {
  const wb = XLSX.read(data, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  const valid: EdtRow[] = [];
  const errors: { row: number; message: string }[] = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const normalized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      normalized[key.toLowerCase().trim()] = val;
    }

    const categoria = String(normalized["categoria"] || normalized["categoría"] || "").trim();
    const subcategoria = String(normalized["subcategoria"] || normalized["subcategoría"] || "").trim();

    if (!categoria) {
      errors.push({ row: rowNum, message: "Categoría es requerida" });
      return;
    }
    if (!subcategoria) {
      errors.push({ row: rowNum, message: "Subcategoría es requerida" });
      return;
    }

    valid.push({ categoria, subcategoria });
  });

  return { valid, errors };
}

// --- ARTICULOS (APU) ---

export interface ArticuloCompRow {
  art_number: number;
  art_description: string;
  art_unit: string;
  insumo_ext_id: number;
  insumo_description: string;
  insumo_type: string;
  insumo_family: string;
  insumo_unit: string;
  quantity: number;
  waste_pct: number;
  margin_pct: number;
  pu_usd: number;
  tc: number;
}

export interface ParsedArticulo {
  number: number;
  description: string;
  unit: string;
  compositions: {
    insumo_ext_id: number;
    insumo_description: string;
    insumo_type: string;
    insumo_family: string;
    insumo_unit: string;
    quantity: number;
    waste_pct: number;
    margin_pct: number;
    pu_usd: number;
    tc: number;
  }[];
}

export interface ArticuloImportResult {
  articulos: ParsedArticulo[];
  insumos: Map<number, { description: string; type: string; family: string; unit: string; pu_usd: number; tc: number }>;
  errors: { row: number; message: string }[];
}

const ARTICULO_TYPE_ALIASES: Record<string, string> = {
  material: "material",
  materiales: "material",
  mat: "material",
  "mano de obra": "mano_de_obra",
  "mano obra": "mano_de_obra",
  mano_de_obra: "mano_de_obra",
  mo: "mano_de_obra",
  servicio: "servicio",
  servicios: "servicio",
  serv: "servicio",
  global: "global",
  globales: "global",
  glo: "global",
};

export function parseArticuloExcel(data: ArrayBuffer, sheetIndex: number = 1): ArticuloImportResult {
  const wb = XLSX.read(data, { type: "array" });
  const sheetName = wb.SheetNames[sheetIndex] || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  const errors: { row: number; message: string }[] = [];
  const artMap = new Map<number, ParsedArticulo>();
  const insumoMap = new Map<number, { description: string; type: string; family: string; unit: string; pu_usd: number; tc: number }>();

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const normalized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      normalized[key.toLowerCase().trim()] = val;
    }

    const artNum = Number(normalized["no.art"] || normalized["no. art"] || normalized["noart"] || normalized["no art"] || 0);
    const artDesc = String(normalized["artículo"] || normalized["articulo"] || "").trim();
    const artUnit = String(normalized["unidad artículo"] || normalized["unidad articulo"] || "").trim();

    const insumoExtId = Number(normalized["insumo id"] || normalized["insumoid"] || normalized["insumo_id"] || 0);
    const insumoDesc = String(normalized["insumo"] || "").trim();
    const insumoTypeRaw = String(normalized["tipo"] || "").trim().toLowerCase();
    const insumoType = ARTICULO_TYPE_ALIASES[insumoTypeRaw] || insumoTypeRaw;
    const insumoFamily = String(normalized["familia"] || "").trim();
    const insumoUnit = String(normalized["unidad insumo"] || normalized["unidad_insumo"] || "").trim();
    const quantity = Number(normalized["cantidad"] || 0);
    const wastePct = Number(normalized["% desperdicio"] || normalized["%desperdicio"] || normalized["desperdicio"] || 0);
    const marginPct = Number(normalized["margen %"] || normalized["margen%"] || normalized["margen"] || 0);
    const puUsd = Number(normalized["precio unitario (usd)"] || normalized["precio unitario"] || normalized["pu usd"] || normalized["pu_usd"] || 0);
    const tc = Number(normalized["tipo cambio"] || normalized["tipo_cambio"] || normalized["tc"] || 0);

    if (!artNum) {
      errors.push({ row: rowNum, message: "No.ART es requerido" });
      return;
    }
    if (!insumoDesc) {
      errors.push({ row: rowNum, message: "Insumo es requerido" });
      return;
    }
    if (!insumoType || !ARTICULO_TYPE_ALIASES[insumoTypeRaw]) {
      errors.push({ row: rowNum, message: `Tipo "${insumoTypeRaw}" no válido` });
      return;
    }

    // Register articulo
    if (!artMap.has(artNum)) {
      artMap.set(artNum, {
        number: artNum,
        description: artDesc,
        unit: artUnit,
        compositions: [],
      });
    }
    const art = artMap.get(artNum)!;
    if (artDesc && !art.description) art.description = artDesc;
    if (artUnit && !art.unit) art.unit = artUnit;

    art.compositions.push({
      insumo_ext_id: insumoExtId,
      insumo_description: insumoDesc,
      insumo_type: insumoType,
      insumo_family: insumoFamily,
      insumo_unit: insumoUnit,
      quantity,
      waste_pct: wastePct,
      margin_pct: marginPct,
      pu_usd: puUsd,
      tc,
    });

    // Register unique insumo
    if (insumoExtId && !insumoMap.has(insumoExtId)) {
      insumoMap.set(insumoExtId, {
        description: insumoDesc,
        type: insumoType,
        family: insumoFamily,
        unit: insumoUnit,
        pu_usd: puUsd,
        tc,
      });
    }
  });

  return {
    articulos: Array.from(artMap.values()),
    insumos: insumoMap,
    errors,
  };
}

// --- CUANTIFICACIÓN ---

export interface CuantificacionRow {
  art_number: number | null;
  descripcion: string;
  unidad: string;
  cantidad: number | null;
  cantidad_formula: string;
  cat_code: string;
  cat_name: string;
  sub_code: string;
  sub_name: string;
  sector_name: string;
  comentario: string;
}

export interface CuantificacionImportResult {
  valid: CuantificacionRow[];
  errors: { row: number; message: string }[];
  categoriesNeeded: Map<string, { code: string; name: string; subs: Map<string, { code: string; name: string }> }>;
  sectorsNeeded: Set<string>;
}

export function generateCuantificacionTemplate(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const wsData = [
    ["No.Art", "Descripción", "Unidad", "Cantidad", "Código Categoría", "Categoría", "Código Sub Categoría", "Sub Categoría", "Sector", "Comentario"],
    [33, "Zapata - Hormigón FCK200 (In Situ)", "m³", 5, "1", "Obra Gris", "1.1", "Fundaciones", "Casa", ""],
    [34, "Zapata - Hormigón FCK200 (Elaborado)", "m³", 3.5, "1", "Obra Gris", "1.1", "Fundaciones", "Casa", ""],
    [35, "Vigas de cimentación", "m³", 2.8, "1", "Obra Gris", "1.2", "Estructura", "Casa", ""],
    [45, "Contrapiso de Hormigón h:8cm", "m²", 82.89, "1", "Obra Gris", "1.3", "Contrapisos", "Casa", ""],
    [71, "Enduido y pintura interior", "m²", 317.68, "2", "Acabados", "2.1", "Pintura", "Casa", ""],
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws["!cols"] = [
    { wch: 8 },   // No.Art
    { wch: 45 },  // Descripción
    { wch: 10 },  // Unidad
    { wch: 12 },  // Cantidad
    { wch: 15 },  // Código Categoría
    { wch: 20 },  // Categoría
    { wch: 18 },  // Código Sub Categoría
    { wch: 20 },  // Sub Categoría
    { wch: 15 },  // Sector
    { wch: 20 },  // Comentario
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Cuantificación");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

export function parseCuantificacionExcel(data: ArrayBuffer): CuantificacionImportResult {
  const wb = XLSX.read(data, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  const valid: CuantificacionRow[] = [];
  const errors: { row: number; message: string }[] = [];
  const categoriesNeeded = new Map<string, { code: string; name: string; subs: Map<string, { code: string; name: string }> }>();
  const sectorsNeeded = new Set<string>();

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const n: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      n[key.toLowerCase().trim()] = val;
    }

    const artNum = Number(n["no.art"] || n["no. art"] || n["noart"] || n["no art"] || 0) || null;
    const descripcion = String(n["descripción"] || n["descripcion"] || "").trim();
    const unidad = String(n["unidad"] || "").trim();
    const cantidadRaw = String(n["cantidad"] || "").trim();
    const catCode = String(n["código categoría"] || n["codigo categoria"] || n["código categoria"] || n["codigo categoría"] || "").trim();
    const catName = String(n["categoría"] || n["categoria"] || "").trim();
    const subCode = String(n["código sub categoría"] || n["codigo sub categoria"] || n["código subcategoría"] || n["codigo subcategoria"] || n["código sub categoria"] || n["codigo sub categoría"] || "").trim();
    const subName = String(n["sub categoría"] || n["sub categoria"] || n["subcategoría"] || n["subcategoria"] || "").trim();
    const sectorName = String(n["sector"] || "").trim();
    const comentario = String(n["comentario"] || "").trim();

    if (!catName) { errors.push({ row: rowNum, message: "Categoría es requerida" }); return; }
    if (!subName) { errors.push({ row: rowNum, message: "Subcategoría es requerida" }); return; }
    if (!sectorName) { errors.push({ row: rowNum, message: "Sector es requerido" }); return; }

    // Track categories/subs/sectors needed
    const catKey = catCode || catName;
    if (!categoriesNeeded.has(catKey)) {
      categoriesNeeded.set(catKey, { code: catCode, name: catName, subs: new Map() });
    }
    const subKey = subCode || subName;
    categoriesNeeded.get(catKey)!.subs.set(subKey, { code: subCode, name: subName });
    sectorsNeeded.add(sectorName);

    valid.push({
      art_number: artNum,
      descripcion,
      unidad,
      cantidad: cantidadRaw ? Number(cantidadRaw) || null : null,
      cantidad_formula: cantidadRaw,
      cat_code: catCode,
      cat_name: catName,
      sub_code: subCode,
      sub_name: subName,
      sector_name: sectorName,
      comentario,
    });
  });

  return { valid, errors, categoriesNeeded, sectorsNeeded };
}

export function downloadBlob(data: ArrayBuffer, filename: string) {
  const blob = new Blob([data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── EXPORT CUANTIFICACIÓN ──────────────────────────────────────────

/** Fila enriquecida que el exportador espera. La página de cuantificación
 *  ya tiene esta info hidratada en memoria, así que sólo hace falta
 *  mapearla. */
export interface CuantificacionExportRow {
  line_number: number;
  group_name: string | null;        // Grupo de sector (puede ser null)
  sector_name: string;
  category_code: string;
  category_name: string;
  subcategory_code: string;
  subcategory_name: string;
  articulo_number: number | null;   // null si no tiene articulo asignado
  articulo_description: string;     // vacío si no tiene
  articulo_unit: string;
  quantity: number | null;
  quantity_formula: string | null;
  pu_usd: number;                   // PU planificado del articulo
  total_usd: number;                // quantity × pu_usd (0 si cualquier falta)
  comment: string | null;
  flag_colors: string[];            // ej. ["amber", "red"]
  needs_review: boolean;
  created_at: string;               // ISO
}

/**
 * Genera un XLSX con todas las líneas de cuantificación + columnas
 * calculadas (PU, total). Compatible para reimportar (las primeras 10
 * columnas matchean el template), pero agrega columnas extra a la
 * derecha con info derivada útil para análisis.
 */
export function exportCuantificacionToExcel(rows: CuantificacionExportRow[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const header = [
    "No.Art", "Descripción", "Unidad", "Cantidad", "Fórmula",
    "Código Categoría", "Categoría", "Código Sub Categoría", "Sub Categoría",
    "Grupo Sector", "Sector",
    "PU USD", "Total USD",
    "Comentario", "Banderas", "Necesita revisión", "Creado",
  ];
  const data: (string | number | null)[][] = [header];
  for (const r of rows) {
    data.push([
      r.articulo_number,
      r.articulo_description || "",
      r.articulo_unit || "",
      r.quantity,
      r.quantity_formula || "",
      r.category_code,
      r.category_name,
      r.subcategory_code,
      r.subcategory_name,
      r.group_name ?? "",
      r.sector_name,
      r.pu_usd || 0,
      r.total_usd || 0,
      r.comment || "",
      r.flag_colors.join(", "),
      r.needs_review ? "Sí" : "",
      r.created_at ? r.created_at.slice(0, 10) : "",
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [
    { wch: 8 },   // No.Art
    { wch: 45 },  // Descripción
    { wch: 10 },  // Unidad
    { wch: 12 },  // Cantidad
    { wch: 18 },  // Fórmula
    { wch: 15 },  // Código Categoría
    { wch: 20 },  // Categoría
    { wch: 18 },  // Código Sub Categoría
    { wch: 22 },  // Sub Categoría
    { wch: 18 },  // Grupo Sector
    { wch: 18 },  // Sector
    { wch: 12 },  // PU USD
    { wch: 14 },  // Total USD
    { wch: 30 },  // Comentario
    { wch: 16 },  // Banderas
    { wch: 14 },  // Necesita revisión
    { wch: 12 },  // Creado
  ];
  // Freeze the header row
  ws["!freeze"] = { xSplit: 0, ySplit: 1 } as never;
  XLSX.utils.book_append_sheet(wb, ws, "Cuantificación");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}
