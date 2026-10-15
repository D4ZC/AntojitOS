export interface TerminalCredentials {
  id: string;
  deviceToken: string;
  displayName: string;
}

export interface ProductionTicket {
  id: string;
  accountId: string;
  roundId: string;
  center: { id: string; code: string; name: string };
  kind: "addition" | "cancellation";
  roundSequence: number;
  status: "pending" | "in_progress" | "ready" | "delivered" | "cancelled";
  version: number;
  service: {
    type: "table" | "quick" | "takeaway";
    label: string;
  };
  createdAt: string;
  startedAt: string | null;
  readyAt: string | null;
  items: Array<{
    id: string;
    orderItemId: string | null;
    productName: string;
    quantity: number;
    note: string | null;
    modifiers: string[];
  }>;
}

export interface Session {
  accessToken: string;
  expiresAt: string;
  user: {
    id: string;
    displayName: string;
    permissions: string[];
  };
}

export interface CatalogModifier {
  id: string;
  name: string;
  priceDeltaInCents: number;
  available: boolean;
}

export interface CatalogProduct {
  id: string;
  code: string;
  name: string;
  shortName: string;
  emoji: string | null;
  color: string | null;
  available: boolean;
  version: number;
  priceInCents: number;
  modifierGroups: Array<{
    id: string;
    name: string;
    minimumSelections: number;
    maximumSelections: number;
    options: CatalogModifier[];
  }>;
}

export interface CatalogCategory {
  id: string;
  code: string;
  name: string;
  color: string | null;
  products: CatalogProduct[];
}

export interface ServiceTable {
  id: string;
  code: string;
  name: string;
  capacity: number;
  state: "free" | "occupied";
  accountId: string | null;
  accountVersion: number | null;
}

export interface ServiceLayout {
  areas: Array<{
    id: string;
    name: string;
    tables: ServiceTable[];
  }>;
}

export interface RemoteOrderItem {
  id: string;
  productId: string;
  productName: string;
  unitPriceInCents: number;
  modifierTotalInCents: number;
  quantity: number;
  note: string | null;
  preparationState: "pending" | "sent" | "fulfilled" | "cancelled";
  modifiers: Array<{
    id: string;
    modifierId?: string;
    name: string;
    priceDeltaInCents: number;
    quantity?: number;
  }>;
  lineTotalInCents: number;
}

export interface ServiceAccount {
  id: string;
  tableId: string | null;
  tableName: string | null;
  serviceType: "table" | "quick" | "takeaway";
  status: string;
  reference: string | null;
  guestCount: number;
  version: number;
  items: RemoteOrderItem[];
  totalInCents: number;
}
