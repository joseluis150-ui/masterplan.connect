import { describe, it, expect } from "vitest";
import { generateDistribution } from "../distributions";

const sumOf = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

describe("generateDistribution", () => {
  it("linear: cada elemento = 1/N", () => {
    const d = generateDistribution("linear", 4);
    expect(d).toHaveLength(4);
    expect(d.every((v) => Math.abs(v - 0.25) < 1e-10)).toBe(true);
    expect(sumOf(d)).toBeCloseTo(1, 10);
  });

  it("front_loaded: decreciente, suma 1", () => {
    const d = generateDistribution("front_loaded", 4);
    expect(d).toHaveLength(4);
    expect(d[0]).toBeGreaterThan(d[1]);
    expect(d[1]).toBeGreaterThan(d[2]);
    expect(d[2]).toBeGreaterThan(d[3]);
    expect(sumOf(d)).toBeCloseTo(1, 10);
    // Para N=4 → [0.4, 0.3, 0.2, 0.1]
    expect(d[0]).toBeCloseTo(0.4, 10);
  });

  it("back_loaded: creciente, suma 1", () => {
    const d = generateDistribution("back_loaded", 4);
    expect(d[0]).toBeLessThan(d[3]);
    expect(sumOf(d)).toBeCloseTo(1, 10);
    expect(d[0]).toBeCloseTo(0.1, 10);
  });

  it("s_curve: suma 1, simétrica alrededor del medio", () => {
    const d = generateDistribution("s_curve", 6);
    expect(sumOf(d)).toBeCloseTo(1, 10);
    // El primer y último deberían ser similares (simetría)
    expect(d[0]).toBeCloseTo(d[d.length - 1], 5);
    // El medio debería ser el más alto
    const max = Math.max(...d);
    expect(d[2] === max || d[3] === max).toBe(true);
  });

  it("custom: normaliza pesos arbitrarios", () => {
    const d = generateDistribution("custom", 3, [10, 20, 30]);
    expect(sumOf(d)).toBeCloseTo(1, 10);
    expect(d[0]).toBeCloseTo(10 / 60, 10);
    expect(d[2]).toBeCloseTo(30 / 60, 10);
  });

  it("custom: error si faltan weights o longitud no coincide", () => {
    expect(() => generateDistribution("custom", 3, [1, 2])).toThrow();
    expect(() => generateDistribution("custom", 3)).toThrow();
  });

  it("duration < 1 lanza error", () => {
    expect(() => generateDistribution("linear", 0)).toThrow();
  });

  it("s_curve N=1 devuelve [1]", () => {
    expect(generateDistribution("s_curve", 1)).toEqual([1]);
  });
});
