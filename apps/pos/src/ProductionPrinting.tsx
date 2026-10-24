import { useEffect, useRef, useState } from "react";
import type { ProductionPrintResult, ProductionTicket, ReceiptPrintStatus } from "./api/types";

export interface ProductionPrintingApi {
  accountProductionTickets(accountId: string): Promise<ProductionTicket[]>;
  printProductionTicket(ticketId: string): Promise<ProductionPrintResult>;
}

const statusLabel: Record<ReceiptPrintStatus, string> = {
  queued: "En cola de impresión",
  claimed: "Enviando a impresora",
  completed: "Enviado a impresora",
  failed: "Error de impresión",
  cancelled: "Impresión cancelada",
};
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : "No fue posible completar la impresión";
const isPending = (ticket: ProductionTicket) => ticket.printStatus === "queued" || ticket.printStatus === "claimed";

export const ProductionPrintControls = ({ api, accountId, accountVersion, disabled = false, onBusyChange }: {
  api: ProductionPrintingApi;
  accountId: string;
  accountVersion: number;
  disabled?: boolean;
  onBusyChange?(busy: boolean): void;
}) => {
  const [printing, setPrinting] = useState<{
    accountId: string;
    tickets: ProductionTicket[];
    loading: boolean;
    error: string | null;
  }>({ accountId, tickets: [], loading: true, error: null });
  const [action, setAction] = useState<{
    accountId: string;
    saving: boolean;
    error: string | null;
    notice: string | null;
  }>({ accountId, saving: false, error: null, notice: null });
  const [refreshKey, setRefreshKey] = useState(0);
  const savingRef = useRef(false);
  const operationEpoch = useRef(0);
  const contextRef = useRef({ api, accountId });
  const busyCallback = useRef(onBusyChange);
  contextRef.current = { api, accountId };
  busyCallback.current = onBusyChange;

  useEffect(() => {
    setAction({ accountId, saving: false, error: null, notice: null });
    return () => {
      operationEpoch.current += 1;
      if (savingRef.current) {
        savingRef.current = false;
        busyCallback.current?.(false);
      }
    };
  }, [api, accountId]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    setPrinting((current) => current.accountId === accountId
      ? { ...current, loading: true, error: null }
      : { accountId, tickets: [], loading: true, error: null });
    const refresh = async () => {
      try {
        const tickets = await api.accountProductionTickets(accountId);
        if (!active) return;
        pending = tickets.some(isPending);
        setPrinting({ accountId, tickets, loading: false, error: null });
      } catch (error) {
        if (!active) return;
        setPrinting((current) => ({ ...current, loading: false, error: errorMessage(error) }));
      }
      if (active && pending) timer = setTimeout(() => void refresh(), 2000);
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [api, accountId, accountVersion, refreshKey]);

  const print = async (ticket: ProductionTicket) => {
    if (disabled || savingRef.current) return;
    savingRef.current = true;
    const epoch = ++operationEpoch.current;
    const isCurrent = () => epoch === operationEpoch.current
      && contextRef.current.accountId === accountId && contextRef.current.api === api;
    setAction({ accountId, saving: true, error: null, notice: null });
    busyCallback.current?.(true);
    try {
      const result = await api.printProductionTicket(ticket.id);
      if (!isCurrent()) return;
      const notice = result.requeued ? "Se reintentará el envío de la comanda."
        : result.created ? "Copia de la comanda enviada a la cola de impresión."
          : result.status === "claimed" ? "La comanda ya se está enviando a la impresora."
            : result.status === "queued" ? "La comanda ya está en la cola de impresión."
              : result.status === "completed" ? "La comanda ya se envió a la impresora."
                : statusLabel[result.status];
      setAction({ accountId, saving: true, error: null, notice });
      setPrinting((current) => ({
        ...current,
        tickets: current.tickets.map((item) => item.id === ticket.id
          ? { ...item, printStatus: result.status, printLastError: null } : item),
      }));
    } catch (error) {
      if (isCurrent()) setAction({ accountId, saving: true, error: errorMessage(error), notice: null });
    } finally {
      if (isCurrent()) {
        savingRef.current = false;
        setAction((current) => ({ ...current, saving: false }));
        busyCallback.current?.(false);
        setRefreshKey((key) => key + 1);
      }
    }
  };

  const current = printing.accountId === accountId ? printing : { tickets: [], loading: true, error: null };
  const currentAction = action.accountId === accountId ? action : { saving: false, error: null, notice: null };
  if (current.tickets.length === 0 && !current.loading && !current.error) return null;

  return (
    <section className="production-print-controls" aria-label="Impresión de comandas">
      <div className="production-print-heading"><h3>Comandas enviadas</h3><p>Se imprimen automáticamente al enviarlas.</p></div>
      {current.loading && current.tickets.length === 0 && <p role="status">Consultando impresión…</p>}
      {current.error && <div className="production-print-actions"><p className="form-error" role="alert">No se pudo consultar la impresión: {current.error}</p><button type="button" disabled={disabled || currentAction.saving} onClick={() => setRefreshKey((key) => key + 1)}>Actualizar impresión</button></div>}
      {currentAction.error && <p className="form-error" role="alert">{currentAction.error}</p>}
      {currentAction.notice && <p className="production-print-notice" role="status">{currentAction.notice}</p>}
      <div className="production-print-list">
        {current.tickets.map((ticket) => (
          <div className="production-print-ticket" key={ticket.id}>
            <div className="production-print-ticket-copy">
              <strong>Ronda #{ticket.roundSequence} · {ticket.center.name}{ticket.kind === "cancellation" ? " · Cancelación" : ""}</strong>
              <div className="production-print-status" role="status" aria-live="polite">
                <span>{ticket.printStatus ? statusLabel[ticket.printStatus] : "Sin envío registrado"}</span>
                {ticket.printStatus === "completed" && <small>Envío confirmado; revisa la impresora si no salió papel.</small>}
                {ticket.printLastError && <small className="production-printer-error">{ticket.printLastError}</small>}
              </div>
            </div>
            <button type="button" disabled={disabled || currentAction.saving} onClick={() => void print(ticket)} aria-label={`Imprimir comanda de la ronda ${ticket.roundSequence}, ${ticket.center.name}${ticket.kind === "cancellation" ? ", cancelación" : ""}`}>Imprimir comanda</button>
          </div>
        ))}
      </div>
    </section>
  );
};
