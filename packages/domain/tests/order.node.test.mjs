import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createOrder,
  orderReducer,
  orderTotalInCents,
  pendingItemCount,
} from "../src/order.ts";

const taco = {
  id: "taco-pastor",
  name: "Taco al pastor",
  category: "Tacos",
  priceInCents: 2200,
  color: "coral",
  emoji: "🌮",
};

describe("orderReducer sin dependencias externas", () => {
  it("agrupa el mismo producto mientras continúa pendiente", () => {
    const withOne = orderReducer(createOrder(), {
      type: "product-added",
      product: taco,
    });
    const withTwo = orderReducer(withOne, {
      type: "product-added",
      product: taco,
    });

    assert.equal(withTwo.items.length, 1);
    assert.equal(withTwo.items[0].quantity, 2);
    assert.equal(orderTotalInCents(withTwo), 4400);
    assert.equal(pendingItemCount(withTwo), 2);
  });

  it("inmoviliza artículos que ya fueron enviados", () => {
    const pending = orderReducer(createOrder(), {
      type: "product-added",
      product: taco,
    });
    const sent = orderReducer(pending, { type: "pending-items-sent" });
    const result = orderReducer(sent, {
      type: "quantity-changed",
      itemId: sent.items[0].id,
      delta: 1,
    });

    assert.equal(result, sent);
    assert.equal(result.items[0].preparationState, "sent");
  });

  it("elimina una captura pendiente al llegar a cero", () => {
    const pending = orderReducer(createOrder(), {
      type: "product-added",
      product: taco,
    });
    const result = orderReducer(pending, {
      type: "quantity-changed",
      itemId: pending.items[0].id,
      delta: -1,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.version, 2);
  });
});

