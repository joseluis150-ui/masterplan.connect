"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CURRENCIES } from "@/lib/constants/units";
import type { Project, ProjectType } from "@/lib/types/database";
import { Plus, Building2, LogOut, Copy, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type DuplicateScope = "planning" | "all";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newProject, setNewProject] = useState({
    name: "",
    project_type: "costo" as ProjectType,
    local_currency: "PYG",
    exchange_rate: "7350",
  });
  // Duplicate dialog state
  const [duplicateSource, setDuplicateSource] = useState<Project | null>(null);
  const [duplicateName, setDuplicateName] = useState("");
  const [duplicateScope, setDuplicateScope] = useState<DuplicateScope>("planning");
  const [duplicating, setDuplicating] = useState(false);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    const { data } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    setProjects(data || []);
    setLoading(false);
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("projects")
      .insert({
        name: newProject.name,
        project_type: newProject.project_type,
        local_currency: newProject.local_currency,
        exchange_rate: Number(newProject.exchange_rate),
        created_by: user.id,
      })
      .select()
      .single();

    if (!error && data) {
      // Create initial exchange rate version
      await supabase.from("exchange_rate_versions").insert({
        project_id: data.id,
        version: 1,
        rate: Number(newProject.exchange_rate),
      });

      setDialogOpen(false);
      setNewProject({ name: "", project_type: "costo", local_currency: "PYG", exchange_rate: "7350" });
      router.push(`/project/${data.id}/settings`);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function openDuplicateDialog(project: Project) {
    setDuplicateSource(project);
    setDuplicateName(`${project.name} (Copia)`);
    setDuplicateScope("planning");
  }

  async function submitDuplicate() {
    if (!duplicateSource || duplicating) return;
    const name = duplicateName.trim();
    if (!name) {
      toast.error("Ingresá un nombre para la copia");
      return;
    }
    setDuplicating(true);
    try {
      const { data, error } = await supabase.rpc("duplicate_project", {
        p_source_id: duplicateSource.id,
        p_new_name: name,
        p_include_compras: duplicateScope === "all",
      });
      if (error) {
        toast.error(`Error al duplicar: ${error.message}`);
        return;
      }
      toast.success("Proyecto duplicado");
      setDuplicateSource(null);
      router.push(`/project/${data}/settings`);
    } finally {
      setDuplicating(false);
    }
  }

  const currencySymbol = (code: string) =>
    CURRENCIES.find((c) => c.code === code)?.symbol || "$";

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background" style={{ height: 64 }}>
        <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-horizontal.svg" alt="MasterPlan Connect" className="h-9" />
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Salir
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold">Proyectos</h2>
            <p className="text-muted-foreground">Administra tus presupuestos de obra</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger
              render={
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Nuevo Proyecto
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nuevo Proyecto</DialogTitle>
                <DialogDescription>
                  Configura los datos básicos del proyecto
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={createProject} className="space-y-4">
                <div className="space-y-2">
                  <Label>Nombre del proyecto</Label>
                  <Input
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    placeholder="Ej: Residencial Los Álamos"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tipo de proyecto</Label>
                  <Select
                    value={newProject.project_type}
                    onValueChange={(v) => v && setNewProject({ ...newProject, project_type: v as ProjectType })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="costo">Costo interno</SelectItem>
                      <SelectItem value="venta">Venta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Moneda local</Label>
                    <Select
                      value={newProject.local_currency}
                      onValueChange={(v) => v && setNewProject({ ...newProject, local_currency: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.code} - {c.symbol}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Tipo de cambio</Label>
                    <Input
                      type="number"
                      step="any"
                      value={newProject.exchange_rate}
                      onChange={(e) => setNewProject({ ...newProject, exchange_rate: e.target.value })}
                      placeholder="1 USD = ?"
                      required
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full">Crear Proyecto</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader><div className="h-6 bg-muted rounded w-3/4" /></CardHeader>
                <CardContent><div className="h-4 bg-muted rounded w-1/2" /></CardContent>
              </Card>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Sin proyectos</h3>
              <p className="text-muted-foreground mb-4">Crea tu primer proyecto de presupuesto</p>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Nuevo Proyecto
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="cursor-pointer hover:border-primary/50 transition-colors relative group"
                onClick={() => router.push(`/project/${project.id}/settings`)}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-2 right-2 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); openDuplicateDialog(project); }}
                  title="Duplicar proyecto"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <CardHeader>
                  <div className="flex items-start justify-between pr-7">
                    <CardTitle className="text-lg">{project.name}</CardTitle>
                    <Badge variant={project.project_type === "venta" ? "default" : "secondary"}>
                      {project.project_type === "venta" ? "Venta" : "Costo"}
                    </Badge>
                  </div>
                  <CardDescription>
                    {project.client || "Sin cliente"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{project.local_currency} {currencySymbol(project.local_currency)}</span>
                    <span>TC: {project.exchange_rate}</span>
                    <span>v{project.current_version}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Duplicate Dialog */}
        <Dialog
          open={duplicateSource !== null}
          onOpenChange={(open) => {
            if (!open && duplicating) return;
            if (!open) setDuplicateSource(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Duplicar proyecto</DialogTitle>
              <DialogDescription>
                Se creará una copia de <span className="font-medium">{duplicateSource?.name}</span> con todos los datos del módulo seleccionado.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nombre de la copia</Label>
                <Input
                  value={duplicateName}
                  onChange={(e) => setDuplicateName(e.target.value)}
                  disabled={duplicating}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>Qué copiar</Label>
                <div className="space-y-2">
                  <label className={`flex items-start gap-3 p-3 border rounded-md cursor-pointer transition-colors ${duplicateScope === "planning" ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}>
                    <input
                      type="radio"
                      name="dupScope"
                      value="planning"
                      checked={duplicateScope === "planning"}
                      onChange={() => setDuplicateScope("planning")}
                      disabled={duplicating}
                      className="mt-1"
                    />
                    <div>
                      <p className="text-sm font-medium">Sólo módulo de Planificación</p>
                      <p className="text-xs text-muted-foreground">Sectores, EDT, insumos, artículos, cuantificación, cronograma, paquetes de compra. <em>No</em> copia proveedores, OCs, recepciones, facturas ni pagos.</p>
                    </div>
                  </label>
                  <label className={`flex items-start gap-3 p-3 border rounded-md cursor-pointer transition-colors ${duplicateScope === "all" ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}>
                    <input
                      type="radio"
                      name="dupScope"
                      value="all"
                      checked={duplicateScope === "all"}
                      onChange={() => setDuplicateScope("all")}
                      disabled={duplicating}
                      className="mt-1"
                    />
                    <div>
                      <p className="text-sm font-medium">Planificación + Compras</p>
                      <p className="text-xs text-muted-foreground">Todo lo anterior más proveedores, solicitudes, órdenes, recepciones, facturas, pagos y contadores de documentos.</p>
                    </div>
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDuplicateSource(null)} disabled={duplicating}>
                  Cancelar
                </Button>
                <Button onClick={submitDuplicate} disabled={duplicating || !duplicateName.trim()}>
                  {duplicating
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Duplicando…</>
                    : <><Copy className="h-4 w-4 mr-2" /> Duplicar</>}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
