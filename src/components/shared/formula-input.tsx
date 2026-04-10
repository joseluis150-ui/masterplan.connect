"use client";

import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { evaluateFormula } from "@/lib/utils/formula";
import { cn } from "@/lib/utils";

interface FormulaInputProps {
  value: number;
  onValueChange: (value: number) => void;
  className?: string;
  step?: string;
}

export function FormulaInput({ value, onValueChange, className, step = "any" }: FormulaInputProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(value));
  const [preview, setPreview] = useState<number | null>(null);

  function handleFocus() {
    setEditing(true);
    setText(String(value));
    setPreview(null);
  }

  function handleChange(raw: string) {
    setText(raw);
    setPreview(evaluateFormula(raw));
  }

  function handleBlur() {
    setEditing(false);
    const result = evaluateFormula(text);
    if (result != null && result !== value) {
      onValueChange(result);
    }
    setPreview(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    }
    if (e.key === "Escape") {
      setText(String(value));
      setPreview(null);
      setEditing(false);
    }
  }

  const isFormula = editing && preview != null && text.match(/[+\-*/()]/);

  return (
    <div className="relative">
      <Input
        type={editing ? "text" : "number"}
        step={step}
        value={editing ? text : value}
        onFocus={handleFocus}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={cn("text-right font-mono text-sm", className)}
      />
      {isFormula && (
        <div
          className="absolute top-full left-0 mt-1 px-2 py-1 rounded text-xs font-mono z-50 whitespace-nowrap"
          style={{ background: "#0F0F0F", color: "#FACC15" }}
        >
          = {preview}
        </div>
      )}
    </div>
  );
}
