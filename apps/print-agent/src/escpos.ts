import type { PrintPayload, ProductionPayload, ReceiptPayload, ShiftClosePayload } from "./types.js";

const ESC = 0x1b;
const GS = 0x1d;
// SRP-F310: ESC t 19 selects PC858, a single-byte table with Spanish and euro.
const CP858 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00ad±‗¾¶§÷¸°¨·¹³²■\u00a0";
const characterBytes = new Map(Array.from(CP858, (character, index) => [character, index + 128]));

export interface TicketOptions {
  columns?: number;
  encoding?: "cp858";
  codePage?: number;
}

const columnsFor = (options: TicketOptions): number => {
  const columns = options.columns ?? 42;
  if (!Number.isInteger(columns) || columns < 24 || columns > 56) throw new Error("El ancho del ticket debe tener entre 24 y 56 columnas");
  if (options.encoding !== undefined && options.encoding !== "cp858") throw new Error("La codificación del ticket debe ser cp858");
  return columns;
};

// Notes and names must never introduce printer commands or bidi controls.
const clean = (value: string): string => Array.from(value.normalize("NFC")
  .replace(/\r\n?/g, "\n").replace(/\t/g, " ")
  .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, "")
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "..."),
  (character) => character === "\n" || (character.charCodeAt(0) >= 32 && character.charCodeAt(0) < 127)
    || characterBytes.has(character) ? character : "?").join("");

export const encodeCp858 = (value: string): Uint8Array => Uint8Array.from(Array.from(clean(value),
  (character) => characterBytes.get(character) ?? character.charCodeAt(0)));

const money = (cents: number): string => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN",
}).format(cents / 100);

const date = (value: string): string => new Date(value).toLocaleString("es-MX", {
  timeZone: "America/Mexico_City", hour12: false,
});

const wrap = (value: string, width: number): string[] => clean(value).split("\n").flatMap((paragraph) => {
  const lines: string[] = [];
  let remaining = paragraph.trim().replace(/ +/g, " ");
  while (remaining.length > width) {
    const space = remaining.lastIndexOf(" ", width);
    const end = space > 0 ? space : width;
    lines.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  lines.push(remaining);
  return lines;
});

const layout = (columns: number) => ({
  rule: "-".repeat(columns),
  text: (value: string, indent = 0): string[] => wrap(value, columns - indent).map((line) => " ".repeat(indent) + line),
  center: (value: string): string[] => wrap(value, columns).map((line) => " ".repeat(Math.floor((columns - line.length) / 2)) + line),
  pair: (label: string, value: string): string[] => {
    const right = clean(value).replace(/\n/g, " ");
    if (right.length >= columns) return [...wrap(label, columns), ...wrap(right, columns)];
    const left = wrap(label, columns - right.length - 1);
    const last = left.pop() ?? "";
    return [...left, last + " ".repeat(columns - last.length - right.length) + right];
  },
});

const renderProduction = (payload: ProductionPayload, columns: number): string[] => {
  const page = layout(columns);
  const title = payload.kind === "reprint" ? "*** REIMPRESION ***"
    : payload.kind === "cancellation" ? "*** CANCELACION ***"
      : payload.kind === "note_update" ? "*** ACTUALIZACION DE NOTA ***" : "*** NUEVA COMANDA ***";
  const lines = [
    ...page.center(title),
    ...(payload.kind === "reprint" && payload.cancellationReason ? page.center("*** CANCELACION ***") : []),
    ...(payload.kind === "note_update" ? page.center("NO PREPARAR DE NUEVO") : []),
    ...page.center(payload.center.name.toUpperCase()),
    ...page.text(`${payload.service.label} · Ronda ${payload.roundSequence}`), page.rule,
  ];
  for (const item of payload.items) {
    lines.push(...page.text(`${item.quantity} x ${item.productName}`));
    for (const modifier of item.modifiers) lines.push(...page.text(`> ${modifier}`, 2));
    if (item.note) lines.push(...page.text(`NOTA: ${item.note}`, 2));
    else if (payload.kind === "note_update") lines.push(...page.text("NOTA: Sin observaciones", 2));
  }
  lines.push(page.rule);
  if (payload.cancellationReason) lines.push(...page.text(`Motivo: ${payload.cancellationReason}`));
  if (payload.reprint) lines.push(...page.text(`Motivo: ${payload.reprint.reason}`));
  lines.push(...page.text(`Ticket: ${payload.ticketId}`));
  return lines;
};

const renderReceipt = (payload: ReceiptPayload, columns: number): string[] => {
  const { receipt } = payload;
  const page = layout(columns);
  const label = receipt.account.tableName || receipt.account.reference
    || (receipt.account.serviceType === "takeaway" ? "Para llevar" : "Venta rápida");
  const lines = [
    ...page.center("ANTOJITOS"),
    ...(payload.kind === "receipt_reprint" ? page.center("*** REIMPRESION DE TICKET ***") : []),
    ...(payload.receiptStatus === "cancelled" ? page.center("*** TICKET CANCELADO ***") : []),
    ...(payload.receiptStatus === "refunded" ? page.center("*** TICKET REEMBOLSADO ***") : []),
    ...page.center(`Ticket ${receipt.folio}`), ...page.center(label), ...page.center(date(receipt.issuedAt)),
    ...(receipt.account.customerName ? page.text(`Cliente: ${receipt.account.customerName}`) : []),
    page.rule, ...page.pair("CANT. PRODUCTO", "IMPORTE"), page.rule,
  ];
  for (const item of receipt.account.items) {
    if (item.preparationState === "cancelled") continue;
    lines.push(...page.pair(`${item.quantity} x ${item.productName}`, money(item.lineTotalInCents)));
    for (const modifier of item.modifiers ?? []) {
      lines.push(...page.text(`> ${modifier.name}${modifier.quantity > 1 ? ` x${modifier.quantity}` : ""}`, 2));
    }
    if (item.note) lines.push(...page.text(`NOTA: ${item.note}`, 2));
  }
  lines.push(page.rule);
  const accountTotals = receipt.account.totals;
  if (accountTotals) {
    if (accountTotals.discountInCents > 0) lines.push(...page.pair("Descuento aplicado", money(accountTotals.discountInCents)));
    lines.push(...page.pair("Subtotal sin impuestos", money(accountTotals.subtotalInCents)),
      ...page.pair("Impuestos", money(accountTotals.taxInCents)));
  }
  lines.push(...page.pair("Venta", money(receipt.totals.saleInCents)));
  if (receipt.totals.tipInCents > 0) lines.push(...page.pair("Propina", money(receipt.totals.tipInCents)));
  lines.push(...page.pair("TOTAL", money(receipt.totals.collectedInCents ?? receipt.totals.saleInCents + receipt.totals.tipInCents)), page.rule);
  for (const payment of receipt.payments) {
    lines.push(...page.pair(payment.method.name, money(payment.totalInCents)));
    if (payment.reference) lines.push(...page.text(`Referencia: ${payment.reference}`, 2));
    if (payment.tenderedInCents != null) lines.push(...page.pair("Recibido", money(payment.tenderedInCents)));
  }
  if (receipt.totals.changeInCents > 0) lines.push(...page.pair("Cambio", money(receipt.totals.changeInCents)));
  if (payload.reprint) lines.push(page.rule, ...page.text(`Reimpreso por: ${payload.reprint.requestedBy}`), ...page.text(`Motivo: ${payload.reprint.reason}`));
  lines.push("", ...page.center("Gracias por su visita"));
  return lines;
};

const renderShiftClose = (payload: ShiftClosePayload, columns: number): string[] => {
  const { close } = payload;
  const page = layout(columns);
  const lines = [...page.center("*** CORTE DE CAJA ***"), ...page.center(close.report.register.name.toUpperCase()),
    ...page.text(`Apertura: ${date(close.report.shift.openedAt)}`), ...page.text(`Cierre: ${date(close.closedAt)}`), page.rule,
    ...page.text(`Tickets: ${close.report.sales.receiptCount}`), ...page.text(`Cancelaciones/devoluciones: ${close.report.sales.refundCount}`),
    ...page.pair("Venta bruta:", money(close.report.sales.grossSaleInCents)),
    ...page.pair("Devoluciones:", money(close.report.sales.refundedSaleInCents)),
    ...page.pair("Venta neta:", money(close.report.sales.netSaleInCents)),
    ...page.pair("Propinas:", money(close.report.sales.tipInCents)), page.rule];
  for (const method of close.report.paymentMethods) lines.push(...page.pair(`${method.name}:`, money(method.netInCents)));
  lines.push(...page.pair("Efectivo teorico:", money(close.report.cash.theoreticalInCents)), page.rule);
  for (const declaration of close.declarations) lines.push(
    ...page.pair(`${declaration.method.name} declarado:`, money(declaration.declaredInCents)),
    ...page.pair("Diferencia:", money(declaration.differenceInCents)));
  lines.push("", ...page.text(`Corte: ${close.id}`));
  return lines;
};

export const renderPlainTicket = (payload: PrintPayload, options: TicketOptions = {}): string => {
  const columns = columnsFor(options);
  const lines = "receipt" in payload ? renderReceipt(payload, columns)
    : "close" in payload ? renderShiftClose(payload, columns) : renderProduction(payload, columns);
  return `${lines.join("\n")}\n\n\n`;
};

export const renderEscPos = (payload: PrintPayload, options: TicketOptions = {}): Uint8Array => {
  const codePage = options.codePage ?? 19;
  if (!Number.isInteger(codePage) || codePage < 0 || codePage > 255) throw new Error("La página de códigos debe estar entre 0 y 255");
  const content = renderPlainTicket(payload, options);
  const font = columnsFor(options) > 42 ? 1 : 0;
  // SRP-F310 (180 dpi): 42 columns in font A, 56 in font B.
  const bytes: number[] = [ESC, 0x40, ESC, 0x21, 0x00, ESC, 0x4d, font, ESC, 0x74, codePage,
    GS, 0x21, 0x00, ESC, 0x61, 0x00, ESC, 0x32, ESC, 0x45, 0x00];
  for (const line of content.split("\n")) {
    const bold = /^(TOTAL\b|ANTOJITOS$|\*\*\*)/.test(line.trim());
    if (bold) bytes.push(ESC, 0x45, 0x01);
    bytes.push(...encodeCp858(line), 0x0a);
    if (bold) bytes.push(ESC, 0x45, 0x00);
  }
  bytes.push(ESC, 0x64, 0x03, GS, 0x56, 0x00);
  return Uint8Array.from(bytes);
};
