export type SaleAdjustmentKind = "discount" | "courtesy";
export type SaleAdjustmentCalculation = "percentage" | "fixed";

export interface SaleLineInput {
  id: string;
  unitPriceInCents: number;
  modifierTotalInCents: number;
  quantity: number;
  taxRateBasisPoints: number;
  taxIncluded: boolean;
  cancelled?: boolean;
}

export interface SaleAdjustmentInput {
  id: string;
  kind: SaleAdjustmentKind;
  calculation: SaleAdjustmentCalculation;
  value: number;
}

export interface CalculatedSaleLine {
  id: string;
  itemTotalInCents: number;
  adjustmentInCents: number;
  subtotalInCents: number;
  taxInCents: number;
  totalInCents: number;
}

export interface CalculatedSaleAdjustment extends SaleAdjustmentInput {
  appliedInCents: number;
}

export interface SaleTotals {
  itemTotalInCents: number;
  subtotalInCents: number;
  adjustmentTotalInCents: number;
  discountInCents: number;
  taxInCents: number;
  totalInCents: number;
  lines: CalculatedSaleLine[];
  adjustments: CalculatedSaleAdjustment[];
}

const assertInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} debe ser un entero no negativo`);
  }
};

const allocate = (amount: number, balances: number[]): number[] => {
  const available = balances.reduce((total, balance) => total + balance, 0);
  const applied = Math.min(amount, available);
  if (applied === 0 || available === 0) return balances.map(() => 0);

  const shares = balances.map((balance, index) => {
    const exact = applied * balance / available;
    const base = Math.floor(exact);
    return { index, base, remainder: exact - base };
  });
  let remaining = applied - shares.reduce((total, share) => total + share.base, 0);
  shares.sort((left, right) =>
    right.remainder - left.remainder || left.index - right.index,
  );
  for (const share of shares) {
    if (remaining === 0) break;
    if (share.base < balances[share.index]!) {
      share.base += 1;
      remaining -= 1;
    }
  }
  shares.sort((left, right) => left.index - right.index);
  return shares.map((share) => share.base);
};

const taxParts = (
  chargeInCents: number,
  rateBasisPoints: number,
  included: boolean,
): { subtotalInCents: number; taxInCents: number; totalInCents: number } => {
  if (included) {
    const subtotalInCents = Math.round(
      chargeInCents * 10_000 / (10_000 + rateBasisPoints),
    );
    return {
      subtotalInCents,
      taxInCents: chargeInCents - subtotalInCents,
      totalInCents: chargeInCents,
    };
  }

  const taxInCents = Math.round(chargeInCents * rateBasisPoints / 10_000);
  return {
    subtotalInCents: chargeInCents,
    taxInCents,
    totalInCents: chargeInCents + taxInCents,
  };
};

export const calculateSaleTotals = (
  lines: SaleLineInput[],
  adjustments: SaleAdjustmentInput[] = [],
): SaleTotals => {
  const activeLines = lines.filter((line) => !line.cancelled);
  for (const line of activeLines) {
    assertInteger(line.unitPriceInCents, "unitPriceInCents");
    assertInteger(line.modifierTotalInCents, "modifierTotalInCents");
    assertInteger(line.quantity, "quantity");
    assertInteger(line.taxRateBasisPoints, "taxRateBasisPoints");
    if (line.quantity === 0 || line.taxRateBasisPoints > 10_000) {
      throw new TypeError("La cantidad y la tasa de impuesto no son válidas");
    }
  }

  const originalCharges = activeLines.map(
    (line) => (line.unitPriceInCents + line.modifierTotalInCents) * line.quantity,
  );
  const remainingCharges = [...originalCharges];
  const lineAdjustments = activeLines.map(() => 0);
  const calculatedAdjustments: CalculatedSaleAdjustment[] = [];

  for (const adjustment of adjustments) {
    assertInteger(adjustment.value, "adjustment.value");
    if (adjustment.calculation === "percentage" && adjustment.value > 10_000) {
      throw new TypeError("El porcentaje no puede exceder 100%");
    }
    const available = remainingCharges.reduce((total, charge) => total + charge, 0);
    const requested = adjustment.calculation === "percentage"
      ? Math.round(available * adjustment.value / 10_000)
      : adjustment.value;
    const allocations = allocate(requested, remainingCharges);
    const appliedInCents = allocations.reduce((total, allocation) => total + allocation, 0);
    allocations.forEach((allocation, index) => {
      remainingCharges[index] = remainingCharges[index]! - allocation;
      lineAdjustments[index] = lineAdjustments[index]! + allocation;
    });
    calculatedAdjustments.push({ ...adjustment, appliedInCents });
  }

  const calculatedActiveLines = activeLines.map((line, index) => {
    const parts = taxParts(
      remainingCharges[index]!,
      line.taxRateBasisPoints,
      line.taxIncluded,
    );
    const original = taxParts(
      originalCharges[index]!,
      line.taxRateBasisPoints,
      line.taxIncluded,
    );
    return {
      id: line.id,
      itemTotalInCents: original.totalInCents,
      adjustmentInCents: lineAdjustments[index]!,
      ...parts,
    };
  });
  const linesById = new Map(calculatedActiveLines.map((line) => [line.id, line]));
  const calculatedLines = lines.map((line) => linesById.get(line.id) ?? {
    id: line.id,
    itemTotalInCents: 0,
    adjustmentInCents: 0,
    subtotalInCents: 0,
    taxInCents: 0,
    totalInCents: 0,
  });
  const itemTotalInCents = calculatedLines.reduce(
    (total, line) => total + line.itemTotalInCents,
    0,
  );
  const subtotalInCents = calculatedLines.reduce(
    (total, line) => total + line.subtotalInCents,
    0,
  );
  const taxInCents = calculatedLines.reduce(
    (total, line) => total + line.taxInCents,
    0,
  );
  const totalInCents = calculatedLines.reduce(
    (total, line) => total + line.totalInCents,
    0,
  );

  return {
    itemTotalInCents,
    subtotalInCents,
    adjustmentTotalInCents: calculatedAdjustments.reduce(
      (total, adjustment) => total + adjustment.appliedInCents,
      0,
    ),
    discountInCents: itemTotalInCents - totalInCents,
    taxInCents,
    totalInCents,
    lines: calculatedLines,
    adjustments: calculatedAdjustments,
  };
};
