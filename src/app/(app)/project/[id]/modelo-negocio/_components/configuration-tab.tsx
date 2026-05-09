"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { updateBusinessModel } from "../_lib/api";
import { formatHorizonLabel } from "../_lib/formatters";
import type { BusinessModel } from "../_lib/types";

/**
 * Tab Configuración. Form con autoguardado (debounce 800ms) tras cambio
 * del usuario, y botón "Guardar" explícito que fuerza inmediato. Toast de
 * confirmación.
 */
export function ConfigurationTab({
  model, onUpdate, canEdit,
}: {
  model: BusinessModel;
  onUpdate: () => Promise<void>;
  canEdit: boolean;
}) {
  const supabase = createClient();
  const [draft, setDraft] = useState<BusinessModel>(model);
  const [saving, setSaving] = useState(false);
  const lastSavedRef = useRef<string>(JSON.stringify(model));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sincronizar cuando el modelo del padre cambia (ej. tras crearlo)
  useEffect(() => { setDraft(model); lastSavedRef.current = JSON.stringify(model); }, [model.id]);

  function patch<K extends keyof BusinessModel>(key: K, value: BusinessModel[K]) {
    if (!canEdit) return;
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(next), 800);
  }

  async function save(next: BusinessModel) {
    if (!canEdit) return;
    const snap = JSON.stringify(next);
    if (snap === lastSavedRef.current) return;
    setSaving(true);
    try {
      await updateBusinessModel(supabase, next.id, {
        name: next.name,
        description: next.description,
        granularity: next.granularity,
        startDate: next.startDate,
        horizonPeriods: next.horizonPeriods,
        reportingCurrency: next.reportingCurrency,
        baseExchangeRate: next.baseExchangeRate,
        annualDevaluation: next.annualDevaluation,
        discountRate: next.discountRate,
        status: next.status,
      });
      lastSavedRef.current = snap;
      await onUpdate();
    } catch (e) {
      toast.error(`Error al guardar: ${(e as Error).message}`);
    }
    setSaving(false);
  }

  return (
    <div className="p-4 max-w-3xl space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Configuración del modelo</CardTitle>
              <CardDescription>Parámetros globales — afectan todos los escenarios</CardDescription>
            </div>
            {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Nombre del modelo</Label>
              <Input
                value={draft.name}
                onChange={(e) => patch("name", e.target.value)}
                disabled={!canEdit}
                placeholder="Ej. Plan financiero v1"
              />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Descripción (opcional)</Label>
              <Textarea
                value={draft.description ?? ""}
                onChange={(e) => patch("description", e.target.value || null)}
                disabled={!canEdit}
                rows={2}
                placeholder="Notas, supuestos generales..."
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Granularidad *</Label>
              <Select
                value={draft.granularity}
                onValueChange={(v) => v && patch("granularity", v as BusinessModel["granularity"])}
              >
                <SelectTrigger disabled={!canEdit}>
                  <span>{draft.granularity === "monthly" ? "Mensual" : "Trimestral"}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Mensual</SelectItem>
                  <SelectItem value="quarterly">Trimestral</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fecha de inicio *</Label>
              <Input
                type="date"
                value={draft.startDate}
                onChange={(e) => patch("startDate", e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Horizonte (períodos) *</Label>
              <Input
                type="number"
                min={1}
                max={120}
                value={draft.horizonPeriods}
                onChange={(e) => patch("horizonPeriods", Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
                disabled={!canEdit}
              />
              <p className="text-[10px] text-muted-foreground">
                {formatHorizonLabel(draft.horizonPeriods, draft.granularity)}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Moneda de reporte *</Label>
              <Select
                value={draft.reportingCurrency}
                onValueChange={(v) => v && patch("reportingCurrency", v as BusinessModel["reportingCurrency"])}
              >
                <SelectTrigger disabled={!canEdit}>
                  <span>{draft.reportingCurrency}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD (Dólar)</SelectItem>
                  <SelectItem value="PYG">PYG (Guaraní)</SelectItem>
                  <SelectItem value="GTQ">GTQ (Quetzal)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">TC base (local/USD)</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={draft.baseExchangeRate ?? ""}
                onChange={(e) => patch("baseExchangeRate", e.target.value === "" ? null : Number(e.target.value))}
                disabled={!canEdit}
                placeholder="Ej. 7400"
              />
              <p className="text-[10px] text-muted-foreground">
                Unidades de moneda local por 1 USD (período 0)
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Devaluación anual (%)</Label>
              <Input
                type="number"
                step="0.01"
                value={draft.annualDevaluation * 100}
                onChange={(e) => patch("annualDevaluation", (Number(e.target.value) || 0) / 100)}
                disabled={!canEdit}
              />
              <p className="text-[10px] text-muted-foreground">
                Aplicada de forma compuesta período a período
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tasa de descuento para VAN (%)</Label>
              <Input
                type="number"
                step="0.01"
                value={draft.discountRate * 100}
                onChange={(e) => patch("discountRate", (Number(e.target.value) || 0) / 100)}
                disabled={!canEdit}
              />
              <p className="text-[10px] text-muted-foreground">Tasa anual</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Estado</Label>
              <Select
                value={draft.status}
                onValueChange={(v) => v && patch("status", v as BusinessModel["status"])}
              >
                <SelectTrigger disabled={!canEdit}>
                  <span>{draft.status === "draft" ? "Borrador" : draft.status === "active" ? "Activo" : "Archivado"}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Borrador</SelectItem>
                  <SelectItem value="active">Activo</SelectItem>
                  <SelectItem value="archived">Archivado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {canEdit && (
            <div className="flex justify-end pt-2">
              <Button
                size="sm"
                onClick={() => save(draft)}
                disabled={saving || JSON.stringify(draft) === lastSavedRef.current}
              >
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Guardar ahora
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
