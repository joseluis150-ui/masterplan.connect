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
import { Plus, Building2, LogOut, Copy, Loader2, Trash2, RotateCcw, AlertTriangle, FileSpreadsheet } from "lucide-react";
import { downloadBlob } from "@/lib/utils/excel";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type DuplicateScope = "planning" | "all";
type ViewMode = "active" | "trash";

const TRASH_RETENTION_DAYS = 15;

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("active");
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
  // Soft-delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Hard-delete (purge) confirmation from trash
  const [purgeTarget, setPurgeTarget] = useState<Project | null>(null);
  const [purging, setPurging] = useState(false);
  // Restore loading per project
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    // Lazy purge of trash older than 15 days for the current user.
    // Errors are silently ignored — the function will retry next page load.
    try { await supabase.rpc("purge_expired_projects"); } catch { /* noop */ }
    const { data } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    setProjects(data || []);
    setLoading(false);
  }

  const activeProjects = projects.filter((p) => !p.deleted_at);
  const trashProjects = projects.filter((p) => !!p.deleted_at);
  const visibleProjects = view === "active" ? activeProjects : trashProjects;

  function daysRemaining(deletedAt: string): number {
    const elapsed = (Date.now() - new Date(deletedAt).getTime()) / 86_400_000;
    return Math.max(0, Math.ceil(TRASH_RETENTION_DAYS - elapsed));
  }

  async function submitSoftDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc("soft_delete_project", { p_id: deleteTarget.id });
      if (error) {
        toast.error(`Error al eliminar: ${error.message}`);
        return;
      }
      toast.success(`"${deleteTarget.name}" movido a Eliminados`);
      setDeleteTarget(null);
      loadProjects();
    } finally {
      setDeleting(false);
    }
  }

  async function restoreFromTrash(p: Project) {
    if (restoringId) return;
    setRestoringId(p.id);
    try {
      const { error } = await supabase.rpc("restore_project", { p_id: p.id });
      if (error) {
        toast.error(`Error al restaurar: ${error.message}`);
        return;
      }
      toast.success(`"${p.name}" restaurado`);
      loadProjects();
    } finally {
      setRestoringId(null);
    }
  }

  async function handleDownloadImportTemplate() {
    try {
      await generateImportTemplate();
      toast.success("Plantilla descargada");
    } catch (err) {
      toast.error(`Error al generar la plantilla: ${err instanceof Error ? err.message : "desconocido"}`);
    }
  }

  async function submitPurge() {
    if (!purgeTarget || purging) return;
    setPurging(true);
    try {
      // RLS DELETE policy on projects allows the owner to delete directly.
      const { error } = await supabase.from("projects").delete().eq("id", purgeTarget.id);
      if (error) {
        toast.error(`Error al eliminar permanentemente: ${error.message}`);
        return;
      }
      toast.success(`"${purgeTarget.name}" eliminado permanentemente`);
      setPurgeTarget(null);
      loadProjects();
    } finally {
      setPurging(false);
    }
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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Proyectos</h2>
            <p className="text-muted-foreground">Administra tus presupuestos de obra</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleDownloadImportTemplate} title="Descargar plantilla Excel para crear un proyecto a partir de un archivo externo">
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Plantilla de importación
            </Button>
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
        </div>

        {/* View tabs: Activos / Eliminados */}
        <div className="flex items-center gap-1 mb-6 border-b">
          <button
            onClick={() => setView("active")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              view === "active"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Activos
            {activeProjects.length > 0 && (
              <span className="ml-2 text-xs text-muted-foreground">({activeProjects.length})</span>
            )}
          </button>
          <button
            onClick={() => setView("trash")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1 ${
              view === "trash"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Eliminados
            {trashProjects.length > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">({trashProjects.length})</span>
            )}
          </button>
        </div>

        {view === "trash" && (
          <p className="text-xs text-muted-foreground mb-4">
            Los proyectos eliminados se restauran dentro de los {TRASH_RETENTION_DAYS} días. Después de ese plazo se eliminan permanentemente.
          </p>
        )}

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader><div className="h-6 bg-muted rounded w-3/4" /></CardHeader>
                <CardContent><div className="h-4 bg-muted rounded w-1/2" /></CardContent>
              </Card>
            ))}
          </div>
        ) : visibleProjects.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              {view === "active" ? (
                <>
                  <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">Sin proyectos</h3>
                  <p className="text-muted-foreground mb-4">Crea tu primer proyecto de presupuesto</p>
                  <Button onClick={() => setDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Nuevo Proyecto
                  </Button>
                </>
              ) : (
                <>
                  <Trash2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No hay proyectos eliminados</h3>
                  <p className="text-muted-foreground">La carpeta de eliminados está vacía.</p>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visibleProjects.map((project) => {
              const inTrash = view === "trash";
              const days = inTrash && project.deleted_at ? daysRemaining(project.deleted_at) : null;
              return (
                <Card
                  key={project.id}
                  className={`relative group transition-colors ${
                    inTrash
                      ? "border-dashed bg-muted/30"
                      : "cursor-pointer hover:border-primary/50"
                  }`}
                  onClick={inTrash ? undefined : () => router.push(`/project/${project.id}/settings`)}
                >
                  {/* Action icons (top-right) */}
                  <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!inTrash && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={(e) => { e.stopPropagation(); openDuplicateDialog(project); }}
                          title="Duplicar proyecto"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(project); }}
                          title="Eliminar proyecto"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>

                  <CardHeader>
                    <div className="flex items-start justify-between pr-16">
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

                    {inTrash && (
                      <div className="mt-3 pt-3 border-t flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground italic">
                          {days === 0
                            ? "Se elimina hoy"
                            : `Se elimina en ${days} día${days === 1 ? "" : "s"}`}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => restoreFromTrash(project)}
                            disabled={restoringId === project.id}
                          >
                            {restoringId === project.id
                              ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              : <RotateCcw className="h-3 w-3 mr-1" />}
                            Restaurar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() => setPurgeTarget(project)}
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Eliminar ya
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
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

        {/* Soft-delete confirmation */}
        <Dialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open && deleting) return;
            if (!open) setDeleteTarget(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Eliminar proyecto</DialogTitle>
              <DialogDescription>
                <span className="font-medium">{deleteTarget?.name}</span> se moverá a la carpeta Eliminados. Podrás restaurarlo durante los próximos {TRASH_RETENTION_DAYS} días; pasado ese plazo se eliminará de forma permanente.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancelar
              </Button>
              <Button
                onClick={submitSoftDelete}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Eliminando…</>
                  : <><Trash2 className="h-4 w-4 mr-2" /> Eliminar</>}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Hard-delete (permanent purge) confirmation */}
        <Dialog
          open={purgeTarget !== null}
          onOpenChange={(open) => {
            if (!open && purging) return;
            if (!open) setPurgeTarget(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Eliminar permanentemente
              </DialogTitle>
              <DialogDescription>
                Esta acción <span className="font-semibold">no se puede deshacer</span>. Se eliminará <span className="font-medium">{purgeTarget?.name}</span> junto con todos sus datos asociados (EDT, presupuesto, cronograma, compras, etc.).
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setPurgeTarget(null)} disabled={purging}>
                Cancelar
              </Button>
              <Button
                onClick={submitPurge}
                disabled={purging}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {purging
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Eliminando…</>
                  : <><Trash2 className="h-4 w-4 mr-2" /> Eliminar permanentemente</>}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}

/* ─────────────────────── Plantilla de importación ─────────────────────── */

const TPL_COLOR = {
  ink: "FF0A0A0A",
  inkSoft: "FF404040",
  white: "FFFFFFFF",
  grayLight: "FFF5F5F5",
  grayFaint: "FFFAFAFA",
  ash: "FF737373",
  border: "FFD4D4D4",
  borderFaint: "FFEFEFEF",
  orange: "FFE87722",
  amberFaint: "FFFEF3E8",
};

function tplBorder(argb: string) {
  return {
    top: { style: "thin" as const, color: { argb } },
    right: { style: "thin" as const, color: { argb } },
    bottom: { style: "thin" as const, color: { argb } },
    left: { style: "thin" as const, color: { argb } },
  };
}

interface TplColumnSpec {
  key: string;
  label: string;
  width: number;
  hint: string;       // Texto en la fila de "formato/notas"
  required?: boolean;
}

interface TplSheetSpec {
  name: string;
  title: string;
  description: string;
  columns: TplColumnSpec[];
  sampleRows: (string | number)[][];
}

async function generateImportTemplate() {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "MasterPlan Connect";
  wb.created = new Date();

  const titleStyle = {
    font: { name: "Calibri", size: 16, bold: true, color: { argb: TPL_COLOR.white } },
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: TPL_COLOR.ink } },
    alignment: { vertical: "middle" as const, horizontal: "left" as const, indent: 1 },
  };
  const subtitleStyle = {
    font: { name: "Calibri", size: 10, italic: true, color: { argb: TPL_COLOR.ash } },
    alignment: { vertical: "middle" as const, horizontal: "left" as const, indent: 1, wrapText: true },
  };
  const headerStyle = {
    font: { name: "Calibri", size: 10, bold: true, color: { argb: TPL_COLOR.white } },
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: TPL_COLOR.ink } },
    alignment: { vertical: "middle" as const, horizontal: "center" as const, wrapText: true },
    border: tplBorder(TPL_COLOR.ink),
  };
  const requiredHeaderStyle = {
    ...headerStyle,
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: TPL_COLOR.orange } },
  };
  const hintStyle = {
    font: { name: "Calibri", size: 9, italic: true, color: { argb: TPL_COLOR.ash } },
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: TPL_COLOR.amberFaint } },
    alignment: { vertical: "middle" as const, horizontal: "center" as const, wrapText: true },
    border: tplBorder(TPL_COLOR.border),
  };
  const sampleStyle = {
    font: { name: "Calibri", size: 10, color: { argb: TPL_COLOR.inkSoft } },
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: TPL_COLOR.grayFaint } },
    alignment: { vertical: "middle" as const, horizontal: "left" as const, wrapText: true },
    border: tplBorder(TPL_COLOR.borderFaint),
  };

  function addStandardSheet(spec: TplSheetSpec) {
    const ws = wb.addWorksheet(spec.name);
    const lastCol = spec.columns.length;
    // Anchos
    spec.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
    // Fila 1: título (merged)
    ws.mergeCells(1, 1, 1, lastCol);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = spec.title;
    Object.assign(titleCell, titleStyle);
    ws.getRow(1).height = 26;
    // Fila 2: descripción (merged)
    ws.mergeCells(2, 1, 2, lastCol);
    const descCell = ws.getCell(2, 1);
    descCell.value = spec.description;
    Object.assign(descCell, subtitleStyle);
    ws.getRow(2).height = Math.max(18, Math.ceil(spec.description.length / 80) * 14);
    // Fila 3: spacing
    ws.getRow(3).height = 6;
    // Fila 4: header
    spec.columns.forEach((c, i) => {
      const cell = ws.getCell(4, i + 1);
      cell.value = c.required ? `${c.label} *` : c.label;
      Object.assign(cell, c.required ? requiredHeaderStyle : headerStyle);
    });
    ws.getRow(4).height = 22;
    // Fila 5: hints (formato/notas)
    spec.columns.forEach((c, i) => {
      const cell = ws.getCell(5, i + 1);
      cell.value = c.hint;
      Object.assign(cell, hintStyle);
    });
    ws.getRow(5).height = 28;
    // Filas 6+: sample data
    spec.sampleRows.forEach((row, ri) => {
      row.forEach((value, ci) => {
        const cell = ws.getCell(6 + ri, ci + 1);
        cell.value = value === "" ? null : value;
        Object.assign(cell, sampleStyle);
      });
    });
    // Freeze panes después del header
    ws.views = [{ state: "frozen", xSplit: 0, ySplit: 5 }];
    ws.pageSetup = {
      paperSize: 9,
      orientation: lastCol > 6 ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    };
  }

  // ────────────────── Hoja 0: Instrucciones ──────────────────
  const wsInstr = wb.addWorksheet("Instrucciones");
  wsInstr.getColumn(1).width = 24;
  wsInstr.getColumn(2).width = 90;
  // Título
  wsInstr.mergeCells(1, 1, 1, 2);
  const t = wsInstr.getCell(1, 1);
  t.value = "PLANTILLA DE IMPORTACIÓN — MasterPlan Connect";
  Object.assign(t, titleStyle);
  wsInstr.getRow(1).height = 28;
  // Subtítulo
  wsInstr.mergeCells(2, 1, 2, 2);
  const s = wsInstr.getCell(2, 1);
  s.value = "Formato esperado para cargar masivamente un nuevo proyecto desde Excel. Completá las hojas en el orden numerado y respetá las referencias entre ellas.";
  Object.assign(s, subtitleStyle);
  wsInstr.getRow(2).height = 30;

  // Bloque de filas tipo (etiqueta | texto)
  const sectionH = {
    font: { name: "Calibri", size: 11, bold: true, color: { argb: TPL_COLOR.white } },
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: TPL_COLOR.ink } },
    alignment: { vertical: "middle" as const, horizontal: "left" as const, indent: 1 },
  };
  const sectionLabel = {
    font: { name: "Calibri", size: 10, bold: true, color: { argb: TPL_COLOR.ink } },
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: TPL_COLOR.grayLight } },
    alignment: { vertical: "top" as const, horizontal: "left" as const, indent: 1, wrapText: true },
    border: tplBorder(TPL_COLOR.border),
  };
  const sectionText = {
    font: { name: "Calibri", size: 10, color: { argb: TPL_COLOR.inkSoft } },
    alignment: { vertical: "top" as const, horizontal: "left" as const, indent: 1, wrapText: true },
    border: tplBorder(TPL_COLOR.borderFaint),
  };

  let r = 4;
  function addSection(title: string) {
    wsInstr.mergeCells(r, 1, r, 2);
    const cell = wsInstr.getCell(r, 1);
    cell.value = title;
    Object.assign(cell, sectionH);
    wsInstr.getRow(r).height = 22;
    r++;
  }
  function addRow(label: string, text: string) {
    const cellL = wsInstr.getCell(r, 1);
    cellL.value = label;
    Object.assign(cellL, sectionLabel);
    const cellT = wsInstr.getCell(r, 2);
    cellT.value = text;
    Object.assign(cellT, sectionText);
    wsInstr.getRow(r).height = Math.max(20, Math.ceil(text.length / 90) * 14);
    r++;
  }

  addSection("ESTRUCTURA DEL ARCHIVO");
  addRow("Hojas", "El archivo tiene una hoja por cada entidad del proyecto. Cargá los datos en el orden numerado: 1.Proyecto → 2.Sectores → 3.EDT → 4.Insumos → 5.Articulos → 6.Composiciones → 7.Cuantificacion. Las hojas con número en su nombre se importan; esta hoja Instrucciones se ignora.");
  addRow("Encabezados", "Cada hoja tiene una fila de encabezados (fila 4) con los nombres de columna. La fila 5 muestra el formato esperado / notas. A partir de la fila 6 ya podés cargar tus datos. NO modifiques los nombres de las columnas.");
  addRow("Columnas obligatorias", "Las columnas marcadas con * y fondo naranja son obligatorias. Las demás son opcionales y pueden quedar vacías.");
  addRow("Hoja 1.Proyecto", "Una sola fila de datos. Define el nombre del proyecto, moneda local, tipo de cambio, cliente y demás metadatos.");

  addSection("REFERENCIAS ENTRE HOJAS");
  addRow("categoria_code", "Texto que identifica una categoría EDT (ej: 02, 03.1). Debe coincidir EXACTAMENTE con un valor de la columna categoria_code de la hoja 3.EDT cuando se use en otras hojas.");
  addRow("subcategoria_code", "Identificador de subcategoría (ej: 02.1, 03.1.2). Debe existir en 3.EDT.");
  addRow("sector_name", "Nombre del sector tal como aparece en 2.Sectores.");
  addRow("articulo_ref", "Identificador del artículo. Puede ser su number (si lo asignaste manualmente) o su descripción exacta. Debe existir en 5.Articulos.");
  addRow("insumo_ref", "Identificador del insumo. Puede ser su code o su description exacta. Debe existir en 4.Insumos.");

  addSection("REGLAS Y FORMATOS");
  addRow("Números", "Usá punto decimal (1234.56) o coma según tu sistema regional, pero respetá una convención consistente. NO uses separadores de miles.");
  addRow("Fechas", "Formato YYYY-MM-DD (ej: 2026-04-28).");
  addRow("Porcentajes", "Cargalos como número entero o decimal sin el símbolo %. Por ejemplo 5 (5 %) o 7.5 (7.5 %).");
  addRow("Monedas", "El campo currency_input de insumos indica si pu_local o pu_usd se cargó originalmente. Sólo uno de los dos campos pu_local/pu_usd debe tener valor.");
  addRow("Tipos enum", "project_type ∈ {costo, venta} · sector.type ∈ {fisico, funcional} · insumo.type ∈ {material, mano_de_obra, servicio} · proration_criteria ∈ {area, cantidad, manual} · number_format ∈ {es, en}.");

  addSection("CÓMO USARLO CON CLAUDE");
  addRow("Paso 1", "Descargá esta plantilla.");
  addRow("Paso 2", "En el chat de Claude, adjuntá tu archivo de presupuesto antiguo (Excel/CSV/lo que sea) y este archivo plantilla.");
  addRow("Paso 3", "Pedile a Claude algo como: \"Leé estos dos archivos. El primero es mi presupuesto antiguo, el segundo es la plantilla esperada de MasterPlan Connect. Convertí los datos al formato de la plantilla manteniendo todas las hojas.\"");
  addRow("Paso 4", "Claude te devolverá el .xlsx armado siguiendo este formato.");
  addRow("Paso 5", "Importá el archivo resultante en MasterPlan Connect (el endpoint de import masivo se conectará en una próxima iteración).");

  // ────────────────── Hojas de datos ──────────────────

  addStandardSheet({
    name: "1.Proyecto",
    title: "1. PROYECTO — datos generales",
    description: "Una sola fila de datos (fila 6). Define los metadatos del proyecto.",
    columns: [
      { key: "name", label: "name", width: 32, hint: "Nombre del proyecto", required: true },
      { key: "project_type", label: "project_type", width: 14, hint: "costo · venta", required: true },
      { key: "local_currency", label: "local_currency", width: 14, hint: "PYG · USD · BRL · ARS · …", required: true },
      { key: "exchange_rate", label: "exchange_rate", width: 16, hint: "1 USD = X (ej: 7350)", required: true },
      { key: "client", label: "client", width: 24, hint: "Nombre del cliente" },
      { key: "location", label: "location", width: 24, hint: "Dirección o zona" },
      { key: "estimated_start", label: "estimated_start", width: 16, hint: "YYYY-MM-DD" },
      { key: "responsible", label: "responsible", width: 22, hint: "Nombre del responsable" },
      { key: "proration_criteria", label: "proration_criteria", width: 18, hint: "area · cantidad · manual" },
      { key: "number_format", label: "number_format", width: 14, hint: "es · en" },
    ],
    sampleRows: [
      ["Residencial Los Álamos", "costo", "PYG", 7350, "ABC SA", "Asunción", "2026-05-01", "Juan Pérez", "area", "es"],
    ],
  });

  addStandardSheet({
    name: "2.Sectores",
    title: "2. SECTORES — divisiones físicas o funcionales del proyecto",
    description: "Cada fila es un sector. El nombre se usa como referencia en 7.Cuantificacion.",
    columns: [
      { key: "order", label: "order", width: 10, hint: "Entero, orden de despliegue (1, 2, 3, …)", required: true },
      { key: "name", label: "name", width: 28, hint: "Nombre del sector", required: true },
      { key: "type", label: "type", width: 14, hint: "fisico · funcional", required: true },
      { key: "area_m2", label: "area_m2", width: 14, hint: "Decimal, área en m²" },
    ],
    sampleRows: [
      [1, "Bloque A", "fisico", 320],
      [2, "Bloque B", "fisico", 280],
      [3, "Áreas comunes", "funcional", 80],
    ],
  });

  addStandardSheet({
    name: "3.EDT",
    title: "3. EDT — Categorías y subcategorías",
    description: "Cada fila define una subcategoría y su categoría padre. Si una categoría tiene varias subs, repetí categoria_code y categoria_name en cada fila. Si una categoría todavía no tiene subs, dejá las dos últimas columnas vacías.",
    columns: [
      { key: "categoria_code", label: "categoria_code", width: 16, hint: "Código de la categoría (ej: 02)", required: true },
      { key: "categoria_name", label: "categoria_name", width: 30, hint: "Nombre de la categoría", required: true },
      { key: "categoria_order", label: "categoria_order", width: 14, hint: "Entero, orden global de la categoría" },
      { key: "subcategoria_code", label: "subcategoria_code", width: 18, hint: "Código de la subcategoría (ej: 02.1)" },
      { key: "subcategoria_name", label: "subcategoria_name", width: 32, hint: "Nombre de la subcategoría" },
      { key: "subcategoria_order", label: "subcategoria_order", width: 18, hint: "Entero, orden dentro de la categoría" },
    ],
    sampleRows: [
      ["01", "Trabajos preliminares", 1, "01.1", "Limpieza y replanteo", 1],
      ["01", "Trabajos preliminares", 1, "01.2", "Cerramiento provisorio", 2],
      ["02", "Movimiento de suelos", 2, "02.1", "Excavación", 1],
      ["02", "Movimiento de suelos", 2, "02.2", "Relleno y compactación", 2],
      ["03", "Fundaciones", 3, "03.1", "Hormigón armado", 1],
    ],
  });

  addStandardSheet({
    name: "4.Insumos",
    title: "4. INSUMOS — Catálogo de materiales, mano de obra y servicios",
    description: "Cada fila es un insumo. La columna code la podés dejar vacía: se asigna automáticamente. Cargá pu_usd o pu_local (no ambos) y marcá currency_input para indicar cuál.",
    columns: [
      { key: "code", label: "code", width: 10, hint: "Vacío → autogenerado" },
      { key: "type", label: "type", width: 14, hint: "material · mano_de_obra · servicio", required: true },
      { key: "family", label: "family", width: 16, hint: "Categoría libre (ej: cemento, perfilería)" },
      { key: "description", label: "description", width: 50, hint: "Descripción del insumo", required: true },
      { key: "unit", label: "unit", width: 10, hint: "Unidad (m, m², m³, kg, u, día, …)", required: true },
      { key: "pu_usd", label: "pu_usd", width: 14, hint: "Precio unitario en USD" },
      { key: "pu_local", label: "pu_local", width: 14, hint: "Precio unitario en moneda local" },
      { key: "currency_input", label: "currency_input", width: 16, hint: "USD · local (cuál se cargó originalmente)" },
      { key: "reference", label: "reference", width: 24, hint: "Marca / proveedor / link de referencia" },
    ],
    sampleRows: [
      ["", "material", "Cementos", "Cemento Portland - Bolsa de 50 kg", "u", 9.46, 69531, "USD", "Yguazú"],
      ["", "material", "Áridos", "Arena lavada", "m³", 18, 132300, "USD", ""],
      ["", "mano_de_obra", "Albañilería", "Jornal Albañil - Oficial 1ra incluye prestaciones", "día", 35.45, 260587, "USD", ""],
      ["", "servicio", "Profesional", "Diseño estructural", "glo", 332.25, "", "USD", ""],
    ],
  });

  addStandardSheet({
    name: "5.Articulos",
    title: "5. ARTÍCULOS (APU) — Análisis de Precios Unitarios",
    description: "Cada fila define un articulo. Los componentes (insumos que lo forman) van en la hoja 6.Composiciones.",
    columns: [
      { key: "number", label: "number", width: 10, hint: "Entero. Vacío → autogenerado" },
      { key: "description", label: "description", width: 60, hint: "Descripción del articulo (ej: \"Hormigón FCK200 in situ\")", required: true },
      { key: "unit", label: "unit", width: 10, hint: "Unidad del articulo (m³, m², ml, u, …)", required: true },
      { key: "profit_pct", label: "profit_pct", width: 14, hint: "% de utilidad/markup global. Default 0" },
      { key: "comment", label: "comment", width: 32, hint: "Comentario opcional" },
    ],
    sampleRows: [
      [1, "Limpieza de terreno", "m²", 0, ""],
      [2, "Excavación manual", "m³", 0, ""],
      [3, "Hormigón FCK200 (in situ)", "m³", 0, "Incluye encofrado y vibrado"],
    ],
  });

  addStandardSheet({
    name: "6.Composiciones",
    title: "6. COMPOSICIONES — Insumos que componen cada articulo",
    description: "Cada fila vincula un articulo con un insumo y define cuánto del insumo aporta a UNA unidad del articulo. Repetí articulo_ref por cada insumo que lo forma.",
    columns: [
      { key: "articulo_ref", label: "articulo_ref", width: 50, hint: "Number o description del articulo (debe existir en 5.Articulos)", required: true },
      { key: "insumo_ref", label: "insumo_ref", width: 50, hint: "Code o description del insumo (debe existir en 4.Insumos)", required: true },
      { key: "quantity", label: "quantity", width: 12, hint: "Cantidad del insumo por 1 unidad del articulo (decimal)", required: true },
      { key: "waste_pct", label: "waste_pct", width: 12, hint: "% de desperdicio (default 0)" },
      { key: "margin_pct", label: "margin_pct", width: 12, hint: "% de margen sobre el insumo (default 0)" },
    ],
    sampleRows: [
      ["Hormigón FCK200 (in situ)", "Cemento Portland - Bolsa de 50 kg", 7, 8, 0],
      ["Hormigón FCK200 (in situ)", "Arena lavada", 0.45, 5, 0],
      ["Hormigón FCK200 (in situ)", "Jornal Albañil - Oficial 1ra incluye prestaciones", 0.5, 0, 0],
    ],
  });

  addStandardSheet({
    name: "7.Cuantificacion",
    title: "7. CUANTIFICACIÓN — Cuánto de cada articulo se ejecuta en cada subcategoría/sector",
    description: "Cada fila representa una línea cuantificada: \"en la subcategoría X del sector Y se ejecutan Z unidades del articulo W\". Las columnas categoria_code y subcategoria_code deben existir en 3.EDT, sector_name en 2.Sectores y articulo_ref en 5.Articulos.",
    columns: [
      { key: "categoria_code", label: "categoria_code", width: 16, hint: "Debe existir en 3.EDT", required: true },
      { key: "subcategoria_code", label: "subcategoria_code", width: 18, hint: "Debe existir en 3.EDT", required: true },
      { key: "sector_name", label: "sector_name", width: 22, hint: "Debe existir en 2.Sectores", required: true },
      { key: "articulo_ref", label: "articulo_ref", width: 50, hint: "Number o description del articulo", required: true },
      { key: "quantity", label: "quantity", width: 14, hint: "Cantidad en la unidad del articulo (decimal)", required: true },
      { key: "comment", label: "comment", width: 30, hint: "Comentario opcional" },
    ],
    sampleRows: [
      ["01", "01.1", "Bloque A", "Limpieza de terreno", 320, ""],
      ["02", "02.1", "Bloque A", "Excavación manual", 45, "Zapatas y vigas de fundación"],
      ["03", "03.1", "Bloque A", "Hormigón FCK200 (in situ)", 12.5, ""],
      ["03", "03.1", "Bloque B", "Hormigón FCK200 (in situ)", 11, ""],
    ],
  });

  const buf = await wb.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(buf as ArrayBuffer, `plantilla_importacion_proyecto_${date}.xlsx`);
}
