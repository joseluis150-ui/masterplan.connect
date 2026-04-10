"use client";

import React, { useEffect, useState, useCallback, use } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { formatNumber, convertCurrency } from "@/lib/utils/formula";
import type { Project, Sector } from "@/lib/types/database";
import { DollarSign } from "lucide-react";

interface BudgetRow {
  category_id: string;
  category_code: string;
  category_name: string;
  subcategory_id: string;
  subcategory_code: string;
  subcategory_name: string;
  sector_id: string;
  sector_name: string;
  total_usd: number;
  total_mat: number;
  total_mo: number;
  total_glo: number;
}

type ViewMode = "categories" | "expanded" | "collapsed";

export default function PresupuestoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const [budgetData, setBudgetData] = useState<BudgetRow[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("expanded");
  const [showLocal, setShowLocal] = useState(false);
  const [filterSector, setFilterSector] = useState("all");
  const supabase = createClient();

  const loadData = useCallback(async () => {
    const [projRes, sectorsRes, budgetRes] = await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).single(),
      supabase.from("sectors").select("*").eq("project_id", projectId).order("order"),
      supabase.rpc("get_budget_summary", { p_project_id: projectId }),
    ]);
    if (projRes.data) setProject(projRes.data);
    setSectors(sectorsRes.data || []);
    setBudgetData((budgetRes.data || []).map((r: Record<string, unknown>) => ({
      ...r,
      total_usd: Number(r.total_usd),
      total_mat: Number(r.total_mat),
      total_mo: Number(r.total_mo),
      total_glo: Number(r.total_glo),
    })) as BudgetRow[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  const tc = Number(project?.exchange_rate || 1);
  const fmt = (val: number) => showLocal
    ? formatNumber(convertCurrency(val, tc, "usd_to_local"), 0)
    : formatNumber(val);
  const currency = showLocal ? project?.local_currency || "LOCAL" : "USD";

  const filteredData = filterSector === "all" ? budgetData : budgetData.filter((r) => r.sector_id === filterSector);

  // Aggregate by category
  const categoryTotals = new Map<string, { code: string; name: string; total: number; mat: number; mo: number; glo: number; subs: Map<string, { code: string; name: string; total: number; mat: number; mo: number; glo: number }> }>();

  for (const row of filteredData) {
    if (!categoryTotals.has(row.category_id)) {
      categoryTotals.set(row.category_id, { code: row.category_code, name: row.category_name, total: 0, mat: 0, mo: 0, glo: 0, subs: new Map() });
    }
    const cat = categoryTotals.get(row.category_id)!;
    cat.total += row.total_usd;
    cat.mat += row.total_mat;
    cat.mo += row.total_mo;
    cat.glo += row.total_glo;

    if (!cat.subs.has(row.subcategory_id)) {
      cat.subs.set(row.subcategory_id, { code: row.subcategory_code, name: row.subcategory_name, total: 0, mat: 0, mo: 0, glo: 0 });
    }
    const sub = cat.subs.get(row.subcategory_id)!;
    sub.total += row.total_usd;
    sub.mat += row.total_mat;
    sub.mo += row.total_mo;
    sub.glo += row.total_glo;
  }

  const grandTotal = filteredData.reduce((s, r) => s + r.total_usd, 0);
  const grandMat = filteredData.reduce((s, r) => s + r.total_mat, 0);
  const grandMo = filteredData.reduce((s, r) => s + r.total_mo, 0);
  const grandGlo = filteredData.reduce((s, r) => s + r.total_glo, 0);

  // Sector totals
  const sectorTotals = new Map<string, number>();
  for (const row of budgetData) {
    sectorTotals.set(row.sector_id, (sectorTotals.get(row.sector_id) || 0) + row.total_usd);
  }

  if (loading) return <div className="animate-pulse h-96 bg-muted rounded-lg" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Presupuesto</h1>
          <p className="text-muted-foreground">Paso 6: Vista calculada del presupuesto</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{fmt(grandTotal)} <span className="text-sm font-normal">{currency}</span></p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Materiales</CardTitle></CardHeader>
          <CardContent><p className="text-lg font-bold">{fmt(grandMat)}<span className="text-xs ml-1">{grandTotal > 0 ? `(${((grandMat / grandTotal) * 100).toFixed(1)}%)` : ""}</span></p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Mano de Obra</CardTitle></CardHeader>
          <CardContent><p className="text-lg font-bold">{fmt(grandMo)}<span className="text-xs ml-1">{grandTotal > 0 ? `(${((grandMo / grandTotal) * 100).toFixed(1)}%)` : ""}</span></p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Servicios/Global</CardTitle></CardHeader>
          <CardContent><p className="text-lg font-bold">{fmt(grandGlo)}<span className="text-xs ml-1">{grandTotal > 0 ? `(${((grandGlo / grandTotal) * 100).toFixed(1)}%)` : ""}</span></p></CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex gap-4 items-center flex-wrap">
        <Select value={viewMode} onValueChange={(v) => v && setViewMode(v as ViewMode)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="collapsed">Colapsado</SelectItem>
            <SelectItem value="categories">Por categorías</SelectItem>
            <SelectItem value="expanded">Expandido</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterSector} onValueChange={(v) => v && setFilterSector(v)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los sectores</SelectItem>
            {sectors.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 ml-auto">
          <Label className="text-sm">USD</Label>
          <Switch checked={showLocal} onCheckedChange={setShowLocal} />
          <Label className="text-sm">{project?.local_currency}</Label>
        </div>
      </div>

      {/* Sector summary */}
      {sectors.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {sectors.map((s) => (
            <Badge key={s.id} variant="outline" className="text-sm py-1 px-3">
              {s.name}: {fmt(sectorTotals.get(s.id) || 0)} {currency}
            </Badge>
          ))}
        </div>
      )}

      {/* Budget Table */}
      {filteredData.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Sin datos de presupuesto</h3>
            <p className="text-muted-foreground">Agrega líneas de cuantificación para ver el presupuesto</p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="text-right">MAT</TableHead>
                <TableHead className="text-right">MO</TableHead>
                <TableHead className="text-right">GLO</TableHead>
                <TableHead className="text-right">Total ({currency})</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {viewMode === "collapsed" ? (
                <TableRow className="font-bold">
                  <TableCell></TableCell>
                  <TableCell>TOTAL PROYECTO</TableCell>
                  <TableCell className="text-right">{fmt(grandMat)}</TableCell>
                  <TableCell className="text-right">{fmt(grandMo)}</TableCell>
                  <TableCell className="text-right">{fmt(grandGlo)}</TableCell>
                  <TableCell className="text-right">{fmt(grandTotal)}</TableCell>
                  <TableCell className="text-right">100%</TableCell>
                </TableRow>
              ) : (
                Array.from(categoryTotals.entries()).map(([catId, cat]) => (
                  <React.Fragment key={catId}>
                    <TableRow className="font-semibold bg-muted/30">
                      <TableCell>{cat.code}</TableCell>
                      <TableCell>{cat.name}</TableCell>
                      <TableCell className="text-right">{fmt(cat.mat)}</TableCell>
                      <TableCell className="text-right">{fmt(cat.mo)}</TableCell>
                      <TableCell className="text-right">{fmt(cat.glo)}</TableCell>
                      <TableCell className="text-right">{fmt(cat.total)}</TableCell>
                      <TableCell className="text-right">{grandTotal > 0 ? `${((cat.total / grandTotal) * 100).toFixed(1)}%` : "—"}</TableCell>
                    </TableRow>
                    {viewMode === "expanded" && Array.from(cat.subs.entries()).map(([subId, sub]) => (
                      <TableRow key={subId}>
                        <TableCell className="pl-8 text-muted-foreground">{sub.code}</TableCell>
                        <TableCell className="pl-8">{sub.name}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(sub.mat)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(sub.mo)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(sub.glo)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(sub.total)}</TableCell>
                        <TableCell className="text-right text-sm">{grandTotal > 0 ? `${((sub.total / grandTotal) * 100).toFixed(1)}%` : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </React.Fragment>
                ))
              )}
              {viewMode !== "collapsed" && (
                <TableRow className="font-bold border-t-2">
                  <TableCell></TableCell>
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right">{fmt(grandMat)}</TableCell>
                  <TableCell className="text-right">{fmt(grandMo)}</TableCell>
                  <TableCell className="text-right">{fmt(grandGlo)}</TableCell>
                  <TableCell className="text-right">{fmt(grandTotal)}</TableCell>
                  <TableCell className="text-right">100%</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
