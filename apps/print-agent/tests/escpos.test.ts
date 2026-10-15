import { describe, expect, it } from "vitest";
import { renderEscPos, renderPlainTicket } from "../src/escpos.js";
import type { ProductionPayload } from "../src/types.js";

const payload: ProductionPayload = {
  ticketId: "ticket-1",
  kind: "addition",
  center: { id: "center-1", code: "KITCHEN", name: "Cocina" },
  service: { accountId: "account-1", type: "table", label: "Mesa 4" },
  roundSequence: 2,
  items: [{
    productName: "Taco al pastor",
    quantity: 3,
    note: "Muy dorado",
    modifiers: ["Sin cebolla"],
  }],
};

describe("adaptador ESC/POS", () => {
  it("genera una comanda legible con modificadores y nota", () => {
    const ticket = renderPlainTicket(payload);
    expect(ticket).toContain("NUEVA COMANDA");
    expect(ticket).toContain("Mesa 4 · Ronda 2");
    expect(ticket).toContain("3 x Taco al pastor");
    expect(ticket).toContain("> Sin cebolla");
    expect(ticket).toContain("NOTA: Muy dorado");
  });

  it("incluye inicialización y corte ESC/POS", () => {
    const bytes = renderEscPos(payload);
    expect([...bytes.slice(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...bytes.slice(-3)]).toEqual([0x1d, 0x56, 0x00]);
  });
});
