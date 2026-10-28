import { type FormEvent, useEffect, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type { ReceiptPrintingStatus, ReceiptPrintResult, ReceiptPrintStatus, SalesReceipt, Precheck } from "./api/types";
import { formatMoney } from "./format";
import { ReasonPresets } from "./ReasonPresets";
import "./receipt-printing.css";

export interface ReceiptPrintingApi {
  receipt(receiptId: string): Promise<SalesReceipt>;
  receiptPrinting(receiptId: string): Promise<ReceiptPrintingStatus>;
  printReceipt(receiptId: string): Promise<ReceiptPrintResult>;
  reprintReceipt(receiptId: string, reason: string): Promise<{ jobId: string }>;
}

const statusLabel: Record<ReceiptPrintStatus, string> = {
  queued: "En cola de impresión",
  claimed: "Enviando a impresora",
  completed: "Enviado a impresora",
  failed: "Falló el envío a impresora",
  cancelled: "Impresión cancelada",
};
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : "No fue posible completar la impresión";

export const BusinessHeading = () => <div className="business-heading"><strong>Antojitos Mexicanos Frank</strong><span>Carretera al Salto #6</span><span>San Jose del Castillo</span><span>Tel: 3330147392</span></div>;

export const PrecheckPaper = ({ precheck }: { precheck: Precheck }) => <article className="receipt-paper">
  <BusinessHeading />
  <p className="receipt-precheck-title">Precuenta #{precheck.sequence}</p>
  <div className="receipt-meta"><strong>{precheck.account.tableName || precheck.account.reference || (precheck.account.serviceType === "takeaway" ? "Para llevar" : "Venta rápida")}</strong>
    {precheck.account.customerName && <span>Cliente: {precheck.account.customerName}</span>}
    <span>{new Date(precheck.generatedAt).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}</span></div>
  <div className="receipt-items">{precheck.account.items.filter((item) => item.preparationState !== "cancelled").map((item) => <div key={item.id}>
    <span className="receipt-line-copy">{item.quantity} × {item.productName}{item.modifiers.length > 0 && <small>{item.modifiers.map((modifier) => modifier.name).join(", ")}</small>}{item.note && <small>{item.note}</small>}</span><strong>{formatMoney(item.lineTotalInCents)}</strong>
  </div>)}</div>
  <div className="receipt-totals">
    {precheck.account.totals.discountInCents > 0 && <div><span>Descuento aplicado</span><span>{formatMoney(precheck.account.totals.discountInCents)}</span></div>}
    <div><span>Subtotal sin impuestos</span><span>{formatMoney(precheck.account.totals.subtotalInCents)}</span></div>
    <div><span>Impuestos</span><span>{formatMoney(precheck.account.totals.taxInCents)}</span></div>
    <div className="receipt-grand-total"><strong>Total a pagar</strong><strong>{formatMoney(precheck.account.totalInCents)}</strong></div>
  </div><p className="receipt-copy-label">CUENTA PENDIENTE DE PAGO</p>
</article>;

export const PrecheckPrintControls = ({ precheck, printPrecheck, disabled = false }: {
  precheck: Precheck;
  printPrecheck(id: string): Promise<{ status: string; requeued: boolean }>;
  disabled?: boolean;
}) => {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [browserCopy, setBrowserCopy] = useState(false);
  useEffect(() => {
    const clear = () => setBrowserCopy(false);
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);
  const print = async () => {
    setSaving(true); setError(null);
    try {
      const result = await printPrecheck(precheck.id);
      setNotice(result.status === "completed" ? "La precuenta ya se envió a la impresora." : "Precuenta en cola de impresión. La cuenta sigue pendiente de pago.");
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  };
  return <section className="receipt-print-controls" aria-label="Impresión de la precuenta">
    {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status" className="receipt-print-notice">{notice}</p>}
    <div className="receipt-print-actions"><button type="button" disabled={disabled || saving} onClick={() => void print()}>Imprimir precuenta</button>
      <button type="button" disabled={disabled || saving} onClick={() => { flushSync(() => setBrowserCopy(true)); window.print(); }}>Imprimir precuenta desde navegador (80 mm)</button></div>
    {browserCopy && createPortal(<div className="receipt-browser-print" style={{ display: "none" }} aria-hidden="true"><PrecheckPaper precheck={precheck} /></div>, document.body)}
  </section>;
};

export const ReceiptPaper = ({ receipt, titleId, browserCopy = false }: {
  receipt: SalesReceipt;
  titleId?: string;
  browserCopy?: boolean;
}) => {
  const account = receipt.account;
  const accountLabel = account.tableName || account.reference || (account.serviceType === "takeaway" ? "Para llevar" : "Venta rápida");
  return (
    <article className="receipt-paper">
      <BusinessHeading />
      <div className="receipt-heading"><span className="brand-mark" aria-hidden="true">A</span><div><span className="eyebrow">AntojitOS · Ticket de venta</span><h2 id={titleId}>Ticket {receipt.folio}</h2></div></div>
      {browserCopy && <p className="receipt-copy-label">COPIA DESDE NAVEGADOR</p>}
      {receipt.status !== "issued" && <p className="receipt-sale-status">{receipt.status === "cancelled" ? "VENTA CANCELADA" : "VENTA DEVUELTA"}</p>}
      <div className="receipt-meta"><strong>{accountLabel}</strong>{account.customerName && <span>Cliente: {account.customerName}</span>}<span>{new Date(receipt.issuedAt).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}</span><small>{receipt.shift.register.name}</small></div>
      <div className="receipt-items">
        {account.items.filter((item) => item.preparationState !== "cancelled").map((item) => (
          <div key={item.id}><span className="receipt-line-copy">{item.quantity} × {item.productName}{item.modifiers.length > 0 && <small>{item.modifiers.map((modifier) => `${modifier.name}${modifier.quantity && modifier.quantity > 1 ? ` × ${modifier.quantity}` : ""}`).join(", ")}</small>}{item.note && <small>{item.note}</small>}</span><strong>{formatMoney(item.lineTotalInCents)}</strong></div>
        ))}
      </div>
      <div className="receipt-totals">
        {account.totals.discountInCents > 0 && <div><span>Descuento aplicado</span><span>{formatMoney(account.totals.discountInCents)}</span></div>}
        <div><span>Subtotal sin impuestos</span><span>{formatMoney(account.totals.subtotalInCents)}</span></div>
        <div><span>Impuestos</span><span>{formatMoney(account.totals.taxInCents)}</span></div>
        <div><strong>Venta</strong><strong>{formatMoney(receipt.totals.saleInCents)}</strong></div>
        {receipt.totals.tipInCents > 0 && <div><span>Propina</span><strong>{formatMoney(receipt.totals.tipInCents)}</strong></div>}
        <div className="receipt-grand-total"><strong>Total cobrado</strong><strong>{formatMoney(receipt.totals.collectedInCents)}</strong></div>
      </div>
      <div className="receipt-payments">
        {receipt.payments.map((payment) => <div key={payment.id}><span>{payment.method.name}{payment.reference ? ` · ${payment.reference}` : ""}</span><strong>{formatMoney(payment.totalInCents)}</strong></div>)}
        {receipt.payments.some((payment) => payment.tenderedInCents !== null) && <div><span>Efectivo recibido</span><span>{formatMoney(receipt.payments.reduce((total, payment) => total + (payment.tenderedInCents ?? 0), 0))}</span></div>}
        {receipt.totals.changeInCents > 0 && <div className="change-row"><span>Cambio</span><strong>{formatMoney(receipt.totals.changeInCents)}</strong></div>}
      </div>
    </article>
  );
};

export const ReceiptPrintControls = ({ api, receipt, canPrint, canReprint, canPrintBrowser = false, disabled = false, onBusyChange }: {
  api: ReceiptPrintingApi;
  receipt: SalesReceipt;
  canPrint: boolean;
  canReprint: boolean;
  canPrintBrowser?: boolean;
  disabled?: boolean;
  onBusyChange?(busy: boolean): void;
}) => {
  const [printing, setPrinting] = useState<ReceiptPrintingStatus | null>(null);
  const [loading, setLoading] = useState(canPrint);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [browserReceipt, setBrowserReceipt] = useState<SalesReceipt | null>(null);

  useEffect(() => {
    if (!canPrint) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    const refresh = async () => {
      try {
        const result = await api.receiptPrinting(receipt.id);
        if (!active) return;
        setPrinting(result);
        setStatusError(null);
        if (result.jobs.some((job) => job.status === "queued" || job.status === "claimed")) {
          timer = setTimeout(() => void refresh(), 2000);
        }
      } catch (error) {
        if (active) setStatusError(errorMessage(error));
      } finally {
        if (active) setLoading(false);
      }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [api, receipt.id, canPrint, refreshKey]);

  useEffect(() => {
    const clearBrowserCopy = () => setBrowserReceipt(null);
    window.addEventListener("afterprint", clearBrowserCopy);
    return () => window.removeEventListener("afterprint", clearBrowserCopy);
  }, []);

  const run = async (operation: () => Promise<void>) => {
    if (saving || disabled) return;
    setSaving(true);
    onBusyChange?.(true);
    setActionError(null);
    setNotice(null);
    try { await operation(); }
    catch (error) { setActionError(errorMessage(error)); }
    finally { setSaving(false); onBusyChange?.(false); setRefreshKey((key) => key + 1); }
  };

  const printOriginal = () => void run(async () => {
    const result = await api.printReceipt(receipt.id);
    setNotice(result.requeued ? "Se reintentará el envío del ticket original." : result.created ? "Ticket enviado a la cola de impresión." : result.status === "completed" ? "El ticket ya se envió a la impresora. Para otra copia, usa Reimprimir ticket." : "El ticket ya está en la cola de impresión.");
  });

  const submitReprint = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reason.trim().length < 3) { setActionError("Escribe un motivo de al menos 3 caracteres"); return; }
    void run(async () => {
      await api.reprintReceipt(receipt.id, reason.trim());
      setNotice("Reimpresión enviada a la cola de impresión.");
      setReason("");
      setReprintOpen(false);
    });
  };

  const printBrowserCopy = () => void run(async () => {
    // Consulta el estado actual antes de imprimir una copia de una venta cancelada o devuelta.
    const currentReceipt = await api.receipt(receipt.id);
    flushSync(() => setBrowserReceipt(currentReceipt));
    window.print();
  });

  const original = printing?.jobs.find((job) => job.kind === "receipt");
  const latest = printing?.jobs[0];
  const inFlight = printing?.jobs.some((job) => job.status === "queued" || job.status === "claimed") ?? false;
  const busy = saving || disabled;
  const originalUnavailable = original && ["queued", "claimed", "completed", "cancelled"].includes(original.status);

  return (
    <section className="receipt-print-controls" aria-label="Impresión del ticket">
      <div className="receipt-print-status" role="status" aria-live="polite">
        <strong>{loading ? "Consultando impresión…" : latest ? statusLabel[latest.status] : "Ticket sin envío registrado"}</strong>
        {latest?.kind === "receipt_reprint" && <small>Última reimpresión</small>}
        {latest?.status === "completed" && <small>Envío confirmado; revisa la impresora si no salió papel.</small>}
        {printing?.receiptStatus !== undefined && printing.receiptStatus !== "issued" && <small>{printing.receiptStatus === "cancelled" ? "La venta está cancelada." : "La venta está devuelta."}</small>}
        {printing && <small>{printing.routing.registerName} · {printing.routing.configuredAgentCount === 0 ? "Servicio de impresión sin configurar" : printing.routing.onlineAgentCount === 0 ? "Servicio de impresión sin conexión" : "Servicio de impresión activo"}</small>}
        {latest?.status === "failed" && latest.lastError && <small className="receipt-printer-error">{latest.lastError}</small>}
      </div>
      {statusError && <p className="form-error" role="alert">No se pudo consultar la impresión: {statusError}</p>}
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {notice && <p className="receipt-print-notice" role="status">{notice}</p>}
      <div className="receipt-print-actions">
        {canPrint && <button type="button" disabled={busy || loading || Boolean(originalUnavailable)} onClick={printOriginal}>{original?.status === "failed" ? "Reintentar impresión" : "Imprimir ticket"}</button>}
        {canPrint && <button type="button" disabled={busy || loading} onClick={() => setRefreshKey((key) => key + 1)}>Actualizar impresión</button>}
        {canReprint && <button type="button" disabled={busy || loading || inFlight} onClick={() => { setReprintOpen(true); setActionError(null); }}>Reimprimir ticket</button>}
        {canPrint && canPrintBrowser && <button type="button" disabled={busy} onClick={printBrowserCopy}>Imprimir desde navegador (80 mm)</button>}
      </div>
      {canPrint && canPrintBrowser && <p className="receipt-browser-help">Para imprimir por USB, selecciona la Bixolon instalada en este equipo y papel de 80 mm. Desactiva los encabezados y pies de página del navegador.</p>}
      {reprintOpen && <form className="receipt-reprint-form" onSubmit={submitReprint}>
        <label>Motivo de reimpresión<input value={reason} maxLength={200} minLength={3} required disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
        <ReasonPresets context="reprint" value={reason} onChange={setReason} disabled={busy} autoFocus />
        <div className="receipt-print-actions"><button type="button" disabled={busy} onClick={() => { setReprintOpen(false); setReason(""); }}>Volver</button><button type="submit" disabled={busy || reason.trim().length < 3}>Confirmar reimpresión</button></div>
      </form>}
      {browserReceipt && createPortal(<div className="receipt-browser-print" style={{ display: "none" }} aria-hidden="true"><ReceiptPaper receipt={browserReceipt} browserCopy /></div>, document.body)}
    </section>
  );
};
