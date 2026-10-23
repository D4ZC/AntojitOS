import { describe, expect, it } from "vitest";
import {
  createOrder,
  orderReducer,
  orderTotalInCents,
  pendingItemCount,
  type Product,
} from "../src";

const taco: Product = {
  id: "taco-pastor",
  name: "Taco al pastor",
  category: "Tacos",
  priceInCents: 2200,
  color: "coral",
  emoji: "🌮",
};

describe("orderReducer", () => {
  it("agrupa toques repetidos del mismo producto pendiente", () => {
    const withOne = orderReducer(createOrder(), {
      type: "product-added",
      product: taco,
    });
    const withTwo = orderReducer(withOne, {
      type: "product-added",
      product: taco,
    });

    expect(withTwo.items).toHaveLength(1);
    expect(withTwo.items[0]?.quantity).toBe(2);
    expect(orderTotalInCents(withTwo)).toBe(4400);
    expect(pendingItemCount(withTwo)).toBe(2);
  });

  it("no modifica cantidades después de enviar a cocina", () => {
    const pending = orderReducer(createOrder(), {
      type: "product-added",
      product: taco,
    });
    const sent = orderReducer(pending, { type: "pending-items-sent" });
    const result = orderReducer(sent, {
      type: "quantity-changed",
      itemId: sent.items[0]!.id,
      delta: 1,
    });

    expect(result).toBe(sent);
    expect(result.items[0]?.preparationState).toBe("sent");
  });

  it("elimina un artículo pendiente cuando su cantidad llega a cero", () => {
    const pending = orderReducer(createOrder(), {
      type: "product-added",
      product: taco,
    });
    const result = orderReducer(pending, {
      type: "quantity-changed",
      itemId: pending.items[0]!.id,
      delta: -1,
    });

    expect(result.items).toHaveLength(0);
    expect(result.version).toBe(2);
  });

  it("permite agregar comentarios a un artículo enviado sin cambiar su cantidad ni estado", () => {
    const pending = orderReducer(createOrder(), { type: "product-added", product: taco });
    const sent = orderReducer(pending, { type: "pending-items-sent" });
    const result = orderReducer(sent, { type: "item-note-updated", itemId: sent.items[0]!.id, note: "  Con todo  " });

    expect(result.items[0]).toMatchObject({ note: "Con todo", quantity: 1, preparationState: "sent" });
    expect(result.version).toBe(sent.version + 1);
  });

  it("separa una nueva pieza de un artículo que tiene comentarios", () => {
    const pending = orderReducer(createOrder(), { type: "product-added", product: taco });
    const noted = orderReducer(pending, { type: "item-note-updated", itemId: pending.items[0]!.id, note: "Sin cebolla" });
    const result = orderReducer(noted, { type: "product-added", product: taco });

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.note)).toEqual(["Sin cebolla", null]);
  });

  it("espera hasta la hora programada y conserva el historial del envío", () => {
    const pending = orderReducer(createOrder(), { type: "product-added", product: taco });
    const scheduled = orderReducer(pending, { type: "details-updated", customerName: "  Lupita  ", scheduledFor: "2030-10-23T19:00:00.000Z" });
    expect(scheduled.customerName).toBe("Lupita");
    expect(orderReducer(scheduled, { type: "pending-items-sent", sentAt: "2030-10-23T18:59:59.000Z" })).toBe(scheduled);
    expect(orderReducer(scheduled, { type: "scheduled-items-sent", sentAt: "2030-10-23T18:59:59.000Z" })).toBe(scheduled);

    const sent = orderReducer(scheduled, { type: "scheduled-items-sent", sentAt: "2030-10-23T19:00:00.000Z" });
    expect(sent.items[0]?.preparationState).toBe("sent");
    expect(sent.scheduledFor).toBe(scheduled.scheduledFor);
    expect(sent.scheduleDispatchedAt).toBe("2030-10-23T19:00:00.000Z");
    expect(orderReducer(sent, { type: "scheduled-items-sent", sentAt: "2030-10-23T19:00:01.000Z" })).toBe(sent);
  });

  it("permite quitar la programación y enviar inmediatamente", () => {
    const pending = orderReducer(createOrder(), { type: "product-added", product: taco });
    const scheduled = orderReducer(pending, { type: "details-updated", customerName: "", scheduledFor: "2030-10-23T19:00:00.000Z" });
    const unscheduled = orderReducer(scheduled, { type: "details-updated", customerName: "", scheduledFor: null });
    const sent = orderReducer(unscheduled, { type: "pending-items-sent", sentAt: "2030-10-23T18:00:00.000Z" });

    expect(sent.items[0]?.preparationState).toBe("sent");
    expect(sent.customerName).toBeNull();
    expect(sent.scheduledFor).toBeNull();
    expect(sent.scheduleDispatchedAt).toBeNull();
  });
});
