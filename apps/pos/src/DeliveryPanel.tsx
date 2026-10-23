import { type FormEvent, useEffect, useRef, useState } from "react";
import type { DeliveryAssignment, DeliveryDriver, DeliveryPanelProps, DeliveryStatus } from "./delivery";
import { deliveryStatusLabel } from "./delivery";
import { formatMoney } from "./format";
import "./delivery.css";

const message = (cause: unknown) => cause instanceof Error ? cause.message : "No se pudo completar la operación";

export const DeliveryPanel = ({ api, account, onClose }: DeliveryPanelProps) => {
  const [drivers, setDrivers] = useState<DeliveryDriver[]>([]);
  const [assignments, setAssignments] = useState<DeliveryAssignment[]>([]);
  const [driverId, setDriverId] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [customerName, setCustomerName] = useState(account?.customerName ?? "");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(true);
  const [selected, setSelected] = useState<DeliveryAssignment | null>(null);
  const [baseUrl, setBaseUrl] = useState(window.location.origin);
  const [share, setShare] = useState<{ id: string; url: string; expiresAt: string } | null>(null);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const lock = useRef(false);
  const shareInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    const [nextDrivers, nextAssignments] = await Promise.all([api.deliveryDrivers(), api.deliveryAssignments()]);
    setDrivers(nextDrivers);
    setAssignments(nextAssignments);
    setDriverId((current) => current || nextDrivers.find((driver) => driver.active)?.id || "");
    setSelected((current) => current ? nextAssignments.find((item) => item.id === current.id) ?? null : null);
  };

  useEffect(() => {
    let active = true;
    void Promise.all([api.deliveryDrivers(), api.deliveryAssignments()]).then(([nextDrivers, nextAssignments]) => {
      if (!active) return;
      setDrivers(nextDrivers);
      setAssignments(nextAssignments);
      setDriverId(nextDrivers.find((driver) => driver.active)?.id ?? "");
    }).catch((cause) => { if (active) setError(message(cause)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api]);

  const mutate = async (operation: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try { await operation(); await load(); }
    catch (cause) { setError(message(cause)); await load().catch(() => undefined); }
    finally { lock.current = false; setBusy(false); }
  };

  const addDriver = (event: FormEvent) => {
    event.preventDefault();
    if (!driverName.trim()) return;
    void mutate(async () => {
      const result = await api.createDeliveryDriver({ name: driverName.trim(), ...(driverPhone.trim() ? { phone: driverPhone.trim() } : {}) });
      setDriverId(result.driver.id);
      setDriverName(""); setDriverPhone(""); setNotice("Repartidor agregado");
    });
  };

  const assign = (event: FormEvent) => {
    event.preventDefault();
    if (!account || !driverId || !address.trim()) return;
    void mutate(async () => {
      const result = await api.assignDelivery({
        accountId: account.id, expectedAccountVersion: account.version, driverId,
        address: address.trim(), ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setSelected(result.assignment);
      setNotice("Pedido asignado. Genera el enlace para abrirlo en el teléfono del repartidor.");
    });
  };

  const changeStatus = (assignment: DeliveryAssignment, status: DeliveryStatus) => void mutate(async () => {
    const result = await api.updateDeliveryStatus(assignment.id, { expectedVersion: assignment.version, status });
    setSelected(result.assignment);
    if (status === "cancelled") setShare(null);
    setNotice(`Reparto ${deliveryStatusLabel[status].toLowerCase()}. Los cobros se registran en caja.`);
  });

  const generateShare = (assignment: DeliveryAssignment) => void mutate(async () => {
    let origin: URL;
    try {
      origin = new URL(baseUrl);
      if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) throw new Error();
    } catch { throw new Error("Escribe la dirección del sistema que abre el teléfono, por ejemplo http://192.168.1.10:8080"); }
    const result = await api.shareDelivery(assignment.id, assignment.version);
    const url = new URL("/reparto", origin);
    url.hash = new URLSearchParams({ token: result.token }).toString();
    setShare({ id: assignment.id, url: url.toString(), expiresAt: result.expiresAt });
    setNotice("Abre el enlace en el teléfono conectado al Wi-Fi del negocio y guarda la comanda antes de salir.");
  });

  const refresh = (assignment: DeliveryAssignment) => void mutate(async () => {
    const current = await api.account(assignment.accountId);
    const result = await api.refreshDelivery(assignment.id, { expectedVersion: assignment.version, expectedAccountVersion: current.version });
    setSelected(result.assignment); setShare(null);
    setNotice("Comanda actualizada. Genera otro enlace para el repartidor.");
  });

  const copyShare = async () => {
    if (!share) return;
    try { await navigator.clipboard.writeText(share.url); setNotice("Enlace copiado"); }
    catch { shareInput.current?.select(); setNotice("Selecciona y copia el enlace para abrirlo en el teléfono"); }
  };

  const visible = assignments.filter((item) => filter === "all" || ["assigned", "out_for_delivery"].includes(item.status));
  const currentAssigned = account && assignments.some((item) => item.accountId === account.id && ["assigned", "out_for_delivery"].includes(item.status));

  return <div className="modal-backdrop" role="presentation">
    <section className="touch-modal delivery-panel" role="dialog" aria-modal="true" aria-labelledby="delivery-title">
      <div className="modal-heading"><div><span className="eyebrow">Comandas en el teléfono</span><h2 id="delivery-title">Repartos</h2></div><button type="button" aria-label="Cerrar repartos" disabled={busy} onClick={onClose}>×</button></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="delivery-notice" role="status">{notice}</p>}
      <details className="delivery-driver-form"><summary>Agregar repartidor</summary><form onSubmit={addDriver}>
        <label>Nombre del repartidor<input required maxLength={80} value={driverName} onChange={(event) => setDriverName(event.target.value)} /></label>
        <label>Teléfono del repartidor (opcional)<input type="tel" maxLength={30} value={driverPhone} onChange={(event) => setDriverPhone(event.target.value)} /></label>
        <button className="access-primary" type="submit" disabled={busy || !driverName.trim()}>Guardar repartidor</button>
      </form></details>
      {account && <section className="delivery-section"><h3>Asignar este pedido</h3>
        {currentAssigned ? <p>Este pedido ya tiene un reparto activo. Selecciónalo abajo para ver su comanda o actualizarla.</p> : <form onSubmit={assign}>
          <label>Repartidor<select required value={driverId} onChange={(event) => setDriverId(event.target.value)}><option value="">Selecciona un repartidor</option>{drivers.filter((driver) => driver.active).map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></label>
          <label>Cliente de la entrega (opcional)<input maxLength={80} value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></label>
          <label>Teléfono del cliente (opcional)<input type="tel" maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          <label>Dirección de entrega<textarea required maxLength={500} rows={2} value={address} onChange={(event) => setAddress(event.target.value)} /></label>
          <label>Indicaciones para el repartidor (opcional)<textarea maxLength={500} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <button className="access-primary" type="submit" disabled={busy || !driverId || !address.trim() || !account.items.some((item) => item.preparationState !== "cancelled")}>Asignar al repartidor</button>
        </form>}
      </section>}
      <section className="delivery-section"><div className="delivery-list-heading"><h3>Pedidos de reparto</h3><label>Mostrar<select value={filter} onChange={(event) => setFilter(event.target.value as "active" | "all")}><option value="active">Activos</option><option value="all">Todos</option></select></label><button type="button" disabled={busy} onClick={() => void mutate(async () => {})}>Actualizar lista</button></div>
        {busy && <p role="status">Actualizando repartos…</p>}
        {!busy && !visible.length && <p>No hay repartos {filter === "active" ? "activos" : "registrados"}.</p>}
        <div className="delivery-list">{visible.map((item) => <button type="button" key={item.id} className={selected?.id === item.id ? "selected" : ""} onClick={() => { setSelected(item); setError(null); }}>
          <strong>{item.customerName || item.snapshot.label}</strong><span>{item.driverName} · {deliveryStatusLabel[item.status]}</span><small>{item.address}</small>{item.accountChanged && <small className="delivery-warning">{item.accountUnavailable ? "Pedido sin entrega disponible; cancela el reparto" : "La comanda cambió; actualízala antes de compartir"}</small>}
        </button>)}</div>
      </section>
      {selected && <section className="delivery-section delivery-selected" aria-label="Detalle del reparto">
        <h3>{selected.customerName || selected.snapshot.label}</h3><p>{selected.driverName} · {deliveryStatusLabel[selected.status]}</p><p>{selected.address}</p>
        {selected.phone && <p>Teléfono: {selected.phone}</p>}{selected.notes && <p>Indicaciones: {selected.notes}</p>}
        {selected.snapshot.items.map((item, index) => <div className="delivery-item" key={index}><strong>{item.quantity} × {item.productName}</strong>{item.modifiers.length > 0 && <span>{item.modifiers.join(", ")}</span>}{item.note && <span>Nota: {item.note}</span>}</div>)}
        <p><strong>Total del pedido: {formatMoney(selected.snapshot.totalInCents)}</strong></p><p className="modal-help">Marcar entregado no registra el cobro. Los pagos del cliente se registran en caja.</p>
        {selected.accountChanged && <p className="delivery-warning" role="alert">{selected.accountUnavailable ? "El pedido está vacío, fue fusionado, cancelado o reembolsado; ya no se puede repartir. Cancela el reparto si sigue activo." : "La cuenta cambió. Actualiza la comanda y comparte un nuevo enlace antes de salir."}</p>}
        <div className="delivery-actions">
          {selected.status !== "cancelled" && selected.accountChanged && !selected.accountUnavailable && <button type="button" disabled={busy} onClick={() => refresh(selected)}>Actualizar comanda</button>}
          {selected.status === "assigned" && <button type="button" disabled={busy || selected.accountChanged} onClick={() => changeStatus(selected, "out_for_delivery")}>Marcar en camino</button>}
          {selected.status === "out_for_delivery" && <button type="button" disabled={busy || selected.accountChanged} onClick={() => changeStatus(selected, "delivered")}>Marcar entregado</button>}
          {["assigned", "out_for_delivery"].includes(selected.status) && <button className="danger-button" type="button" disabled={busy} onClick={() => changeStatus(selected, "cancelled")}>Cancelar reparto</button>}
        </div>
        {selected.status !== "cancelled" && <div className="delivery-sharing">
          <label>Dirección del sistema para el teléfono<input type="url" value={baseUrl} placeholder="http://192.168.1.10:8080" onChange={(event) => setBaseUrl(event.target.value)} /></label>
          {/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i.test(baseUrl) && <p className="delivery-warning">Para otro teléfono usa la dirección de red de la PC, en lugar de localhost.</p>}
          <button className="access-primary" type="button" disabled={busy || selected.accountChanged} onClick={() => generateShare(selected)}>{selected.shareExpiresAt ? "Renovar enlace para teléfono" : "Generar enlace para teléfono"}</button>
          <p className="modal-help">Cada enlace permite consultar sólo esta entrega y vence en 72 horas. Renovarlo invalida el enlace anterior.</p>
          {share?.id === selected.id && !selected.accountChanged && <div><label>Enlace de la comanda<input ref={shareInput} readOnly value={share.url} onFocus={(event) => event.target.select()} /></label><div className="delivery-actions"><button type="button" onClick={() => void copyShare()}>Copiar enlace</button>{typeof navigator.share === "function" && <button type="button" onClick={() => void navigator.share({ title: "Comanda de reparto", url: share.url }).catch(() => undefined)}>Compartir enlace</button>}<a href={share.url} target="_blank" rel="noreferrer">Abrir comanda</a></div></div>}
        </div>}
      </section>}
    </section>
  </div>;
};
