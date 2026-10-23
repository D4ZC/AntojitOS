import { describe, expect, it } from "vitest";
import { renderEscPos, renderPlainTicket } from "../src/escpos.js";
import type {
  ProductionPayload,
  ReceiptPayload,
  ShiftClosePayload,
} from "../src/types.js";

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

  it("identifica una actualización de nota sin pedir preparar otra comanda", () => {
    const ticket = renderPlainTicket({
      ...payload,
      kind: "note_update",
      previousNote: "Muy dorado",
      items: [{ ...payload.items[0]!, note: "Con todo, salsa aparte" }],
    });
    expect(ticket).toContain("ACTUALIZACION DE NOTA");
    expect(ticket).toContain("NO PREPARAR DE NUEVO");
    expect(ticket).toContain("Mesa 4 · Ronda 2");
    expect(ticket).toContain("3 x Taco al pastor");
    expect(ticket).toContain("NOTA: Con todo, salsa aparte");
    expect(ticket).not.toContain("NUEVA COMANDA");
    expect(ticket).not.toContain("Muy dorado");
  });

  it("avisa cuando se eliminó la nota de una comanda enviada", () => {
    const ticket = renderPlainTicket({
      ...payload,
      kind: "note_update",
      items: [{ ...payload.items[0]!, note: null }],
    });
    expect(ticket).toContain("NO PREPARAR DE NUEVO");
    expect(ticket).toContain("NOTA: Sin observaciones");
  });

  it("genera tickets de venta y marca sus reimpresiones", () => {
    const receipt: ReceiptPayload = {
      kind: "receipt_reprint",
      receipt: {
        id: "receipt-1",
        folio: "T-000001",
        issuedAt: "2030-01-01T12:00:00.000Z",
        account: {
          tableName: "Mesa 4",
          reference: null,
          serviceType: "table",
          items: [{
            productName: "Taco al pastor",
            quantity: 2,
            preparationState: "sent",
            lineTotalInCents: 4_000,
          }],
        },
        payments: [{
          method: { name: "Efectivo" },
          totalInCents: 4_400,
          reference: null,
        }],
        totals: {
          saleInCents: 4_000,
          tipInCents: 400,
          changeInCents: 100,
        },
      },
      reprint: { reason: "Cliente solicita copia", requestedBy: "Administrador" },
    };

    const ticket = renderPlainTicket(receipt);
    expect(ticket).toContain("REIMPRESION DE TICKET");
    expect(ticket).toContain("Ticket T-000001");
    expect(ticket).toContain("2 x Taco al pastor");
    expect(ticket).toContain("Cliente solicita copia");
  });

  it("genera un corte con declarado y diferencia", () => {
    const close: ShiftClosePayload = {
      kind: "shift_close",
      close: {
        id: "close-1",
        closedAt: "2030-01-01T18:00:00.000Z",
        report: {
          register: { name: "Caja principal" },
          shift: { openedAt: "2030-01-01T10:00:00.000Z" },
          sales: {
            receiptCount: 4,
            refundCount: 1,
            grossSaleInCents: 10_000,
            refundedSaleInCents: 1_000,
            netSaleInCents: 9_000,
            tipInCents: 500,
          },
          cash: { theoreticalInCents: 5_000 },
          paymentMethods: [{ name: "Efectivo", netInCents: 4_500 }],
        },
        declarations: [{
          method: { name: "Efectivo" },
          declaredInCents: 4_900,
          differenceInCents: -100,
        }],
      },
    };

    const ticket = renderPlainTicket(close);
    expect(ticket).toContain("CORTE DE CAJA");
    expect(ticket).toContain("Venta neta: $90.00");
    expect(ticket).toContain("Diferencia: -$1.00");
  });
});
