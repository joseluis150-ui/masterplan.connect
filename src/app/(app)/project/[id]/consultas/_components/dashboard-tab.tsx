"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber, convertCurrency } from "@/lib/utils/formula";
import type { Project } from "@/lib/types/database";
import { BarChart3 } from "lucide-react";

interface BudgetRow {
  category_id: string;
  category_code: string;
  category_name: string;
  total_usd: number;
  total_mat: number;
  total_mo: number;
  total_glo: number;
}

export function DashboardTab({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [budgetData, setBudgetData] = useState<BudgetRow[]>([]);
  const [stats, setStats] = useState({ insumos: 0, articulos: 0, lines: 0, packages: 0 });
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const loadData = useCallback(async () => {
    const [projRes, budgetRes, insCount, artCount, lineCount, pkgCount] = await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).single(),
      supabase.rpc("get_budget_summary", { p_project_id: projectId }),
      supabase.from("insumos").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      supabase.from("articulos").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      supabase.from("quantification_lines").select("id", { count: "exact", head: true }).eq("project_id", projectId).is("deleted_at", null),
      supabase.from("procurement_packages").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    ]);

    if (projRes.data) setProject(projRes.data);

    const catMap = new Map<string, BudgetRow>();
    for (const row of (budgetRes.data || []) as BudgetRow[]) {
      if (!catMap.has(row.category_id)) {
        catMap.set(row.category_id, { ...row, total_usd: 0, total_mat: 0, total_mo: 0, total_glo: 0 });
      }
      const cat = catMap.get(row.category_id)!;
      cat.total_usd += Number(row.total_usd);
      cat.total_mat += Number(row.total_mat);
      cat.total_mo += Number(row.total_mo);
      cat.total_glo += Number(row.total_glo);
    }
    setBudgetData(Array.from(catMap.values()));

    setStats({
      insumos: insCount.count || 0,
      articulos: artCount.count || 0,
      lines: lineCount.count || 0,
      packages: pkgCount.count || 0,
    });
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <div className="animate-pulse h-96 bg-muted rounded-lg" />;

  const grandTotal = budgetData.reduce((s, r) => s + r.total_usd, 0);
  const grandMat = budgetData.reduce((s, r) => s + r.total_mat, 0);
  const grandMo = budgetData.reduce((s, r) => s + r.total_mo, 0);
  const grandGlo = budgetData.reduce((s, r) => s + r.total_glo, 0);
  const tc = Number(project?.exchange_rate || 1);
  const localTotal = convertCurrency(grandTotal, tc, "usd_to_local");

  return (
    <div className="space-y-6">
      {/* Main KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground mb-1">Total USD</p>
            <p className="text-2xl font-bold">{formatNumber(grandTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground mb-1">Total {project?.local_currency}</p>
            <p className="text-2xl font-bold">{formatNumber(localTotal, 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground mb-1">Tipo de Cambio</p>
            <p className="text-2xl font-bold">{formatNumber(tc, 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground mb-1">Version</p>
            <p className="text-2xl font-bold">v{project?.current_version}</p>
          </CardContent>
        </Card>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground mb-1">Insumos</p>
            <p className="text-3xl font-bold">{stats.insumos}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground mb-1">Articulos</p>
            <p className="text-3xl font-bold">{stats.articulos}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground mb-1">Lineas Cuantif.</p>
            <p className="text-3xl font-bold">{stats.lines}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground mb-1">Paquetes</p>
            <p className="text-3xl font-bold">{stats.packages}</p>
          </CardContent>
        </Card>
      </div>

      {/* Type breakdown */}
      <Card>
        <CardHeader><CardTitle>Distribucion por Tipo de Insumo</CardTitle></CardHeader>
        <CardContent>
          {grandTotal > 0 ? (
            <div className="space-y-3">
              {[
                { label: "Materiales", value: grandMat, color: "bg-neutral-900" },
                { label: "Mano de Obra", value: grandMo, color: "bg-neutral-500" },
                { label: "Servicios/Global", value: grandGlo, color: "bg-[#E87722]" },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{item.label}</span>
                    <span className="font-mono">{formatNumber(item.value)} USD ({((item.value / grandTotal) * 100).toFixed(1)}%)</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-3">
                    <div className={`${item.color} h-3 rounded-full transition-all`} style={{ width: `${(item.value / grandTotal) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Sin datos para mostrar</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Category breakdown */}
      {budgetData.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Distribucion por Categoria</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {budgetData.map((cat) => (
                <div key={cat.category_id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{cat.category_code} {cat.category_name}</span>
                    <span className="font-mono">{formatNumber(cat.total_usd)} USD ({((cat.total_usd / grandTotal) * 100).toFixed(1)}%)</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-3">
                    <div className="bg-neutral-900 h-3 rounded-full transition-all" style={{ width: `${(cat.total_usd / grandTotal) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
