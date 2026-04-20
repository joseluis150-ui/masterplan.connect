"use client";

import { useState, useRef, useEffect } from "react";
import { getNumberLocale } from "@/lib/utils/number-format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { BookOpen, History, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { CURRENCIES } from "@/lib/constants/units";

export interface PriceRef {
  source: "budget" | "history";
  price: number;
  currency: string;
  // history fields
  supplier?: string;
  date?: string;
  quantity?: number;
  ocNumber?: string;
}

interface Props {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  currency: string;             // Currency of the current OC
  suggestions: PriceRef[];      // From parent — calculated per line
  projectTc?: number;           // Exchange rate for conversion display
  className?: string;
}

function formatCurrency(amount: number, currency: string): string {
  const c = CURRENCIES.find((x) => x.code === currency);
  const symbol = c?.symbol || "";
  return `${symbol} ${amount.toLocaleString(getNumberLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function PriceSuggestionsInput({
  value,
  onChange,
  disabled,
  currency,
  suggestions,
  projectTc,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Split suggestions
  const budget = suggestions.find((s) => s.source === "budget");
  const history = suggestions
    .filter((s) => s.source === "history")
    .slice(0, 8); // top 8 most recent

  const hasSuggestions = budget !== undefined || history.length > 0;

  // Convert a suggestion price into the current OC currency
  function convertTo(sug: PriceRef): number {
    if (sug.currency === currency) return sug.price;
    if (!projectTc || projectTc <= 0) return sug.price;
    // Very simple 2-way conversion via USD
    if (sug.currency === "USD" && currency !== "USD") return sug.price * projectTc;
    if (sug.currency !== "USD" && currency === "USD") return sug.price / projectTc;
    return sug.price;
  }

  function applyPrice(sug: PriceRef) {
    onChange(Math.round(convertTo(sug) * 100) / 100);
    setOpen(false);
    inputRef.current?.blur();
  }

  // Open popover when input gains focus (only if we have suggestions)
  function handleFocus() {
    if (disabled) return;
    if (hasSuggestions) setOpen(true);
  }

  // Close on outside click (Popover handles this automatically via onOpenChange)

  // If nothing to suggest, render a plain input
  if (!hasSuggestions) {
    return (
      <Input
        ref={inputRef}
        className={cn("h-8 text-xs text-right", className)}
        type="number"
        step="any"
        value={value || ""}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    );
  }

  return (
    <div className="relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Input
              ref={inputRef}
              className={cn("h-8 text-xs text-right", className)}
              type="number"
              step="any"
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
              onFocus={handleFocus}
              onClick={(e) => {
                e.stopPropagation();
                if (!disabled && hasSuggestions) setOpen(true);
              }}
            />
          }
        />
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={4}
          className="w-[340px] p-0"
          onClick={(e) => e.stopPropagation()}
        >
          {budget && (
            <div className="px-3 py-2 border-b bg-amber-50/50">
              <div className="flex items-center gap-2 mb-1.5">
                <BookOpen className="h-3 w-3 text-amber-700" />
                <span className="text-[10px] font-mono uppercase tracking-wider text-amber-700 font-medium">
                  Precio de referencia
                </span>
              </div>
              <button
                onClick={() => applyPrice(budget)}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-white transition-colors text-xs"
              >
                <span className="text-muted-foreground">Presupuesto</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold">
                    {formatCurrency(convertTo(budget), currency)}
                  </span>
                  {budget.currency !== currency && (
                    <span className="text-[10px] text-muted-foreground">
                      (de {budget.currency} {budget.price.toLocaleString(getNumberLocale(), { maximumFractionDigits: 2 })})
                    </span>
                  )}
                  <Check className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                </div>
              </button>
            </div>
          )}

          {history.length > 0 && (
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 mb-1.5">
                <History className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground font-medium">
                  Compras anteriores ({history.length})
                </span>
              </div>
              <div className="space-y-0.5">
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => applyPrice(h)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors text-xs text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-[11px]">
                          {h.supplier || "—"}
                        </span>
                        {h.ocNumber && (
                          <span className="text-[9px] font-mono text-muted-foreground shrink-0">
                            {h.ocNumber}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        {h.date && <span>{new Date(h.date).toLocaleDateString("es")}</span>}
                        {h.quantity !== undefined && (
                          <span>· {h.quantity.toLocaleString(getNumberLocale(), { maximumFractionDigits: 2 })} und.</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono font-semibold">
                        {formatCurrency(h.price, h.currency)}
                      </div>
                      {h.currency !== currency && (
                        <div className="text-[9px] text-muted-foreground">
                          ≈ {formatCurrency(convertTo(h), currency)}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t px-3 py-1.5 bg-muted/20">
            <p className="text-[9px] text-muted-foreground font-mono uppercase tracking-wider">
              Click para aplicar · Esc para cerrar
            </p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
