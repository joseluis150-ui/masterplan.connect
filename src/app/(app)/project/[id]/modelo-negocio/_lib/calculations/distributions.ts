/**
 * Curvas de distribución para costos de construcción.
 *
 * Cada función devuelve un array de N valores que SUMA ≈ 1, donde el
 * elemento i es la fracción del total que se desembolsa en el período
 * relativo i (0..N-1) desde el inicio del rubro.
 *
 * Funciones puras (sin side effects, sin dependencias). Testeadas en
 * __tests__/distributions.test.ts.
 */

import type { DistributionCurve } from "../types";

/** Distribución lineal: cada período recibe 1/N del total. */
function linear(duration: number): number[] {
  return Array(duration).fill(1 / duration);
}

/** Frente cargado: pesos linealmente decrecientes [N, N-1, ..., 1] normalizados.
 *  Ej. N=4 → [0.40, 0.30, 0.20, 0.10]. */
function frontLoaded(duration: number): number[] {
  const weights = Array.from({ length: duration }, (_, i) => duration - i);
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
}

/** Atrás cargado: pesos linealmente crecientes [1, 2, ..., N] normalizados.
 *  Ej. N=4 → [0.10, 0.20, 0.30, 0.40]. */
function backLoaded(duration: number): number[] {
  const weights = Array.from({ length: duration }, (_, i) => i + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
}

/** Curva S (sigmoidea): lenta-rápida-lenta. Útil para construcción típica
 *  donde los primeros y últimos meses son menos intensos.
 *
 *  Implementación: muestreamos la sigmoide logística en N+1 puntos
 *  equiespaciados sobre [-6, 6], tomamos las diferencias entre puntos
 *  consecutivos (cumulative → increments), y normalizamos.  */
function sCurve(duration: number): number[] {
  if (duration === 1) return [1];
  // Puntos N+1 sobre la sigmoide → da N incrementos
  const points = Array.from({ length: duration + 1 }, (_, i) => {
    const x = (i / duration) * 12 - 6; // -6..6
    return 1 / (1 + Math.exp(-x));
  });
  const increments = points.slice(1).map((p, i) => p - points[i]);
  const total = increments.reduce((a, b) => a + b, 0);
  return increments.map((v) => v / total);
}

/** Distribución custom: el usuario pasa pesos arbitrarios; los
 *  normalizamos para que sumen 1. Si no matchea la duración, error. */
function custom(duration: number, weights: number[]): number[] {
  if (weights.length !== duration) {
    throw new Error(`Custom distribution: esperaba ${duration} valores, recibió ${weights.length}`);
  }
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    throw new Error("Custom distribution: la suma de pesos debe ser > 0");
  }
  return weights.map((v) => v / total);
}

/**
 * API pública. Genera la distribución según la curva indicada.
 *
 * @param curve     Tipo de curva
 * @param duration  Cantidad de períodos (debe ser >= 1)
 * @param customWeights  Sólo necesario cuando curve === "custom"
 * @returns Array de N valores que suman ≈ 1
 */
export function generateDistribution(
  curve: DistributionCurve,
  duration: number,
  customWeights?: number[] | null,
): number[] {
  if (duration < 1) {
    throw new Error(`Duration debe ser >= 1, recibido ${duration}`);
  }
  switch (curve) {
    case "linear": return linear(duration);
    case "front_loaded": return frontLoaded(duration);
    case "back_loaded": return backLoaded(duration);
    case "s_curve": return sCurve(duration);
    case "custom": {
      if (!customWeights || customWeights.length === 0) {
        throw new Error("Custom distribution: se requieren weights");
      }
      return custom(duration, customWeights);
    }
  }
}
