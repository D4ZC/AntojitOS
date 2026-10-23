import type { ServiceAccount } from "./api/types";

export interface DeliveryDriver {
  id: string;
  name: string;
  phone: string | null;
  active: boolean;
}

export type DeliveryStatus = "assigned" | "out_for_delivery" | "delivered" | "cancelled";

export const deliveryStatusLabel: Record<DeliveryStatus, string> = {
  assigned: "Asignado",
  out_for_delivery: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

export interface DeliveryAssignment {
  id: string;
  accountId: string;
  driverId: string;
  driverName: string;
  driverPhone: string | null;
  status: DeliveryStatus;
  version: number;
  accountVersion: number;
  customerName: string | null;
  phone: string | null;
  address: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  snapshot: DeliverySnapshot;
  shareExpiresAt: string | null;
  accountChanged: boolean;
  accountUnavailable: boolean;
}

export interface DeliverySnapshot {
  accountId: string;
  label: string;
  customerName: string | null;
  totalInCents: number;
  items: Array<{
    productName: string;
    quantity: number;
    note: string | null;
    modifiers: string[];
    lineTotalInCents: number;
  }>;
}

export interface SharedDelivery {
  id: string;
  driverName: string;
  status: DeliveryStatus;
  customerName: string | null;
  phone: string | null;
  address: string;
  notes: string | null;
  snapshot: DeliverySnapshot;
  updatedAt: string;
  expiresAt: string;
}

export interface AssignDeliveryInput {
  accountId: string;
  expectedAccountVersion: number;
  driverId: string;
  customerName?: string;
  phone?: string;
  address: string;
  notes?: string;
}

export interface DeliveryApi {
  deliveryDrivers(): Promise<DeliveryDriver[]>;
  createDeliveryDriver(input: { name: string; phone?: string }): Promise<{ driver: DeliveryDriver }>;
  deliveryAssignments(): Promise<DeliveryAssignment[]>;
  assignDelivery(input: AssignDeliveryInput): Promise<{ assignment: DeliveryAssignment }>;
  updateDeliveryStatus(id: string, input: { expectedVersion: number; status: DeliveryStatus }): Promise<{ assignment: DeliveryAssignment }>;
  refreshDelivery(id: string, input: { expectedVersion: number; expectedAccountVersion: number }): Promise<{ assignment: DeliveryAssignment }>;
  shareDelivery(id: string, expectedVersion: number): Promise<{ token: string; expiresAt: string; version: number }>;
}

export interface DeliveryPanelProps {
  api: DeliveryApi & { account(id: string): Promise<ServiceAccount> };
  account?: ServiceAccount | null;
  onClose(): void;
}
