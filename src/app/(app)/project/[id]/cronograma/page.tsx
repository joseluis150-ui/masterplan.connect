"use client";

import { useEffect, useState, useCallback, use, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Articulo, EdtCategory, EdtSubcategory } from "@/lib/types/database";
import { Calendar, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { addWeeks, startOfWeek, format } from "date-fns";
import { es } from "date-fns/locale";

interface ScheduleLine {
  lineId: string;
  articuloId: string | null;
  articuloNumber: number | null;
  articuloDesc: string;
  articuloUnit: string;
  categoryId: string;
  subcategoryId: string;
  activeWeeks: Set<number>;
}

interface SubcategoryGroup {
  id: string;
  code: string;
  name: string;
  lines: ScheduleLine[];
}

interface CategoryGroup {
  id: string;
  code: string;
  name: string;
  subcategories: SubcategoryGroup[];
}

export default function CronogramaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [configId, setConfigId] = useState<string | null>(null);
  const [configStartDate, setConfigStartDate] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState(true);
  // Collapse state
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [collapsedSubs, setCollapsedSubs] = useState<Set<string>>(new Set());
  const supabase = createClient();

  const loadData = useCallback(async () => {
    const [configRes, linesRes, artsRes, catsRes, subsRes, weeksRes] = await Promise.all([
      supabase.from("schedule_config").select("*").eq("project_id", projectId).single(),
      supabase.from("quantification_lines").select("*").eq("project_id", projectId).is("deleted_at", null).order("line_number"),
      supabase.from("articulos").select("*").eq("project_id", projectId),
      supabase.from("edt_categories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("edt_subcategories").select("*").eq("project_id", projectId).is("deleted_at", null).order("order"),
      supabase.from("schedule_weeks").select("*"),
    ]);

    if (configRes.data) {
      setConfigId(configRes.data.id);
      setStartDate(configRes.data.start_date);
      setConfigStartDate(configRes.data.start_date);
    }

    const arts = (artsRes.data || []) as Articulo[];
    const cats = (catsRes.data || []) as EdtCategory[];
    const subs = (subsRes.data || []) as EdtSubcategory[];
    const lines = linesRes.data || [];
    const weeks = weeksRes.data || [];

    const lineIds = new Set(lines.map((l: { id: string }) => l.id));
    const projectWeeks = weeks.filter((w: { quantification_line_id: string }) => lineIds.has(w.quantification_line_id));

    // Build schedule lines
    const scheduleLines: ScheduleLine[] = lines.map((line: Record<string, unknown>) => {
      const art = arts.find((a) => a.id === line.articulo_id);
      const lineWeeks = projectWeeks.filter(
        (w: { quantification_line_id: string; active: boolean; week_number: number }) =>
          w.quantification_line_id === line.id && w.active
      );
      return {
        lineId: line.id as string,
        articuloId: (line.articulo_id as string) || null,
        articuloNumber: art?.number || null,
        articuloDesc: art?.description || "(provisional)",
        articuloUnit: art?.unit || "",
        categoryId: line.category_id as string,
        subcategoryId: line.subcategory_id as string,
        activeWeeks: new Set(lineWeeks.map((w: { week_number: number }) => w.week_number)),
      };
    });

    // Group by category → subcategory
    const catGroups: CategoryGroup[] = cats.map((cat) => {
      const catSubs = subs.filter((s) => s.category_id === cat.id);
      const subcategoryGroups: SubcategoryGroup[] = catSubs
        .map((sub) => ({
          id: sub.id,
          code: sub.code,
          name: sub.name,
          lines: scheduleLines.filter((l) => l.subcategoryId === sub.id),
        }))
        .filter((sg) => sg.lines.length > 0);

      return {
        id: cat.id,
        code: cat.code,
        name: cat.name,
        subcategories: subcategoryGroups,
      };
    }).filter((cg) => cg.subcategories.length > 0);

    setGroups(catGroups);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Reactive: always keep at least 10 empty columns beyond the last active week
  const totalWeeks = useMemo(() => {
    let maxActiveWeek = -1;
    for (const cat of groups) {
      for (const sub of cat.subcategories) {
        for (const line of sub.lines) {
          for (const w of line.activeWeeks) {
            if (w > maxActiveWeek) maxActiveWeek = w;
          }
        }
      }
    }
    // At least 10 empty columns after the last active, minimum 30 total
    return Math.max(maxActiveWeek + 11, 30);
  }, [groups]);

  async function saveStartDate() {
    if (!startDate) return;
    if (configId) {
      await supabase.from("schedule_config").update({ start_date: startDate }).eq("id", configId);
    } else {
      await supabase.from("schedule_config").insert({ project_id: projectId, start_date: startDate });
    }
    toast.success("Fecha de inicio guardada");
    loadData();
  }

  async function toggleWeek(lineId: string, weekNum: number, forceValue?: boolean) {
    // Find the line in groups
    let targetLine: ScheduleLine | undefined;
    for (const cat of groups) {
      for (const sub of cat.subcategories) {
        const found = sub.lines.find((l) => l.lineId === lineId);
        if (found) { targetLine = found; break; }
      }
      if (targetLine) break;
    }
    if (!targetLine) return;

    const isActive = forceValue !== undefined ? !forceValue : targetLine.activeWeeks.has(weekNum);

    if (isActive) {
      await supabase.from("schedule_weeks").delete()
        .eq("quantification_line_id", lineId)
        .eq("week_number", weekNum);
      targetLine.activeWeeks.delete(weekNum);
    } else {
      await supabase.from("schedule_weeks").upsert({
        quantification_line_id: lineId,
        week_number: weekNum,
        active: true,
      }, { onConflict: "quantification_line_id,week_number" });
      targetLine.activeWeeks.add(weekNum);
    }

    setGroups([...groups]);
  }

  function handleMouseDown(lineId: string, weekNum: number) {
    let targetLine: ScheduleLine | undefined;
    for (const cat of groups) {
      for (const sub of cat.subcategories) {
        const found = sub.lines.find((l) => l.lineId === lineId);
        if (found) { targetLine = found; break; }
      }
      if (targetLine) break;
    }
    if (!targetLine) return;
    setIsDragging(true);
    const newValue = !targetLine.activeWeeks.has(weekNum);
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

  function toggleCat(catId: string) {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  }

  function toggleSub(subId: string) {
    setCollapsedSubs((prev) => {
      const next = new Set(prev);
      if (next.has(subId)) next.delete(subId); else next.add(subId);
      return next;
    });
  }

  function collapseAll() {
    setCollapsedCats(new Set(groups.map((g) => g.id)));
  }

  function expandAll() {
    setCollapsedCats(new Set());
    setCollapsedSubs(new Set());
  }

  const getWeekLabel = (weekNum: number) => {
    if (!configStartDate) return `S${weekNum + 1}`;
    const weekStart = addWeeks(startOfWeek(new Date(configStartDate), { weekStartsOn: 1 }), weekNum);
    return format(weekStart, "dd/MM", { locale: es });
  };

  // Check if a category or subcategory has any active weeks (for summary bar)
  function getGroupActiveWeeks(lines: ScheduleLine[]): Set<number> {
    const result = new Set<number>();
    for (const line of lines) {
      for (const w of line.activeWeeks) result.add(w);
    }
    return result;
  }

  const totalLines = groups.reduce((sum, g) => sum + g.subcategories.reduce((s2, sg) => s2 + sg.lines.length, 0), 0);

  if (loading) return <div className="animate-pulse h-96 bg-muted rounded-lg" />;

  return (
    <div className="space-y-6" onMouseUp={handleMouseUp}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cronograma</h1>
          <p className="text-muted-foreground">Paso 7: Programa las actividades por semana</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={expandAll}>Expandir todo</Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>Colapsar todo</Button>
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
          {configStartDate && <p className="text-sm text-muted-foreground">Inicio: {new Date(configStartDate).toLocaleDateString("es")}</p>}
        </CardContent>
      </Card>

      {totalLines === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Sin actividades</h3>
            <p className="text-muted-foreground">Agrega líneas de cuantificación primero</p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
            <div className="min-w-max select-none">
              {/* Header */}
              <div className="flex border-b sticky top-0 z-20" style={{ background: "#F5F5F5" }}>
                <div className="w-80 shrink-0 px-3 py-2 border-r font-semibold text-xs uppercase tracking-wider sticky left-0 z-30" style={{ background: "#F5F5F5" }}>
                  Actividad
                </div>
                {Array.from({ length: totalWeeks }, (_, i) => (
                  <div key={i} className="w-9 shrink-0 text-center text-[9px] py-2 border-r text-muted-foreground font-medium">
                    {getWeekLabel(i)}
                  </div>
                ))}
              </div>

              {/* Groups */}
              {groups.map((cat) => {
                const catCollapsed = collapsedCats.has(cat.id);
                const catAllLines = cat.subcategories.flatMap((sg) => sg.lines);
                const catActiveWeeks = getGroupActiveWeeks(catAllLines);

                return (
                  <div key={cat.id}>
                    {/* Category row */}
                    <div
                      className="flex border-b cursor-pointer hover:bg-muted/30"
                      style={{ background: "#E8EDF5" }}
                      onClick={() => toggleCat(cat.id)}
                    >
                      <div className="w-80 shrink-0 px-3 py-1.5 border-r flex items-center gap-2 sticky left-0 z-10" style={{ background: "#E8EDF5" }}>
                        {catCollapsed
                          ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        }
                        <span className="font-mono text-xs font-bold" style={{ color: "#1E3A8A" }}>{cat.code}</span>
                        <span className="text-sm font-semibold truncate">{cat.name}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                          {catAllLines.length} líneas
                        </span>
                      </div>
                      {/* Summary bar for collapsed category */}
                      {Array.from({ length: totalWeeks }, (_, weekNum) => (
                        <div
                          key={weekNum}
                          className={cn(
                            "w-9 shrink-0 border-r",
                            catActiveWeeks.has(weekNum) ? "bg-[#1E3A8A]/20" : ""
                          )}
                          style={{ height: 28 }}
                        />
                      ))}
                    </div>

                    {/* Subcategories */}
                    {!catCollapsed && cat.subcategories.map((sub) => {
                      const subCollapsed = collapsedSubs.has(sub.id);
                      const subActiveWeeks = getGroupActiveWeeks(sub.lines);

                      return (
                        <div key={sub.id}>
                          {/* Subcategory row */}
                          <div
                            className="flex border-b cursor-pointer hover:bg-muted/20"
                            style={{ background: "#F3F4F6" }}
                            onClick={() => toggleSub(sub.id)}
                          >
                            <div className="w-80 shrink-0 px-3 py-1 border-r flex items-center gap-2 pl-8 sticky left-0 z-10" style={{ background: "#F3F4F6" }}>
                              {subCollapsed
                                ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              }
                              <span className="font-mono text-[11px] font-medium text-muted-foreground">{sub.code}</span>
                              <span className="text-xs font-medium truncate">{sub.name}</span>
                              <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                                {sub.lines.length}
                              </span>
                            </div>
                            {Array.from({ length: totalWeeks }, (_, weekNum) => (
                              <div
                                key={weekNum}
                                className={cn(
                                  "w-9 shrink-0 border-r",
                                  subActiveWeeks.has(weekNum) ? "bg-[#1E3A8A]/15" : ""
                                )}
                                style={{ height: 24 }}
                              />
                            ))}
                          </div>

                          {/* Lines */}
                          {!subCollapsed && sub.lines.map((line) => (
                            <div key={line.lineId} className="flex border-b hover:bg-muted/10">
                              <div className="w-80 shrink-0 px-3 py-1 border-r flex items-center gap-2 pl-14 sticky left-0 z-10 bg-background">
                                {line.articuloNumber && (
                                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">#{line.articuloNumber}</span>
                                )}
                                <span className="text-xs truncate" title={line.articuloDesc}>{line.articuloDesc}</span>
                                {line.articuloUnit && (
                                  <span className="text-[10px] text-muted-foreground shrink-0">{line.articuloUnit}</span>
                                )}
                              </div>
                              {Array.from({ length: totalWeeks }, (_, weekNum) => (
                                <div
                                  key={weekNum}
                                  className={cn(
                                    "w-9 shrink-0 border-r cursor-pointer transition-colors",
                                    line.activeWeeks.has(weekNum)
                                      ? "bg-[#1E3A8A] hover:bg-[#1E3A8A]/70"
                                      : "hover:bg-muted/40"
                                  )}
                                  onMouseDown={() => handleMouseDown(line.lineId, weekNum)}
                                  onMouseEnter={() => handleMouseEnter(line.lineId, weekNum)}
                                  style={{ height: 24 }}
                                />
                              ))}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
