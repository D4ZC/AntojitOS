import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError, PosApi } from "./api/pos-api";
import type {
  ProductionTicket,
  Session,
  TerminalCredentials,
} from "./api/types";

const KDS_TERMINAL_STORAGE_KEY = "antojit-os.kds-terminal.v1";

export interface KdsApi {
  setAccessToken(accessToken?: string): void;
  registerTerminal(input: {
    bootstrapToken: string;
    terminalCode: string;
    displayName: string;
    profile?: "pos" | "kds";
  }): Promise<TerminalCredentials>;
  login(input: {
    terminal: TerminalCredentials;
    employeeCode: string;
    pin: string;
  }): Promise<Session>;
  productionTickets(): Promise<ProductionTicket[]>;
  transitionProductionTicket(
    ticketId: string,
    input: {
      status: "in_progress" | "ready" | "delivered";
      expectedVersion: number;
    },
  ): Promise<{ ticketId: string; status: string; version: number }>;
  reprintProductionTicket(
    ticketId: string,
    reason: string,
  ): Promise<{ jobId: string; ticketId: string }>;
}

interface KdsAppProps {
  api?: KdsApi;
  storage?: Storage;
}

const readTerminal = (storage: Storage): TerminalCredentials | null => {
  try {
    const raw = storage.getItem(KDS_TERMINAL_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<TerminalCredentials>;
    return value.id && value.deviceToken && value.displayName
      ? value as TerminalCredentials
      : null;
  } catch {
    return null;
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "No fue posible completar la operación";

const elapsedLabel = (createdAt: string, now: number): string => {
  const minutes = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));
  return minutes === 0 ? "Ahora" : `${minutes} min`;
};

const nextAction = (status: ProductionTicket["status"]) => {
  if (status === "pending") return { label: "Comenzar", status: "in_progress" as const };
  if (status === "in_progress") return { label: "Marcar listo", status: "ready" as const };
  if (status === "ready") return { label: "Entregar", status: "delivered" as const };
  return null;
};

export const KdsApp = ({ api: injectedApi, storage = window.localStorage }: KdsAppProps) => {
  const api = useMemo<KdsApi>(
    () => injectedApi ?? new PosApi(import.meta.env.VITE_API_URL || "/api"),
    [injectedApi],
  );
  const [terminal, setTerminal] = useState<TerminalCredentials | null>(() => readTerminal(storage));
  const [session, setSession] = useState<Session | null>(null);
  const [tickets, setTickets] = useState<ProductionTicket[]>([]);
  const [centerCode, setCenterCode] = useState("ALL");
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("Esperando comandas");
  const [now, setNow] = useState(Date.now());
  const [reprintTicket, setReprintTicket] = useState<ProductionTicket | null>(null);
  const [reprintReason, setReprintReason] = useState("");

  const refresh = async (silent = false) => {
    try {
      const nextTickets = await api.productionTickets();
      setTickets(nextTickets);
      if (!silent) setError(null);
    } catch (refreshError) {
      if (!silent) setError(errorMessage(refreshError));
    }
  };

  useEffect(() => {
    if (!session) return undefined;
    const poll = window.setInterval(() => void refresh(true), 3_000);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [session, api]);

  const register = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setAccessBusy(true);
    setError(null);
    try {
      const credentials = await api.registerTerminal({
        bootstrapToken: String(form.get("bootstrapToken") ?? ""),
        terminalCode: String(form.get("terminalCode") ?? "").trim().toUpperCase(),
        displayName: String(form.get("displayName") ?? "").trim(),
        profile: "kds",
      });
      storage.setItem(KDS_TERMINAL_STORAGE_KEY, JSON.stringify(credentials));
      setTerminal(credentials);
    } catch (registrationError) {
      setError(errorMessage(registrationError));
    } finally {
      setAccessBusy(false);
    }
  };

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!terminal) return;
    const form = new FormData(event.currentTarget);
    setAccessBusy(true);
    setError(null);
    try {
      const nextSession = await api.login({
        terminal,
        employeeCode: String(form.get("employeeCode") ?? "").trim().toUpperCase(),
        pin: String(form.get("pin") ?? ""),
      });
      api.setAccessToken(nextSession.accessToken);
      const initialTickets = await api.productionTickets();
      setTickets(initialTickets);
      setSession(nextSession);
    } catch (loginError) {
      api.setAccessToken(undefined);
      setError(errorMessage(loginError));
    } finally {
      setAccessBusy(false);
    }
  };

  const forgetTerminal = () => {
    storage.removeItem(KDS_TERMINAL_STORAGE_KEY);
    api.setAccessToken(undefined);
    setTerminal(null);
    setSession(null);
    setError(null);
  };

  const logout = () => {
    api.setAccessToken(undefined);
    setSession(null);
    setTickets([]);
    setError(null);
  };

  const transition = async (ticket: ProductionTicket) => {
    const action = nextAction(ticket.status);
    if (!action) return;
    setBusyTicketId(ticket.id);
    setError(null);
    try {
      await api.transitionProductionTicket(ticket.id, {
        status: action.status,
        expectedVersion: ticket.version,
      });
      await refresh();
      setNotice(`${ticket.service.label}: ${action.label} confirmado`);
    } catch (transitionError) {
      if (transitionError instanceof ApiError && transitionError.status === 409) {
        await refresh(true);
        setError("La comanda cambió en otra pantalla; ya mostramos el estado actual");
      } else {
        setError(errorMessage(transitionError));
      }
    } finally {
      setBusyTicketId(null);
    }
  };

  const requestReprint = async () => {
    if (!reprintTicket || !reprintReason.trim()) return;
    setBusyTicketId(reprintTicket.id);
    setError(null);
    try {
      await api.reprintProductionTicket(reprintTicket.id, reprintReason.trim());
      setNotice(`Reimpresión solicitada para ${reprintTicket.service.label}`);
      setReprintTicket(null);
      setReprintReason("");
    } catch (reprintError) {
      setError(errorMessage(reprintError));
    } finally {
      setBusyTicketId(null);
    }
  };

  if (!terminal) {
    return (
      <KdsAccess title="Configurar pantalla de cocina" subtitle="Registra este equipo como una terminal KDS.">
        <form className="access-form" onSubmit={register}>
          <label>Código de terminal<input name="terminalCode" defaultValue="KDS-01" required /></label>
          <label>Nombre visible<input name="displayName" defaultValue="Pantalla cocina" required /></label>
          <label>Token de instalación<input name="bootstrapToken" type="password" required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="access-primary" type="submit" disabled={accessBusy}>{accessBusy ? "Registrando…" : "Registrar KDS"}</button>
        </form>
      </KdsAccess>
    );
  }

  if (!session) {
    return (
      <KdsAccess title="Acceso a producción" subtitle={`${terminal.displayName} · Servidor local`}>
        <form className="access-form login-form" onSubmit={login}>
          <label>Código de empleado<input name="employeeCode" defaultValue="ADMIN" required /></label>
          <label>PIN<input name="pin" type="password" inputMode="numeric" minLength={4} maxLength={12} required autoFocus /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="access-primary" type="submit" disabled={accessBusy}>{accessBusy ? "Ingresando…" : "Ingresar"}</button>
          <button className="access-link" type="button" onClick={forgetTerminal}>Configurar otra pantalla</button>
        </form>
      </KdsAccess>
    );
  }

  const centers = [...new Map(tickets.map((ticket) => [ticket.center.code, ticket.center.name])).entries()];
  const visibleTickets = tickets.filter((ticket) => centerCode === "ALL" || ticket.center.code === centerCode);

  return (
    <main className="kds-shell">
      <header className="kds-topbar">
        <div className="brand" aria-label="AntojitOS KDS"><span className="brand-mark" aria-hidden="true">A</span><span>Antojit<span>OS</span> <small>KDS</small></span></div>
        <div className="kds-live"><span className="status-dot" aria-hidden="true" /><strong>Producción en vivo</strong><small>{notice}</small></div>
        <button className="user-button" type="button" aria-label={`Cerrar sesión de ${session.user.displayName}`} onClick={logout}><span className="avatar">{session.user.displayName.slice(0, 2).toUpperCase()}</span><span><strong>{session.user.displayName}</strong><small>{terminal.displayName}</small></span></button>
      </header>
      <nav className="kds-filters" aria-label="Centros de producción">
        <button type="button" className={centerCode === "ALL" ? "active" : ""} onClick={() => setCenterCode("ALL")}>Todos <span>{tickets.length}</span></button>
        {centers.map(([code, name]) => (
          <button type="button" className={centerCode === code ? "active" : ""} key={code} onClick={() => setCenterCode(code)}>{name} <span>{tickets.filter((ticket) => ticket.center.code === code).length}</span></button>
        ))}
        <button className="kds-refresh" type="button" onClick={() => void refresh()} aria-label="Actualizar comandas">↻</button>
      </nav>
      {error && <div className="kds-alert" role="alert">{error}</div>}
      <section className="kds-board" aria-label="Comandas activas" aria-live="polite">
        {visibleTickets.length === 0 ? (
          <div className="kds-empty"><span aria-hidden="true">✓</span><h1>Sin comandas pendientes</h1><p>Las nuevas órdenes aparecerán automáticamente.</p></div>
        ) : visibleTickets.map((ticket) => {
          const action = nextAction(ticket.status);
          const elapsedMinutes = Math.floor((now - new Date(ticket.createdAt).getTime()) / 60_000);
          return (
            <article className={`kds-ticket state-${ticket.status} kind-${ticket.kind}${elapsedMinutes >= 10 ? " aging" : ""}`} key={ticket.id}>
              <header>
                <div><span className="kds-sequence">#{ticket.roundSequence}</span><strong>{ticket.service.label}</strong></div>
                <time dateTime={ticket.createdAt}>{elapsedLabel(ticket.createdAt, now)}</time>
              </header>
              <div className="kds-ticket-meta"><span>{ticket.center.name}</span><span>{ticket.kind === "cancellation" ? "Cancelación" : "Nueva orden"}</span></div>
              <div className="kds-items">
                {ticket.items.map((item) => (
                  <div className="kds-item" key={item.id}>
                    <strong><span>{item.quantity}</span>{item.productName}</strong>
                    {item.modifiers.map((modifier) => <small key={modifier}>• {modifier}</small>)}
                    {item.note && <em>Nota: {item.note}</em>}
                  </div>
                ))}
              </div>
              <footer>
                <button className="kds-reprint" type="button" disabled={busyTicketId === ticket.id} onClick={() => { setReprintTicket(ticket); setReprintReason(""); }}>Reimprimir</button>
                {action && <button className="kds-action" type="button" disabled={busyTicketId === ticket.id} onClick={() => void transition(ticket)}>{busyTicketId === ticket.id ? "Actualizando…" : action.label}</button>}
              </footer>
            </article>
          );
        })}
      </section>
      {reprintTicket && (
        <div className="modal-backdrop" role="presentation">
          <section className="touch-modal note-modal" role="dialog" aria-modal="true" aria-labelledby="reprint-title">
            <div className="modal-heading"><div><span className="eyebrow">Acción auditada</span><h2 id="reprint-title">Reimprimir {reprintTicket.service.label}</h2></div><button type="button" aria-label="Cerrar" onClick={() => setReprintTicket(null)}>×</button></div>
            <label>Motivo de la reimpresión<textarea value={reprintReason} maxLength={200} rows={3} autoFocus onChange={(event) => setReprintReason(event.target.value)} /></label>
            <div className="modal-actions"><button type="button" onClick={() => setReprintTicket(null)}>Cancelar</button><button className="access-primary" type="button" disabled={!reprintReason.trim() || busyTicketId !== null} onClick={() => void requestReprint()}>Solicitar reimpresión</button></div>
          </section>
        </div>
      )}
    </main>
  );
};

const KdsAccess = ({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) => (
  <main className="access-shell kds-access">
    <section className="access-card">
      <div className="access-brand"><span className="brand-mark" aria-hidden="true">A</span><strong>Antojit<span>OS</span> KDS</strong></div>
      <span className="eyebrow">Producción local</span><h1>{title}</h1><p>{subtitle}</p>{children}
    </section>
  </main>
);
