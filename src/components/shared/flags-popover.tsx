"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Flag } from "lucide-react";

/** Paleta de banderas para "agrupaciones de revisión".
 *
 * Es compartida entre módulos (cuantificación, artículos, etc.) para que
 * los colores tengan significado consistente en todo el app. La paleta
 * está cerrada — agregar colores requiere coordinar el cambio con todos
 * los lugares que filtran/cuentan banderas.
 */
export const FLAG_COLORS: { id: string; label: string; cls: string; fillCls: string }[] = [
  { id: "amber",  label: "Por revisar",        cls: "text-amber-500",   fillCls: "fill-amber-500" },
  { id: "red",    label: "Urgente / problema", cls: "text-red-600",     fillCls: "fill-red-600" },
  { id: "blue",   label: "Información",        cls: "text-blue-600",    fillCls: "fill-blue-600" },
  { id: "green",  label: "Validado / OK",      cls: "text-emerald-600", fillCls: "fill-emerald-600" },
  { id: "violet", label: "Consultar",          cls: "text-violet-600",  fillCls: "fill-violet-600" },
];

/**
 * Popover de banderas — múltiples colores asignables a una entidad. Click
 * en el ícono abre un menú con los 5 colores predefinidos como toggles.
 * La fila muestra hasta 3 banderitas chicas; si hay más se ve un "+N".
 *
 * Comportamiento idéntico al original de cuantificación.
 */
export function FlagsPopover({
  colors,
  onToggle,
  size = "normal",
}: {
  /** Array de IDs de color activos en la entidad. */
  colors: string[];
  /** Callback al togglear un color. */
  onToggle: (color: string) => void;
  /** Tamaño visual. "compact" para celdas más pequeñas. */
  size?: "normal" | "compact";
}) {
  const [open, setOpen] = useState(false);
  const active = FLAG_COLORS.filter((c) => colors.includes(c.id));
  const visible = active.slice(0, 3);
  const extra = Math.max(0, active.length - 3);
  const iconClass = size === "compact" ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-0 hover:scale-110 transition-transform"
            title={active.length > 0
              ? `Banderas: ${active.map((c) => c.label).join(", ")}`
              : "Marcar con bandera de color"}
          />
        }
      >
        {active.length === 0 ? (
          <Flag className={cn(iconClass, "text-gray-200 hover:text-amber-300")} />
        ) : (
          <div className="inline-flex items-center -space-x-1">
            {visible.map((c) => (
              <Flag key={c.id} className={cn(iconClass, c.cls, c.fillCls)} />
            ))}
            {extra > 0 && (
              <span className="ml-1 text-[9px] font-mono text-muted-foreground">+{extra}</span>
            )}
          </div>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[210px] p-1" align="start">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5 border-b mb-1">
          Banderas
        </p>
        {FLAG_COLORS.map((c) => {
          const isActive = colors.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onToggle(c.id)}
              className={cn(
                "w-full text-left flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors",
                isActive ? "bg-muted" : "hover:bg-muted/50"
              )}
            >
              <Flag className={cn("h-3.5 w-3.5", c.cls, isActive && c.fillCls)} />
              <span className="flex-1">{c.label}</span>
              {isActive && <span className="text-[10px] text-emerald-600">✓</span>}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
