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
  note: string | null;
  preparationState: ItemPreparationState;
}

export interface Order {
  id: string;
  label: string;
  customerName: string | null;
  scheduledFor: string | null;
  scheduleDispatchedAt: string | null;
  version: number;
  items: OrderItem[];
}

export type OrderAction =
  | { type: "product-added"; product: Product }
  | { type: "quantity-changed"; itemId: string; delta: 1 | -1 }
  | { type: "item-note-updated"; itemId: string; note: string }
  | { type: "label-changed"; label: string }
  | { type: "details-updated"; customerName: string; scheduledFor: string | null }
  | { type: "pending-items-sent"; sentAt?: string }
  | { type: "scheduled-items-sent"; sentAt: string };

const createItemId = (productId: string): string =>
  `${productId}-${createUuid()}`;

export const createOrder = (label = "Mesa 4"): Order => ({
  id: createUuid(),
  label,
  customerName: null,
  scheduledFor: null,
  scheduleDispatchedAt: null,
  version: 0,
  items: [],
});

export const orderReducer = (order: Order, action: OrderAction): Order => {
  switch (action.type) {
    case "product-added": {
      const matchingPendingItem = order.items.find(
        (item) =>
          item.productId === action.product.id &&
          !item.note &&
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
              note: null,
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

    case "item-note-updated": {
      const target = order.items.find((item) => item.id === action.itemId);
      if (!target || target.preparationState === "cancelled") return order;
      const note = action.note.trim().slice(0, 120) || null;
      if (target.note === note) return order;
      return {
        ...order,
        items: order.items.map((item) => item.id === target.id ? { ...item, note } : item),
        version: order.version + 1,
      };
    }

    case "label-changed": {
      if (!action.label.trim() || action.label === order.label) return order;
      return { ...order, label: action.label.trim(), version: order.version + 1 };
    }

    case "details-updated": {
      if (action.scheduledFor !== null && !Number.isFinite(Date.parse(action.scheduledFor))) return order;
      const customerName = action.customerName.trim().slice(0, 80) || null;
      const scheduledFor = action.scheduledFor === null ? null : new Date(action.scheduledFor).toISOString();
      if (customerName === order.customerName && scheduledFor === order.scheduledFor) return order;
      return {
        ...order,
        customerName,
        scheduledFor,
        scheduleDispatchedAt: scheduledFor === order.scheduledFor ? order.scheduleDispatchedAt : null,
        version: order.version + 1,
      };
    }

    case "scheduled-items-sent":
    case "pending-items-sent": {
      const sentAt = action.sentAt ?? new Date().toISOString();
      const sentTime = Date.parse(sentAt);
      if (!Number.isFinite(sentTime)) return order;
      const awaitingSchedule = Boolean(order.scheduledFor && !order.scheduleDispatchedAt);
      if (action.type === "scheduled-items-sent" && !awaitingSchedule) return order;
      if (awaitingSchedule && Date.parse(order.scheduledFor!) > sentTime) return order;
      if (!order.items.some((item) => item.preparationState === "pending")) {
        return order;
      }

      return {
        ...order,
        scheduleDispatchedAt: awaitingSchedule ? new Date(sentAt).toISOString() : order.scheduleDispatchedAt,
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
