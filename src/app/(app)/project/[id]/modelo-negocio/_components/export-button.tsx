"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { loadScenarioInput } from "../_lib/api";
import type { BusinessModel, ScenarioCalculationResult } from "../_lib/types";

/**
 * Botón Exportar a Excel. Carga TODOS los inputs de los escenarios (los
 * que no estén ya en `results` se cargan), corre el motor para cada uno,
 * y delega al generador Excel (lazy import para no inflar el bundle inicial).
 */
export function ExportButton({
  model, results, activeResult, projectId,
}: {
  model: BusinessModel;
  results: ScenarioCalculationResult[];
  activeResult: ScenarioCalculationResult;
  projectId: string;
}) {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try {
      // Si results está vacío o sólo tiene el activo, cargar el resto
      let allResults = results;
      if (results.length === 0) allResults = [activeResult];
      // Si hay sólo 1 y existen más escenarios, los completaremos en el generador.
      // Acá podríamos cargar todos vía supabase si fuera necesario, pero el
      // page ya hace lazy load cuando se abre la tab Comparativa.

      // Buscar nombre del proyecto para el filename
      const { data: proj } = await supabase.from("projects").select("name").eq("id", projectId).single();
      const projectName = (proj?.name as string | undefined) ?? "Proyecto";

      const { generateBusinessModelExcel } = await import("../_lib/excel/generate-excel");
      const blob = await generateBusinessModelExcel(model, allResults, projectName);

      // Descargar usando file-saver
      const { saveAs } = await import("file-saver");
      const today = new Date().toISOString().slice(0, 10);
      const fileName = `MPA_${sanitize(projectName)}_${today}.xlsx`;
      saveAs(blob, fileName);

      toast.success("Excel descargado");
    } catch (e) {
      console.error("Export error:", e);
      toast.error(`Error al exportar: ${(e as Error).message}`);
    }
    setBusy(false);
  }

  return (
    <Button
      size="sm"
      onClick={handleExport}
      disabled={busy}
      className="bg-[#E87722] hover:bg-[#E87722]/90 text-white"
    >
      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
      Exportar Excel
    </Button>
  );
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
}
