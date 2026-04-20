"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, Plus, Truck, ChevronDown, Check } from "lucide-react";
import { toast } from "sonner";
import type { Supplier } from "@/lib/types/database";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  /** List of suppliers already loaded by the parent. Must include the full list for the project. */
  suppliers: Supplier[];
  /** Current selection — by id. When null, the picker shows "Seleccionar proveedor". */
  selectedId: string | null;
  onSelect: (s: Supplier) => void;
  /** Parent can refresh its list when a new supplier is created inline. */
  onSupplierCreated?: (s: Supplier) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  /** If true, the input border turns red (e.g. form validation feedback). */
  error?: boolean;
}

export function SupplierPicker({
  projectId,
  suppliers,
  selectedId,
  onSelect,
  onSupplierCreated,
  disabled,
  className,
  placeholder = "Seleccionar proveedor…",
  error,
}: Props) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => suppliers.find((s) => s.id === selectedId) || null,
    [suppliers, selectedId]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return suppliers;
    const q = search.trim().toLowerCase();
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.tax_id || "").toLowerCase().includes(q) ||
        (s.email || "").toLowerCase().includes(q)
    );
  }, [suppliers, search]);

  const exactMatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return suppliers.find((s) => s.name.trim().toLowerCase() === q) || null;
  }, [suppliers, search]);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 40);
    else setSearch("");
  }, [open]);

  async function createAndSelect() {
    const name = search.trim();
    if (!name) {
      toast.error("El nombre no puede estar vacío");
      return;
    }
    if (exactMatch) {
      // Shouldn't reach here because the button is hidden, but belt & suspenders
      onSelect(exactMatch);
      setOpen(false);
      return;
    }
    setCreating(true);
    try {
      const { data, error: insErr } = await supabase
        .from("suppliers")
        .insert({ project_id: projectId, name })
        .select()
        .single();
      if (insErr || !data) {
        // unique_violation (23505) means it already exists (case-insensitive match)
        if (insErr?.code === "23505") {
          // Reload just in case — the parent's list might be stale
          const { data: existing } = await supabase
            .from("suppliers")
            .select("*")
            .eq("project_id", projectId)
            .eq("name_normalized", name.toLowerCase())
            .maybeSingle();
          if (existing) {
            onSelect(existing as Supplier);
            onSupplierCreated?.(existing as Supplier);
            setOpen(false);
            toast.info(`Ya existía "${(existing as Supplier).name}", se seleccionó el existente.`);
            return;
          }
        }
        toast.error(`Error al crear proveedor: ${insErr?.message || "desconocido"}`);
        return;
      }
      const created = data as Supplier;
      onSelect(created);
      onSupplierCreated?.(created);
      setOpen(false);
      toast.success(`Proveedor "${created.name}" creado`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={(v) => !disabled && setOpen(v)}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            className={cn(
              "w-full h-9 px-3 text-sm text-left rounded-md border border-input bg-transparent hover:bg-muted/50 transition-colors flex items-center justify-between font-normal disabled:opacity-50 disabled:cursor-not-allowed",
              !selected && "text-muted-foreground",
              error && "border-destructive/60",
              className
            )}
          />
        }
      >
        <span className="flex items-center gap-2 truncate flex-1 min-w-0">
          <Truck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{selected ? selected.name : placeholder}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
        <div className="border-b px-2 py-2">
          <div className="flex items-center gap-1 border rounded-md px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar o crear proveedor…"
              className="h-8 border-0 px-1 focus-visible:ring-0 focus-visible:ring-offset-0 text-xs"
            />
          </div>
        </div>
        <div className="max-h-[280px] overflow-auto">
          {filtered.length === 0 && !search.trim() && (
            <p className="text-xs text-muted-foreground italic px-3 py-4 text-center">
              No hay proveedores creados. Empezá escribiendo un nombre.
            </p>
          )}
          {filtered.length === 0 && search.trim() && (
            <p className="text-xs text-muted-foreground italic px-3 py-4 text-center">
              Sin resultados para &quot;{search}&quot;.
            </p>
          )}
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onSelect(s);
                setOpen(false);
              }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-xs hover:bg-muted/40 flex items-center gap-2 border-b last:border-b-0",
                s.id === selectedId && "bg-primary/10"
              )}
            >
              {s.id === selectedId ? (
                <Check className="h-3 w-3 text-primary shrink-0" />
              ) : (
                <span className="w-3 shrink-0" />
              )}
              <span className="flex-1 truncate font-medium">{s.name}</span>
              {s.tax_id && (
                <span className="text-[10px] font-mono text-muted-foreground">{s.tax_id}</span>
              )}
            </button>
          ))}
        </div>
        {search.trim() && !exactMatch && (
          <div className="border-t p-1">
            <button
              type="button"
              disabled={creating}
              onClick={createAndSelect}
              className="w-full text-left px-3 py-2 text-xs hover:bg-muted/40 rounded flex items-center gap-2 text-[#B85A0F] font-medium disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {creating ? "Creando…" : `Crear "${search.trim()}"`}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
