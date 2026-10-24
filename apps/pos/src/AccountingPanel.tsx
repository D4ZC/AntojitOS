import { type FormEvent, useEffect, useState } from "react";
import {
  type AccountingApi, type AccountingBill, type AccountingPayment,
  type AccountingPaymentMethod, type AccountingPaymentSource, type AccountingPeriod,
  type AccountingSummary, type AccountingSupplier, accountingCsv,
  accountingDateLabel, accountingPesosToCents, accountingToday,
} from "./accounting";
import { formatMoney } from "./format";
import { ReasonPresets } from "./ReasonPresets";
import "./accounting.css";

export type { AccountingApi } from "./accounting";

interface AccountingPanelProps { api: AccountingApi; onClose(): void }
type Section = "summary" | "suppliers" | "bills";
const errorText = (error: unknown): string => error instanceof Error ? error.message : "No fue posible completar la operación";
const methodName = (code: AccountingPaymentMethod): string => ({ CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia" })[code];
const initialSupplier = { name: "", contactName: "", phone: "", taxId: "", notes: "" };
const optionalText = (value: string): string | null => value.trim() || null;

export const AccountingPanel = ({ api, onClose }: AccountingPanelProps) => {
  const today = accountingToday();
  const [section, setSection] = useState<Section>("summary");
  const [suppliers, setSuppliers] = useState<AccountingSupplier[]>([]);
  const [bills, setBills] = useState<AccountingBill[]>([]);
  const [summary, setSummary] = useState<AccountingSummary | null>(null);
  const [period, setPeriod] = useState<AccountingPeriod>({ from: `${today.slice(0, 7)}-01`, to: today });
  const [appliedPeriod, setAppliedPeriod] = useState(period);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<AccountingSupplier | null>(null);
  const [supplierDraft, setSupplierDraft] = useState(initialSupplier);
  const [billDraft, setBillDraft] = useState({ supplierId: "", description: "", amount: "", issuedOn: today, dueOn: "", reference: "" });
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [paymentDraft, setPaymentDraft] = useState({ amount: "", methodCode: "CASH" as AccountingPaymentMethod, paidOn: today, reference: "", source: "external" as AccountingPaymentSource });
  const [voidingPayment, setVoidingPayment] = useState<AccountingPayment | null>(null);
  const [voidingBill, setVoidingBill] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(null);
    void Promise.all([api.accountingSuppliers(), api.accountingBills(), api.accountingSummary(appliedPeriod)])
      .then(([supplierResult, billResult, nextSummary]) => {
        if (!active) return;
        setSuppliers(supplierResult.suppliers);
        setBills(billResult.bills);
        setSummary(nextSummary);
        setEditingSupplier((current) => current ? supplierResult.suppliers.find((supplier) => supplier.id === current.id) ?? null : null);
      }).catch((loadError) => { if (active) setError(errorText(loadError)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api, reloadKey]);

  const run = async (operation: () => Promise<void>, message: string) => {
    if (busy) return;
    setBusy(true);
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      setNotice(message);
      try { setSummary(await api.accountingSummary(appliedPeriod)); }
      catch (refreshError) { setError(`El registro se guardó. No se pudo actualizar el resumen: ${errorText(refreshError)}`); }
    } catch (operationError) {
      setError(errorText(operationError));
      // Recupera la versión vigente si otra terminal cambió el cargo o proveedor.
      if (operationError && typeof operationError === "object" && "status" in operationError && operationError.status === 409) {
        try {
          const [supplierResult, billResult] = await Promise.all([api.accountingSuppliers(), api.accountingBills()]);
          setSuppliers(supplierResult.suppliers);
          setBills(billResult.bills);
          if (editingSupplier) setEditingSupplier(supplierResult.suppliers.find((supplier) => supplier.id === editingSupplier.id) ?? null);
        } catch { /* Conserva el mensaje original para poder reintentar. */ }
      }
    } finally { setBusy(false); setSaving(false); }
  };

  const upsertBill = (bill: AccountingBill) => setBills((current) => [bill, ...current.filter((candidate) => candidate.id !== bill.id)]);
  const upsertSupplier = (supplier: AccountingSupplier) => {
    setSuppliers((current) => [supplier, ...current.filter((candidate) => candidate.id !== supplier.id)]);
    setBills((current) => current.map((bill) => bill.supplierId === supplier.id ? { ...bill, supplierName: supplier.name } : bill));
    if (!supplier.active) setBillDraft((current) => current.supplierId === supplier.id ? { ...current, supplierId: "" } : current);
  };

  const saveSupplier = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (supplierDraft.name.trim().length < 2) { setError("Escribe el nombre del proveedor"); return; }
    const input = {
      name: supplierDraft.name.trim(), contactName: optionalText(supplierDraft.contactName),
      phone: optionalText(supplierDraft.phone), taxId: optionalText(supplierDraft.taxId), notes: optionalText(supplierDraft.notes),
    };
    void run(async () => {
      const { supplier } = editingSupplier
        ? await api.updateAccountingSupplier(editingSupplier.id, { expectedVersion: editingSupplier.version, ...input })
        : await api.createAccountingSupplier(input);
      upsertSupplier(supplier);
      setEditingSupplier(null);
      setSupplierDraft(initialSupplier);
    }, editingSupplier ? "Proveedor actualizado" : "Proveedor registrado");
  };

  const editSupplier = (supplier: AccountingSupplier) => {
    setEditingSupplier(supplier);
    setSupplierDraft({ name: supplier.name, contactName: supplier.contactName ?? "", phone: supplier.phone ?? "", taxId: supplier.taxId ?? "", notes: supplier.notes ?? "" });
    setError(null);
    setNotice(null);
  };

  const saveBill = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amountInCents = accountingPesosToCents(billDraft.amount);
    if (billDraft.description.trim().length < 2 || amountInCents === null || !billDraft.issuedOn) {
      setError("Describe el cargo e indica un importe mayor a cero"); return;
    }
    if (billDraft.dueOn && billDraft.dueOn < billDraft.issuedOn) { setError("El vencimiento debe ser igual o posterior a la fecha del cargo"); return; }
    void run(async () => {
      const { bill } = await api.createAccountingBill({
        supplierId: billDraft.supplierId || null, description: billDraft.description.trim(), amountInCents,
        issuedOn: billDraft.issuedOn, dueOn: billDraft.dueOn || null, reference: optionalText(billDraft.reference),
      });
      upsertBill(bill);
      setBillDraft({ supplierId: "", description: "", amount: "", issuedOn: today, dueOn: "", reference: "" });
    }, "Cargo registrado. Puedes registrar sus pagos parciales.");
  };

  const selectedBill = bills.find((bill) => bill.id === selectedBillId) ?? null;
  const openBill = (bill: AccountingBill) => {
    setSelectedBillId(bill.id);
    setPaymentDraft({ amount: (bill.outstandingInCents / 100).toFixed(2), methodCode: "CASH", paidOn: today, reference: "", source: "external" });
    setVoidingPayment(null);
    setVoidingBill(false);
    setVoidReason("");
    setError(null);
    setNotice(null);
  };

  const payBill = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedBill) return;
    const amountInCents = accountingPesosToCents(paymentDraft.amount);
    if (amountInCents === null || amountInCents > selectedBill.outstandingInCents) { setError("El pago debe ser mayor a cero y no puede exceder el saldo pendiente"); return; }
    if (!paymentDraft.paidOn) { setError("Indica la fecha del pago"); return; }
    if (paymentDraft.paidOn > today) { setError("Registra un pago ya realizado, con fecha de hoy o anterior"); return; }
    if (paymentDraft.source === "business_cash" && (paymentDraft.methodCode !== "CASH" || paymentDraft.paidOn !== today)) {
      setError("Una salida de caja debe ser en efectivo y con fecha de hoy en México"); return;
    }
    void run(async () => {
      const { bill } = await api.payAccountingBill(selectedBill.id, {
        expectedVersion: selectedBill.version, amountInCents, methodCode: paymentDraft.methodCode,
        paidOn: paymentDraft.paidOn, reference: optionalText(paymentDraft.reference), source: paymentDraft.source,
      });
      upsertBill(bill);
      setPaymentDraft((current) => ({ ...current, amount: (bill.outstandingInCents / 100).toFixed(2), reference: "" }));
    }, "Pago registrado");
  };

  const voidPayment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedBill || !voidingPayment || !voidReason.trim()) return;
    void run(async () => {
      const { bill } = await api.voidAccountingPayment(selectedBill.id, voidingPayment.id, { expectedVersion: selectedBill.version, reason: voidReason.trim() });
      upsertBill(bill);
      setVoidingPayment(null);
      setVoidReason("");
      setPaymentDraft((current) => ({ ...current, amount: (bill.outstandingInCents / 100).toFixed(2) }));
    }, "Pago anulado. El historial conserva el motivo.");
  };

  const voidBill = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedBill || selectedBill.voidedAt || selectedBill.paidInCents > 0 || !voidReason.trim()) return;
    void run(async () => {
      const { bill } = await api.voidAccountingBill(selectedBill.id, { expectedVersion: selectedBill.version, reason: voidReason.trim() });
      upsertBill(bill);
      setVoidingBill(false);
      setVoidReason("");
    }, "Cargo anulado. El historial conserva el motivo.");
  };

  const loadSummary = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!period.from || !period.to || period.from > period.to) { setError("Elige un periodo válido: Desde debe ser anterior o igual a Hasta"); return; }
    setBusy(true); setError(null); setNotice(null);
    try { setSummary(await api.accountingSummary(period)); setAppliedPeriod(period); }
    catch (loadError) { setError(errorText(loadError)); }
    finally { setBusy(false); }
  };

  const exportCsv = () => {
    if (!summary) return;
    const rows: Array<Array<string | number>> = [
      ["Contabilidad administrativa", "Desde", summary.from, "Hasta", summary.to],
      ["Concepto", "Importe MXN"], ["Ventas brutas", summary.sales.grossInCents / 100],
      ["Devoluciones", summary.sales.refundedInCents / 100], ["Ventas netas", summary.sales.netInCents / 100],
      ["Pagos de cargos y proveedores", summary.expenses.supplierPaymentsInCents / 100],
      ["Otros egresos de caja", summary.expenses.manualCashOutInCents / 100],
      ["Saldo operativo del periodo", summary.balanceInCents / 100],
      ["Saldo pendiente actual de cargos", summary.outstandingInCents / 100], [],
      ["Proveedor", "Cargo", "Fecha de pago", "Importe MXN", "Método", "Origen", "Referencia", "Estado", "Motivo de anulación"],
    ];
    for (const bill of bills) for (const payment of bill.payments) {
      if (payment.paidOn < summary.from || payment.paidOn > summary.to) continue;
      rows.push([bill.supplierName ?? "Gasto general", bill.description, payment.paidOn, payment.amountInCents / 100,
        methodName(payment.methodCode), payment.source === "business_cash" ? "Efectivo de caja del negocio" : "Externo",
        payment.reference ?? "", payment.voidedAt ? "Anulado" : "Registrado", payment.voidReason ?? ""]);
    }
    const url = URL.createObjectURL(new Blob([accountingCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `contabilidad-${summary.from}-${summary.to}.csv`;
    anchor.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop accounting-backdrop" role="presentation">
      <section className="touch-modal accounting-panel" role="dialog" aria-modal="true" aria-labelledby="accounting-title">
        <div className="modal-heading"><div><span className="eyebrow">Administración</span><h2 id="accounting-title">Contabilidad</h2></div><button type="button" aria-label="Cerrar contabilidad" disabled={saving} onClick={onClose}>×</button></div>
        <p className="modal-help">Consulta ventas y egresos, administra proveedores y registra los pagos que ya realizaste.</p>
        <nav className="accounting-tabs" aria-label="Secciones de contabilidad">
          <button type="button" aria-pressed={section === "summary"} disabled={busy} onClick={() => setSection("summary")}>Resumen</button>
          <button type="button" aria-pressed={section === "suppliers"} disabled={busy} onClick={() => setSection("suppliers")}>Proveedores</button>
          <button type="button" aria-pressed={section === "bills"} disabled={busy} onClick={() => setSection("bills")}>Cargos y pagos</button>
          <button type="button" disabled={busy} onClick={() => setReloadKey((current) => current + 1)}>Actualizar datos</button>
        </nav>
        {busy && <p role="status">Actualizando contabilidad…</p>}
        {notice && <p className="accounting-notice" role="status">{notice}</p>}
        {error && <p className="form-error accounting-error" role="alert">{error}</p>}

        {section === "summary" && <section aria-label="Resumen contable" className="accounting-section">
          <form className="accounting-period" onSubmit={(event) => void loadSummary(event)}>
            <label>Desde<input type="date" required value={period.from} disabled={busy} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} /></label>
            <label>Hasta<input type="date" required value={period.to} disabled={busy} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} /></label>
            <button className="accounting-primary" type="submit" disabled={busy}>Consultar periodo</button>
            <button type="button" disabled={busy || !summary} onClick={exportCsv}>Exportar CSV</button>
          </form>
          {summary && <>
            <p className="accounting-period-label">Del {accountingDateLabel(summary.from)} al {accountingDateLabel(summary.to)} · Fechas de México</p>
            <dl className="accounting-summary-grid">
              <div><dt>Ventas netas</dt><dd>{formatMoney(summary.sales.netInCents)}</dd><small>{summary.sales.receiptCount} tickets · Bruto {formatMoney(summary.sales.grossInCents)} · Devoluciones {formatMoney(summary.sales.refundedInCents)}</small></div>
              <div><dt>Pagos de cargos y proveedores</dt><dd>{formatMoney(summary.expenses.supplierPaymentsInCents)}</dd><small>Pagos registrados y vigentes del periodo</small></div>
              <div><dt>Otros egresos de caja</dt><dd>{formatMoney(summary.expenses.manualCashOutInCents)}</dd><small>Salidas adicionales del negocio</small></div>
              <div className="accounting-balance"><dt>Saldo operativo del periodo</dt><dd>{formatMoney(summary.balanceInCents)}</dd><small>Ventas netas menos egresos registrados</small></div>
              <div><dt>Saldo pendiente de cargos</dt><dd>{formatMoney(summary.outstandingInCents)}</dd><small>Saldo actual de todos los cargos, independiente del periodo</small></div>
            </dl>
          </>}
        </section>}

        {section === "suppliers" && <div className="accounting-columns">
          <form className="accounting-section accounting-form" onSubmit={saveSupplier} aria-label={editingSupplier ? "Editar proveedor" : "Nuevo proveedor"}>
            <h3>{editingSupplier ? "Editar proveedor" : "Nuevo proveedor"}</h3>
            <fieldset disabled={busy}>
              <label>Nombre del proveedor<input required minLength={2} maxLength={160} value={supplierDraft.name} onChange={(event) => setSupplierDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>Contacto<input maxLength={160} value={supplierDraft.contactName} onChange={(event) => setSupplierDraft((current) => ({ ...current, contactName: event.target.value }))} /></label>
              <label>Teléfono<input type="tel" maxLength={60} value={supplierDraft.phone} onChange={(event) => setSupplierDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
              <label>RFC (opcional)<input maxLength={40} value={supplierDraft.taxId} onChange={(event) => setSupplierDraft((current) => ({ ...current, taxId: event.target.value.toUpperCase() }))} /></label>
              <label>Notas del proveedor<textarea maxLength={1000} rows={3} value={supplierDraft.notes} onChange={(event) => setSupplierDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
              <div className="accounting-actions">{editingSupplier && <button type="button" onClick={() => { setEditingSupplier(null); setSupplierDraft(initialSupplier); }}>Cancelar edición</button>}<button className="accounting-primary" type="submit">{editingSupplier ? "Guardar proveedor" : "Registrar proveedor"}</button></div>
            </fieldset>
          </form>
          <section className="accounting-section" aria-label="Lista de proveedores">
            <h3>Proveedores registrados</h3>
            {!suppliers.length && <p>Aún no hay proveedores. Registra el primero para agregar cargos.</p>}
            <div className="accounting-list">{suppliers.map((supplier) => <article key={supplier.id} className={supplier.active ? "accounting-card" : "accounting-card inactive"}>
              <div className="accounting-card-heading"><h4>{supplier.name}</h4><span className="accounting-badge">{supplier.active ? "Activo" : "Inactivo"}</span></div>
              {supplier.contactName && <p>Contacto: {supplier.contactName}</p>}{supplier.phone && <p>Teléfono: {supplier.phone}</p>}{supplier.taxId && <p>RFC: {supplier.taxId}</p>}{supplier.notes && <p>{supplier.notes}</p>}
              <div className="accounting-actions"><button type="button" disabled={busy} aria-label={`Editar ${supplier.name}`} onClick={() => editSupplier(supplier)}>Editar</button><button type="button" disabled={busy} aria-label={`${supplier.active ? "Desactivar" : "Activar"} ${supplier.name}`} onClick={() => void run(async () => {
                const result = await api.updateAccountingSupplier(supplier.id, { expectedVersion: supplier.version, active: !supplier.active }); upsertSupplier(result.supplier);
                if (editingSupplier?.id === supplier.id) setEditingSupplier(result.supplier);
              }, supplier.active ? "Proveedor desactivado" : "Proveedor activado")}>{supplier.active ? "Desactivar" : "Activar"}</button></div>
            </article>)}</div>
          </section>
        </div>}

        {section === "bills" && <div className="accounting-columns">
          <form className="accounting-section accounting-form" onSubmit={saveBill} aria-label="Nuevo cargo">
            <h3>Registrar cargo</h3>
            <p className="modal-help">Puedes vincular un proveedor o registrar gastos generales, como renta o luz.</p>
            <fieldset disabled={busy}>
              <label>Proveedor (opcional)<select value={billDraft.supplierId} onChange={(event) => setBillDraft((current) => ({ ...current, supplierId: event.target.value }))}><option value="">Sin proveedor / gasto general</option>{suppliers.filter((supplier) => supplier.active).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              <label>Concepto del cargo<input required minLength={2} maxLength={240} value={billDraft.description} onChange={(event) => setBillDraft((current) => ({ ...current, description: event.target.value }))} /></label>
              <label>Importe del cargo ($ MXN)<input required inputMode="decimal" placeholder="0.00" value={billDraft.amount} onChange={(event) => setBillDraft((current) => ({ ...current, amount: event.target.value }))} /></label>
              <label>Fecha del cargo<input type="date" required value={billDraft.issuedOn} onChange={(event) => setBillDraft((current) => ({ ...current, issuedOn: event.target.value }))} /></label>
              <label>Vencimiento (opcional)<input type="date" min={billDraft.issuedOn || undefined} value={billDraft.dueOn} onChange={(event) => setBillDraft((current) => ({ ...current, dueOn: event.target.value }))} /></label>
              <label>Referencia del cargo (opcional)<input maxLength={160} value={billDraft.reference} onChange={(event) => setBillDraft((current) => ({ ...current, reference: event.target.value }))} /></label>
              <button className="accounting-primary" type="submit">Registrar cargo</button>
            </fieldset>
          </form>
          <section className="accounting-section" aria-label="Cargos de proveedores"><h3>Cargos y saldos</h3>
            {!bills.length && <p>Aún no hay cargos registrados.</p>}
            <div className="accounting-list">{bills.map((bill) => <article key={bill.id} className="accounting-card">
              <div className="accounting-card-heading"><h4>{bill.supplierName ?? "Gasto general"}</h4><span className="accounting-badge">{bill.voidedAt ? "Anulado" : bill.outstandingInCents === 0 ? "Pagado" : bill.dueOn && bill.dueOn < today ? "Vencido" : "Pendiente"}</span></div>
              <p><strong>{bill.description}</strong></p><p>Cargo: {accountingDateLabel(bill.issuedOn)}{bill.dueOn ? ` · Vence: ${accountingDateLabel(bill.dueOn)}` : ""}</p>{bill.reference && <p>Referencia: {bill.reference}</p>}
              <dl className="accounting-bill-totals"><div><dt>Importe</dt><dd>{formatMoney(bill.amountInCents)}</dd></div><div><dt>Pagado</dt><dd>{formatMoney(bill.paidInCents)}</dd></div><div><dt>Pendiente</dt><dd>{formatMoney(bill.outstandingInCents)}</dd></div></dl>
              {bill.voidReason && <p>Motivo de anulación del cargo: {bill.voidReason}</p>}
              <button type="button" disabled={busy} aria-label={`Pagos de ${bill.description}`} onClick={() => openBill(bill)}>Ver pagos{bill.outstandingInCents > 0 ? " / Registrar pago" : ""}</button>
            </article>)}</div>
          </section>
        </div>}

        {selectedBill && <div className="modal-backdrop nested-backdrop accounting-backdrop" role="presentation">
          <section className="touch-modal accounting-payment-modal" role="dialog" aria-modal="true" aria-labelledby="accounting-payment-title">
            <div className="modal-heading"><div><span className="eyebrow">{selectedBill.supplierName ?? "Gasto general"}</span><h2 id="accounting-payment-title">Pagos de {selectedBill.description}</h2></div><button type="button" disabled={busy} aria-label="Cerrar pagos" onClick={() => { setSelectedBillId(null); setVoidingPayment(null); setVoidingBill(false); }}>×</button></div>
            <p>Saldo pendiente: <strong>{formatMoney(selectedBill.outstandingInCents)}</strong></p>
            {selectedBill.voidedAt && <p className="accounting-notice">Cargo anulado. Motivo: {selectedBill.voidReason}</p>}
            {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
            {!selectedBill.voidedAt && selectedBill.outstandingInCents > 0 && <form className="accounting-form" onSubmit={payBill} aria-label="Registrar pago a proveedor"><fieldset disabled={busy}>
              <label>Importe del pago ($ MXN)<input required inputMode="decimal" value={paymentDraft.amount} onChange={(event) => setPaymentDraft((current) => ({ ...current, amount: event.target.value }))} /></label>
              <label>Origen del pago<select value={paymentDraft.source} onChange={(event) => {
                const source = event.target.value as AccountingPaymentSource;
                setPaymentDraft((current) => ({ ...current, source, ...(source === "business_cash" ? { methodCode: "CASH", paidOn: today } : {}) }));
              }}><option value="external">Externo (no afecta la caja del negocio)</option><option value="business_cash">Efectivo de caja del negocio</option></select></label>
              <label>Método del pago<select value={paymentDraft.methodCode} disabled={paymentDraft.source === "business_cash"} onChange={(event) => setPaymentDraft((current) => ({ ...current, methodCode: event.target.value as AccountingPaymentMethod }))}><option value="CASH">Efectivo</option><option value="CARD">Tarjeta</option><option value="TRANSFER">Transferencia</option></select></label>
              <label>Fecha del pago<input type="date" required max={today} disabled={paymentDraft.source === "business_cash"} value={paymentDraft.paidOn} onChange={(event) => setPaymentDraft((current) => ({ ...current, paidOn: event.target.value }))} /></label>
              <label>Referencia del pago (opcional)<input maxLength={160} value={paymentDraft.reference} onChange={(event) => setPaymentDraft((current) => ({ ...current, reference: event.target.value }))} /></label>
              <p className="modal-help">{paymentDraft.source === "business_cash" ? "Registra una salida en el turno abierto de esta terminal, con fecha de hoy en México. Requiere caja abierta." : "Registra un pago ya realizado sin descontarlo de la caja del negocio. Puedes registrar fechas anteriores."}</p>
              <button className="accounting-primary" type="submit">Registrar pago</button>
            </fieldset></form>}
            <section className="accounting-payment-history" aria-label="Historial de pagos"><h3>Historial de pagos</h3>{!selectedBill.payments.length && <p>Este cargo aún no tiene pagos.</p>}
              {selectedBill.payments.map((payment) => <article key={payment.id} className="accounting-card">
                <div className="accounting-card-heading"><strong>{formatMoney(payment.amountInCents)}</strong><span className="accounting-badge">{payment.voidedAt ? "Anulado" : "Registrado"}</span></div>
                <p>{accountingDateLabel(payment.paidOn)} · {methodName(payment.methodCode)} · {payment.source === "business_cash" ? "Caja del negocio" : "Externo"}</p>{payment.reference && <p>Referencia: {payment.reference}</p>}{payment.voidReason && <p>Motivo de anulación: {payment.voidReason}</p>}
                {!payment.voidedAt && <button type="button" disabled={busy} aria-label={`Anular pago de ${formatMoney(payment.amountInCents)}`} onClick={() => { setVoidingBill(false); setVoidingPayment(payment); setVoidReason(""); }}>Anular pago</button>}
              </article>)}
            </section>
            {voidingPayment && <form className="accounting-void-form accounting-form" onSubmit={voidPayment} aria-label="Anular pago">
              <h3>Anular pago de {formatMoney(voidingPayment.amountInCents)}</h3>
              <p>El saldo del cargo volverá a aumentar y el resumen de su fecha original se recalculará.{voidingPayment.source === "business_cash" ? " Se registrará el movimiento que repone el efectivo. Requiere que el turno de caja original siga abierto." : ""}</p>
              <label>Motivo de anulación<textarea required maxLength={240} rows={3} disabled={busy} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} /></label>
              <ReasonPresets context="paymentVoid" value={voidReason} onChange={setVoidReason} disabled={busy} />
              <div className="accounting-actions"><button type="button" disabled={busy} onClick={() => setVoidingPayment(null)}>Conservar pago</button><button className="accounting-danger" type="submit" disabled={busy || !voidReason.trim()}>Confirmar anulación</button></div>
            </form>}
            {!selectedBill.voidedAt && <section className="accounting-bill-void-section" aria-label="Anulación del cargo">
              {selectedBill.paidInCents > 0 ? <p className="modal-help">Para anular este cargo, anula primero sus pagos vigentes.</p> : voidingBill ? <form className="accounting-void-form accounting-form" onSubmit={voidBill} aria-label="Anular cargo">
                <h3>Anular cargo</h3><p>Se eliminará del saldo pendiente y conservará el historial.</p>
                <label>Motivo de anulación del cargo<textarea required maxLength={240} rows={3} disabled={busy} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} /></label>
                <ReasonPresets context="billVoid" value={voidReason} onChange={setVoidReason} disabled={busy} />
                <div className="accounting-actions"><button type="button" disabled={busy} onClick={() => setVoidingBill(false)}>Conservar cargo</button><button className="accounting-danger" type="submit" disabled={busy || !voidReason.trim()}>Confirmar anulación del cargo</button></div>
              </form> : <button className="accounting-danger" type="button" disabled={busy} onClick={() => { setVoidingBill(true); setVoidingPayment(null); setVoidReason(""); }}>Anular cargo</button>}
            </section>}
          </section>
        </div>}
      </section>
    </div>
  );
};
