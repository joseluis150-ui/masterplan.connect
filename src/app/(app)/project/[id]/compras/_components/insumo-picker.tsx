"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Search, Plus, Package, Sparkles, Check } from "lucide-react";
import { toast } from "sonner";
import type { Insumo } from "@/lib/types/database";
import { DEFAULT_UNITS, DEFAULT_INSUMO_TYPES } from "@/lib/constants/units";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  insumos: Insumo[];
  selectedInsumoId: string | null;
  onSelect: (insumo: Insumo) => void;
  onInsumoCreated?: (insumo: Insumo) => void; // parent can refresh list
}

export function InsumoPicker({ projectId, insumos, selectedInsumoId, onSelect, onInsumoCreated }: Props) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"pick" | "create">("pick");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // New insumo form state
  const [newDesc, setNewDesc] = useState("");
  const [newUnit, setNewUnit] = useState("U");
  const [newType, setNewType] = useState("material");
  const [newPu, setNewPu] = useState(0);
  const [creating, setCreating] = useState(false);

  const selected = useMemo(
    () => insumos.find((i) => i.id === selectedInsumoId),
    [insumos, selectedInsumoId]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return insumos.slice(0, 100);
    const q = search.toLowerCase();
    return insumos
      .filter(
        (i) =>
          i.description.toLowerCase().includes(q) ||
          String(i.code).includes(q) ||
          (i.family || "").toLowerCase().includes(q)
      )
      .slice(0, 100);
  }, [insumos, search]);

  useEffect(() => {
    if (open && mode === "pick") {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open, mode]);

  function switchToCreate() {
    setNewDesc(search); // carry over search text as new name
    setNewUnit("U");
    setNewType("material");
    setNewPu(0);
    setMode("create");
  }

  async function createAndSelect() {
    if (!newDesc.trim()) {
      toast.error("Descripción es requerida");
      return;
    }
    setCreating(true);
    try {
      // Get next code for this project
      const { data: maxCode } = await supabase
        .from("insumos")
        .select("code")
        .eq("project_id", projectId)
        .order("code", { ascending: false })
        .limit(1)
        .single();
      const nextCode = (maxCode?.code || 0) + 1;

      const { data: newInsumo, error } = await supabase
        .from("insumos")
        .insert({
          project_id: projectId,
          code: nextCode,
          description: newDesc.trim(),
          unit: newUnit,
          type: newType,
          pu_usd: newPu > 0 ? newPu : null,
          origin: "execution",
        })
        .select()
        .single();

      if (error || !newInsumo) {
        toast.error(`Error al crear insumo: ${error?.message}`);
        return;
      }

      toast.success(`Insumo "${newInsumo.description}" creado (ejecución)`);
      onSelect(newInsumo as Insumo);
      if (onInsumoCreated) onInsumoCreated(newInsumo as Insumo);
      setOpen(false);
      setMode("pick");
      setSearch("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setMode("pick"); }}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "w-full h-8 px-2.5 text-xs text-left rounded-md border border-input bg-transparent hover:bg-muted/50 transition-colors flex items-center gap-1.5",
              !selected && "text-muted-foreground"
            )}
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <Package className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate flex-1">
          {selected ? `${selected.code} · ${selected.description}` : "Seleccionar insumo..."}
        </span>
        {selected?.origin === "execution" && (
          <span className="text-[9px] bg-amber-100 text-amber-700 px-1 rounded shrink-0">Nuevo</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[380px] p-0" onClick={(e) => e.stopPropagation()}>
        {mode === "pick" ? (
          <>
            <div className="p-2 border-b">
              <div className="flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Input
                  ref={searchRef}
                  placeholder="Buscar insumo por descripción, código o familia..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-7 text-xs border-0 shadow-none focus-visible:ring-0"
                />
              </div>
            </div>
            <div className="max-h-[300px] overflow-auto">
              {filtered.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-xs text-muted-foreground mb-3">
                    {search ? `Sin resultados para "${search}"` : "No hay insumos en la base"}
                  </p>
                  <Button size="sm" variant="outline" onClick={switchToCreate}>
                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                    Crear nuevo insumo
                  </Button>
                </div>
              ) : (
                <div className="p-1">
                  {filtered.map((ins) => (
                    <button
                      key={ins.id}
                      onClick={() => { onSelect(ins); setOpen(false); }}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-left text-xs transition-colors",
                        selectedInsumoId === ins.id && "bg-primary/5"
                      )}
                    >
                      {selectedInsumoId === ins.id && (
                        <Check className="h-3 w-3 text-primary shrink-0" />
                      )}
                      <span className="text-muted-foreground font-mono w-10 shrink-0">
                        {String(ins.code).padStart(3, "0")}
                      </span>
                      <span className="flex-1 truncate">{ins.description}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{ins.unit}</span>
                      {ins.origin === "execution" && (
                        <span className="text-[9px] bg-amber-100 text-amber-700 px-1 rounded shrink-0">
                          Ejec.
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t p-2">
              <Button
                size="sm"
                variant="outline"
                className="w-full h-7 text-xs justify-center"
                onClick={switchToCreate}
              >
                <Plus className="h-3 w-3 mr-1" />
                Crear insumo nuevo
              </Button>
            </div>
          </>
        ) : (
          <div className="p-3 space-y-2.5">
            <div className="flex items-center gap-2 pb-1 border-b">
              <Sparkles className="h-4 w-4 text-amber-600" />
              <p className="text-xs font-semibold">Nuevo insumo de ejecución</p>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Descripción *</label>
              <Input
                className="h-8 text-xs mt-0.5"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Ej: Cemento Portland 50kg"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Unidad</label>
                <Select value={newUnit} onValueChange={(v) => { if (v) setNewUnit(v); }}>
                  <SelectTrigger className="h-8 text-xs mt-0.5 w-full">
                    <span>{newUnit}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {DEFAULT_UNITS.map((u) => (
                      <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Tipo</label>
                <Select value={newType} onValueChange={(v) => { if (v) setNewType(v); }}>
                  <SelectTrigger className="h-8 text-xs mt-0.5 w-full">
                    <span>{DEFAULT_INSUMO_TYPES.find((t) => t.value === newType)?.label || newType}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {DEFAULT_INSUMO_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Precio referencia USD (opcional)</label>
              <Input
                className="h-8 text-xs mt-0.5"
                type="number"
                value={newPu}
                onChange={(e) => setNewPu(parseFloat(e.target.value) || 0)}
              />
            </div>
            <p className="text-[10px] text-muted-foreground italic">
              Se marcará como insumo de <strong>ejecución</strong> y podrá filtrarse luego en Insumos.
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-7 text-xs"
                onClick={() => setMode("pick")}
                disabled={creating}
              >
                Volver
              </Button>
              <Button
                size="sm"
                className="flex-1 h-7 text-xs"
                onClick={createAndSelect}
                disabled={creating || !newDesc.trim()}
              >
                {creating ? "Creando..." : "Crear y usar"}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
