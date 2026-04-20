"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Search, ChevronDown, X } from "lucide-react";

interface Option {
  value: string;
  label: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  allowEmpty?: boolean;
  emptyValue?: string;
  className?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Seleccionar...",
  emptyLabel,
  allowEmpty = false,
  emptyValue = "",
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const filtered = options.filter(
    (o) =>
      o.label.toLowerCase().includes(search.toLowerCase()) ||
      (o.sublabel && o.sublabel.toLowerCase().includes(search.toLowerCase()))
  );

  const selected = options.find((o) => o.value === value);

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const dropdownHeight = 320;
      // Open upward if not enough space below
      const openUp = spaceBelow < dropdownHeight && rect.top > dropdownHeight;
      setPos({
        top: openUp ? rect.top - dropdownHeight : rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 400),
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
    if (open) {
      updatePosition();
      // Focus search input after position is set
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open, updatePosition]);

  function handleSelect(val: string) {
    onChange(val);
    setOpen(false);
    setSearch("");
  }

  return (
    <div className={cn("relative", className)}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center justify-between w-full h-8 px-2 py-1 text-sm border rounded-md bg-background",
          "hover:border-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-[#E87722] focus:ring-offset-1",
          !selected && "text-muted-foreground"
        )}
        style={{ borderColor: "#CBD5E1" }}
      >
        <span className="truncate text-left flex-1 text-xs">
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground ml-1" />
      </button>

      {/* Portal dropdown */}
      {open && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            className="bg-background border rounded-md shadow-xl"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: pos.width,
              maxHeight: 320,
              zIndex: 9999,
              borderColor: "#E5E5E5",
            }}
          >
            {/* Search input */}
            <div className="p-2 border-b" style={{ borderColor: "#E5E5E5" }}>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  ref={inputRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar..."
                  className="h-8 pl-8 text-sm"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>

            {/* Options list */}
            <div className="overflow-y-auto" style={{ maxHeight: 300 }}>
              {allowEmpty && (
                <button
                  type="button"
                  onClick={() => handleSelect(emptyValue)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm hover:bg-[#F5F5F5] transition-colors",
                    value === emptyValue && "bg-[#DBEAFE] text-[#E87722] font-medium"
                  )}
                >
                  {emptyLabel || "(Ninguno)"}
                </button>
              )}
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-sm text-center text-muted-foreground">
                  Sin resultados para &ldquo;{search}&rdquo;
                </div>
              ) : (
                filtered.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSelect(option.value)}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm hover:bg-[#F5F5F5] transition-colors flex items-center gap-2",
                      value === option.value && "bg-[#DBEAFE] text-[#E87722] font-medium"
                    )}
                  >
                    <span className="flex-1 break-words leading-snug">{option.label}</span>
                    {option.sublabel && (
                      <span className="text-xs text-muted-foreground shrink-0">{option.sublabel}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body
        )
      }
    </div>
  );
}
