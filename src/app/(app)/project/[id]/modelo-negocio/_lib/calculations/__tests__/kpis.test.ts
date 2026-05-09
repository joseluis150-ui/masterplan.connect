import { describe, it, expect } from "vitest";
import { calculateIRR, calculateNPV } from "../kpis";

describe("calculateIRR", () => {
  it("cashflow conocido [-100, 50, 50, 50] → ~23.4% mensual", () => {
    const irr = calculateIRR([-100, 50, 50, 50]);
    expect(irr).toBeGreaterThan(0.22);
    expect(irr).toBeLessThan(0.25);
  });

  it("cashflow con TIR exacta 10%", () => {
    // Inversión 100 a 10% por período por 3 períodos hasta recuperar:
    // -100, 0, 0, 100 × (1.1)^3 = 133.1 → TIR = 10%
    const irr = calculateIRR([-100, 0, 0, 133.1]);
    expect(irr).toBeCloseTo(0.1, 3);
  });

  it("retorna NaN si no hay cambio de signo", () => {
    expect(Number.isNaN(calculateIRR([-100, -50, -25]))).toBe(true);
    expect(Number.isNaN(calculateIRR([100, 50, 25]))).toBe(true);
  });

  it("retorna NaN para arrays muy cortos", () => {
    expect(Number.isNaN(calculateIRR([100]))).toBe(true);
  });
});

describe("calculateNPV", () => {
  it("tasa 0 → suma simple", () => {
    expect(calculateNPV([-100, 50, 50, 50], 0)).toBeCloseTo(50, 10);
  });

  it("descuenta correctamente al 10% por período", () => {
    // NPV = -100 + 110/1.1 = -100 + 100 = 0
    expect(calculateNPV([-100, 110], 0.1)).toBeCloseTo(0, 10);
  });

  it("preserva el signo del flujo", () => {
    expect(calculateNPV([100, 50], 0.5)).toBeGreaterThan(0);
    expect(calculateNPV([-100, -50], 0.5)).toBeLessThan(0);
  });
});
