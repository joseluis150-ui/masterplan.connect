"use client";

import { useEffect, useState, use } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CURRENCIES } from "@/lib/constants/units";
import type { Project, Sector, SectorType, ExchangeRateVersion } from "@/lib/types/database";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { toast } from "sonner";

export default function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [tcVersions, setTcVersions] = useState<ExchangeRateVersion[]>([]);
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, [projectId]);

  async function loadData() {
    const [projectRes, sectorsRes, tcRes] = await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).single(),
      supabase.from("sectors").select("*").eq("project_id", projectId).order("order"),
      supabase.from("exchange_rate_versions").select("*").eq("project_id", projectId).order("version", { ascending: false }),
    ]);
    if (projectRes.data) setProject(projectRes.data);
    setSectors(sectorsRes.data || []);
    setTcVersions(tcRes.data || []);
  }

  async function updateProject(updates: Record<string, unknown>) {
    if (!project) return;
    setSaving(true);
    const { error } = await supabase
      .from("projects")
      .update(updates)
      .eq("id", projectId);

    if (!error) {
      setProject({ ...project, ...updates });
      toast.success("Proyecto actualizado");
    } else {
      toast.error("Error al actualizar");
    }
    setSaving(false);
  }

  async function addSector() {
    const newOrder = sectors.length;
    const { data, error } = await supabase
      .from("sectors")
      .insert({
        project_id: projectId,
        name: `Sector ${newOrder + 1}`,
        type: "fisico" as SectorType,
        order: newOrder,
      })
      .select()
      .single();

    if (!error && data) {
      setSectors([...sectors, data]);
      toast.success("Sector agregado");
    }
  }

  async function updateSector(sectorId: string, updates: Partial<Sector>) {
    const { error } = await supabase
      .from("sectors")
      .update(updates)
      .eq("id", sectorId);

    if (!error) {
      setSectors(sectors.map((s) => (s.id === sectorId ? { ...s, ...updates } : s)));
    }
  }

  async function deleteSector(sectorId: string) {
    const { error } = await supabase.from("sectors").delete().eq("id", sectorId);
    if (!error) {
      setSectors(sectors.filter((s) => s.id !== sectorId));
      toast.success("Sector eliminado");
    }
  }

  async function addTcVersion() {
    if (!project) return;
    const newVersion = (tcVersions[0]?.version || 0) + 1;
    const { data, error } = await supabase
      .from("exchange_rate_versions")
      .insert({
        project_id: projectId,
        version: newVersion,
        rate: project.exchange_rate,
      })
      .select()
      .single();

    if (!error && data) {
      setTcVersions([data, ...tcVersions]);
      toast.success(`Versión TC ${newVersion} creada`);
    }
  }

  if (!project) return <div className="animate-pulse h-96 bg-muted rounded-lg" />;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configuración del Proyecto</h1>
        <p className="text-muted-foreground">Paso 1: Define los datos generales</p>
      </div>

      {/* Datos generales */}
      <Card>
        <CardHeader>
          <CardTitle>Datos generales</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nombre del proyecto</Label>
              <Input
                value={project.name}
                onChange={(e) => setProject({ ...project, name: e.target.value })}
                onBlur={() => updateProject({ name: project.name })}
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo de proyecto</Label>
              <Select
                value={project.project_type}
                onValueChange={(v) => v && updateProject({ project_type: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="costo">Costo interno</SelectItem>
                  <SelectItem value="venta">Venta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Cliente</Label>
              <Input
                value={project.client || ""}
                onChange={(e) => setProject({ ...project, client: e.target.value })}
                onBlur={() => updateProject({ client: project.client })}
                placeholder="Nombre del cliente"
              />
            </div>
            <div className="space-y-2">
              <Label>Ubicación</Label>
              <Input
                value={project.location || ""}
                onChange={(e) => setProject({ ...project, location: e.target.value })}
                onBlur={() => updateProject({ location: project.location })}
                placeholder="Dirección o zona"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Fecha inicio estimada</Label>
              <Input
                type="date"
                value={project.estimated_start || ""}
                onChange={(e) => updateProject({ estimated_start: e.target.value || null })}
              />
            </div>
            <div className="space-y-2">
              <Label>Responsable</Label>
              <Input
                value={project.responsible || ""}
                onChange={(e) => setProject({ ...project, responsible: e.target.value })}
                onBlur={() => updateProject({ responsible: project.responsible })}
                placeholder="Nombre del responsable"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Moneda y tipo de cambio */}
      <Card>
        <CardHeader>
          <CardTitle>Moneda y Tipo de Cambio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Moneda local</Label>
              <Select
                value={project.local_currency}
                onValueChange={(v) => v && updateProject({ local_currency: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} ({c.symbol}) - {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo de cambio (1 USD =)</Label>
              <Input
                type="number"
                step="any"
                value={project.exchange_rate}
                onChange={(e) => setProject({ ...project, exchange_rate: Number(e.target.value) })}
                onBlur={() => updateProject({ exchange_rate: project.exchange_rate })}
              />
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={addTcVersion}>
                Guardar versión TC
              </Button>
            </div>
          </div>

          {tcVersions.length > 0 && (
            <>
              <Separator />
              <div>
                <Label className="mb-2 block">Historial de tipo de cambio</Label>
                <div className="space-y-1">
                  {tcVersions.map((v) => (
                    <div key={v.id} className="flex items-center gap-3 text-sm">
                      <Badge variant="outline">v{v.version}</Badge>
                      <span>1 USD = {Number(v.rate).toLocaleString()} {project.local_currency}</span>
                      <span className="text-muted-foreground">
                        {new Date(v.created_at).toLocaleDateString("es")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Sectores */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Sectores del Proyecto</CardTitle>
              <CardDescription>Divide el proyecto en sectores físicos y gastos generales</CardDescription>
            </div>
            <Button size="sm" onClick={addSector}>
              <Plus className="h-4 w-4 mr-1" />
              Agregar Sector
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {sectors.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Sin sectores. Agrega al menos un sector para continuar.
            </p>
          ) : (
            <div className="space-y-3">
              {sectors.map((sector) => (
                <div key={sector.id} className="flex items-center gap-3 p-3 border rounded-lg">
                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                  <Input
                    value={sector.name}
                    onChange={(e) => setSectors(sectors.map((s) => s.id === sector.id ? { ...s, name: e.target.value } : s))}
                    onBlur={() => updateSector(sector.id, { name: sector.name })}
                    className="flex-1"
                  />
                  <Select
                    value={sector.type}
                    onValueChange={(v) => v && updateSector(sector.id, { type: v as SectorType })}
                  >
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fisico">Sector físico</SelectItem>
                      <SelectItem value="gastos_generales">Gastos generales</SelectItem>
                    </SelectContent>
                  </Select>
                  {sector.type === "fisico" && (
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        step="any"
                        placeholder="Área m²"
                        value={sector.area_m2 || ""}
                        onChange={(e) => setSectors(sectors.map((s) => s.id === sector.id ? { ...s, area_m2: Number(e.target.value) } : s))}
                        onBlur={() => updateSector(sector.id, { area_m2: sector.area_m2 })}
                        className="w-28"
                      />
                      <span className="text-sm text-muted-foreground">m²</span>
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteSector(sector.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {sectors.some((s) => s.type === "gastos_generales") && (
            <>
              <Separator className="my-4" />
              <div className="space-y-2">
                <Label>Criterio de prorrateo de Gastos Generales</Label>
                <Select
                  value={project.proration_criteria}
                  onValueChange={(v) => v && updateProject({ proration_criteria: v })}
                >
                  <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="area">Por área (m²)</SelectItem>
                    <SelectItem value="monto">Por monto presupuestado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
