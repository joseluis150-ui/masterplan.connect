"use client";

import { useEffect, useState } from "react";
import { getNumberLocale } from "@/lib/utils/number-format";

/**
 * React hook returning the current display locale ("es" | "en").
 * Re-renders when the preference changes (triggered from Settings page).
 */
export function useNumberLocale(): "es" | "en" {
  const [locale, setLocale] = useState<"es" | "en">(() => getNumberLocale());

  useEffect(() => {
    function handle() {
      setLocale(getNumberLocale());
    }
    window.addEventListener("number-locale-changed", handle);
    window.addEventListener("storage", handle);
    return () => {
      window.removeEventListener("number-locale-changed", handle);
      window.removeEventListener("storage", handle);
    };
  }, []);

  return locale;
}
