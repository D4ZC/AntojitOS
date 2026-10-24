import { describe, expect, it } from "vitest";
import { encodeCp858, renderEscPos, renderPlainTicket } from "../src/escpos.js";
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
    expect(ticket).toMatch(/Venta neta:\s+\$90\.00/);
    expect(ticket).toMatch(/Diferencia:\s+-\$1\.00/);
  });
});

const thermalReceipt: ReceiptPayload = {
  kind: "receipt",
  receipt: {
    id: "receipt-thermal", folio: "T-000009", issuedAt: "2026-10-24T18:30:00.000Z",
    account: {
      tableName: "Mesa 9", reference: null, serviceType: "table", customerName: "José Muñoz",
      totals: { subtotalInCents: 6034, discountInCents: 500, taxInCents: 966 },
      items: [{ productName: "Flauta de pollo", quantity: 2, preparationState: "sent", lineTotalInCents: 7000,
        modifiers: [{ name: "Con todo", quantity: 1 }], note: "Salsa aparte" },
      { productName: "Artículo cancelado", quantity: 1, preparationState: "cancelled", lineTotalInCents: 0 }],
    },
    payments: [{ method: { name: "Efectivo" }, totalInCents: 7500, tenderedInCents: 10000, reference: null }],
    totals: { saleInCents: 7000, tipInCents: 500, collectedInCents: 7500, changeInCents: 2500 },
  },
};

describe("ticket térmico SRP-F310 de 80 mm", () => {
  it("alinea importes y conserva cliente, preparaciones, propina, recibido y cambio", () => {
    const ticket = renderPlainTicket(thermalReceipt);
    expect(ticket).toContain("Cliente: José Muñoz");
    expect(ticket).toContain("> Con todo");
    expect(ticket).toContain("NOTA: Salsa aparte");
    expect(ticket).not.toContain("Artículo cancelado");
    expect(ticket).toContain("24/10/2026, 12:30:00");
    for (const [label, value] of [["2 x Flauta de pollo", "$70.00"], ["Descuento aplicado", "$5.00"],
      ["Subtotal sin impuestos", "$60.34"], ["Impuestos", "$9.66"], ["TOTAL", "$75.00"],
      ["Recibido", "$100.00"], ["Cambio", "$25.00"]]) {
      const line = ticket.split("\n").find((candidate) => candidate.startsWith(label!));
      expect(line).toHaveLength(42);
      expect(line).toMatch(new RegExp(value!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
    }
  });

  it.each([32, 42, 56])("ajusta nombres y notas largos a %i columnas sin perder importes", (columns) => {
    const productName = "Quesadilla especial de pollo con queso y champiñones recién preparados";
    const payload: ReceiptPayload = { ...thermalReceipt, receipt: { ...thermalReceipt.receipt,
      account: { ...thermalReceipt.receipt.account, customerName: "Cliente".repeat(18), items: [{
        ...thermalReceipt.receipt.account.items[0]!, productName, note: "A".repeat(120) + "\nBien dorada",
      }] } } };
    const ticket = renderPlainTicket(payload, { columns });
    expect(ticket.split("\n").every((line) => line.length <= columns)).toBe(true);
    expect(ticket).toMatch(/\$70\.00\n/);
    expect(ticket).toContain("Bien dorada");
    expect(ticket.replace(/\s/g, "")).toContain(productName.replace(/\s/g, ""));
    expect(ticket.replace(/\s/g, "")).toContain("A".repeat(120));
  });

  it("selecciona PC858 y codifica español en un byte por carácter", () => {
    expect([...encodeCp858("ñÑáéíóúü¿¡€")]).toEqual([164, 165, 160, 130, 161, 162, 163, 129, 168, 173, 213]);
    expect([...encodeCp858("Jose\u0301 🥙")]).toEqual([74, 111, 115, 130, 32, 63]);
    const bytes = Buffer.from(renderEscPos(thermalReceipt));
    expect(bytes.includes(Buffer.from([0x1b, 0x74, 19]))).toBe(true);
    expect(bytes.includes(Buffer.from([0x1b, 0x4d, 0]))).toBe(true);
    expect(bytes.includes(Buffer.from(encodeCp858("José Muñoz")))).toBe(true);
    expect(bytes.includes(Buffer.from("José Muñoz", "utf8"))).toBe(false);
    expect(Buffer.from(renderEscPos(thermalReceipt, { columns: 56 })).includes(Buffer.from([0x1b, 0x4d, 1]))).toBe(true);
  });

  it("elimina comandos de notas y sólo corta al terminar el ticket", () => {
    const payload: ReceiptPayload = { ...thermalReceipt, receipt: { ...thermalReceipt.receipt,
      account: { ...thermalReceipt.receipt.account, items: [{ ...thermalReceipt.receipt.account.items[0]!,
        note: "Nota\x1dV\x00\x1b@\x1ba\x02\u202e prueba",
      }] } } };
    const bytes = Buffer.from(renderEscPos(payload));
    expect(bytes.indexOf(Buffer.from([0x1d, 0x56, 0x00]))).toBe(bytes.length - 3);
    expect(bytes.indexOf(Buffer.from([0x1b, 0x40]), 2)).toBe(-1);
    expect(bytes.includes(Buffer.from([0x1b, 0x61, 2]))).toBe(false);
    expect(renderPlainTicket(payload)).not.toMatch(/[\x00-\x09\x0b-\x1f\u202e]/);
  });

  it.each(["cancelled", "refunded"] as const)("identifica el estado actual %s sin alterar los importes originales", (receiptStatus) => {
    const ticket = renderPlainTicket({ ...thermalReceipt, kind: "receipt_reprint", receiptStatus });
    expect(ticket).toContain(receiptStatus === "cancelled" ? "TICKET CANCELADO" : "TICKET REEMBOLSADO");
    expect(ticket).toMatch(/TOTAL\s+\$75\.00/);
    expect(thermalReceipt.receipt.totals.saleInCents).toBe(7000);
  });

  it("rechaza anchos que recortarían el ticket y páginas de códigos inválidas", () => {
    expect(() => renderPlainTicket(thermalReceipt, { columns: 10 })).toThrow();
    expect(() => renderEscPos(thermalReceipt, { codePage: 256 })).toThrow();
  });
});
