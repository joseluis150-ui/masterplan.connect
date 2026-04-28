"use client";

import { useEffect, useState, useRef, use } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, GripVertical, ShoppingCart, Upload, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { setNumberLocale } from "@/lib/utils/number-format";
import { cn } from "@/lib/utils";

export default function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [tcVersions, setTcVersions] = useState<ExchangeRateVersion[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();
  const router = useRouter();

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
      // Refresh server components (sidebar) if module toggles changed
      if ("compras_enabled" in updates) router.refresh();
      // Propagate number-format preference to all client components
      if ("number_format" in updates) {
        setNumberLocale((updates.number_format as "es" | "en") || "es");
      }
    } else {
      toast.error("Error al actualizar");
    }
    setSaving(false);
  }

  async function handleClientLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !project) return;

    const allowed = ["image/svg+xml", "image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) {
      toast.error("Formato no soportado. Usá SVG, PNG, JPG o WebP.");
      return;
    }
    const MAX_BYTES = 500 * 1024; // 500 KB en disco — el data URI base64 pesa ~33 % más
    if (file.size > MAX_BYTES) {
      toast.error(`El archivo supera ${Math.round(MAX_BYTES / 1024)} KB. Usá una versión más liviana.`);
      return;
    }

    setUploadingLogo(true);
    try {
      const dataUri: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await updateProject({ client_logo_data: dataUri });
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleClientLogoRemove() {
    if (!project) return;
    if (!confirm("¿Quitar el logo del cliente del proyecto?")) return;
    await updateProject({ client_logo_data: null });
  }

  async function addSector() {
    const newOrder = sectors.length;
    const { data, error } = await supabase
      .from("sectors")
      .insert({
        project_id: projectId,
        name: `Sector ${newOrder + 1}`,
        type: "fisico" as SectorType,
        is_construction: true,
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

          {/* Logo del cliente */}
          <div className="space-y-2 pt-2 border-t">
            <Label>Logo del cliente <span className="text-xs font-normal text-muted-foreground">(opcional)</span></Label>
            <p className="text-xs text-muted-foreground -mt-1">
              Aparece en el encabezado de los reportes PDF junto al logo de MasterPlan. Si no hay logo cargado, el reporte sale sólo con el logo de MasterPlan.
            </p>
            <input
              ref={logoFileInputRef}
              type="file"
              accept="image/svg+xml,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleClientLogoUpload}
            />
            <div className="flex items-start gap-3 mt-1">
              {project.client_logo_data ? (
                <div className="border rounded-md p-3 bg-muted/30 flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={project.client_logo_data}
                    alt="Logo del cliente"
                    className="h-16 max-w-[180px] object-contain"
                  />
                  <div className="flex flex-col gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => logoFileInputRef.current?.click()}
                      disabled={uploadingLogo}
                    >
                      <Upload className="h-3.5 w-3.5 mr-1.5" />
                      Reemplazar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClientLogoRemove}
                      disabled={uploadingLogo}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Quitar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => logoFileInputRef.current?.click()}
                  disabled={uploadingLogo}
                >
                  {uploadingLogo
                    ? <>Subiendo…</>
                    : <><ImageIcon className="h-4 w-4 mr-2" /> Subir logo del cliente</>}
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              SVG, PNG, JPG o WebP — hasta 500 KB. Se recomienda SVG o PNG con fondo transparente.
            </p>
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

          <Separator />

          <div className="space-y-2">
            <Label>Formato de números</Label>
            <p className="text-[11px] text-muted-foreground">
              Define cómo se muestran los números en todo el proyecto.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => updateProject({ number_format: "es" })}
                className={cn(
                  "flex-1 max-w-xs text-left p-3 rounded-md border transition-colors",
                  project.number_format === "es"
                    ? "bg-primary/10 border-primary"
                    : "bg-background hover:bg-muted"
                )}
              >
                <p className="text-sm font-medium">Punto como separador de miles</p>
                <p className="text-xs font-mono text-muted-foreground mt-1">1.234.567,89</p>
                <p className="text-[10px] text-muted-foreground">Español / Latam</p>
              </button>
              <button
                type="button"
                onClick={() => updateProject({ number_format: "en" })}
                className={cn(
                  "flex-1 max-w-xs text-left p-3 rounded-md border transition-colors",
                  project.number_format === "en"
                    ? "bg-primary/10 border-primary"
                    : "bg-background hover:bg-muted"
                )}
              >
                <p className="text-sm font-medium">Coma como separador de miles</p>
                <p className="text-xs font-mono text-muted-foreground mt-1">1,234,567.89</p>
                <p className="text-[10px] text-muted-foreground">Inglés / USA</p>
              </button>
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

      {/* Módulos */}
      <Card>
        <CardHeader>
          <CardTitle>Módulos</CardTitle>
          <CardDescription>Activa o desactiva módulos adicionales del proyecto</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <ShoppingCart className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Módulo de Compras</p>
                <p className="text-xs text-muted-foreground">
                  Solicitudes de compra, órdenes, albaranes, facturas y pagos
                </p>
              </div>
            </div>
            <Switch
              checked={project.compras_enabled}
              onCheckedChange={(checked) => updateProject({ compras_enabled: checked })}
            />
          </div>
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
                <div key={sector.id} className="p-3 border rounded-lg space-y-2">
                  {/* Fila 1: nombre, tipo, área, eliminar */}
                  <div className="flex items-center gap-3">
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

                  {/* Fila 2: opciones avanzadas — sólo para sectores físicos */}
                  {sector.type === "fisico" && (
                    <div className="flex items-center gap-6 pl-7 text-sm">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={sector.is_construction}
                          onCheckedChange={(v) => updateSector(sector.id, { is_construction: !!v })}
                        />
                        <span>Suma como m² de construcción</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">m² rentables</span>
                        <Input
                          type="number"
                          step="any"
                          placeholder="opcional"
                          value={sector.rentable_m2 ?? ""}
                          onChange={(e) => {
                            const v = e.target.value === "" ? null : Number(e.target.value);
                            setSectors(sectors.map((s) => s.id === sector.id ? { ...s, rentable_m2: v } : s));
                          }}
                          onBlur={() => updateSector(sector.id, { rentable_m2: sector.rentable_m2 })}
                          className="w-28 h-8"
                        />
                      </div>
                    </div>
                  )}
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
