"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ListFilter, Search, X, ArrowUpNarrowWide, ArrowDownWideNarrow } from "lucide-react";

export type SortDirection = "asc" | "desc" | null;

interface ColumnFilterProps {
  /** All unique values for this column */
  values: string[];
  /** Currently active (selected) values — if empty, means "all" */
  activeValues: Set<string>;
  /** Called when filter changes */
  onChange: (values: Set<string>) => void;
  /** Column label for the header */
  label: string;
  /** Alignment */
  align?: "left" | "center" | "right";
  /** Current sort direction for this column */
  sortDirection?: SortDirection;
  /** Called when sort changes */
  onSort?: (direction: SortDirection) => void;
  className?: string;
}

export function ColumnFilter({
  values,
  activeValues,
  onChange,
  label,
  align = "left",
  sortDirection,
  onSort,
  className,
}: ColumnFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const isFiltered = activeValues.size > 0 && activeValues.size < values.length;
  const isSorted = sortDirection != null;
  const isActive = isFiltered || isSorted;

  const sortedValues = [...values].sort((a, b) => a.localeCompare(b, "es"));
  const filteredValues = sortedValues.filter((v) =>
    v.toLowerCase().includes(search.toLowerCase())
  );

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const dropdownHeight = 360;
      const openUp = spaceBelow < dropdownHeight && rect.top > dropdownHeight;
      setPos({
        top: openUp ? rect.top - dropdownHeight : rect.bottom + 4,
        left: Math.min(rect.left, window.innerWidth - 240),
      });
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setSearch("");
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("scroll", updatePosition, true);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        window.removeEventListener("scroll", updatePosition, true);
      };
    }
  }, [open, updatePosition]);

  useEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  function toggleValue(val: string) {
    const next = new Set(activeValues);
    if (activeValues.size === 0) {
      for (const v of values) {
        if (v !== val) next.add(v);
      }
    } else if (next.has(val)) {
      next.delete(val);
      if (next.size === 0) {
        onChange(new Set());
        return;
      }
    } else {
      next.add(val);
      if (next.size === values.length) {
        onChange(new Set());
        return;
      }
    }
    onChange(next);
  }

  function selectAll() {
    onChange(new Set());
  }

  function deselectAll() {
    onChange(new Set(["__none__"]));
  }

  function isChecked(val: string) {
    return activeValues.size === 0 || activeValues.has(val);
  }

  function handleSort(dir: SortDirection) {
    if (!onSort) return;
    onSort(sortDirection === dir ? null : dir);
    setOpen(false);
    setSearch("");
  }

  const alignClass = align === "right" ? "text-right justify-end" : align === "center" ? "text-center justify-center" : "text-left justify-start";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className={cn(
          "flex items-center gap-1 w-full group cursor-pointer select-none",
          alignClass,
          className
        )}
      >
        <span className="uppercase text-[11px] font-semibold tracking-wider">{label}</span>
        {isSorted ? (
          sortDirection === "asc" ? (
            <ArrowUpNarrowWide className="h-3 w-3 shrink-0 text-[#E87722]" />
          ) : (
            <ArrowDownWideNarrow className="h-3 w-3 shrink-0 text-[#E87722]" />
          )
        ) : (
          <ListFilter
            className={cn(
              "h-3 w-3 shrink-0 transition-colors",
              isFiltered
                ? "text-[#E87722]"
                : "text-muted-foreground/40 group-hover:text-muted-foreground"
            )}
          />
        )}
      </button>

      {open && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            className="bg-background border rounded-md shadow-xl"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: 230,
              maxHeight: 360,
              zIndex: 9999,
              borderColor: "#E5E5E5",
            }}
          >
            {/* Sort options */}
            {onSort && (
              <div className="border-b" style={{ borderColor: "#E5E5E5" }}>
                <button
                  type="button"
                  onClick={() => handleSort("asc")}
                  className={cn(
                    "flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[#F5F5F5] transition-colors",
                    sortDirection === "asc" && "bg-[#EFF6FF] font-medium text-[#E87722]"
                  )}
                >
                  <ArrowUpNarrowWide className="h-3.5 w-3.5" />
                  Ordenar A → Z / Menor → Mayor
                </button>
                <button
                  type="button"
                  onClick={() => handleSort("desc")}
                  className={cn(
                    "flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[#F5F5F5] transition-colors",
                    sortDirection === "desc" && "bg-[#EFF6FF] font-medium text-[#E87722]"
                  )}
                >
                  <ArrowDownWideNarrow className="h-3.5 w-3.5" />
                  Ordenar Z → A / Mayor → Menor
                </button>
              </div>
            )}

            {values.length > 0 && <>
            {/* Search */}
            {values.length > 8 && (
              <div className="p-2 border-b" style={{ borderColor: "#E5E5E5" }}>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar..."
                    className="h-7 pl-7 text-xs"
                    autoFocus
                  />
                  {search && (
                    <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2">
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Select all / none */}
            <div className="flex gap-2 px-3 py-1.5 border-b text-[11px]" style={{ borderColor: "#E5E5E5" }}>
              <button
                type="button"
                onClick={selectAll}
                className="text-[#E87722] hover:underline font-medium"
              >
                Todos
              </button>
              <span className="text-muted-foreground">|</span>
              <button
                type="button"
                onClick={deselectAll}
                className="text-[#E87722] hover:underline font-medium"
              >
                Ninguno
              </button>
              {isFiltered && (
                <>
                  <span className="text-muted-foreground">|</span>
                  <button
                    type="button"
                    onClick={selectAll}
                    className="text-destructive hover:underline font-medium"
                  >
                    Limpiar
                  </button>
                </>
              )}
            </div>

            {/* Values list */}
            <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
              {filteredValues.length === 0 ? (
                <div className="px-3 py-4 text-xs text-center text-muted-foreground">
                  Sin resultados
                </div>
              ) : (
                filteredValues.map((val) => (
                  <label
                    key={val}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[#F5F5F5] cursor-pointer transition-colors",
                      isChecked(val) && isFiltered && "bg-[#EFF6FF]"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked(val)}
                      onChange={() => toggleValue(val)}
                      className="h-3.5 w-3.5 rounded accent-[#E87722] cursor-pointer"
                    />
                    <span className="truncate flex-1" title={val}>{val || "(Vacío)"}</span>
                  </label>
                ))
              )}
            </div>
            </>}
          </div>,
          document.body
        )
      }
    </>
  );
}
