import { describe, expect, it } from "vitest";
import { calculateSaleTotals } from "../src";

describe("calculateSaleTotals", () => {
  it("desglosa impuestos incluidos sin usar punto flotante para dinero", () => {
    const totals = calculateSaleTotals([{
      id: "tacos",
      unitPriceInCents: 1_000,
      modifierTotalInCents: 200,
      quantity: 2,
      taxRateBasisPoints: 1_600,
      taxIncluded: true,
    }]);

    expect(totals).toMatchObject({
      itemTotalInCents: 2_400,
      subtotalInCents: 2_069,
      taxInCents: 331,
      totalInCents: 2_400,
    });
  });

  it("aplica descuentos consecutivos, prorratea centavos y conserva la suma", () => {
    const totals = calculateSaleTotals([
      {
        id: "one",
        unitPriceInCents: 1_000,
        modifierTotalInCents: 0,
        quantity: 1,
        taxRateBasisPoints: 1_600,
        taxIncluded: true,
      },
      {
        id: "two",
        unitPriceInCents: 501,
        modifierTotalInCents: 0,
        quantity: 1,
        taxRateBasisPoints: 1_600,
        taxIncluded: true,
      },
    ], [
      { id: "percent", kind: "discount", calculation: "percentage", value: 1_000 },
      { id: "courtesy", kind: "courtesy", calculation: "fixed", value: 101 },
    ]);

    expect(totals.adjustmentTotalInCents).toBe(251);
    expect(totals.discountInCents).toBe(251);
    expect(totals.totalInCents).toBe(1_250);
    expect(totals.lines.reduce((sum, line) => sum + line.totalInCents, 0)).toBe(1_250);
  });

  it("reduce la base antes de calcular un impuesto excluido", () => {
    const totals = calculateSaleTotals([{
      id: "service",
      unitPriceInCents: 1_000,
      modifierTotalInCents: 0,
      quantity: 1,
      taxRateBasisPoints: 1_600,
      taxIncluded: false,
    }], [{
      id: "discount",
      kind: "discount",
      calculation: "fixed",
      value: 100,
    }]);

    expect(totals).toMatchObject({
      itemTotalInCents: 1_160,
      subtotalInCents: 900,
      taxInCents: 144,
      totalInCents: 1_044,
      discountInCents: 116,
    });
  });
});
