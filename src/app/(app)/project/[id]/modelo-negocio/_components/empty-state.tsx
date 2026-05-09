"use client";

import { TrendingUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function EmptyState({ onCreate, creating }: { onCreate: () => void; creating: boolean }) {
  return (
    <div className="p-6">
      <Card>
        <CardContent className="py-16 flex flex-col items-center text-center gap-4">
          <div className="h-14 w-14 rounded-full bg-[#E87722]/10 flex items-center justify-center">
            <TrendingUp className="h-7 w-7 text-[#E87722]" />
          </div>
          <div className="space-y-2 max-w-md">
            <h2 className="text-lg font-semibold">Crear modelo de negocio</h2>
            <p className="text-sm text-muted-foreground">
              Definí la estructura financiera proyectada del proyecto: costos
              de tierra, construcción, otros gastos e ingresos por unidades
              vendibles. Calculamos cashflow, ROI, TIR, VAN y más.
            </p>
          </div>
          <Button
            className="bg-[#E87722] hover:bg-[#E87722]/90 text-white"
            onClick={onCreate}
            disabled={creating}
          >
            {creating
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creando...</>
              : <>Crear modelo de negocio</>}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Se crea un escenario "Base" automáticamente. Podés agregar
            "Optimista" / "Pesimista" después.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
