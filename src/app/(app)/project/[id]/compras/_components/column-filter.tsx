"use client";

import { useState, useMemo } from "react";
import { Filter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  values: string[];           // All unique values (raw strings)
  selected: Set<string>;      // Empty set = all selected (no filter)
  onChange: (selected: Set<string>) => void;
  align?: "start" | "center" | "end";
  valueLabels?: Record<string, string>; // Optional display labels
}

export function ColumnFilter({
  label,
  values,
  selected,
  onChange,
  align = "start",
  valueLabels,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const unique = useMemo(() => Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "es")), [values]);

  const filtered = useMemo(() => {
    if (!search.trim()) return unique;
    const q = search.toLowerCase();
    return unique.filter((v) => {
      const label = valueLabels?.[v] || v;
      return label.toLowerCase().includes(q);
    });
  }, [unique, search, valueLabels]);

  const isFiltered = selected.size > 0 && selected.size !== unique.length;

  function toggle(v: string) {
    const next = new Set(selected.size === 0 ? unique : selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    // If all are selected again, treat as "no filter" (empty set)
    if (next.size === unique.length) onChange(new Set());
    else onChange(next);
  }

  function selectAll() {
    onChange(new Set());
  }

  function clearAll() {
    onChange(new Set(["__NONE__"])); // Empty selection = show nothing (single sentinel value)
  }

  function clearFilter() {
    onChange(new Set());
    setSearch("");
  }

  // Display logic: empty set = all selected
  function isChecked(v: string): boolean {
    return selected.size === 0 || selected.has(v);
  }

  return (
    <div className="flex items-center gap-1">
      <span>{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              className={cn(
                "inline-flex items-center justify-center h-5 w-5 rounded hover:bg-muted transition-colors",
                isFiltered && "bg-primary/10"
              )}
              title={`Filtrar ${label}`}
            />
          }
        >
          <Filter
            className={cn(
              "h-3 w-3",
              isFiltered ? "text-primary" : "text-muted-foreground"
            )}
            fill={isFiltered ? "currentColor" : "none"}
          />
        </PopoverTrigger>
        <PopoverContent align={align} className="w-64 p-0">
          <div className="p-2 border-b">
            <div className="flex items-center gap-1">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Input
                placeholder="Buscar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 text-xs border-0 shadow-none focus-visible:ring-0"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between px-2 py-1.5 border-b bg-muted/30">
            <button
              onClick={selectAll}
              className="text-[11px] text-primary hover:underline"
            >
              Seleccionar todo
            </button>
            <button
              onClick={clearAll}
              className="text-[11px] text-muted-foreground hover:underline"
            >
              Quitar todo
            </button>
          </div>
          <div className="max-h-64 overflow-auto p-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Sin resultados</p>
            ) : (
              filtered.map((v) => (
                <label
                  key={v}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer text-xs"
                >
                  <input
                    type="checkbox"
                    checked={isChecked(v)}
                    onChange={() => toggle(v)}
                    className="shrink-0"
                  />
                  <span className="truncate">{valueLabels?.[v] ?? v}</span>
                </label>
              ))
            )}
          </div>
          {isFiltered && (
            <div className="border-t p-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full h-7 text-xs"
                onClick={clearFilter}
              >
                Limpiar filtro
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Helper: given a Set<string> from a ColumnFilter and a list of items,
 * returns whether the item should be visible.
 */
export function matchesColumnFilter(filter: Set<string>, value: string): boolean {
  if (filter.size === 0) return true;               // no filter
  if (filter.has("__NONE__") && filter.size === 1) return false; // "Quitar todo"
  return filter.has(value);
}
