"use client";

import { useEffect } from "react";
import { setNumberLocale } from "@/lib/utils/number-format";

/**
 * Syncs the project's number_format preference into localStorage
 * so client-side formatting helpers pick it up. Renders nothing.
 */
export function NumberLocaleHydrator({ locale }: { locale: "es" | "en" }) {
  useEffect(() => {
    setNumberLocale(locale);
  }, [locale]);
  return null;
}
