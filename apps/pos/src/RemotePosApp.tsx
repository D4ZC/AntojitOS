import { CustomerPicker } from "./CustomerPicker";
import type { CustomersApi } from "./customers";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccountingPanel } from "./AccountingPanel";
import { CatalogPricesEditor, type CatalogPricingApi } from "./CatalogPricesEditor";
import type { AccountingApi } from "./accounting";
import { DeliveryPanel } from "./DeliveryPanel";
import type { DeliveryApi } from "./delivery";
import { ApiError, PosApi } from "./api/pos-api";
import type {
  AccountManagementOptions,
  AccountSummary,
  CashShiftClose,
  BlindCashShiftClose,
  CashShiftContext,
  CashShiftReport,
  CatalogCategory,
  CatalogProduct,
  CheckoutPayment,
  OpenCounterAccount,
  PaymentMethod,
  Precheck,
  RemoteOrderItem,
  ServiceAccount,
  ServiceLayout,
  ServiceTable,
  Session,
  SalesReceipt,
  SalesReceiptSummary,
  TerminalCredentials,
} from "./api/types";
import { formatMoney } from "./format";
import { ReasonPresets } from "./ReasonPresets";
import { MAX_NOTE_LENGTH, toggleQuickNote } from "./notes";
import { OrderBuilder, type OrderBuilderLine } from "./OrderBuilder";
import { QuickNotes } from "./QuickNotes";
import { ReceiptPaper, ReceiptPrintControls, PrecheckPaper, PrecheckPrintControls, type ReceiptPrintingApi } from "./ReceiptPrinting";
import { ProductionPrintControls, type ProductionPrintingApi } from "./ProductionPrinting";
import { type SeasonalMenuApi, SeasonalMenuEditor } from "./SeasonalMenuEditor";

const TERMINAL_STORAGE_KEY = "antojit-os.terminal.v1";

export interface RemoteApi extends CustomersApi, SeasonalMenuApi, CatalogPricingApi, AccountingApi, DeliveryApi, ReceiptPrintingApi, ProductionPrintingApi {
  setAccessToken(accessToken?: string): void;
  registerTerminal(input: {
    bootstrapToken: string;
    terminalCode: string;
    displayName: string;
  }): Promise<TerminalCredentials>;
  login(input: {
    terminal: TerminalCredentials;
    employeeCode: string;
    pin: string;
  }): Promise<Session>;
  catalog(): Promise<CatalogCategory[]>;
  serviceLayout(): Promise<ServiceLayout>;
  openAccount(input: {
    serviceType: "table" | "quick" | "takeaway";
    tableId?: string;
    guestCount: number;
    reference?: string;
    customerId?: string | null;
    customerName?: string | null;
    scheduledFor?: string | null;
  }): Promise<{ id: string }>;
  account(accountId: string): Promise<ServiceAccount>;
  tableAccounts(tableId: string): Promise<AccountSummary[]>;
  openCounterAccounts(): Promise<OpenCounterAccount[]>;
  accountManagementOptions(accountId: string): Promise<AccountManagementOptions>;
  currentCashShift(): Promise<CashShiftContext>;
  openCashShift(openingFloatInCents: number): Promise<CashShiftContext>;
  currentCashReport(): Promise<CashShiftReport>;
  createCashMovement(input: {
    direction: "in" | "out";
    amountInCents: number;
    reason: string;
  }): Promise<{ id: string }>;
  closeCashShift(input: {
    expectedVersion: number;
    declarations: Array<{
      methodCode: "CASH" | "CARD" | "TRANSFER";
      declaredInCents: number;
    }>;
  }): Promise<CashShiftClose | BlindCashShiftClose>;
  cashShiftCloses(): Promise<CashShiftClose[]>;
  paymentMethods(): Promise<PaymentMethod[]>;
  checkoutAccount(
    accountId: string,
    input: { expectedVersion: number; payments: CheckoutPayment[] },
  ): Promise<SalesReceipt>;
  recentReceipts(): Promise<SalesReceiptSummary[]>;
  refundReceipt(
    receiptId: string,
    input: { kind: "cancellation" | "refund"; reason: string },
  ): Promise<{ id: string }>;
  printPrecheck(precheckId: string): Promise<{ status: string; requeued: boolean }>;
  createPrecheck(accountId: string, expectedVersion: number): Promise<Precheck>;
  applyAccountAdjustment(
    accountId: string,
    input: {
      kind: "discount" | "courtesy";
      calculation: "percentage" | "fixed";
      value: number;
      expectedVersion: number;
      reason: string;
    },
  ): Promise<{ accountVersion: number }>;
  voidAccountAdjustment(
    accountId: string,
    adjustmentId: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<{ accountVersion: number }>;
  updateAccountDetails(
    accountId: string,
    input: { expectedVersion: number; customerId?: string | null; customerName?: string | null; scheduledFor?: string | null },
  ): Promise<{ accountVersion: number }>;
  updateAccountContext(
    accountId: string,
    input: { expectedVersion: number; tableId?: string; responsibleUserId?: string },
  ): Promise<{ accountVersion: number }>;
  splitAccount(
    accountId: string,
    input: {
      expectedVersion: number;
      items: Array<{ itemId: string; quantity: number }>;
      reason: string;
    },
  ): Promise<{ sourceVersion: number; destinationAccountId: string; destinationVersion: number }>;
  transferAccountItems(
    accountId: string,
    input: {
      destinationAccountId: string;
      sourceExpectedVersion: number;
      destinationExpectedVersion: number;
      items: Array<{ itemId: string; quantity: number }>;
      reason: string;
    },
  ): Promise<{ sourceVersion: number; destinationVersion: number }>;
  mergeAccount(
    accountId: string,
    input: {
      destinationAccountId: string;
      sourceExpectedVersion: number;
      destinationExpectedVersion: number;
      reason: string;
    },
  ): Promise<{ destinationAccountId: string; destinationVersion: number }>;
  cancelAccount(
    accountId: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<{ accountVersion: number; status: "cancelled" }>;
  addItem(
    accountId: string,
    input: {
      productId: string;
      quantity: number;
      expectedVersion: number;
      modifierIds?: string[];
      note?: string;
    },
  ): Promise<{ accountVersion: number }>;
  updateItem(
    accountId: string,
    itemId: string,
    input: { quantity: number; expectedVersion: number; note?: string },
  ): Promise<{ accountVersion: number }>;
  cancelItem(
    accountId: string,
    itemId: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<{ accountVersion: number; state: string }>;
  sendRound(
    accountId: string,
    expectedVersion: number,
  ): Promise<{ roundId: string; accountVersion: number }>;
}

interface RemotePosAppProps {
  api?: RemoteApi;
  storage?: Storage;
}

const readTerminal = (storage: Storage): TerminalCredentials | null => {
  try {
    const value = storage.getItem(TERMINAL_STORAGE_KEY);
    if (!value) return null;
    const terminal = JSON.parse(value) as Partial<TerminalCredentials>;
    if (!terminal.id || !terminal.deviceToken || !terminal.displayName) return null;
    return terminal as TerminalCredentials;
  } catch {
    return null;
  }
};

const messageFor = (error: unknown): string =>
  error instanceof Error ? error.message : "No fue posible completar la operación";

const serviceLabel = (account: ServiceAccount): string => {
  if (account.tableName) return account.tableName;
  if (account.serviceType === "takeaway") return account.reference || "Para llevar";
  return account.reference || "Venta rápida";
};

const localDateTime = (value: string | null | undefined): string => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const scheduledLabel = (value: string): string => new Date(value).toLocaleString("es-MX", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});

const moneyInput = (cents: number): string => (cents / 100).toFixed(2);

const moneyInputToCents = (value: string): number | null => {
  if (!value.trim()) return null;
  const amount = Number(value.replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
};

type PaymentMode = "cash" | "card" | "transfer" | "combined";

export const RemotePosApp = ({ api: injectedApi, storage = window.localStorage }: RemotePosAppProps) => {
  const api = useMemo<RemoteApi>(
    () => injectedApi ?? new PosApi(import.meta.env.VITE_API_URL || "/api"),
    [injectedApi],
  );
  const [terminal, setTerminal] = useState<TerminalCredentials | null>(() => readTerminal(storage));
  const [session, setSession] = useState<Session | null>(null);
  const [catalog, setCatalog] = useState<CatalogCategory[]>([]);
  const [layout, setLayout] = useState<ServiceLayout | null>(null);
  const [account, setAccount] = useState<ServiceAccount | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [guestCount, setGuestCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Selecciona una mesa para comenzar");
  const [error, setError] = useState<string | null>(null);
  const [builder, setBuilder] = useState<{ category: CatalogCategory; product: CatalogProduct } | null>(null);
  const [seasonalEditorOpen, setSeasonalEditorOpen] = useState(false);
  const [pricesEditorOpen, setPricesEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<RemoteOrderItem | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [customerIdDraft, setCustomerIdDraft] = useState<string | null>(null);
  const [customerNameDraft, setCustomerNameDraft] = useState("");
  const [scheduledDraft, setScheduledDraft] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [leavingAccount, setLeavingAccount] = useState(false);
  const [cancellingItem, setCancellingItem] = useState<RemoteOrderItem | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [precheck, setPrecheck] = useState<Precheck | null>(null);
  const [accountChoices, setAccountChoices] = useState<AccountSummary[]>([]);
  const [openCounterAccounts, setOpenCounterAccounts] = useState<OpenCounterAccount[]>([]);
  const [managementOpen, setManagementOpen] = useState(false);
  const [managementOptions, setManagementOptions] = useState<AccountManagementOptions | null>(null);
  const [managementReason, setManagementReason] = useState("");
  const [discountPercent, setDiscountPercent] = useState("10");
  const [movementTargetId, setMovementTargetId] = useState("");
  const [selectedMovementItems, setSelectedMovementItems] = useState<string[]>([]);
  const [confirmingAccountCancellation, setConfirmingAccountCancellation] = useState(false);
  const [quickCancellationOpen, setQuickCancellationOpen] = useState(false);
  const [quickCancellationReason, setQuickCancellationReason] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [cashShiftContext, setCashShiftContext] = useState<CashShiftContext | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [openingFloat, setOpeningFloat] = useState("500.00");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("cash");
  const [tipPercent, setTipPercent] = useState("0");
  const [cashTendered, setCashTendered] = useState("0.00");
  const [combinedCashAmount, setCombinedCashAmount] = useState("0.00");
  const [cardReference, setCardReference] = useState("");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SalesReceipt | null>(null);
  const [cashPanelOpen, setCashPanelOpen] = useState(false);
  const [accountingOpen, setAccountingOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [deliveryAccount, setDeliveryAccount] = useState<ServiceAccount | null>(null);
  const [cashReport, setCashReport] = useState<CashShiftReport | null>(null);
  const [cashClose, setCashClose] = useState<CashShiftClose | BlindCashShiftClose | null>(null);
  const [closedShifts, setClosedShifts] = useState<CashShiftClose[]>([]);
  const [recentReceipts, setRecentReceipts] = useState<SalesReceiptSummary[]>([]);
  const [cashPanelError, setCashPanelError] = useState<string | null>(null);
  const [cashMovementDirection, setCashMovementDirection] = useState<"in" | "out">("out");
  const [cashMovementAmount, setCashMovementAmount] = useState("");
  const [cashMovementReason, setCashMovementReason] = useState("");
  const [cashDeclarations, setCashDeclarations] = useState<Record<string, string>>({});
  const [cashCloseConfirmation, setCashCloseConfirmation] = useState(false);
  const [receiptAction, setReceiptAction] = useState<{
    receipt: SalesReceiptSummary;
    kind: "reprint" | "cancellation" | "refund";
  } | null>(null);
  const [receiptActionReason, setReceiptActionReason] = useState("");
  const catalogRequest = useRef({ id: 0, authorized: false, mounted: true });

  useEffect(() => {
    catalogRequest.current.mounted = true;
    return () => {
      catalogRequest.current.mounted = false;
      catalogRequest.current.id += 1;
    };
  }, [api]);

  const refreshCatalog = useCallback(async () => {
    if (!catalogRequest.current.authorized || !catalogRequest.current.mounted) return;
    const requestId = ++catalogRequest.current.id;
    const nextCatalog = await api.catalog();
    const current = catalogRequest.current;
    if (!current.mounted || !current.authorized || current.id !== requestId) return;
    setCatalog(nextCatalog);
    setActiveCategoryId((selected) =>
      selected && nextCatalog.some((category) => category.id === selected)
        ? selected
        : nextCatalog[0]?.id ?? null,
    );
  }, [api]);

  const loadServiceData = async () => {
    const [, nextLayout, nextCounterAccounts] = await Promise.all([
      refreshCatalog(),
      api.serviceLayout(),
      api.openCounterAccounts(),
    ]);
    setLayout(nextLayout);
    setOpenCounterAccounts(nextCounterAccounts);
  };

  // Mantiene los precios al día sin reemplazar la cuenta ni los borradores de captura.
  useEffect(() => {
    if (!session || busy || builder || seasonalEditorOpen || pricesEditorOpen) return;
    let active = true;
    const refreshVisibleCatalog = () => {
      if (active && document.visibilityState === "visible") void refreshCatalog().catch(() => undefined);
    };
    const poll = window.setInterval(refreshVisibleCatalog, 15_000);
    window.addEventListener("focus", refreshVisibleCatalog);
    document.addEventListener("visibilitychange", refreshVisibleCatalog);
    return () => {
      active = false;
      window.clearInterval(poll);
      window.removeEventListener("focus", refreshVisibleCatalog);
      document.removeEventListener("visibilitychange", refreshVisibleCatalog);
    };
  }, [session, busy, builder, seasonalEditorOpen, pricesEditorOpen, refreshCatalog]);

  const refreshAccount = async (accountId: string) => {
    const [nextAccount, nextLayout] = await Promise.all([
      api.account(accountId),
      api.serviceLayout(),
    ]);
    setAccount(nextAccount);
    setLayout(nextLayout);
    return nextAccount;
  };

  // El servidor despacha la programación; esta consulta sólo actualiza la tablet.
  useEffect(() => {
    if (!session || busy) return;
    let active = true;
    const poll = window.setInterval(() => {
      if (account?.scheduledFor && !account.scheduleDispatchedAt) {
        void api.account(account.id).then((next) => { if (active) setAccount(next); }).catch(() => undefined);
      } else if (!account) {
        void api.openCounterAccounts().then((next) => { if (active) setOpenCounterAccounts(next); }).catch(() => undefined);
      }
    }, 5_000);
    return () => { active = false; window.clearInterval(poll); };
  }, [api, session, account?.id, account?.scheduledFor, account?.scheduleDispatchedAt, busy]);

  const editDetails = (current: ServiceAccount, enableSchedule = false) => {
    setCustomerIdDraft(current.customerId ?? null);
    setCustomerNameDraft(current.customerName ?? "");
    setScheduledDraft(localDateTime(current.scheduledFor));
    setScheduleEnabled(enableSchedule || Boolean(current.scheduledFor && !current.scheduleDispatchedAt));
    setError(null);
    setDetailsOpen(true);
  };

  const saveDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!account || busy) return;
    const nextSchedule = scheduleEnabled && scheduledDraft ? new Date(scheduledDraft) : null;
    const scheduleChanged = scheduleEnabled
      ? scheduledDraft !== localDateTime(account.scheduledFor) || Boolean(account.scheduleDispatchedAt)
      : Boolean(account.scheduledFor && !account.scheduleDispatchedAt);
    if (scheduleEnabled && (!nextSchedule || !Number.isFinite(nextSchedule.getTime()) || (scheduleChanged && nextSchedule.getTime() <= Date.now()))) {
      setError("Elige una fecha y hora futuras para enviar a cocina");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateAccountDetails(account.id, {
        expectedVersion: account.version,
        customerId: customerIdDraft,
        customerName: customerNameDraft.trim() || null,
        ...(scheduleChanged ? { scheduledFor: nextSchedule?.toISOString() ?? null } : {}),
      });
      await refreshAccount(account.id);
      setDetailsOpen(false);
      setNotice(scheduleEnabled ? "Pedido programado. Se enviará automáticamente a cocina a la hora indicada." : "Datos del pedido guardados");
    } catch (detailsError) {
      await handleMutationError(detailsError);
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const credentials = await api.registerTerminal({
        bootstrapToken: String(form.get("bootstrapToken") ?? ""),
        terminalCode: String(form.get("terminalCode") ?? "").trim().toUpperCase(),
        displayName: String(form.get("displayName") ?? "").trim(),
      });
      storage.setItem(TERMINAL_STORAGE_KEY, JSON.stringify(credentials));
      setTerminal(credentials);
      setNotice("Terminal registrada. Ingresa con tu PIN.");
    } catch (registrationError) {
      setError(messageFor(registrationError));
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!terminal) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const nextSession = await api.login({
        terminal,
        employeeCode: String(form.get("employeeCode") ?? "").trim().toUpperCase(),
        pin: String(form.get("pin") ?? ""),
      });
      api.setAccessToken(nextSession.accessToken);
      catalogRequest.current.authorized = true;
      await loadServiceData();
      setSession(nextSession);
      setNotice("Sesión iniciada. Selecciona el tipo de servicio.");
    } catch (loginError) {
      catalogRequest.current.authorized = false;
      catalogRequest.current.id += 1;
      api.setAccessToken(undefined);
      setError(messageFor(loginError));
    } finally {
      setBusy(false);
    }
  };

  const clearSessionViews = () => {
    setCashPanelOpen(false);
    setCashReport(null);
    setCashClose(null);
    setClosedShifts([]);
    setRecentReceipts([]);
    setCashShiftContext(null);
    setCashDeclarations({});
    setCashCloseConfirmation(false);
    setCashPanelError(null);
    setCashMovementAmount("");
    setCashMovementReason("");
    setReceiptAction(null);
    setReceiptActionReason("");
    setCheckoutOpen(false);
    setCheckoutError(null);
    setReceipt(null);
    setPaymentMethods([]);
    setCardReference("");
    setCashTendered("0.00");
    setCombinedCashAmount("0.00");
    setOpeningFloat("500.00");
    setPrecheck(null);
    setBuilder(null);
    setEditingItem(null);
    setCancellingItem(null);
    setDetailsOpen(false);
    setCustomerIdDraft(null);
    setCustomerNameDraft("");
    setAccountChoices([]);
    setManagementOptions(null);
    setSeasonalEditorOpen(false);
    setNotice("Ingresa con tu PIN para comenzar");
  };

  const forgetTerminal = () => {
    clearSessionViews();
    catalogRequest.current.authorized = false;
    catalogRequest.current.id += 1;
    storage.removeItem(TERMINAL_STORAGE_KEY);
    api.setAccessToken(undefined);
    setTerminal(null);
    setSession(null);
    setError(null);
  };

  const logout = async () => {
    if (busy) return;
    if (account && account.serviceType !== "table" && !account.scheduledFor && !account.adjustments.length &&
        account.items.every((item) => item.preparationState === "cancelled") &&
        (account.responsible.id === session?.user.id || session?.user.permissions.includes("service.account.manage"))) {
      setBusy(true);
      try {
        await api.cancelAccount(account.id, { expectedVersion: account.version, reason: "Servicio sin productos descartado al cerrar sesión" });
      } catch (logoutError) {
        await handleMutationError(logoutError);
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    clearSessionViews();
    catalogRequest.current.authorized = false;
    catalogRequest.current.id += 1;
    api.setAccessToken(undefined);
    setSession(null);
    setAccount(null);
    setOpenCounterAccounts([]);
    setCatalog([]);
    setPricesEditorOpen(false);
    setLayout(null);
    setError(null);
    setManagementOpen(false);
    setDetailsOpen(false);
    setLeavingAccount(false);
    setQuickCancellationOpen(false);
    setAccountingOpen(false);
    setDeliveryOpen(false);
    setDeliveryAccount(null);
    setPrecheck(null);
  };

  const selectTable = async (table: ServiceTable) => {
    setBusy(true);
    setError(null);
    try {
      await refreshCatalog();
      if (table.accountId && table.accountCount > 1) {
        const choices = await api.tableAccounts(table.id);
        setAccountChoices(choices);
        setNotice(`${table.name} tiene ${choices.length} cuentas abiertas`);
        return;
      }
      const accountId = table.accountId ?? (await api.openAccount({
        serviceType: "table",
        tableId: table.id,
        guestCount,
      })).id;
      await refreshAccount(accountId);
      setNotice(table.accountId ? "Cuenta existente actualizada" : `${table.name} abierta`);
    } catch (selectionError) {
      setError(messageFor(selectionError));
      await loadServiceData().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const selectExistingAccount = async (accountId: string) => {
    setBusy(true);
    setError(null);
    try {
      await refreshCatalog();
      await refreshAccount(accountId);
      setAccountChoices([]);
      setNotice("Cuenta actualizada");
    } catch (selectionError) {
      setError(messageFor(selectionError));
    } finally {
      setBusy(false);
    }
  };

  const openCounterService = async (serviceType: "quick" | "takeaway", schedule = false) => {
    setBusy(true);
    setError(null);
    try {
      await refreshCatalog();
      const opened = await api.openAccount({ serviceType, guestCount });
      const openedAccount = await refreshAccount(opened.id);
      if (schedule) editDetails(openedAccount, true);
      setNotice(serviceType === "takeaway" ? "Orden para llevar abierta" : "Venta rápida abierta");
    } catch (openingError) {
      setError(messageFor(openingError));
    } finally {
      setBusy(false);
    }
  };

  const handleMutationError = async (mutationError: unknown) => {
    if (mutationError instanceof ApiError && mutationError.status === 409 && account) {
      try {
        const latest = await refreshAccount(account.id);
        if (latest.version !== account.version) {
          setNotice("La cuenta cambió en otra terminal; ya mostramos la versión más reciente");
          setError(null);
          return;
        }
      } catch {
        // El error original explica mejor qué operación falló.
      }
    }
    setError(messageFor(mutationError));
  };

  const addProduct = async (product: CatalogProduct) => {
    if (!account || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.addItem(account.id, {
        productId: product.id,
        quantity: 1,
        expectedVersion: account.version,
        modifierIds: [],
      });
      await refreshAccount(account.id);
      setNotice(`${product.name} agregado`);
    } catch (addError) {
      await handleMutationError(addError);
    } finally {
      setBusy(false);
    }
  };

  // Cada variante es un artículo independiente con su propia cantidad, opciones y nota,
  // para que cocina vea "2 tostadas de pierna" y "1 sencilla" por separado.
  const addLines = async (lines: OrderBuilderLine[]): Promise<string[]> => {
    if (!account || busy) return [];
    const added: string[] = [];
    let expectedVersion = account.version;
    setBusy(true);
    setError(null);
    try {
      for (const line of lines) {
        const result = await api.addItem(account.id, {
          productId: line.product.id,
          quantity: line.quantity,
          expectedVersion,
          modifierIds: line.modifierIds,
          ...(line.note ? { note: line.note } : {}),
        });
        expectedVersion = result.accountVersion;
        added.push(line.key);
      }
      await refreshAccount(account.id);
      const pieces = lines.reduce((total, line) => total + line.quantity, 0);
      setNotice(pieces === 1 ? `${lines[0]?.product.name} agregado` : `${pieces} productos agregados`);
      setBuilder(null);
    } catch (addError) {
      if (added.length > 0) await refreshAccount(account.id).catch(() => undefined);
      await handleMutationError(addError);
    } finally {
      setBusy(false);
    }
    return added;
  };

  const chooseProduct = (category: CatalogCategory, product: CatalogProduct) => {
    const hasOptions = product.modifierGroups.some((group) =>
      group.options.some((option) => option.available),
    );
    if (!hasOptions) {
      void addProduct(product);
      return;
    }
    setError(null);
    setBuilder({ category, product });
  };

  const changeQuantity = async (item: RemoteOrderItem, quantity: number, note = item.note ?? "") => {
    if (!account || busy || quantity < 1) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateItem(account.id, item.id, {
        quantity,
        expectedVersion: account.version,
        note,
      });
      await refreshAccount(account.id);
      setNotice(`${item.productName} actualizado`);
      setEditingItem(null);
    } catch (updateError) {
      await handleMutationError(updateError);
    } finally {
      setBusy(false);
    }
  };

  const sendRound = async () => {
    if (!account || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.sendRound(account.id, account.version);
      await refreshAccount(account.id);
      setNotice("Comanda enviada. Impresión automática en cola.");
    } catch (sendError) {
      await handleMutationError(sendError);
    } finally {
      setBusy(false);
    }
  };

  const cancelItem = async () => {
    if (!account || !cancellingItem || busy || !cancellationReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.cancelItem(account.id, cancellingItem.id, {
        expectedVersion: account.version,
        reason: cancellationReason.trim(),
      });
      await refreshAccount(account.id);
      setNotice(`${cancellingItem.productName} cancelado con aviso a producción`);
      setCancellingItem(null);
      setCancellationReason("");
    } catch (cancellationError) {
      await handleMutationError(cancellationError);
    } finally {
      setBusy(false);
    }
  };

  const loadManagementOptions = async (accountId: string) => {
    const options = await api.accountManagementOptions(accountId);
    setManagementOptions(options);
    setMovementTargetId((current) =>
      options.accounts.some((candidate) => candidate.id === current)
        ? current
        : options.accounts[0]?.id ?? "",
    );
    return options;
  };

  const openManagement = async () => {
    if (!account || busy) return;
    setBusy(true);
    setError(null);
    try {
      await loadManagementOptions(account.id);
      setManagementReason("");
      setSelectedMovementItems([]);
      setConfirmingAccountCancellation(false);
      setManagementOpen(true);
    } catch (managementError) {
      setError(messageFor(managementError));
    } finally {
      setBusy(false);
    }
  };

  const generatePrecheck = async () => {
    if (!account || busy || account.items.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const nextPrecheck = await api.createPrecheck(account.id, account.version);
      setPrecheck(nextPrecheck);
      setNotice(`Precuenta #${nextPrecheck.sequence} generada`);
    } catch (precheckError) {
      await handleMutationError(precheckError);
    } finally {
      setBusy(false);
    }
  };

  const applyDiscount = async () => {
    if (!account || busy || !managementReason.trim()) return;
    const percentage = Number(discountPercent);
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
      setError("El descuento debe estar entre 0.01% y 100%");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.applyAccountAdjustment(account.id, {
        kind: "discount",
        calculation: "percentage",
        value: Math.round(percentage * 100),
        expectedVersion: account.version,
        reason: managementReason.trim(),
      });
      const next = await refreshAccount(account.id);
      await loadManagementOptions(account.id);
      setManagementReason("");
      setNotice(`Descuento aplicado. Nuevo total: ${formatMoney(next.totalInCents)}`);
    } catch (discountError) {
      await handleMutationError(discountError);
    } finally {
      setBusy(false);
    }
  };

  const voidAdjustment = async (adjustmentId: string) => {
    if (!account || busy || !managementReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.voidAccountAdjustment(account.id, adjustmentId, {
        expectedVersion: account.version,
        reason: managementReason.trim(),
      });
      await refreshAccount(account.id);
      await loadManagementOptions(account.id);
      setManagementReason("");
      setNotice("Descuento anulado con trazabilidad");
    } catch (voidError) {
      await handleMutationError(voidError);
    } finally {
      setBusy(false);
    }
  };

  const updateContext = async (change: { tableId?: string; responsibleUserId?: string }) => {
    if (!account || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateAccountContext(account.id, {
        expectedVersion: account.version,
        ...change,
      });
      const next = await refreshAccount(account.id);
      await loadManagementOptions(account.id);
      setNotice(change.tableId ? `Cuenta movida a ${next.tableName}` : `Responsable: ${next.responsible.displayName}`);
    } catch (contextError) {
      await handleMutationError(contextError);
    } finally {
      setBusy(false);
    }
  };

  const toggleMovementItem = (itemId: string) => {
    setSelectedMovementItems((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId],
    );
  };

  const selectedItems = account?.items
    .filter((item) => selectedMovementItems.includes(item.id))
    .map((item) => ({ itemId: item.id, quantity: item.quantity })) ?? [];

  const splitSelected = async () => {
    if (!account || busy || selectedItems.length === 0 || !managementReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.splitAccount(account.id, {
        expectedVersion: account.version,
        items: selectedItems,
        reason: managementReason.trim(),
      });
      await refreshAccount(account.id);
      await loadManagementOptions(account.id);
      setSelectedMovementItems([]);
      setManagementReason("");
      setNotice("Cuenta dividida; la mesa ahora muestra dos cuentas");
    } catch (splitError) {
      await handleMutationError(splitError);
    } finally {
      setBusy(false);
    }
  };

  const transferSelected = async () => {
    if (!account || !managementOptions || busy || selectedItems.length === 0 || !managementReason.trim()) return;
    const destination = managementOptions.accounts.find(
      (candidate) => candidate.id === movementTargetId,
    );
    if (!destination) return;
    setBusy(true);
    setError(null);
    try {
      await api.transferAccountItems(account.id, {
        destinationAccountId: destination.id,
        sourceExpectedVersion: account.version,
        destinationExpectedVersion: destination.version,
        items: selectedItems,
        reason: managementReason.trim(),
      });
      await refreshAccount(account.id);
      await loadManagementOptions(account.id);
      setSelectedMovementItems([]);
      setManagementReason("");
      setNotice(`Artículos transferidos a ${destination.label}`);
    } catch (transferError) {
      await handleMutationError(transferError);
    } finally {
      setBusy(false);
    }
  };

  const mergeCurrent = async () => {
    if (!account || !managementOptions || busy || !managementReason.trim()) return;
    const destination = managementOptions.accounts.find(
      (candidate) => candidate.id === movementTargetId,
    );
    if (!destination) return;
    setBusy(true);
    setError(null);
    try {
      const merged = await api.mergeAccount(account.id, {
        destinationAccountId: destination.id,
        sourceExpectedVersion: account.version,
        destinationExpectedVersion: destination.version,
        reason: managementReason.trim(),
      });
      await refreshAccount(merged.destinationAccountId);
      setManagementOpen(false);
      setManagementOptions(null);
      setSelectedMovementItems([]);
      setManagementReason("");
      setNotice(`Cuentas unidas en ${destination.label}`);
    } catch (mergeError) {
      await handleMutationError(mergeError);
    } finally {
      setBusy(false);
    }
  };

  const showServices = async () => {
    setAccount(null);
    setDetailsOpen(false);
    setLeavingAccount(false);
    await loadServiceData();
  };

  const leaveCurrentAccount = async () => {
    if (!account || busy) return;
    const canDiscardOwnCounter = account.serviceType !== "table" && (
      account.responsible.id === session?.user.id || session?.user.permissions.includes("service.account.manage")
    );
    const hasItems = account.items.some((item) => item.preparationState !== "cancelled");
    if (canDiscardOwnCounter && !hasItems && !account.adjustments.length && !account.scheduledFor) {
      await cancelCurrentAccount("Servicio sin productos descartado al salir");
      return;
    }
    if (canDiscardOwnCounter && hasItems && !account.scheduledFor) {
      setLeavingAccount(true);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try { await showServices(); }
    catch (navigationError) { setError(messageFor(navigationError)); }
    finally { setBusy(false); }
  };

  const cancelCurrentAccount = async (reason: string) => {
    if (!account || busy || !reason.trim()) return;
    const cancelledLabel = serviceLabel(account);
    setBusy(true);
    setError(null);
    try {
      await api.cancelAccount(account.id, {
        expectedVersion: account.version,
        reason: reason.trim(),
      });
      setAccount(null);
      setLeavingAccount(false);
      setDetailsOpen(false);
      setManagementOpen(false);
      setManagementOptions(null);
      setManagementReason("");
      setConfirmingAccountCancellation(false);
      setQuickCancellationOpen(false);
      setQuickCancellationReason("");
      await loadServiceData();
      setNotice(account.tableId ? `${cancelledLabel} liberada` : `${cancelledLabel} cancelada`);
    } catch (cancellationError) {
      await handleMutationError(cancellationError);
    } finally {
      setBusy(false);
    }
  };

  const openCheckout = async () => {
    if (!account || busy) return;
    setBusy(true);
    setError(null);
    setCheckoutError(null);
    try {
      const [nextShiftContext, nextPaymentMethods] = await Promise.all([
        api.currentCashShift(),
        api.paymentMethods(),
      ]);
      setCashShiftContext(nextShiftContext);
      setPaymentMethods(nextPaymentMethods);
      setOpeningFloat("500.00");
      setPaymentMode("cash");
      setTipPercent("0");
      setCashTendered(moneyInput(account.totalInCents));
      const half = Math.max(1, Math.floor(account.totalInCents / 2));
      setCombinedCashAmount(moneyInput(half));
      setCardReference("");
      setCheckoutOpen(true);
    } catch (checkoutLoadError) {
      setError(messageFor(checkoutLoadError));
    } finally {
      setBusy(false);
    }
  };

  const openCashShift = async () => {
    const openingFloatInCents = moneyInputToCents(openingFloat);
    if (openingFloatInCents === null) {
      setCheckoutError("Captura un fondo inicial válido");
      return;
    }
    setBusy(true);
    setCheckoutError(null);
    try {
      setCashShiftContext(await api.openCashShift(openingFloatInCents));
      setNotice("Turno de caja abierto");
    } catch (shiftError) {
      if (shiftError instanceof ApiError && shiftError.status === 409) {
        const current = await api.currentCashShift().catch(() => null);
        if (current?.shift) {
          setCashShiftContext(current);
          setNotice("Se usará el turno de caja que ya estaba abierto");
          return;
        }
      }
      setCheckoutError(messageFor(shiftError));
    } finally {
      setBusy(false);
    }
  };

  const choosePaymentMode = (mode: PaymentMode) => {
    if (!account) return;
    const percentage = Number(tipPercent);
    const tip = Number.isFinite(percentage)
      ? Math.round(account.totalInCents * percentage / 100)
      : 0;
    setPaymentMode(mode);
    setCheckoutError(null);
    if (mode === "cash") {
      setCashTendered(moneyInput(account.totalInCents + tip));
    } else if (mode === "combined") {
      const half = Math.max(1, Math.floor(account.totalInCents / 2));
      setCombinedCashAmount(moneyInput(half));
      setCashTendered(moneyInput(half));
    }
  };

  const updateTipPercent = (value: string) => {
    setTipPercent(value);
    if (!account || paymentMode !== "cash") return;
    const percentage = Number(value);
    const tip = Number.isFinite(percentage) && percentage >= 0
      ? Math.round(account.totalInCents * percentage / 100)
      : 0;
    setCashTendered(moneyInput(account.totalInCents + tip));
  };

  const capturePayment = async () => {
    if (!account || busy) return;
    const percentage = Number(tipPercent);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      setCheckoutError("La propina debe estar entre 0% y 100%");
      return;
    }
    const tipInCents = Math.round(account.totalInCents * percentage / 100);
    const hasMethod = (code: PaymentMethod["code"]) =>
      paymentMethods.some((method) => method.code === code);
    const payments: CheckoutPayment[] = [];

    if (paymentMode === "cash") {
      const tenderedInCents = moneyInputToCents(cashTendered);
      if (!hasMethod("CASH") || tenderedInCents === null) {
        setCheckoutError("Captura un importe válido de efectivo recibido");
        return;
      }
      if (tenderedInCents < account.totalInCents + tipInCents) {
        setCheckoutError("El efectivo recibido no cubre la cuenta y la propina");
        return;
      }
      payments.push({
        methodCode: "CASH",
        amountInCents: account.totalInCents,
        tipInCents,
        tenderedInCents,
      });
    } else if (paymentMode === "card" || paymentMode === "transfer") {
      const methodCode = paymentMode === "transfer" ? "TRANSFER" : "CARD";
      const method = paymentMethods.find((entry) => entry.code === methodCode);
      if (!method || (method.requiresReference && !cardReference.trim())) {
        setCheckoutError(paymentMode === "transfer" ? "Captura la referencia de la transferencia" : "Captura la autorización o referencia de la tarjeta");
        return;
      }
      payments.push({
        methodCode,
        amountInCents: account.totalInCents,
        tipInCents,
        reference: cardReference.trim(),
      });
    } else {
      const cashAmountInCents = moneyInputToCents(combinedCashAmount);
      const tenderedInCents = moneyInputToCents(cashTendered);
      if (!hasMethod("CASH") || !hasMethod("CARD")) {
        setCheckoutError("Efectivo o tarjeta no están configurados");
        return;
      }
      if (
        cashAmountInCents === null || cashAmountInCents <= 0 ||
        cashAmountInCents >= account.totalInCents
      ) {
        setCheckoutError("La parte en efectivo debe ser mayor a cero y menor al total");
        return;
      }
      if (tenderedInCents === null || tenderedInCents < cashAmountInCents) {
        setCheckoutError("El efectivo recibido no cubre la parte en efectivo");
        return;
      }
      if (!cardReference.trim()) {
        setCheckoutError("Captura la autorización o referencia de la tarjeta");
        return;
      }
      payments.push(
        {
          methodCode: "CASH",
          amountInCents: cashAmountInCents,
          tipInCents: 0,
          tenderedInCents,
        },
        {
          methodCode: "CARD",
          amountInCents: account.totalInCents - cashAmountInCents,
          tipInCents,
          reference: cardReference.trim(),
        },
      );
    }

    setBusy(true);
    setCheckoutError(null);
    try {
      const nextReceipt = await api.checkoutAccount(account.id, {
        expectedVersion: account.version,
        payments,
      });
      setReceipt(nextReceipt);
      setCheckoutOpen(false);
      setNotice(`Pago confirmado · ${nextReceipt.folio}`);
    } catch (paymentError) {
      setCheckoutError(messageFor(paymentError));
    } finally {
      setBusy(false);
    }
  };

  const assignPaidReceipt = async () => {
    if (!receipt || busy) return;
    setBusy(true);
    setError(null);
    try {
      const current = await api.account(receipt.account.id);
      setDeliveryAccount(current);
      setDeliveryOpen(true);
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  const closeReceipt = async () => {
    setReceipt(null);
    setAccount(null);
    setBusy(true);
    try {
      await loadServiceData();
    } catch (refreshError) {
      setError(messageFor(refreshError));
    } finally {
      setBusy(false);
    }
  };

  const loadCashPanelData = async () => {
    const context = await api.currentCashShift();
    const permissions = session?.user.permissions ?? [];
    const [receipts, closes, methods] = await Promise.all([
      permissions.includes("sales.receipt.read") ? api.recentReceipts() : Promise.resolve([]),
      permissions.includes("cash.shift.reconcile") ? api.cashShiftCloses() : Promise.resolve([]),
      api.paymentMethods(),
    ]);
    setCashShiftContext(context);
    setRecentReceipts(receipts);
    setClosedShifts(closes);
    setPaymentMethods(methods);
    if (!context.shift || !permissions.includes("cash.shift.preview")) {
      setCashReport(null);
      setCashDeclarations(Object.fromEntries(methods.map((method) => [method.code, ""])));
      return;
    }
    const report = await api.currentCashReport();
    setCashReport(report);
    setCashDeclarations(Object.fromEntries(report.paymentMethods.map((method) => [method.code, moneyInput(method.code === "CASH" ? report.cash.theoreticalInCents : method.netInCents)])));
  };

  const openCashPanel = async () => {
    if (busy) return;
    setBusy(true);
    setCashPanelError(null);
    setCashClose(null);
    setCashCloseConfirmation(false);
    try {
      await loadCashPanelData();
      setCashPanelOpen(true);
    } catch (panelError) {
      setError(messageFor(panelError));
    } finally {
      setBusy(false);
    }
  };

  const openShiftFromCashPanel = async () => {
    const openingFloatInCents = moneyInputToCents(openingFloat);
    if (openingFloatInCents === null) {
      setCashPanelError("Captura un fondo inicial válido");
      return;
    }
    setBusy(true);
    setCashPanelError(null);
    try {
      await api.openCashShift(openingFloatInCents);
      await loadCashPanelData();
      setNotice("Turno de caja abierto");
    } catch (shiftError) {
      setCashPanelError(messageFor(shiftError));
    } finally {
      setBusy(false);
    }
  };

  const recordCashMovement = async () => {
    const amountInCents = moneyInputToCents(cashMovementAmount);
    if (!amountInCents || !cashMovementReason.trim()) {
      setCashPanelError("Captura un importe mayor a cero y el motivo");
      return;
    }
    setBusy(true);
    setCashPanelError(null);
    try {
      await api.createCashMovement({
        direction: cashMovementDirection,
        amountInCents,
        reason: cashMovementReason.trim(),
      });
      setCashMovementAmount("");
      setCashMovementReason("");
      await loadCashPanelData();
      setNotice(cashMovementDirection === "in" ? "Entrada de caja registrada" : "Salida de caja registrada");
    } catch (movementError) {
      setCashPanelError(messageFor(movementError));
    } finally {
      setBusy(false);
    }
  };

  const closeCurrentCashShift = async () => {
    if (!cashShiftContext?.shift) return;
    const declarations = (cashReport?.paymentMethods ?? paymentMethods).map((method) => ({
      methodCode: method.code,
      declaredInCents: moneyInputToCents(cashDeclarations[method.code] ?? "") ?? -1,
    }));
    if (declarations.some((declaration) => declaration.declaredInCents < 0)) {
      setCashPanelError("Captura una declaración válida para cada forma de pago");
      return;
    }
    setBusy(true);
    setCashPanelError(null);
    try {
      const result = await api.closeCashShift({
        expectedVersion: cashShiftContext.shift.version,
        declarations,
      });
      setCashClose(result);
      setCashReport(null);
      setCashShiftContext({ register: result.blind ? result.register : result.report.register, shift: null });
      setCashCloseConfirmation(false);
      setNotice("Turno de caja cerrado y corte enviado a impresión");
    } catch (closeError) {
      setCashPanelError(messageFor(closeError));
      setCashCloseConfirmation(false);
    } finally {
      setBusy(false);
    }
  };

  const performReceiptAction = async () => {
    if (!receiptAction || !receiptActionReason.trim()) return;
    setBusy(true);
    setCashPanelError(null);
    try {
      if (receiptAction.kind === "reprint") {
        await api.reprintReceipt(receiptAction.receipt.id, receiptActionReason.trim());
        setNotice(`${receiptAction.receipt.folio} enviado a reimpresión`);
      } else {
        await api.refundReceipt(receiptAction.receipt.id, {
          kind: receiptAction.kind,
          reason: receiptActionReason.trim(),
        });
        await loadCashPanelData();
        setNotice(
          receiptAction.kind === "cancellation"
            ? `${receiptAction.receipt.folio} cancelado`
            : `${receiptAction.receipt.folio} devuelto`,
        );
      }
      setReceiptAction(null);
      setReceiptActionReason("");
    } catch (actionError) {
      setCashPanelError(messageFor(actionError));
    } finally {
      setBusy(false);
    }
  };

  if (!terminal) {
    return (
      <AccessShell title="Configurar terminal" subtitle="Esta operación se realiza una sola vez en cada tablet.">
        <form className="access-form" onSubmit={handleRegister}>
          <label>Código de terminal<input name="terminalCode" defaultValue="POS-01" pattern="[A-Za-z0-9_-]{2,24}" required /></label>
          <label>Nombre visible<input name="displayName" defaultValue="Terminal 1" maxLength={80} required /></label>
          <label>Token de instalación<input name="bootstrapToken" type="password" autoComplete="off" required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="access-primary" type="submit" disabled={busy}>{busy ? "Registrando…" : "Registrar terminal"}</button>
        </form>
      </AccessShell>
    );
  }

  if (!session) {
    return (
      <AccessShell title="Acceso al punto de venta" subtitle={`${terminal.displayName} · Servidor local`}>
        <form className="access-form login-form" onSubmit={handleLogin}>
          <label>Código de empleado<input name="employeeCode" defaultValue="ADMIN" autoCapitalize="characters" required /></label>
          <label>PIN<input name="pin" type="password" inputMode="numeric" autoComplete="current-password" minLength={4} maxLength={12} required autoFocus /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="access-primary" type="submit" disabled={busy}>{busy ? "Ingresando…" : "Ingresar"}</button>
          <button className="access-link" type="button" onClick={forgetTerminal}>Configurar otra terminal</button>
        </form>
      </AccessShell>
    );
  }

  const canManageAccounting = session.user.permissions.includes("accounting.manage");
  const canManageDelivery = session.user.permissions.includes("delivery.manage");
  const canManageCatalog = session.user.permissions.includes("catalog.product.manage");
  const pricesEditor = pricesEditorOpen && canManageCatalog && (
    <CatalogPricesEditor
      api={api}
      categories={catalog}
      initialCategoryId={activeCategoryId ?? undefined}
      onChanged={refreshCatalog}
      onClose={() => setPricesEditorOpen(false)}
    />
  );
  if (accountingOpen && canManageAccounting) {
    return <main className="service-shell"><AccountingPanel api={api} onClose={() => setAccountingOpen(false)} /></main>;
  }
  if (deliveryOpen && canManageDelivery) {
    return <main className="service-shell"><DeliveryPanel api={api} account={deliveryAccount} onClose={() => { setDeliveryOpen(false); setDeliveryAccount(null); }} /></main>;
  }

  if (!account) {
    const canManageCash = session.user.permissions.includes("cash.shift.read") && (session.user.permissions.includes("cash.shift.preview") || session.user.permissions.includes("cash.shift.close"));
    return (
      <main className="service-shell">
        <RemoteTopbar terminal={terminal} session={session} onLogout={logout} />
        <section className="service-selector" aria-labelledby="service-title">
          <div className="service-selector-heading">
            <div><span className="eyebrow">Nuevo servicio</span><h1 id="service-title">Selecciona una mesa</h1></div>
            <div className="service-heading-actions">
              {canManageCatalog && <button className="cash-panel-button" type="button" disabled={busy} onClick={() => setPricesEditorOpen(true)}>Precios del menú</button>}
              {canManageAccounting && <button className="cash-panel-button" type="button" disabled={busy} onClick={() => setAccountingOpen(true)}>Contabilidad y proveedores</button>}
              {canManageDelivery && <button className="cash-panel-button" type="button" disabled={busy} onClick={() => { setDeliveryAccount(null); setDeliveryOpen(true); }}>Repartos</button>}
              {canManageCash && <button className="cash-panel-button" type="button" disabled={busy} onClick={() => void openCashPanel()}>Caja y corte</button>}
              <div className="guest-counter" aria-label="Número de comensales">
                <span>Comensales</span>
                <button type="button" aria-label="Quitar comensal" disabled={guestCount <= 1} onClick={() => setGuestCount((count) => count - 1)}>−</button>
                <output aria-label={`${guestCount} comensales`}>{guestCount}</output>
                <button type="button" aria-label="Agregar comensal" disabled={guestCount >= 99} onClick={() => setGuestCount((count) => count + 1)}>+</button>
              </div>
            </div>
          </div>
          {error && <p className="form-error service-error" role="alert">{error}</p>}
          <div className="counter-services">
            <button type="button" disabled={busy} onClick={() => void openCounterService("quick")}><span>⚡</span><strong>Venta rápida</strong><small>Sin mesa</small></button>
            <button type="button" disabled={busy} onClick={() => void openCounterService("takeaway")}><span>🛍️</span><strong>Para llevar</strong><small>Orden abierta</small></button>
            <button type="button" disabled={busy} onClick={() => void openCounterService("takeaway", true)}><span>🕒</span><strong>Programar pedido</strong><small>Envío automático a cocina</small></button>
          </div>
          {openCounterAccounts.length > 0 && (
            <section className="open-counter-section" aria-labelledby="open-counter-title">
              <div><h2 id="open-counter-title">Servicios abiertos</h2><span>{openCounterAccounts.length} sin mesa</span></div>
              <div className="open-counter-grid">
                {openCounterAccounts.map((openAccount) => (
                  <button type="button" key={openAccount.id} disabled={busy} onClick={() => void selectExistingAccount(openAccount.id)} aria-label={`Abrir ${openAccount.label} ${openAccount.sequence}`}>
                    <span>{openAccount.serviceType === "takeaway" ? "🛍️" : "⚡"}</span>
                    <strong>{openAccount.label} {openAccount.sequence}</strong>
                    <small>{openAccount.customerName ? `Cliente: ${openAccount.customerName}` : openAccount.responsible.displayName}</small>
                    <small>{openAccount.itemCount} productos{openAccount.scheduledFor ? ` · ${openAccount.scheduleDispatchedAt ? "Enviado" : "Programado"}: ${scheduledLabel(openAccount.scheduledFor)}` : ""}</small>
                    <b>{formatMoney(openAccount.totalInCents)}</b>
                    {openAccount.scheduleError && <small className="schedule-error">Envío pendiente; reintentando</small>}
                  </button>
                ))}
              </div>
            </section>
          )}
          {layout?.areas.map((area) => (
            <section className="area-section" key={area.id} aria-labelledby={`area-${area.id}`}>
              <h2 id={`area-${area.id}`}>{area.name}</h2>
              <div className="table-grid">
                {area.tables.map((table) => (
                  <button
                    className={`table-card ${table.state}`}
                    key={table.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void selectTable(table)}
                    aria-label={`${table.name}, ${table.state === "free" ? "libre" : "ocupada"}`}
                  >
                    <span className="table-state">{table.state === "free" ? "Libre" : "Ocupada"}</span>
                    <strong>{table.name}</strong>
                    <small>{table.accountCount > 1 ? `${table.accountCount} cuentas abiertas` : `Hasta ${table.capacity} personas`}</small>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </section>
        {pricesEditor}
        {accountChoices.length > 0 && (
          <div className="modal-backdrop" role="presentation">
            <section className="touch-modal account-picker" role="dialog" aria-modal="true" aria-labelledby="account-picker-title">
              <div className="modal-heading"><div><span className="eyebrow">Mesa dividida</span><h2 id="account-picker-title">Selecciona una cuenta</h2></div><button type="button" aria-label="Cerrar" onClick={() => setAccountChoices([])}>×</button></div>
              <div className="account-choice-grid">
                {accountChoices.map((choice, index) => (
                  <button type="button" key={choice.id} disabled={busy} onClick={() => void selectExistingAccount(choice.id)}>
                    <span>Cuenta {index + 1}{choice.isPrimary ? " · Principal" : ""}</span>
                    <strong>{formatMoney(choice.totalInCents)}</strong>
                    <small>{choice.itemCount} productos · {choice.responsible.displayName}</small>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
        {cashPanelOpen && canManageCash && (
          <div className="modal-backdrop" role="presentation">
            <section className="touch-modal cash-panel-modal" role="dialog" aria-modal="true" aria-labelledby="cash-panel-title">
              <div className="modal-heading">
                <div><span className="eyebrow">Operación auditada</span><h2 id="cash-panel-title">Caja y corte</h2></div>
                <button type="button" aria-label="Cerrar" onClick={() => { setCashPanelOpen(false); setReceiptAction(null); }}>×</button>
              </div>
              {cashPanelError && <p className="form-error" role="alert">{cashPanelError}</p>}

              {cashClose ? (
                <section className="cash-close-result">
                  <span className="success-mark" aria-hidden="true">✓</span>
                  <h3>Turno cerrado</h3>
                  <p>El corte quedó guardado y se envió a la cola de impresión.</p>
                  <div className="cash-declaration-results">
                    {cashClose.declarations.map((declaration) => (
                      <div key={declaration.method.code}>
                        <span>{declaration.method.name}</span>
                        <strong>{formatMoney(declaration.declaredInCents)}</strong>
                        {session.user.permissions.includes("cash.shift.preview") && "differenceInCents" in declaration && <small className={declaration.differenceInCents === 0 ? "balanced" : "difference"}>Diferencia {formatMoney(declaration.differenceInCents)}</small>}
                      </div>
                    ))}
                  </div>
                  <button className="access-primary" type="button" onClick={() => setCashPanelOpen(false)}>Finalizar</button>
                </section>
              ) : !cashShiftContext?.shift ? (
                <div className="cash-panel-content">
                  <section className="cash-open-panel">
                    <h3>Abrir turno de caja</h3>
                    <p>Registra el efectivo disponible para dar cambio. No se contará como venta.</p>
                    <label>Fondo inicial<input aria-label="Fondo inicial de caja" type="number" inputMode="decimal" min="0" step="0.01" value={openingFloat} onChange={(event) => setOpeningFloat(event.target.value)} /></label>
                    <button className="access-primary" type="button" disabled={busy} onClick={() => void openShiftFromCashPanel()}>{busy ? "Abriendo…" : "Abrir turno"}</button>
                  </section>
                  {session.user.permissions.includes("sales.receipt.read") && <section className="cash-panel-section">
                    <h3>Tickets recientes</h3>
                    <p>La reimpresión está disponible aunque el turno anterior ya esté cerrado.</p>
                    <div className="cash-receipt-list">
                      {recentReceipts.length === 0 && <p className="management-hint">Todavía no hay tickets.</p>}
                      {recentReceipts.map((item) => (
                        <article key={item.id}>
                          <div><strong>{item.folio}</strong><span>{item.accountLabel}</span><small>{new Date(item.issuedAt).toLocaleString("es-MX")} · {item.status === "issued" ? "Emitido" : item.status === "cancelled" ? "Cancelado" : "Devuelto"}</small></div>
                          <strong>{formatMoney(item.totalInCents)}</strong>
                          <div className="cash-receipt-actions"><button type="button" onClick={() => { setReceiptAction({ receipt: item, kind: "reprint" }); setReceiptActionReason(""); }}>Reimprimir</button></div>
                        </article>
                      ))}
                    </div>
                  </section>
                  }
                </div>
              ) : (
                <div className="cash-panel-content">
                  {cashReport && session.user.permissions.includes("cash.shift.preview") && <><section className="cash-summary-grid" aria-label="Resumen del turno">
                    <div><span>Venta neta</span><strong>{formatMoney(cashReport.sales.netSaleInCents)}</strong><small>{cashReport.sales.receiptCount} tickets</small></div>
                    <div><span>Efectivo teórico</span><strong>{formatMoney(cashReport.cash.theoreticalInCents)}</strong><small>Incluye fondo y movimientos</small></div>
                    <div><span>Devoluciones</span><strong>{formatMoney(cashReport.sales.refundedSaleInCents)}</strong><small>{cashReport.sales.refundCount} operaciones</small></div>
                    <div><span>Cuentas abiertas</span><strong>{cashReport.openAccountCount}</strong><small>{cashReport.openAccountCount === 0 ? "Listo para cierre" : "Deben cerrarse primero"}</small></div>
                  </section>

                  <section className="cash-panel-section">
                    <h3>Formas de pago</h3>
                    <div className="cash-method-list">
                      {cashReport.paymentMethods.map((method) => <div key={method.code}><span>{method.name}</span><strong>{formatMoney(method.netInCents)}</strong></div>)}
                    </div>
                  </section>

                  </>}

                  {session.user.permissions.includes("cash.movement.create") && <section className="cash-panel-section">
                    <h3>Entrada o salida de efectivo</h3>
                    <div className="cash-movement-form">
                      <div className="cash-direction-options">
                        <button className={cashMovementDirection === "in" ? "selected" : ""} type="button" onClick={() => setCashMovementDirection("in")}>Entrada</button>
                        <button className={cashMovementDirection === "out" ? "selected" : ""} type="button" onClick={() => setCashMovementDirection("out")}>Retiro / gasto</button>
                      </div>
                      <label>Importe<input aria-label="Importe del movimiento" type="number" inputMode="decimal" min="0.01" step="0.01" value={cashMovementAmount} onChange={(event) => setCashMovementAmount(event.target.value)} /></label>
                      <label>Motivo<input aria-label="Motivo del movimiento" maxLength={200} value={cashMovementReason} onChange={(event) => setCashMovementReason(event.target.value)} /></label>
                      <ReasonPresets context={cashMovementDirection === "in" ? "cashIn" : "cashOut"} value={cashMovementReason} onChange={setCashMovementReason} disabled={busy} />
                      <button type="button" disabled={busy || !cashMovementAmount || !cashMovementReason.trim()} onClick={() => void recordCashMovement()}>Registrar movimiento</button>
                    </div>
                  </section>

                  }

                  {session.user.permissions.includes("sales.receipt.read") && <section className="cash-panel-section">
                    <h3>Tickets recientes</h3>
                    <div className="cash-receipt-list">
                      {recentReceipts.length === 0 && <p className="management-hint">Todavía no hay tickets.</p>}
                      {recentReceipts.map((item) => (
                        <article key={item.id}>
                          <div><strong>{item.folio}</strong><span>{item.accountLabel}</span><small>{new Date(item.issuedAt).toLocaleString("es-MX")} · {item.status === "issued" ? "Emitido" : item.status === "cancelled" ? "Cancelado" : "Devuelto"}</small></div>
                          <strong>{formatMoney(item.totalInCents)}</strong>
                          <div className="cash-receipt-actions">
                            <button type="button" onClick={() => { setReceiptAction({ receipt: item, kind: "reprint" }); setReceiptActionReason(""); }}>Reimprimir</button>
                            {item.status === "issued" && <button type="button" onClick={() => { setReceiptAction({ receipt: item, kind: "cancellation" }); setReceiptActionReason(""); }}>Cancelar</button>}
                            {item.status === "issued" && <button className="danger-button" type="button" onClick={() => { setReceiptAction({ receipt: item, kind: "refund" }); setReceiptActionReason(""); }}>Devolver</button>}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>

                  }

                  <section className="cash-panel-section cash-close-section">
                    <h3>Declaración y cierre</h3>
                    <p>Captura el efectivo contado y los comprobantes de cada forma de pago. El administrador revisará las diferencias.</p>
                    <div className="cash-declaration-grid">
                      {(cashReport?.paymentMethods ?? paymentMethods).map((method) => (
                        <label key={method.code}>{method.name}<input aria-label={`Declarado ${method.name}`} type="number" inputMode="decimal" min="0" step="0.01" value={cashDeclarations[method.code] ?? ""} onChange={(event) => setCashDeclarations((current) => ({ ...current, [method.code]: event.target.value }))} /></label>
                      ))}
                    </div>
                    {(cashReport?.openAccountCount ?? 0) > 0 && <p className="form-error">Cierra o cancela las cuentas abiertas antes de cerrar caja.</p>}
                    {cashCloseConfirmation ? (
                      <div className="danger-confirmation">
                        <strong>¿Confirmas el cierre definitivo del turno?</strong>
                        <span>Después del cierre no se podrán registrar más cobros ni movimientos en este turno.</span>
                        <div><button type="button" onClick={() => setCashCloseConfirmation(false)}>Seguir revisando</button><button className="danger-button" type="button" disabled={busy || (cashReport?.openAccountCount ?? 0) > 0} onClick={() => void closeCurrentCashShift()}>Confirmar cierre</button></div>
                      </div>
                    ) : (
                      <button className="danger-button cash-close-button" type="button" disabled={busy || (cashReport?.openAccountCount ?? 0) > 0} onClick={() => setCashCloseConfirmation(true)}>Cerrar turno de caja</button>
                    )}
                  </section>
                </div>
              )}
              {session.user.permissions.includes("cash.shift.reconcile") && closedShifts.length > 0 && <section className="cash-panel-section" aria-label="Conciliación de cortes">
                <h3>Cortes registrados por cajero</h3>
                {closedShifts.map((close) => <article className="cash-history-close" key={close.id}>
                  <strong>{new Date(close.closedAt).toLocaleString("es-MX")} · {close.report.register.name}</strong>
                  <span>Cajero: {close.closedBy?.displayName ?? close.report.shift.openedBy.displayName}</span>
                  {close.declarations.map((declaration) => <div key={declaration.method.code}><strong>{declaration.method.name}</strong><span>Registrado: {formatMoney(declaration.theoreticalInCents)}</span><span>Declarado: {formatMoney(declaration.declaredInCents)}</span><span className={declaration.differenceInCents === 0 ? "balanced" : "difference"}>Diferencia: {formatMoney(declaration.differenceInCents)}</span></div>)}
                </article>)}
              </section>}
            </section>
          </div>
        )}
        {cashPanelOpen && receiptAction && (
          <div className="modal-backdrop nested-backdrop" role="presentation">
            <section className="touch-modal note-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-action-title">
              <div className="modal-heading"><div><span className="eyebrow">Ticket {receiptAction.receipt.folio}</span><h2 id="receipt-action-title">{receiptAction.kind === "reprint" ? "Reimprimir ticket" : receiptAction.kind === "cancellation" ? "Cancelar ticket" : "Devolver ticket"}</h2></div><button type="button" aria-label="Cerrar" onClick={() => setReceiptAction(null)}>×</button></div>
              <p className="modal-help">{receiptAction.kind === "reprint" ? "La copia quedará identificada como reimpresión." : "La venta original se conservará y se generará un movimiento compensatorio."}</p>
              <label>Motivo<textarea aria-label="Motivo de la acción sobre el ticket" value={receiptActionReason} maxLength={200} rows={3} onChange={(event) => setReceiptActionReason(event.target.value)} /></label>
              <ReasonPresets context={receiptAction.kind === "cancellation" ? "receiptCancellation" : receiptAction.kind} value={receiptActionReason} onChange={setReceiptActionReason} disabled={busy} autoFocus />
              <div className="modal-actions"><button type="button" onClick={() => setReceiptAction(null)}>Volver</button><button className={receiptAction.kind === "reprint" ? "access-primary" : "danger-button"} type="button" disabled={busy || !receiptActionReason.trim()} onClick={() => void performReceiptAction()}>{busy ? "Procesando…" : "Confirmar"}</button></div>
            </section>
          </div>
        )}
      </main>
    );
  }

  const activeCategory = catalog.find((category) => category.id === activeCategoryId) ?? catalog[0];
  const editingCategory = editingItem
    ? catalog.find((category) => category.products.some((product) => product.id === editingItem.productId))
    : undefined;
  const editingProduct = editingCategory?.products.find((product) => product.id === editingItem?.productId);
  const canManageAccount = session.user.permissions.includes("service.account.manage");
  const canDiscount = session.user.permissions.includes("service.account.discount");
  const canCreatePrecheck = session.user.permissions.includes("service.precheck.create");
  const canCapturePayment = session.user.permissions.includes("sales.payment.capture");
  const seasonalCategory = seasonalEditorOpen
    ? catalog.find((category) => category.id === activeCategory?.id && category.seasonal)
    : undefined;
  const pendingCount = account.items
    .filter((item) => item.preparationState === "pending")
    .reduce((total, item) => total + item.quantity, 0);
  const activeAccountItemCount = account.items
    .filter((item) => item.preparationState !== "cancelled")
    .reduce((total, item) => total + item.quantity, 0);
  const canDiscardCounter = account.serviceType !== "table" && (
    account.responsible.id === session.user.id || canManageAccount
  );
  const canCancelAccount = (activeAccountItemCount === 0 || (canDiscardCounter && account.items.every((item) => ["pending", "cancelled"].includes(item.preparationState)))) && account.adjustments.length === 0;
  const schedulePending = Boolean(account.scheduledFor && !account.scheduleDispatchedAt);
  const canEditDetails = canManageAccount || account.responsible.id === session.user.id;
  const numericTipPercent = Number(tipPercent);
  const checkoutTipInCents = Number.isFinite(numericTipPercent) && numericTipPercent >= 0
    ? Math.round(account.totalInCents * numericTipPercent / 100)
    : 0;
  const checkoutCashTenderedInCents = moneyInputToCents(cashTendered) ?? 0;
  const checkoutCombinedCashInCents = moneyInputToCents(combinedCashAmount) ?? 0;
  const checkoutCashRequiredInCents = paymentMode === "cash"
    ? account.totalInCents + checkoutTipInCents
    : paymentMode === "combined"
      ? checkoutCombinedCashInCents
      : 0;
  const checkoutChangeInCents = Math.max(
    0,
    checkoutCashTenderedInCents - checkoutCashRequiredInCents,
  );
  const checkoutCardInCents = paymentMode === "combined"
    ? Math.max(0, account.totalInCents - checkoutCombinedCashInCents)
    : account.totalInCents;

  return (
    <main className="app-shell remote-pos">
      <RemoteTopbar
        terminal={terminal}
        session={session}
        context={serviceLabel(account)}
        guestCount={account.guestCount}
        onContextClick={() => void leaveCurrentAccount()}
        onLogout={logout}
      />
      <section className="workspace">
        <nav className="category-rail" aria-label="Categorías del menú">
          {catalog.map((category) => (
            <button
              className={activeCategory?.id === category.id ? "category active" : "category"}
              key={category.id}
              type="button"
              aria-pressed={activeCategory?.id === category.id}
              onClick={() => setActiveCategoryId(category.id)}
            >
              <span aria-hidden="true">{category.products[0]?.emoji ?? "•"}</span>
              <strong>{category.name}</strong>
            </button>
          ))}
        </nav>
        <section className="menu-panel" aria-labelledby="menu-title">
          <div className="section-heading">
            <div><span className="eyebrow">Menú</span><h1 id="menu-title">{activeCategory?.name ?? "Productos"}</h1></div>
            {busy && <span className="working-pill" role="status">Actualizando…</span>}
            {canManageCatalog && <button className="cash-panel-button" type="button" disabled={busy} onClick={() => setPricesEditorOpen(true)}>Precios del menú</button>}
            {activeCategory?.seasonal && canManageCatalog && <button className="cash-panel-button" type="button" disabled={busy} onClick={() => setSeasonalEditorOpen(true)}>Editar platillos</button>}
          </div>
          <div className="product-grid">
            {activeCategory?.products.filter((product) => product.available || !activeCategory.seasonal).map((product) => (
              <button
                className={`product-card tone-${product.color ?? "cream"}`}
                key={product.id}
                type="button"
                disabled={!product.available || busy}
                onClick={() => chooseProduct(activeCategory, product)}
                aria-label={`Agregar ${product.name}, ${formatMoney(product.priceInCents)}`}
              >
                <span className="product-emoji" aria-hidden="true">{product.emoji ?? "🍽️"}</span>
                <span className="product-copy"><strong>{product.shortName}</strong><span>{formatMoney(product.priceInCents)}</span></span>
                <span className="add-indicator" aria-hidden="true">+</span>
              </button>
            ))}
          </div>
        </section>
        <aside className="order-panel" aria-labelledby="order-title">
          <div className="order-details-heading">
            <div className="order-heading">
              <div><span className="eyebrow">Cuenta actual</span><h2 id="order-title">{serviceLabel(account)}</h2></div>
              <div className="account-heading-actions"><span className="version-pill" title="Versión de la cuenta">v{account.version}</span>{canManageAccount && <button className="icon-button" type="button" aria-label="Gestionar cuenta" disabled={busy} onClick={() => void openManagement()}>•••</button>}</div>
            </div>
            <div className="order-details">
              {account.customerName && <p className="order-details-summary">Cliente: <strong>{account.customerName}</strong></p>}
              {account.scheduledFor && <p className="order-details-summary">{account.scheduleDispatchedAt ? "Enviado a cocina" : "Envío programado"}: <strong>{scheduledLabel(account.scheduleDispatchedAt || account.scheduledFor)}</strong></p>}
              {account.scheduleError && <p className="form-error" role="alert">El envío a cocina está pendiente. El servidor volverá a intentarlo; también puedes revisar la programación.</p>}
              {canEditDetails && <button className="order-details-button" type="button" disabled={busy} onClick={() => editDetails(account)}>Cliente y programación</button>}
              {canManageDelivery && <button className="order-details-button" type="button" disabled={busy || activeAccountItemCount === 0} onClick={() => { setDeliveryAccount(account); setDeliveryOpen(true); }}>Asignar repartidor</button>}
              {canManageAccounting && <button className="order-details-button" type="button" disabled={busy} onClick={() => setAccountingOpen(true)}>Contabilidad y proveedores</button>}
            </div>
          </div>
          <div className="order-items" aria-live="polite">
            {account.items.length === 0 ? (
              <div className="empty-order"><span aria-hidden="true">☝</span><strong>Comienza la orden</strong><p>Toca un producto para agregarlo a la cuenta.</p></div>
            ) : account.items.map((item) => (
              <article className="order-item" key={item.id}>
                <div className="item-title">
                  <div>
                    <strong>{item.productName}</strong>
                    <span className={`item-state ${item.preparationState}`}>{item.preparationState === "pending" ? "Pendiente" : item.preparationState === "cancelled" ? "Cancelado" : item.preparationState === "fulfilled" ? "Listo" : "Enviado"}</span>
                  </div>
                  <strong>{formatMoney(item.lineTotalInCents)}</strong>
                </div>
                {item.modifiers.length > 0 && <small className="item-detail">{item.modifiers.map((modifier) => modifier.name).join(", ")}</small>}
                {item.note && <small className="item-detail">Nota: {item.note}</small>}
                <div className="item-actions">
                  <button type="button" aria-label={`Quitar una unidad de ${item.productName}`} disabled={busy || item.preparationState !== "pending" || item.quantity <= 1} onClick={() => void changeQuantity(item, item.quantity - 1)}>−</button>
                  <output aria-label={`Cantidad: ${item.quantity}`}>{item.quantity}</output>
                  <button type="button" aria-label={`Agregar una unidad de ${item.productName}`} disabled={busy || item.preparationState !== "pending"} onClick={() => void changeQuantity(item, item.quantity + 1)}>+</button>
                  <button className="note-button" type="button" disabled={busy || item.preparationState === "cancelled"} onClick={() => { setEditingItem(item); setNoteDraft(item.note ?? ""); }}>+ Nota</button>
                  <button className="cancel-button" type="button" disabled={busy || !["pending", "sent"].includes(item.preparationState)} onClick={() => { setCancellingItem(item); setCancellationReason(""); }}>Cancelar</button>
                </div>
              </article>
            ))}
            {session.user.permissions.includes("service.round.send") && <ProductionPrintControls
              key={account.id}
              api={api}
              accountId={account.id}
              accountVersion={account.version}
              disabled={busy}
              onBusyChange={setBusy}
            />}
          </div>
          <div className={error ? "notice error-notice" : "notice"} role={error ? "alert" : "status"}><span aria-hidden="true">●</span>{error ?? notice}</div>
          <div className="order-summary">
            <div><span>Productos</span><strong>{account.items.filter((item) => item.preparationState !== "cancelled").reduce((total, item) => total + item.quantity, 0)}</strong></div>
            <div><span>Subtotal</span><span>{formatMoney(account.totals.subtotalInCents)}</span></div>
            {account.totals.discountInCents > 0 && <div className="discount-row"><span>Descuento</span><strong>− {formatMoney(account.totals.discountInCents)}</strong></div>}
            <div><span>IVA</span><span>{formatMoney(account.totals.taxInCents)}</span></div>
            <div className="total-row"><span>Total</span><strong>{formatMoney(account.totalInCents)}</strong></div>
          </div>
          <div className="primary-actions">
            <button className="send-button" type="button" disabled={pendingCount === 0 || busy || schedulePending} onClick={() => void sendRound()}><span>{busy ? "Procesando…" : schedulePending ? "Envío automático programado" : "Enviar comanda"}</span>{pendingCount > 0 && <span className="count-badge">{pendingCount}</span>}</button>
            {canCreatePrecheck && <button className="precheck-button" type="button" disabled={account.totalInCents <= 0 || busy} onClick={() => void generatePrecheck()}>Precuenta</button>}
            <button className="pay-button" type="button" disabled={!canCapturePayment || account.totalInCents <= 0 || pendingCount > 0 || busy} onClick={() => void openCheckout()}>{canCapturePayment ? "Pago" : "Pago restringido"}</button>
            {(canManageAccount || canDiscardCounter) && <button className="release-table-button" type="button" disabled={busy} onClick={() => { setQuickCancellationReason(""); setQuickCancellationOpen(true); setError(null); }}>{account.serviceType === "table" ? "Liberar mesa" : "Cancelar pedido"}</button>}
          </div>
        </aside>
      </section>
      <footer className="bottom-status"><span>Servidor local · Sesión protegida</span><span>{terminal.displayName} · AntojitOS</span></footer>

      {precheck && (
        <div className="modal-backdrop" role="presentation">
          <section className="touch-modal precheck-modal" role="dialog" aria-modal="true" aria-labelledby="precheck-title">
            <div className="modal-heading"><div><span className="eyebrow">Vista previa de cobro</span><h2 id="precheck-title">Precuenta #{precheck.sequence}</h2></div><button type="button" aria-label="Cerrar" onClick={() => setPrecheck(null)}>×</button></div>
            <PrecheckPaper precheck={precheck} />
            <PrecheckPrintControls precheck={precheck} printPrecheck={(id) => api.printPrecheck(id)} disabled={busy} />
            <p className="modal-help">Documento informativo; todavía no representa un pago ni cierra la cuenta.</p>
            <div className="modal-actions"><button type="button" disabled={busy} onClick={() => setPrecheck(null)}>Cerrar precuenta</button>{canCapturePayment && <button className="access-primary" type="button" disabled={busy || pendingCount > 0 || account.totalInCents <= 0} onClick={() => { setPrecheck(null); void openCheckout(); }}>Pagar</button>}</div>
          </section>
        </div>
      )}

      {checkoutOpen && cashShiftContext && (
        <div className="modal-backdrop" role="presentation">
          <section className="touch-modal checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
            {cashShiftContext.shift ? (
              <>
                <div className="modal-heading"><div><span className="eyebrow">{cashShiftContext.register.name}</span><h2 id="checkout-title">Cobrar {serviceLabel(account)}</h2></div><button type="button" aria-label="Cerrar" onClick={() => setCheckoutOpen(false)}>×</button></div>
                {checkoutError && <p className="form-error" role="alert">{checkoutError}</p>}
                <div className="payment-mode-options" aria-label="Forma de pago">
                  <button className={paymentMode === "cash" ? "selected" : ""} type="button" aria-pressed={paymentMode === "cash"} onClick={() => choosePaymentMode("cash")}>Efectivo</button>
                  <button className={paymentMode === "card" ? "selected" : ""} type="button" aria-pressed={paymentMode === "card"} onClick={() => choosePaymentMode("card")}>Tarjeta</button>
                  <button className={paymentMode === "transfer" ? "selected" : ""} type="button" disabled={!paymentMethods.some((method) => method.code === "TRANSFER")} aria-pressed={paymentMode === "transfer"} onClick={() => choosePaymentMode("transfer")}>Transferencia</button>
                  <button className={paymentMode === "combined" ? "selected" : ""} type="button" aria-pressed={paymentMode === "combined"} onClick={() => choosePaymentMode("combined")}>Combinado</button>
                </div>

                <section className="checkout-section">
                  <h3>Propina</h3>
                  <div className="tip-options">
                    {[0, 10, 15].map((percentage) => (
                      <button className={tipPercent === String(percentage) ? "selected" : ""} type="button" key={percentage} aria-pressed={tipPercent === String(percentage)} onClick={() => updateTipPercent(String(percentage))}>{percentage}%</button>
                    ))}
                    <label>Otro %<input aria-label="Porcentaje de propina" type="number" inputMode="decimal" min="0" max="100" step="0.01" value={tipPercent} onChange={(event) => updateTipPercent(event.target.value)} /></label>
                  </div>
                  {paymentMode === "combined" && checkoutTipInCents > 0 && <p className="management-hint">La propina se cargará a la tarjeta.</p>}
                </section>

                <section className="checkout-section payment-entry">
                  {paymentMode === "cash" && <label>Efectivo recibido<input aria-label="Efectivo recibido" type="number" inputMode="decimal" min="0" step="0.01" value={cashTendered} onChange={(event) => setCashTendered(event.target.value)} /></label>}
                  {paymentMode === "transfer" && <label>Referencia de transferencia<input aria-label="Referencia de transferencia" maxLength={80} value={cardReference} onChange={(event) => setCardReference(event.target.value)} /></label>}
                  {paymentMode === "card" && <label>Autorización o referencia<input aria-label="Autorización o referencia" maxLength={80} value={cardReference} onChange={(event) => setCardReference(event.target.value)} /></label>}
                  {paymentMode === "combined" && (
                    <>
                      <label>Parte en efectivo<input aria-label="Parte en efectivo" type="number" inputMode="decimal" min="0.01" step="0.01" value={combinedCashAmount} onChange={(event) => { setCombinedCashAmount(event.target.value); setCashTendered(event.target.value); }} /></label>
                      <label>Efectivo recibido<input aria-label="Efectivo recibido" type="number" inputMode="decimal" min="0" step="0.01" value={cashTendered} onChange={(event) => setCashTendered(event.target.value)} /></label>
                      <label>Autorización de tarjeta<input aria-label="Autorización de tarjeta" maxLength={80} value={cardReference} onChange={(event) => setCardReference(event.target.value)} /></label>
                    </>
                  )}
                  {(paymentMode === "cash" || paymentMode === "combined") && <div className="cash-quick-amounts" aria-label="Cantidades rápidas de efectivo">{[50, 100, 150, 200, 500].map((amount) => <button key={amount} type="button" disabled={busy} aria-label={`Recibido $${amount}`} onClick={() => setCashTendered(moneyInput(amount * 100))}>${amount}</button>)}</div>}
                </section>

                <div className="checkout-summary">
                  <div><span>Cuenta</span><strong>{formatMoney(account.totalInCents)}</strong></div>
                  <div><span>Propina</span><strong>{formatMoney(checkoutTipInCents)}</strong></div>
                  {paymentMode === "combined" && <><div><span>Efectivo aplicado</span><span>{formatMoney(checkoutCombinedCashInCents)}</span></div><div><span>Tarjeta</span><span>{formatMoney(checkoutCardInCents + checkoutTipInCents)}</span></div></>}
                  {(paymentMode === "cash" || paymentMode === "combined") && <div className="change-row"><span>Cambio</span><strong>{formatMoney(checkoutChangeInCents)}</strong></div>}
                  <div className="checkout-total"><span>Total a registrar</span><strong>{formatMoney(account.totalInCents + checkoutTipInCents)}</strong></div>
                </div>
                <div className="modal-actions"><button type="button" disabled={busy} onClick={() => setCheckoutOpen(false)}>Volver</button><button className="pay-confirm-button" type="button" disabled={busy} onClick={() => void capturePayment()}>{busy ? "Procesando…" : "Confirmar pago"}</button></div>
              </>
            ) : (
              <>
                <div className="modal-heading"><div><span className="eyebrow">{cashShiftContext.register.name}</span><h2 id="checkout-title">Abrir turno de caja</h2></div><button type="button" aria-label="Cerrar" onClick={() => setCheckoutOpen(false)}>×</button></div>
                <p className="modal-help">El fondo inicial sirve para dar cambio y se registra separado de las ventas.</p>
                {checkoutError && <p className="form-error" role="alert">{checkoutError}</p>}
                <label className="checkout-input">Fondo inicial<input aria-label="Fondo inicial" type="number" inputMode="decimal" min="0" step="0.01" value={openingFloat} onChange={(event) => setOpeningFloat(event.target.value)} /></label>
                <div className="modal-actions"><button type="button" disabled={busy} onClick={() => setCheckoutOpen(false)}>Volver</button><button className="access-primary" type="button" disabled={busy} onClick={() => void openCashShift()}>{busy ? "Abriendo…" : "Abrir turno"}</button></div>
              </>
            )}
          </section>
        </div>
      )}

      {receipt && (
        <div className="modal-backdrop" role="presentation">
          <section className="touch-modal receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
            <ReceiptPaper receipt={receipt} titleId="receipt-title" />
            <ReceiptPrintControls api={api} receipt={receipt} canPrint={canCapturePayment} canReprint={session.user.permissions.includes("sales.receipt.reprint")} canPrintBrowser={canCapturePayment && session.user.permissions.includes("sales.receipt.read")} disabled={busy} onBusyChange={setBusy} />
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions">{canManageDelivery && <button type="button" disabled={busy} onClick={() => void assignPaidReceipt()}>Asignar repartidor al pedido pagado</button>}<button className="access-primary" type="button" disabled={busy} onClick={() => void closeReceipt()}>Cerrar ticket</button></div>
          </section>
        </div>
      )}

      {managementOpen && managementOptions && (
        <div className="modal-backdrop" role="presentation">
          <section className="touch-modal management-modal" role="dialog" aria-modal="true" aria-labelledby="management-title">
            <div className="modal-heading"><div><span className="eyebrow">Operaciones auditadas</span><h2 id="management-title">Gestionar cuenta</h2></div><button type="button" aria-label="Cerrar" onClick={() => { setManagementOpen(false); setConfirmingAccountCancellation(false); }}>×</button></div>
            {error && <p className="form-error" role="alert">{error}</p>}

            <section className="management-section">
              <h3>Responsable</h3>
              <div className="management-options">
                {managementOptions.users.map((user) => (
                  <button className={account.responsible.id === user.id ? "selected" : ""} type="button" key={user.id} disabled={busy || account.responsible.id === user.id} onClick={() => void updateContext({ responsibleUserId: user.id })}>{user.displayName}</button>
                ))}
              </div>
            </section>

            {account.serviceType === "table" && (
              <section className="management-section">
                <h3>Cambiar mesa</h3>
                <div className="management-options">
                  {managementOptions.tables.map((table) => (
                    <button className={account.tableId === table.id ? "selected" : ""} type="button" key={table.id} disabled={busy || account.tableId === table.id} onClick={() => void updateContext({ tableId: table.id })}>{table.name}</button>
                  ))}
                </div>
              </section>
            )}

            {canDiscount && <section className="management-section">
              <h3>Descuento</h3>
              {account.adjustments.map((adjustment) => (
                <div className="active-adjustment" key={adjustment.id}><span><strong>{adjustment.calculation === "percentage" ? `${adjustment.value / 100}%` : formatMoney(adjustment.value)}</strong><small>{adjustment.reason}</small></span><button type="button" disabled={busy || !managementReason.trim()} onClick={() => void voidAdjustment(adjustment.id)}>Anular</button></div>
              ))}
              <div className="discount-controls"><label>Porcentaje<input aria-label="Porcentaje de descuento" type="number" inputMode="decimal" min="0.01" max="100" step="0.01" value={discountPercent} onChange={(event) => setDiscountPercent(event.target.value)} /></label><button type="button" disabled={busy || !managementReason.trim()} onClick={() => void applyDiscount()}>Aplicar descuento</button></div>
            </section>}

            <section className="management-section">
              <h3>Dividir, transferir o unir</h3>
              {account.adjustments.length > 0 && <p className="management-hint">Anula los descuentos antes de mover artículos.</p>}
              <div className="movement-items">
                {account.items.filter((item) => item.preparationState !== "cancelled").map((item) => (
                  <button className={selectedMovementItems.includes(item.id) ? "selected" : ""} type="button" key={item.id} aria-pressed={selectedMovementItems.includes(item.id)} disabled={busy || account.adjustments.length > 0} onClick={() => toggleMovementItem(item.id)}><span>{item.quantity} × {item.productName}</span><strong>{formatMoney(item.lineTotalInCents)}</strong></button>
                ))}
              </div>
              <label className="management-select">Cuenta destino<select aria-label="Cuenta destino" value={movementTargetId} disabled={managementOptions.accounts.length === 0} onChange={(event) => setMovementTargetId(event.target.value)}><option value="">Sin cuenta destino</option>{managementOptions.accounts.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label} · {formatMoney(candidate.totalInCents)}</option>)}</select></label>
              <div className="movement-actions">
                <button type="button" disabled={busy || selectedItems.length === 0 || !managementReason.trim() || account.adjustments.length > 0} onClick={() => void splitSelected()}>Dividir selección</button>
                <button type="button" disabled={busy || selectedItems.length === 0 || !movementTargetId || !managementReason.trim() || account.adjustments.length > 0} onClick={() => void transferSelected()}>Transferir</button>
                <button type="button" disabled={busy || !movementTargetId || !managementReason.trim() || account.adjustments.length > 0} onClick={() => void mergeCurrent()}>Unir toda la cuenta</button>
              </div>
            </section>

            <label className="management-reason">Motivo de la operación<textarea value={managementReason} maxLength={200} rows={2} onChange={(event) => setManagementReason(event.target.value)} /></label>
            <ReasonPresets context="management" value={managementReason} onChange={setManagementReason} disabled={busy} />

            <section className="management-section danger-zone">
              <h3>Cancelar cuenta</h3>
              <p>Libera la mesa conservando la operación en la bitácora.</p>
              {!canCancelAccount && <p className="management-hint">Cancela o transfiere todos los artículos y anula los descuentos antes de liberar la mesa.</p>}
              {confirmingAccountCancellation ? (
                <div className="danger-confirmation" role="alert">
                  <strong>¿Confirmas que deseas cancelar {serviceLabel(account)}?</strong>
                  <span>La mesa quedará libre y esta acción no se puede deshacer desde el punto de venta.</span>
                  <div><button type="button" disabled={busy} onClick={() => setConfirmingAccountCancellation(false)}>Conservar cuenta</button><button className="danger-button" type="button" disabled={busy} onClick={() => void cancelCurrentAccount(managementReason)}>Confirmar cancelación</button></div>
                </div>
              ) : (
                <button className="danger-button" type="button" disabled={busy || !managementReason.trim() || !canCancelAccount} onClick={() => setConfirmingAccountCancellation(true)}>{account.tableId ? "Cancelar cuenta y liberar mesa" : "Cancelar cuenta"}</button>
              )}
            </section>
            <div className="modal-actions single-action"><button type="button" onClick={() => setManagementOpen(false)}>Listo</button></div>
          </section>
        </div>
      )}

      {detailsOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="touch-modal order-details-modal" role="dialog" aria-modal="true" aria-labelledby="order-details-title" onSubmit={(event) => void saveDetails(event)}>
            <div className="modal-heading"><div><span className="eyebrow">Datos opcionales</span><h2 id="order-details-title">Cliente y programación</h2></div><button type="button" aria-label="Cerrar" disabled={busy} onClick={() => setDetailsOpen(false)}>×</button></div>
            {session.user.permissions.includes("customers.read") && <CustomerPicker api={api} value={customerIdDraft} customerName={customerNameDraft} disabled={busy} canCreate={session.user.permissions.includes("customers.manage")} onChange={(customer) => { setCustomerIdDraft(customer?.id ?? null); setCustomerNameDraft(customer?.name ?? ""); }} />}
            <label>Nombre del cliente (opcional)<input value={customerNameDraft} maxLength={80} placeholder="Escribe el nombre del cliente" onChange={(event) => { setCustomerIdDraft(null); setCustomerNameDraft(event.target.value); }} /></label>
            <label className="schedule-toggle"><input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} />Programar envío a cocina</label>
            {scheduleEnabled && <label>Fecha y hora de envío a cocina<input type="datetime-local" required value={scheduledDraft} onChange={(event) => setScheduledDraft(event.target.value)} /></label>}
            <p className="modal-help">{scheduleEnabled ? "Agrega los productos y guarda el pedido. El servidor lo enviará automáticamente a cocina a esta hora, aunque cierres la tablet." : "Puedes agregar un cliente y programar este pedido más adelante."}</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions"><button type="button" disabled={busy} onClick={() => setDetailsOpen(false)}>Volver al pedido</button><button className="access-primary" type="submit" disabled={busy}>Guardar datos</button></div>
          </form>
        </div>
      )}

      {leavingAccount && (
        <div className="modal-backdrop" role="presentation">
          <section className="touch-modal note-modal" role="dialog" aria-modal="true" aria-labelledby="leave-order-title">
            <div className="modal-heading"><h2 id="leave-order-title">Salir de {serviceLabel(account)}</h2><button type="button" aria-label="Cerrar" disabled={busy} onClick={() => setLeavingAccount(false)}>×</button></div>
            <p className="modal-help">Puedes conservar el pedido para retomarlo desde Servicios abiertos.{canCancelAccount ? " También puedes cancelar este pedido sin enviar a cocina." : " Para cancelarlo, cancela primero los artículos enviados y anula los descuentos."}</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions"><button type="button" disabled={busy} onClick={() => { setBusy(true); void showServices().catch((cause) => setError(messageFor(cause))).finally(() => setBusy(false)); }}>Conservar y salir</button>{canCancelAccount && <button className="danger-action" type="button" disabled={busy} onClick={() => void cancelCurrentAccount("Pedido sin enviar descartado al salir")}>Cancelar pedido y salir</button>}</div>
          </section>
        </div>
      )}

      {quickCancellationOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="touch-modal note-modal" role="dialog" aria-modal="true" aria-labelledby="quick-cancel-title">
            <div className="modal-heading"><div><span className="eyebrow">Acción auditada</span><h2 id="quick-cancel-title">{account.tableId ? "Liberar" : "Cancelar"} {serviceLabel(account)}</h2></div><button type="button" aria-label="Cerrar" onClick={() => setQuickCancellationOpen(false)}>×</button></div>
            <p className="modal-help">{account.tableId ? "La cuenta se marcará como cancelada y la mesa volverá a estar disponible." : "Se cancelará el pedido y se descartarán los productos que aún no se han enviado a cocina."}</p>
            {!canCancelAccount && <p className="form-error" role="alert">Primero cancela o transfiere todos los artículos y anula los descuentos vigentes.</p>}
            <label>{account.tableId ? "Motivo para liberar la mesa" : "Motivo de cancelación"}<textarea value={quickCancellationReason} maxLength={200} rows={3} onChange={(event) => setQuickCancellationReason(event.target.value)} /></label>
            <ReasonPresets context={account.tableId ? "table" : "account"} value={quickCancellationReason} onChange={setQuickCancellationReason} disabled={busy} autoFocus />
            <div className="modal-actions"><button type="button" onClick={() => setQuickCancellationOpen(false)}>Conservar cuenta</button><button className="danger-action" type="button" disabled={!canCancelAccount || !quickCancellationReason.trim() || busy} onClick={() => void cancelCurrentAccount(quickCancellationReason)}>{account.tableId ? "Confirmar y liberar" : "Confirmar cancelación"}</button></div>
          </section>
        </div>
      )}

      {builder && (
        <OrderBuilder
          category={builder.category}
          initialProduct={builder.product}
          busy={busy}
          error={error}
          onClose={() => setBuilder(null)}
          onSubmit={addLines}
        />
      )}

      {pricesEditor}
      {seasonalCategory && (
        <SeasonalMenuEditor
          api={api}
          category={seasonalCategory}
          onChanged={loadServiceData}
          onClose={() => setSeasonalEditorOpen(false)}
        />
      )}

      {editingItem && (
        <div className="modal-backdrop" role="presentation">
          <section className="touch-modal note-modal" role="dialog" aria-modal="true" aria-labelledby="note-title">
            <div className="modal-heading"><div><span className="eyebrow">Instrucción especial</span><h2 id="note-title">{editingItem.productName}</h2></div><button type="button" aria-label="Cerrar" autoFocus onClick={() => setEditingItem(null)}>×</button></div>
            <QuickNotes
              context={{ name: editingItem.productName, code: editingProduct?.code, categoryName: editingCategory?.name, categoryCode: editingCategory?.code }}
              note={noteDraft}
              onToggle={(quickNote) => setNoteDraft((draft) => toggleQuickNote(draft, quickNote))}
            />
            {editingItem.preparationState !== "pending" && <p className="modal-help">Cocina recibirá la actualización de esta nota.</p>}
            <label>Nota para preparación<textarea value={noteDraft} maxLength={MAX_NOTE_LENGTH} rows={4} onChange={(event) => setNoteDraft(event.target.value)} /></label>
            <div className="modal-actions"><button type="button" onClick={() => setEditingItem(null)}>Cancelar</button><button className="access-primary" type="button" disabled={busy} onClick={() => void changeQuantity(editingItem, editingItem.quantity, noteDraft.trim())}>Guardar nota</button></div>
          </section>
        </div>
      )}

      {cancellingItem && (
        <div className="modal-backdrop" role="presentation">
          <section className="touch-modal note-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
            <div className="modal-heading"><div><span className="eyebrow">Acción auditada</span><h2 id="cancel-title">Cancelar {cancellingItem.productName}</h2></div><button type="button" aria-label="Cerrar" onClick={() => setCancellingItem(null)}>×</button></div>
            <p className="modal-help">Si el producto ya fue enviado, cocina recibirá una comanda de cancelación.</p>
            <label>Motivo de cancelación<textarea value={cancellationReason} maxLength={200} rows={3} onChange={(event) => setCancellationReason(event.target.value)} /></label>
            <ReasonPresets context="item" value={cancellationReason} onChange={setCancellationReason} disabled={busy} autoFocus />
            <div className="modal-actions"><button type="button" onClick={() => setCancellingItem(null)}>Volver</button><button className="danger-action" type="button" disabled={!cancellationReason.trim() || busy} onClick={() => void cancelItem()}>Confirmar cancelación</button></div>
          </section>
        </div>
      )}
    </main>
  );
};

const AccessShell = ({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) => (
  <main className="access-shell">
    <section className="access-card">
      <div className="access-brand"><span className="brand-mark" aria-hidden="true">A</span><strong>Antojit<span>OS</span></strong></div>
      <span className="eyebrow">Punto de venta local</span>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
    </section>
  </main>
);

const RemoteTopbar = ({
  terminal,
  session,
  context,
  guestCount,
  onContextClick,
  onLogout,
}: {
  terminal: TerminalCredentials;
  session: Session;
  context?: string;
  guestCount?: number;
  onContextClick?: () => void;
  onLogout: () => void;
}) => (
  <header className="topbar">
    <div className="brand" aria-label="AntojitOS"><span className="brand-mark" aria-hidden="true">A</span><span>Antojit<span>OS</span></span></div>
    <div className="service-context">
      {context ? (
        <button className="context-button" type="button" aria-label="Cambiar mesa" onClick={onContextClick}><span className="context-eyebrow">Servicio activo</span><strong>{context}</strong><span aria-hidden="true">⌄</span></button>
      ) : <span className="topbar-title">Selección de servicio</span>}
      {guestCount !== undefined && <div className="guest-pill" aria-label={`${guestCount} comensales`}><span aria-hidden="true">● ●</span><strong>{guestCount}</strong></div>}
    </div>
    <div className="terminal-status">
      <div><span className="status-dot" aria-hidden="true" /><span>Servidor local</span></div>
      <button type="button" className="user-button" aria-label={`Cerrar sesión de ${session.user.displayName}`} onClick={onLogout}><span className="avatar">{session.user.displayName.slice(0, 2).toUpperCase()}</span><span><strong>{session.user.displayName}</strong><small>{terminal.displayName}</small></span></button>
    </div>
  </header>
);
