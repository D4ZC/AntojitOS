import type { ProductionPayload } from "./types.js";

const ESC = 0x1b;
const GS = 0x1d;
const encoder = new TextEncoder();

const text = (value: string): Uint8Array => encoder.encode(value);

export const renderPlainTicket = (payload: ProductionPayload): string => {
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

export const renderEscPos = (payload: ProductionPayload): Uint8Array => {
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
