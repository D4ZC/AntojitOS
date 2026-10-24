export const modifierPriceLabel = (
  code: string,
  name: string,
  basePriceInCents: number,
  priceDeltaInCents: number,
): string => {
  if (!/^POZOLE-BOTE-\d+$/.test(code)) return name;
  const totalInCents = basePriceInCents + priceDeltaInCents;
  const amount = totalInCents % 100 === 0
    ? String(totalInCents / 100)
    : (totalInCents / 100).toFixed(2);
  return `Bote de $${amount}`;
};
