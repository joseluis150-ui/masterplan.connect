"use client";

import { useEffect, useState, useCallback, use } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { QuantificationLine, Articulo, EdtCategory, EdtSubcategory, ScheduleConfig, ScheduleWeek } from "@/lib/types/database";
import { Calendar, Plus } from "lucide-react";
import { toast } from "sonner";
import { addWeeks, startOfWeek, format } from "date-fns";
import { es } from "date-fns/locale";

interface ScheduleRow {
  lineId: string;
  articuloNumber: number | null;
  description: string;
  categoryCode: string;
  subcategoryCode: string;
  activeWeeks: Set<number>;
}

export default function CronogramaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [totalWeeks, setTotalWeeks] = useState(30);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState(true);
  const supabase = createClient();

  const loadData = useCallback(async () => {
    const [configRes, linesRes, artsRes, catsRes, subsRes, weeksRes] = await Promise.all([
      supabase.from("schedule_config").select("*").eq("project_id", projectId).single(),
      supabase.from("quantification_lines").select("*").eq("project_id", projectId).order("line_number"),
      supabase.from("articulos").select("*").eq("project_id", projectId),
      supabase.from("edt_categories").select("*").eq("project_id", projectId).order("order"),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).order("order"),
      supabase.from("schedule_weeks").select("*"),
    ]);

    if (configRes.data) {
      setConfig(configRes.data);
      setStartDate(configRes.data.start_date);
    }

    const arts = artsRes.data || [];
    const cats = catsRes.data || [];
    const subs = subsRes.data || [];
    const lines = linesRes.data || [];
    const weeks = weeksRes.data || [];

    // Filter weeks for this project's lines
    const lineIds = new Set(lines.map((l) => l.id));
    const projectWeeks = weeks.filter((w) => lineIds.has(w.quantification_line_id));

    const scheduleRows: ScheduleRow[] = lines.map((line) => {
      const art = arts.find((a) => a.id === line.articulo_id);
      const cat = cats.find((c) => c.id === line.category_id);
      const sub = subs.find((s) => s.id === line.subcategory_id);
      const lineWeeks = projectWeeks.filter((w) => w.quantification_line_id === line.id && w.active);
      return {
        lineId: line.id,
        articuloNumber: art?.number || null,
        description: art?.description || "(provisional)",
        categoryCode: cat?.code || "",
        subcategoryCode: sub?.code || "",
        activeWeeks: new Set(lineWeeks.map((w) => w.week_number)),
      };
    });

    // Calculate total weeks
    let maxWeek = 20;
    for (const row of scheduleRows) {
      for (const w of row.activeWeeks) {
        if (w > maxWeek - 20) maxWeek = w + 20;
      }
    }
    setTotalWeeks(Math.max(maxWeek, 30));
    setRows(scheduleRows);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  async function saveStartDate() {
    if (!startDate) return;
    if (config) {
      await supabase.from("schedule_config").update({ start_date: startDate }).eq("id", config.id);
    } else {
      await supabase.from("schedule_config").insert({ project_id: projectId, start_date: startDate });
    }
    toast.success("Fecha de inicio guardada");
    loadData();
  }

  async function toggleWeek(lineId: string, weekNum: number, forceValue?: boolean) {
    const row = rows.find((r) => r.lineId === lineId);
    if (!row) return;

    const isActive = forceValue !== undefined ? !forceValue : row.activeWeeks.has(weekNum);

    if (isActive) {
      // Delete
      await supabase.from("schedule_weeks").delete()
        .eq("quantification_line_id", lineId)
        .eq("week_number", weekNum);
      row.activeWeeks.delete(weekNum);
    } else {
      // Insert
      await supabase.from("schedule_weeks").upsert({
        quantification_line_id: lineId,
        week_number: weekNum,
        active: true,
      }, { onConflict: "quantification_line_id,week_number" });
      row.activeWeeks.add(weekNum);
    }

    setRows([...rows]);
  }

  function handleMouseDown(lineId: string, weekNum: number) {
    const row = rows.find((r) => r.lineId === lineId);
    if (!row) return;
    setIsDragging(true);
    const newValue = !row.activeWeeks.has(weekNum);
    setDragValue(newValue);
    toggleWeek(lineId, weekNum, newValue);
  }

  function handleMouseEnter(lineId: string, weekNum: number) {
    if (!isDragging) return;
    toggleWeek(lineId, weekNum, dragValue);
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  const getWeekLabel = (weekNum: number) => {
    if (!config?.start_date) return `S${weekNum + 1}`;
    const weekStart = addWeeks(startOfWeek(new Date(config.start_date), { weekStartsOn: 1 }), weekNum);
    return format(weekStart, "dd/MM", { locale: es });
  };

  if (loading) return <div className="animate-pulse h-96 bg-muted rounded-lg" />;

  return (
    <div className="space-y-6" onMouseUp={handleMouseUp}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cronograma</h1>
          <p className="text-muted-foreground">Paso 7: Programa las actividades por semana</p>
        </div>
      </div>

      {/* Start date config */}
      <Card>
        <CardContent className="flex items-end gap-4 pt-6">
          <div className="space-y-2">
            <Label>Fecha de inicio del proyecto</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <Button onClick={saveStartDate} disabled={!startDate}>Guardar fecha</Button>
          {config && <p className="text-sm text-muted-foreground">Inicio: {new Date(config.start_date).toLocaleDateString("es")}</p>}
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Sin actividades</h3>
            <p className="text-muted-foreground">Agrega líneas de cuantificación primero</p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <ScrollArea className="w-full" style={{ maxHeight: "calc(100vh - 350px)" }}>
            <div className="min-w-max select-none">
              {/* Header */}
              <div className="flex border-b bg-muted/50 sticky top-0 z-10">
                <div className="w-64 shrink-0 px-3 py-2 border-r font-medium text-sm">Actividad</div>
                {Array.from({ length: totalWeeks }, (_, i) => (
                  <div key={i} className="w-10 shrink-0 text-center text-[10px] py-2 border-r text-muted-foreground">
                    {getWeekLabel(i)}
                  </div>
                ))}
              </div>
              {/* Rows */}
              {rows.map((row) => (
                <div key={row.lineId} className="flex border-b hover:bg-muted/20">
                  <div className="w-64 shrink-0 px-3 py-1.5 border-r text-sm truncate flex items-center gap-2">
                    <span className="text-muted-foreground font-mono text-xs">{row.subcategoryCode}</span>
                    <span className="truncate">{row.description}</span>
                  </div>
                  {Array.from({ length: totalWeeks }, (_, weekNum) => (
                    <div
                      key={weekNum}
                      className={cn(
                        "w-10 shrink-0 border-r cursor-pointer transition-colors",
                        row.activeWeeks.has(weekNum)
                          ? "bg-primary/80 hover:bg-primary/60"
                          : "hover:bg-muted/40"
                      )}
                      onMouseDown={() => handleMouseDown(row.lineId, weekNum)}
                      onMouseEnter={() => handleMouseEnter(row.lineId, weekNum)}
                      style={{ height: 28 }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
