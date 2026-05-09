"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Input numérico "humano" para el módulo Modelo de Negocio.
 *
 * Resuelve los issues comunes de `<Input type="number" value={n}>`:
 *
 *  1. Se puede borrar el "0" por completo. Internamente mantenemos el
 *     string que el usuario tipeó; el padre no se entera del valor hasta
 *     que el usuario hace blur.
 *  2. Si el campo es opcional (`required=false`) y el usuario lo deja
 *     vacío al hacer blur, el commit propaga `null`. Si es obligatorio,
 *     vuelve a 0.
 *  3. Soporta `displayMultiplier` para almacenar % como decimales (0.05)
 *     pero mostrarlos como enteros (5). El multiplicador se aplica al
 *     mostrar y se invierte al commitear.
 *  4. Cuando el padre actualiza el `value` externamente (ej. tras un
 *     reload), sólo re-syncroniza si NO estamos en focus — para no
 *     pisar lo que el usuario está tipeando.
 */
export interface NumericInputProps {
  /** Valor controlado del padre. */
  value: number | null | undefined;
  /** Se invoca con el número parseado al hacer blur (o null si vacío y
   *  no required). NO se invoca durante la escritura — sólo en blur. */
  onCommit: (v: number | null) => void;
  /** Si true: al hacer blur con vacío vuelve a 0 (campos obligatorios).
   *  Si false: permite null en DB (campos opcionales). Default: false. */
  required?: boolean;
  /** Multiplicador para display. Ej. 100 para mostrar % como enteros
   *  (stored 0.05 → displayed 5). El commit aplica el inverso. */
  displayMultiplier?: number;
  /** Decimales a mostrar cuando NO está en focus. */
  fractionDigits?: number;
  min?: number;
  max?: number;
  step?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function NumericInput({
  value,
  onCommit,
  required = false,
  displayMultiplier = 1,
  fractionDigits,
  min,
  max,
  step = "any",
  className,
  placeholder,
  disabled,
}: NumericInputProps) {
  const focusedRef = useRef(false);

  function toDisplay(v: number | null | undefined): string {
    if (v == null || Number.isNaN(v)) return "";
    const display = v * displayMultiplier;
    if (fractionDigits != null) return display.toFixed(fractionDigits);
    // Evitar exponentes en valores normales
    return String(Number(display.toPrecision(15)));
  }

  const [text, setText] = useState<string>(toDisplay(value));

  // Sincronizar cuando el valor externo cambia y NO estamos editando.
  // Sin esto, los inputs no se actualizan al recibir nuevos props (ej.
  // tras un reload del escenario activo). Con esto, no pisamos lo que
  // el usuario está tipeando.
  useEffect(() => {
    if (!focusedRef.current) setText(toDisplay(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleBlur() {
    focusedRef.current = false;
    const trimmed = text.trim();

    if (trimmed === "" || trimmed === "-") {
      if (required) {
        onCommit(0);
        setText(toDisplay(0));
      } else {
        onCommit(null);
        setText("");
      }
      return;
    }

    // Aceptamos coma como separador decimal por costumbre regional
    const normalized = trimmed.replace(",", ".");
    const parsed = Number(normalized);
    if (Number.isNaN(parsed)) {
      // Tipeó algo no numérico — restaurar al valor previo
      setText(toDisplay(value));
      return;
    }

    // Aplicar clamp si hay min/max
    let v = parsed / displayMultiplier;
    if (min != null && v < min) v = min;
    if (max != null && v * displayMultiplier > max) v = max / displayMultiplier;

    onCommit(v);
    setText(toDisplay(v));
  }

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        // Enter = blur (commit). Escape = restaurar
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(toDisplay(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
      step={step}
      min={min}
      max={max}
      placeholder={placeholder ?? "0"}
      disabled={disabled}
      className={className}
    />
  );
}
