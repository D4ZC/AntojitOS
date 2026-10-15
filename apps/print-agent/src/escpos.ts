import type {
  PrintPayload,
  ProductionPayload,
  ReceiptPayload,
  ShiftClosePayload,
} from "./types.js";

const ESC = 0x1b;
const GS = 0x1d;
const encoder = new TextEncoder();

const text = (value: string): Uint8Array => encoder.encode(value);

const money = (cents: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(cents / 100);

const renderProduction = (payload: ProductionPayload): string => {
  const title = payload.kind === "reprint"
    ? "*** REIMPRESION ***"
    : payload.kind === "cancellation"
      ? "*** CANCELACION ***"
      : "*** NUEVA COMANDA ***";
  const lines = [
    title,
    payload.center.name.toUpperCase(),
    `${payload.service.label} · Ronda ${payload.roundSequence}`,
    "--------------------------------",
  ];
  for (const item of payload.items) {
    lines.push(`${item.quantity} x ${item.productName}`);
    for (const modifier of item.modifiers) lines.push(`  > ${modifier}`);
    if (item.note) lines.push(`  NOTA: ${item.note}`);
  }
  lines.push("--------------------------------");
  if (payload.cancellationReason) lines.push(`Motivo: ${payload.cancellationReason}`);
  if (payload.reprint) lines.push(`Motivo: ${payload.reprint.reason}`);
  lines.push(`Ticket: ${payload.ticketId}`, "", "");
  return `${lines.join("\n")}\n`;
};

const renderReceipt = (payload: ReceiptPayload): string => {
  const { receipt } = payload;
  const label = receipt.account.tableName
    ?? receipt.account.reference
    ?? (receipt.account.serviceType === "takeaway" ? "Para llevar" : "Venta rápida");
  const lines = [
    payload.kind === "receipt_reprint" ? "*** REIMPRESION DE TICKET ***" : "ANTOJITOS",
    `Ticket ${receipt.folio}`,
    label,
    new Date(receipt.issuedAt).toLocaleString("es-MX"),
    "--------------------------------",
  ];
  for (const item of receipt.account.items) {
    if (item.preparationState === "cancelled") continue;
    lines.push(`${item.quantity} x ${item.productName}  ${money(item.lineTotalInCents)}`);
  }
  lines.push(
    "--------------------------------",
    `Venta: ${money(receipt.totals.saleInCents)}`,
  );
  if (receipt.totals.tipInCents > 0) {
    lines.push(`Propina: ${money(receipt.totals.tipInCents)}`);
  }
  for (const payment of receipt.payments) {
    lines.push(
      `${payment.method.name}: ${money(payment.totalInCents)}${payment.reference ? ` (${payment.reference})` : ""}`,
    );
  }
  if (receipt.totals.changeInCents > 0) {
    lines.push(`Cambio: ${money(receipt.totals.changeInCents)}`);
  }
  if (payload.reprint) {
    lines.push(
      "--------------------------------",
      `Reimpreso por: ${payload.reprint.requestedBy}`,
      `Motivo: ${payload.reprint.reason}`,
    );
  }
  lines.push("", "Gracias por su visita", "", "");
  return `${lines.join("\n")}\n`;
};

const renderShiftClose = (payload: ShiftClosePayload): string => {
  const { close } = payload;
  const lines = [
    "*** CORTE DE CAJA ***",
    close.report.register.name.toUpperCase(),
    `Apertura: ${new Date(close.report.shift.openedAt).toLocaleString("es-MX")}`,
    `Cierre: ${new Date(close.closedAt).toLocaleString("es-MX")}`,
    "--------------------------------",
    `Tickets: ${close.report.sales.receiptCount}`,
    `Cancelaciones/devoluciones: ${close.report.sales.refundCount}`,
    `Venta bruta: ${money(close.report.sales.grossSaleInCents)}`,
    `Devoluciones: ${money(close.report.sales.refundedSaleInCents)}`,
    `Venta neta: ${money(close.report.sales.netSaleInCents)}`,
    `Propinas: ${money(close.report.sales.tipInCents)}`,
    "--------------------------------",
  ];
  for (const method of close.report.paymentMethods) {
    lines.push(`${method.name}: ${money(method.netInCents)}`);
  }
  lines.push(
    `Efectivo teorico: ${money(close.report.cash.theoreticalInCents)}`,
    "--------------------------------",
  );
  for (const declaration of close.declarations) {
    lines.push(
      `${declaration.method.name} declarado: ${money(declaration.declaredInCents)}`,
      `Diferencia: ${money(declaration.differenceInCents)}`,
    );
  }
  lines.push("", `Corte: ${close.id}`, "", "");
  return `${lines.join("\n")}\n`;
};

export const renderPlainTicket = (payload: PrintPayload): string => {
  if ("receipt" in payload) return renderReceipt(payload);
  if ("close" in payload) return renderShiftClose(payload);
  return renderProduction(payload);
};

export const renderEscPos = (payload: PrintPayload): Uint8Array => {
  const content = text(renderPlainTicket(payload));
  const prefix = Uint8Array.from([
    ESC, 0x40,
    ESC, 0x61, 0x00,
    ESC, 0x45, 0x01,
  ]);
  const suffix = Uint8Array.from([
    ESC, 0x45, 0x00,
    0x0a, 0x0a,
    GS, 0x56, 0x00,
  ]);
  const result = new Uint8Array(prefix.length + content.length + suffix.length);
  result.set(prefix, 0);
  result.set(content, prefix.length);
  result.set(suffix, prefix.length + content.length);
  return result;
};
