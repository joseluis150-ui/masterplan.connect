import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Config minimalista de Vitest. Sólo se usa para los tests del motor de
 * cálculo del módulo Modelo de Negocio (funciones puras, sin React).
 *
 * Resolve alias `@/` igual que el resto del proyecto Next.js para que los
 * imports en tests funcionen idénticos al runtime.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
