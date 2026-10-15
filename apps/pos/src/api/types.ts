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
  accountCount: number;
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
  adjustmentInCents: number;
  taxInCents: number;
  lineTotalInCents: number;
}

export interface AccountTotals {
  itemTotalInCents: number;
  subtotalInCents: number;
  adjustmentTotalInCents: number;
  discountInCents: number;
  taxInCents: number;
  totalInCents: number;
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
  accountGroupId: string;
  isPrimary: boolean;
  responsible: { id: string; displayName: string };
  items: RemoteOrderItem[];
  adjustments: Array<{
    id: string;
    kind: "discount" | "courtesy";
    calculation: "percentage" | "fixed";
    value: number;
    reason: string;
    createdAt: string;
    appliedInCents: number;
  }>;
  totals: AccountTotals;
  totalInCents: number;
}

export interface AccountSummary {
  id: string;
  label: string;
  version: number;
  guestCount: number;
  responsible: { id: string; displayName: string };
  itemCount: number;
  totalInCents: number;
  isPrimary: boolean;
}

export interface AccountManagementOptions {
  users: Array<{ id: string; displayName: string }>;
  tables: Array<{ id: string; name: string }>;
  accounts: Array<{
    id: string;
    label: string;
    version: number;
    totalInCents: number;
    responsible: { id: string; displayName: string };
  }>;
}

export interface Precheck {
  id: string;
  sequence: number;
  generatedAt: string;
  account: ServiceAccount;
}
