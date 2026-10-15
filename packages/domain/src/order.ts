import { createUuid } from "./uuid.js";

export type ItemPreparationState = "pending" | "sent" | "cancelled";

export interface Product {
  id: string;
  name: string;
  category: string;
  priceInCents: number;
  color: string;
  emoji: string;
}

export interface OrderItem {
  id: string;
  productId: string;
  name: string;
  priceInCents: number;
  quantity: number;
  preparationState: ItemPreparationState;
}

export interface Order {
  id: string;
  label: string;
  version: number;
  items: OrderItem[];
}

export type OrderAction =
  | { type: "product-added"; product: Product }
  | { type: "quantity-changed"; itemId: string; delta: 1 | -1 }
  | { type: "pending-items-sent" };

const createItemId = (productId: string): string =>
  `${productId}-${createUuid()}`;

export const createOrder = (label = "Mesa 4"): Order => ({
  id: createUuid(),
  label,
  version: 0,
  items: [],
});

export const orderReducer = (order: Order, action: OrderAction): Order => {
  switch (action.type) {
    case "product-added": {
      const matchingPendingItem = order.items.find(
        (item) =>
          item.productId === action.product.id &&
          item.preparationState === "pending",
      );

      const items = matchingPendingItem
        ? order.items.map((item) =>
            item.id === matchingPendingItem.id
              ? { ...item, quantity: item.quantity + 1 }
              : item,
          )
        : [
            ...order.items,
            {
              id: createItemId(action.product.id),
              productId: action.product.id,
              name: action.product.name,
              priceInCents: action.product.priceInCents,
              quantity: 1,
              preparationState: "pending" as const,
            },
          ];

      return { ...order, items, version: order.version + 1 };
    }

    case "quantity-changed": {
      const target = order.items.find((item) => item.id === action.itemId);

      if (!target || target.preparationState !== "pending") {
        return order;
      }

      const nextQuantity = target.quantity + action.delta;
      const items =
        nextQuantity <= 0
          ? order.items.filter((item) => item.id !== action.itemId)
          : order.items.map((item) =>
              item.id === action.itemId
                ? { ...item, quantity: nextQuantity }
                : item,
            );

      return { ...order, items, version: order.version + 1 };
    }

    case "pending-items-sent": {
      if (!order.items.some((item) => item.preparationState === "pending")) {
        return order;
      }

      return {
        ...order,
        items: order.items.map((item) =>
          item.preparationState === "pending"
            ? { ...item, preparationState: "sent" as const }
            : item,
        ),
        version: order.version + 1,
      };
    }
  }
};

export const orderTotalInCents = (order: Order): number =>
  order.items.reduce(
    (total, item) => total + item.priceInCents * item.quantity,
    0,
  );

export const pendingItemCount = (order: Order): number =>
  order.items
    .filter((item) => item.preparationState === "pending")
    .reduce((total, item) => total + item.quantity, 0);
