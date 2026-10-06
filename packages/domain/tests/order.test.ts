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
});

