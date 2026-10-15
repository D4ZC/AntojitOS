import { type FormEvent, useMemo, useState } from "react";
import { ApiError, PosApi } from "./api/pos-api";
import type {
  AccountManagementOptions,
  AccountSummary,
  CatalogCategory,
  CatalogProduct,
  Precheck,
  RemoteOrderItem,
  ServiceAccount,
  ServiceLayout,
  ServiceTable,
  Session,
  TerminalCredentials,
} from "./api/types";
import { formatMoney } from "./format";

const TERMINAL_STORAGE_KEY = "antojit-os.terminal.v1";

export interface RemoteApi {
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
  }): Promise<{ id: string }>;
  account(accountId: string): Promise<ServiceAccount>;
  tableAccounts(tableId: string): Promise<AccountSummary[]>;
  accountManagementOptions(accountId: string): Promise<AccountManagementOptions>;
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
  const [modifierProduct, setModifierProduct] = useState<CatalogProduct | null>(null);
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);
  const [editingItem, setEditingItem] = useState<RemoteOrderItem | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [cancellingItem, setCancellingItem] = useState<RemoteOrderItem | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [precheck, setPrecheck] = useState<Precheck | null>(null);
  const [accountChoices, setAccountChoices] = useState<AccountSummary[]>([]);
  const [managementOpen, setManagementOpen] = useState(false);
  const [managementOptions, setManagementOptions] = useState<AccountManagementOptions | null>(null);
  const [managementReason, setManagementReason] = useState("");
  const [discountPercent, setDiscountPercent] = useState("10");
  const [movementTargetId, setMovementTargetId] = useState("");
  const [selectedMovementItems, setSelectedMovementItems] = useState<string[]>([]);
  const [confirmingAccountCancellation, setConfirmingAccountCancellation] = useState(false);
  const [quickCancellationOpen, setQuickCancellationOpen] = useState(false);
  const [quickCancellationReason, setQuickCancellationReason] = useState("");

  const loadServiceData = async () => {
    const [nextCatalog, nextLayout] = await Promise.all([
      api.catalog(),
      api.serviceLayout(),
    ]);
    setCatalog(nextCatalog);
    setLayout(nextLayout);
    setActiveCategoryId((current) =>
      current && nextCatalog.some((category) => category.id === current)
        ? current
        : nextCatalog[0]?.id ?? null,
    );
  };

  const refreshAccount = async (accountId: string) => {
    const [nextAccount, nextLayout] = await Promise.all([
      api.account(accountId),
      api.serviceLayout(),
    ]);
    setAccount(nextAccount);
    setLayout(nextLayout);
    return nextAccount;
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
      await loadServiceData();
      setSession(nextSession);
      setNotice("Sesión iniciada. Selecciona el tipo de servicio.");
    } catch (loginError) {
      api.setAccessToken(undefined);
      setError(messageFor(loginError));
    } finally {
      setBusy(false);
    }
  };

  const forgetTerminal = () => {
    storage.removeItem(TERMINAL_STORAGE_KEY);
    api.setAccessToken(undefined);
    setTerminal(null);
    setSession(null);
    setError(null);
  };

  const logout = () => {
    api.setAccessToken(undefined);
    setSession(null);
    setAccount(null);
    setCatalog([]);
    setLayout(null);
    setError(null);
    setManagementOpen(false);
    setPrecheck(null);
  };

  const selectTable = async (table: ServiceTable) => {
    setBusy(true);
    setError(null);
    try {
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
      await refreshAccount(accountId);
      setAccountChoices([]);
      setNotice("Cuenta actualizada");
    } catch (selectionError) {
      setError(messageFor(selectionError));
    } finally {
      setBusy(false);
    }
  };

  const openCounterService = async (serviceType: "quick" | "takeaway") => {
    setBusy(true);
    setError(null);
    try {
      const opened = await api.openAccount({ serviceType, guestCount });
      await refreshAccount(opened.id);
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
        await refreshAccount(account.id);
        setNotice("La cuenta cambió en otra terminal; ya mostramos la versión más reciente");
        setError(null);
        return;
      } catch {
        // El error original explica mejor qué operación falló.
      }
    }
    setError(messageFor(mutationError));
  };

  const addProduct = async (product: CatalogProduct, modifierIds: string[] = []) => {
    if (!account || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.addItem(account.id, {
        productId: product.id,
        quantity: 1,
        expectedVersion: account.version,
        modifierIds,
      });
      await refreshAccount(account.id);
      setNotice(`${product.name} agregado`);
      setModifierProduct(null);
      setSelectedModifierIds([]);
    } catch (addError) {
      await handleMutationError(addError);
    } finally {
      setBusy(false);
    }
  };

  const chooseProduct = (product: CatalogProduct) => {
    const hasOptions = product.modifierGroups.some((group) =>
      group.options.some((option) => option.available),
    );
    if (!hasOptions) {
      void addProduct(product);
      return;
    }
    setModifierProduct(product);
    setSelectedModifierIds([]);
  };

  const toggleModifier = (
    group: CatalogProduct["modifierGroups"][number],
    modifierId: string,
  ) => {
    setSelectedModifierIds((current) => {
      if (current.includes(modifierId)) return current.filter((id) => id !== modifierId);
      const groupIds = new Set(group.options.map((option) => option.id));
      const selectedInGroup = current.filter((id) => groupIds.has(id));
      const withoutGroup = current.filter((id) => !groupIds.has(id));
      if (group.maximumSelections === 1) return [...withoutGroup, modifierId];
      if (selectedInGroup.length >= group.maximumSelections) return current;
      return [...current, modifierId];
    });
  };

  const modifiersAreValid = modifierProduct?.modifierGroups.every((group) => {
    const groupIds = new Set(group.options.map((option) => option.id));
    const count = selectedModifierIds.filter((id) => groupIds.has(id)).length;
    return count >= group.minimumSelections && count <= group.maximumSelections;
  }) ?? false;

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
      setNotice("Comanda enviada a los centros de producción");
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
      setManagementOpen(false);
      setManagementOptions(null);
      setManagementReason("");
      setConfirmingAccountCancellation(false);
      setQuickCancellationOpen(false);
      setQuickCancellationReason("");
      await loadServiceData();
      setNotice(account.tableId ? `${cancelledLabel} liberada` : `${cancelledLabel} cancelada`);
    } catch (cancellationError) {
      setError(messageFor(cancellationError));
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

  if (!account) {
    return (
      <main className="service-shell">
        <RemoteTopbar terminal={terminal} session={session} onLogout={logout} />
        <section className="service-selector" aria-labelledby="service-title">
          <div className="service-selector-heading">
            <div><span className="eyebrow">Nuevo servicio</span><h1 id="service-title">Selecciona una mesa</h1></div>
            <div className="guest-counter" aria-label="Número de comensales">
              <span>Comensales</span>
              <button type="button" aria-label="Quitar comensal" disabled={guestCount <= 1} onClick={() => setGuestCount((count) => count - 1)}>−</button>
              <output aria-label={`${guestCount} comensales`}>{guestCount}</output>
              <button type="button" aria-label="Agregar comensal" disabled={guestCount >= 99} onClick={() => setGuestCount((count) => count + 1)}>+</button>
            </div>
          </div>
          {error && <p className="form-error service-error" role="alert">{error}</p>}
          <div className="counter-services">
            <button type="button" disabled={busy} onClick={() => void openCounterService("quick")}><span>⚡</span><strong>Venta rápida</strong><small>Sin mesa</small></button>
            <button type="button" disabled={busy} onClick={() => void openCounterService("takeaway")}><span>🛍️</span><strong>Para llevar</strong><small>Orden abierta</small></button>
          </div>
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
      </main>
    );
  }

  const activeCategory = catalog.find((category) => category.id === activeCategoryId) ?? catalog[0];
  const canManageAccount = session.user.permissions.includes("service.account.manage");
  const canDiscount = session.user.permissions.includes("service.account.discount");
  const canCreatePrecheck = session.user.permissions.includes("service.precheck.create");
  const pendingCount = account.items
    .filter((item) => item.preparationState === "pending")
    .reduce((total, item) => total + item.quantity, 0);
  const activeAccountItemCount = account.items
    .filter((item) => item.preparationState !== "cancelled")
    .reduce((total, item) => total + item.quantity, 0);
  const canCancelAccount = activeAccountItemCount === 0 && account.adjustments.length === 0;

  return (
    <main className="app-shell remote-pos">
      <RemoteTopbar
        terminal={terminal}
        session={session}
        context={serviceLabel(account)}
        guestCount={account.guestCount}
        onContextClick={() => {
          setAccount(null);
          void loadServiceData();
        }}
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
          </div>
          <div className="product-grid">
            {activeCategory?.products.map((product) => (
              <button
                className={`product-card tone-${product.color ?? "cream"}`}
                key={product.id}
                type="button"
                disabled={!product.available || busy}
                onClick={() => chooseProduct(product)}
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
          <div className="order-heading">
            <div><span className="eyebrow">Cuenta actual</span><h2 id="order-title">{serviceLabel(account)}</h2></div>
            <div className="account-heading-actions"><span className="version-pill" title="Versión de la cuenta">v{account.version}</span>{canManageAccount && <button className="icon-button" type="button" aria-label="Gestionar cuenta" disabled={busy} onClick={() => void openManagement()}>•••</button>}</div>
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
                  <button className="note-button" type="button" disabled={busy || item.preparationState !== "pending"} onClick={() => { setEditingItem(item); setNoteDraft(item.note ?? ""); }}>+ Nota</button>
                  <button className="cancel-button" type="button" disabled={busy || !["pending", "sent"].includes(item.preparationState)} onClick={() => { setCancellingItem(item); setCancellationReason(""); }}>Cancelar</button>
                </div>
              </article>
            ))}
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
            <button className="send-button" type="button" disabled={pendingCount === 0 || busy} onClick={() => void sendRound()}><span>{busy ? "Procesando…" : "Enviar comanda"}</span>{pendingCount > 0 && <span className="count-badge">{pendingCount}</span>}</button>
            {canCreatePrecheck && <button className="precheck-button" type="button" disabled={account.totalInCents <= 0 || busy} onClick={() => void generatePrecheck()}>Precuenta</button>}
            <button className="pay-button" type="button" disabled>Pago (próxima fase)</button>
            {canManageAccount && account.serviceType === "table" && <button className="release-table-button" type="button" disabled={busy} onClick={() => { setQuickCancellationReason(""); setQuickCancellationOpen(true); setError(null); }}>Liberar mesa</button>}
          </div>
        </aside>
      </section>
      <footer className="bottom-status"><span>Servidor local · Sesión protegida</span><span>{terminal.displayName} · AntojitOS</span></footer>

      {precheck && (
        <div className="modal-backdrop" role="presentation">
          <section className="touch-modal precheck-modal" role="dialog" aria-modal="true" aria-labelledby="precheck-title">
            <div className="modal-heading"><div><span className="eyebrow">Vista previa de cobro</span><h2 id="precheck-title">Precuenta #{precheck.sequence}</h2></div><button type="button" aria-label="Cerrar" onClick={() => setPrecheck(null)}>×</button></div>
            <div className="precheck-meta"><strong>AntojitOS</strong><span>{serviceLabel(precheck.account)}</span><small>{new Date(precheck.generatedAt).toLocaleString("es-MX")}</small></div>
            <div className="precheck-items">
              {precheck.account.items.filter((item) => item.preparationState !== "cancelled").map((item) => (
                <div key={item.id}><span>{item.quantity} × {item.productName}</span><strong>{formatMoney(item.lineTotalInCents)}</strong></div>
              ))}
            </div>
            <div className="precheck-totals">
              <div><span>Subtotal</span><span>{formatMoney(precheck.account.totals.subtotalInCents)}</span></div>
              {precheck.account.totals.discountInCents > 0 && <div><span>Descuento</span><span>− {formatMoney(precheck.account.totals.discountInCents)}</span></div>}
              <div><span>IVA</span><span>{formatMoney(precheck.account.totals.taxInCents)}</span></div>
              <div><strong>Total</strong><strong>{formatMoney(precheck.account.totalInCents)}</strong></div>
            </div>
            <p className="modal-help">Documento informativo; todavía no representa un pago ni cierra la cuenta.</p>
            <div className="modal-actions single-action"><button className="access-primary" type="button" onClick={() => setPrecheck(null)}>Cerrar precuenta</button></div>
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

      {quickCancellationOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="touch-modal note-modal" role="dialog" aria-modal="true" aria-labelledby="quick-cancel-title">
            <div className="modal-heading"><div><span className="eyebrow">Acción auditada</span><h2 id="quick-cancel-title">Liberar {serviceLabel(account)}</h2></div><button type="button" aria-label="Cerrar" onClick={() => setQuickCancellationOpen(false)}>×</button></div>
            <p className="modal-help">La cuenta se marcará como cancelada y la mesa volverá a estar disponible.</p>
            {!canCancelAccount && <p className="form-error" role="alert">Primero cancela o transfiere todos los artículos y anula los descuentos vigentes.</p>}
            <label>Motivo para liberar la mesa<textarea value={quickCancellationReason} maxLength={200} rows={3} autoFocus onChange={(event) => setQuickCancellationReason(event.target.value)} /></label>
            <div className="modal-actions"><button type="button" onClick={() => setQuickCancellationOpen(false)}>Conservar cuenta</button><button className="danger-action" type="button" disabled={!canCancelAccount || !quickCancellationReason.trim() || busy} onClick={() => void cancelCurrentAccount(quickCancellationReason)}>Confirmar y liberar</button></div>
          </section>
        </div>
      )}

      {modifierProduct && (
        <div className="modal-backdrop" role="presentation">
          <section className="touch-modal" role="dialog" aria-modal="true" aria-labelledby="modifier-title">
            <div className="modal-heading"><div><span className="eyebrow">Personalizar</span><h2 id="modifier-title">{modifierProduct.name}</h2></div><button type="button" aria-label="Cerrar" onClick={() => setModifierProduct(null)}>×</button></div>
            {modifierProduct.modifierGroups.map((group) => (
              <fieldset className="modifier-group" key={group.id}>
                <legend>{group.name} <small>{group.minimumSelections > 0 ? `Elige de ${group.minimumSelections} a ${group.maximumSelections}` : `Opcional · máximo ${group.maximumSelections}`}</small></legend>
                <div className="modifier-options">
                  {group.options.filter((option) => option.available).map((option) => (
                    <button className={selectedModifierIds.includes(option.id) ? "selected" : ""} type="button" key={option.id} aria-pressed={selectedModifierIds.includes(option.id)} onClick={() => toggleModifier(group, option.id)}>
                      <span>{option.name}</span><small>{option.priceDeltaInCents === 0 ? "Sin costo" : `+ ${formatMoney(option.priceDeltaInCents)}`}</small>
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
            <div className="modal-actions"><button type="button" onClick={() => setModifierProduct(null)}>Cancelar</button><button className="access-primary" type="button" disabled={!modifiersAreValid || busy} onClick={() => void addProduct(modifierProduct, selectedModifierIds)}>Agregar a la orden</button></div>
          </section>
        </div>
      )}

      {editingItem && (
        <div className="modal-backdrop" role="presentation">
          <section className="touch-modal note-modal" role="dialog" aria-modal="true" aria-labelledby="note-title">
            <div className="modal-heading"><div><span className="eyebrow">Instrucción especial</span><h2 id="note-title">{editingItem.productName}</h2></div><button type="button" aria-label="Cerrar" onClick={() => setEditingItem(null)}>×</button></div>
            <label>Nota para preparación<textarea value={noteDraft} maxLength={200} rows={4} autoFocus onChange={(event) => setNoteDraft(event.target.value)} /></label>
            <div className="modal-actions"><button type="button" onClick={() => setEditingItem(null)}>Cancelar</button><button className="access-primary" type="button" disabled={busy} onClick={() => void changeQuantity(editingItem, editingItem.quantity, noteDraft.trim())}>Guardar nota</button></div>
          </section>
        </div>
      )}

      {cancellingItem && (
        <div className="modal-backdrop" role="presentation">
          <section className="touch-modal note-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
            <div className="modal-heading"><div><span className="eyebrow">Acción auditada</span><h2 id="cancel-title">Cancelar {cancellingItem.productName}</h2></div><button type="button" aria-label="Cerrar" onClick={() => setCancellingItem(null)}>×</button></div>
            <p className="modal-help">Si el producto ya fue enviado, cocina recibirá una comanda de cancelación.</p>
            <label>Motivo de cancelación<textarea value={cancellationReason} maxLength={200} rows={3} autoFocus onChange={(event) => setCancellationReason(event.target.value)} /></label>
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
