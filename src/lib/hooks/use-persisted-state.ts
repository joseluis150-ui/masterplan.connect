"use client";

import * as React from "react";

/**
 * Hook genérico que envuelve `useState` con persistencia automática en
 * localStorage. Misma API que useState; sólo agrega `key` (única por
 * contexto/proyecto) y opcionalmente `toJSON`/`fromJSON` para tipos no
 * JSON-nativos (Set, Map, etc.).
 *
 * Casos típicos:
 *   - Filtros de columna: `usePersistedState<Set<string>>("art:filterUnit:" + projectId, new Set(), SET_OPTS)`
 *   - Toggles UI: `usePersistedState<boolean>("art:showLocal:" + projectId, false)`
 *   - Search text: `usePersistedState<string>("art:search:" + projectId, "")`
 *
 * Si `window` no existe (SSR) o el JSON está corrupto, cae al
 * `defaultValue`. Errores de escritura (cuota llena, modo privado)
 * se ignoran silenciosamente.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  options?: {
    toJSON?: (v: T) => unknown;
    fromJSON?: (raw: unknown) => T;
  },
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const toJSON = options?.toJSON ?? ((v: T) => v);
  const fromJSON = options?.fromJSON ?? ((raw: unknown) => raw as T);

  const [value, _setValue] = React.useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return defaultValue;
      return fromJSON(JSON.parse(raw));
    } catch {
      return defaultValue;
    }
  });

  const setValue: React.Dispatch<React.SetStateAction<T>> = (action) => {
    _setValue((prev) => {
      const next = typeof action === "function"
        ? (action as (p: T) => T)(prev)
        : action;
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(key, JSON.stringify(toJSON(next)));
        } catch {
          /* cuota llena o bloqueado — silencioso */
        }
      }
      return next;
    });
  };

  return [value, setValue];
}

/** Helpers de serialización pre-armados para Set<string>. Re-usable
 *  en toda la app. */
export const SET_PERSIST_OPTS = {
  toJSON: (s: Set<string>) => Array.from(s),
  fromJSON: (raw: unknown) => new Set<string>(Array.isArray(raw) ? (raw as string[]) : []),
};

/** Helpers para SortConfig genérico `{ key: string; dir: "asc"|"desc"|null }`.
 *  Coincide con el shape que usa @/components/shared/column-filter. */
export type SortPersistConfig = { key: string; dir: "asc" | "desc" | null };
export const SORT_PERSIST_OPTS = {
  toJSON: (s: SortPersistConfig) => s,
  fromJSON: (raw: unknown): SortPersistConfig => {
    if (raw && typeof raw === "object" && "key" in raw && "dir" in raw) {
      const r = raw as { key: unknown; dir: unknown };
      const dir: "asc" | "desc" | null = r.dir === "asc" || r.dir === "desc" ? r.dir : null;
      return { key: typeof r.key === "string" ? r.key : "", dir };
    }
    return { key: "", dir: null };
  },
};
