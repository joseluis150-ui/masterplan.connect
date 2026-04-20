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
import { Plus, Building2, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

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
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => router.push(`/project/${project.id}/settings`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
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
      </main>
    </div>
  );
}
