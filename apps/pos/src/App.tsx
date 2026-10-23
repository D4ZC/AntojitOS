import { useEffect, useMemo, useReducer, useState } from "react";
import {
  createOrder,
  orderReducer,
  orderTotalInCents,
  pendingItemCount,
  type Order,
  type OrderItem,
  type Product,
} from "@antojit-os/domain";
import { categories, favoriteProductIds, products } from "./catalog";
import { formatMoney } from "./format";
import { hasQuickNote, QUICK_NOTES, toggleQuickNote } from "./notes";

type CategoryId = (typeof categories)[number]["id"];
const DEMO_ORDER_KEY = "antojit-os-demo-order";

const restoreDemoOrder = (): Order => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(DEMO_ORDER_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return createOrder();
    const order = saved as Partial<Order>;
    if (typeof order.id !== "string" || typeof order.label !== "string" ||
      !Number.isInteger(order.version) || !Array.isArray(order.items) ||
      !order.items.every((item) => item && typeof item.id === "string" &&
        typeof item.productId === "string" && typeof item.name === "string" &&
        Number.isInteger(item.priceInCents) && item.priceInCents >= 0 &&
        Number.isInteger(item.quantity) && item.quantity > 0 &&
        ["pending", "sent", "cancelled"].includes(item.preparationState) &&
        (item.note === null || typeof item.note === "string"))) return createOrder();
    const validDate = (date: unknown): date is string => typeof date === "string" && Number.isFinite(Date.parse(date));
    return {
      id: order.id,
      label: order.label,
      version: order.version!,
      items: order.items,
      customerName: typeof order.customerName === "string" ? order.customerName.slice(0, 80) : null,
      scheduledFor: validDate(order.scheduledFor) ? order.scheduledFor : null,
      scheduleDispatchedAt: validDate(order.scheduleDispatchedAt) ? order.scheduleDispatchedAt : null,
    };
  } catch {
    return createOrder();
  }
};

const localDateTime = (date: string | null): string => {
  if (!date) return "";
  const value = new Date(date);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const scheduleLabel = (date: string): string => new Date(date).toLocaleString("es-MX", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
});

export const App = () => {
  const [activeCategory, setActiveCategory] = useState<CategoryId>("favorites");
  const [order, dispatch] = useReducer(orderReducer, undefined, restoreDemoOrder);
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState("Listo para capturar");
  const [isChoosingTable, setIsChoosingTable] = useState(false);
  const [editingItem, setEditingItem] = useState<OrderItem | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [customerDraft, setCustomerDraft] = useState("");
  const [scheduleDraft, setScheduleDraft] = useState("");
  const [detailsError, setDetailsError] = useState<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem(DEMO_ORDER_KEY, JSON.stringify(order)); } catch { /* La captura sigue disponible sin almacenamiento local. */ }
  }, [order]);

  useEffect(() => {
    const dispatchIfDue = () => {
      if (!order.scheduledFor || order.scheduleDispatchedAt || pendingItemCount(order) === 0 ||
        Date.parse(order.scheduledFor) > Date.now()) return;
      dispatch({ type: "scheduled-items-sent", sentAt: new Date().toISOString() });
      setNotice("Pedido programado enviado automáticamente a cocina");
    };
    dispatchIfDue();
    const timer = window.setInterval(dispatchIfDue, 1000);
    window.addEventListener("focus", dispatchIfDue);
    document.addEventListener("visibilitychange", dispatchIfDue);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", dispatchIfDue);
      document.removeEventListener("visibilitychange", dispatchIfDue);
    };
  }, [order]);

  const visibleProducts = useMemo(
    () =>
      activeCategory === "favorites"
        ? products.filter((product) => favoriteProductIds.has(product.id))
        : products.filter((product) => product.category === activeCategory),
    [activeCategory],
  );

  const pendingCount = pendingItemCount(order);
  const total = orderTotalInCents(order);
  const awaitingSchedule = Boolean(order.scheduledFor && !order.scheduleDispatchedAt);

  const addProduct = (product: Product) => {
    dispatch({ type: "product-added", product });
    setNotice(`${product.name} agregado`);
  };

  const sendToKitchen = () => {
    if (pendingCount === 0 || isSending || awaitingSchedule) return;

    setIsSending(true);
    setNotice("Enviando comanda…");

    window.setTimeout(() => {
      dispatch({ type: "pending-items-sent" });
      setNotice("Comanda enviada a cocina");
      setIsSending(false);
    }, 500);
  };

  const openDetails = () => {
    setCustomerDraft(order.customerName ?? "");
    setScheduleDraft(localDateTime(order.scheduledFor));
    setDetailsError(null);
    setIsEditingDetails(true);
  };

  const saveDetails = () => {
    if (scheduleDraft && !Number.isFinite(Date.parse(scheduleDraft))) {
      setDetailsError("Ingresa una fecha y hora válidas para programar el pedido.");
      return;
    }
    const scheduledFor = scheduleDraft === localDateTime(order.scheduledFor)
      ? order.scheduledFor
      : scheduleDraft ? new Date(scheduleDraft).toISOString() : null;
    if (scheduledFor && scheduledFor !== order.scheduledFor && Date.parse(scheduledFor) <= Date.now()) {
      setDetailsError("Elige una fecha y hora futuras para programar el pedido.");
      return;
    }
    if (scheduledFor && scheduledFor !== order.scheduledFor && pendingCount === 0) {
      setDetailsError("Agrega artículos pendientes antes de programar el pedido.");
      return;
    }
    dispatch({ type: "details-updated", customerName: customerDraft, scheduledFor });
    setIsEditingDetails(false);
    setNotice(scheduledFor ? "Pedido programado para envío automático a cocina" : "Datos del pedido guardados");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="AntojitOS">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span>Antojit<span>OS</span></span>
        </div>

        <div className="service-context">
          <button className="context-button" type="button" aria-label="Cambiar mesa" onClick={() => setIsChoosingTable(true)}>
            <span className="context-eyebrow">Servicio en mesa</span>
            <strong>{order.label}</strong>
            <span aria-hidden="true">⌄</span>
          </button>
          <div className="guest-pill" aria-label="Dos comensales">
            <span aria-hidden="true">● ●</span>
            <strong>2</strong>
          </div>
        </div>

        <div className="terminal-status">
          <div>
            <span className="status-dot" aria-hidden="true" />
            <span>Servidor local</span>
          </div>
          <button type="button" className="user-button" aria-label="Opciones del usuario Ana">
            <span className="avatar">AM</span>
            <span><strong>Ana</strong><small>Terminal 1</small></span>
          </button>
        </div>
      </header>

      <section className="workspace">
        <nav className="category-rail" aria-label="Categorías del menú">
          {categories.map((category) => (
            <button
              className={activeCategory === category.id ? "category active" : "category"}
              key={category.id}
              type="button"
              aria-pressed={activeCategory === category.id}
              onClick={() => setActiveCategory(category.id)}
            >
              <span aria-hidden="true">{category.emoji}</span>
              <strong>{category.label}</strong>
            </button>
          ))}
          <button className="category more" type="button">
            <span aria-hidden="true">•••</span>
            <strong>Más</strong>
          </button>
        </nav>

        <section className="menu-panel" aria-labelledby="menu-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Menú</span>
              <h1 id="menu-title">
                {categories.find((category) => category.id === activeCategory)?.label}
              </h1>
            </div>
            <button className="search-button" type="button" aria-label="Buscar producto">
              <span aria-hidden="true">⌕</span>
              Buscar
            </button>
          </div>

          <div className="product-grid">
            {visibleProducts.map((product) => (
              <button
                className={`product-card tone-${product.color}`}
                key={product.id}
                type="button"
                onClick={() => addProduct(product)}
                aria-label={`Agregar ${product.name}, ${formatMoney(product.priceInCents)}`}
              >
                <span className="product-emoji" aria-hidden="true">{product.emoji}</span>
                <span className="product-copy">
                  <strong>{product.name}</strong>
                  <span>{formatMoney(product.priceInCents)}</span>
                </span>
                <span className="add-indicator" aria-hidden="true">+</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="order-panel" aria-labelledby="order-title">
          <div className="order-details-heading">
            <div className="order-heading">
              <div>
                <span className="eyebrow">Cuenta actual</span>
                <h2 id="order-title">Orden #{order.id.slice(0, 4).toUpperCase()}</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Más opciones">•••</button>
            </div>

            <div className="order-details">
              <button className="order-details-button" type="button" disabled={isSending} onClick={openDetails}>Cliente y programación</button>
              {order.customerName && <p className="order-details-summary">Cliente: {order.customerName}</p>}
              {order.scheduledFor && <p className="order-details-summary">{order.scheduleDispatchedAt ? "Enviado según programación" : "Envío automático"}: {scheduleLabel(order.scheduledFor)}</p>}
            </div>
          </div>

          <div className="order-items" aria-live="polite">
            {order.items.length === 0 ? (
              <div className="empty-order">
                <span aria-hidden="true">☝</span>
                <strong>Comienza la orden</strong>
                <p>Toca un producto para agregarlo a la cuenta.</p>
              </div>
            ) : (
              order.items.map((item) => (
                <article className="order-item" key={item.id}>
                  <div className="item-title">
                    <div>
                      <strong>{item.name}</strong>
                      <span className={`item-state ${item.preparationState}`}>
                        {item.preparationState === "pending" ? "Pendiente" : "En cocina"}
                      </span>
                    </div>
                    <strong>{formatMoney(item.priceInCents * item.quantity)}</strong>
                  </div>
                  {item.note && <p className="item-note">{item.note}</p>}
                  <div className="item-actions">
                    <button
                      type="button"
                      aria-label={`Quitar una unidad de ${item.name}`}
                      disabled={item.preparationState !== "pending"}
                      onClick={() => dispatch({ type: "quantity-changed", itemId: item.id, delta: -1 })}
                    >−</button>
                    <output aria-label={`Cantidad: ${item.quantity}`}>{item.quantity}</output>
                    <button
                      type="button"
                      aria-label={`Agregar una unidad de ${item.name}`}
                      disabled={item.preparationState !== "pending"}
                      onClick={() => dispatch({ type: "quantity-changed", itemId: item.id, delta: 1 })}
                    >+</button>
                    <button className="note-button" type="button" disabled={isSending || item.preparationState === "cancelled"} aria-label={`Editar nota de ${item.name}`} onClick={() => { setEditingItem(item); setNoteDraft(item.note ?? ""); }}>
                      {item.note ? "Editar nota" : "+ Nota"}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="notice" role="status">
            <span aria-hidden="true">●</span>
            {notice}
          </div>

          <div className="order-summary">
            <div><span>Subtotal</span><strong>{formatMoney(total)}</strong></div>
            <div><span>IVA incluido</span><span>{formatMoney(Math.round(total * 0.137931))}</span></div>
            <div className="total-row"><span>Total</span><strong>{formatMoney(total)}</strong></div>
          </div>

          <div className="primary-actions">
            <button
              className="send-button"
              type="button"
              disabled={pendingCount === 0 || isSending || awaitingSchedule}
              onClick={sendToKitchen}
            >
              <span>{isSending ? "Enviando…" : awaitingSchedule ? "Envío programado" : "Enviar a cocina"}</span>
              {pendingCount > 0 && <span className="count-badge">{pendingCount}</span>}
            </button>
            <button className="pay-button" type="button" disabled={order.items.length === 0 || pendingCount > 0}>
              Cobrar
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </aside>
      </section>

      <footer className="bottom-status">
        <span>Turno abierto · 09:42</span>
        <span>Sincronización local activa · v0.0.0</span>
      </footer>

      {isChoosingTable && <div className="modal-backdrop" role="presentation">
        <section className="touch-modal" role="dialog" aria-modal="true" aria-labelledby="demo-tables-title">
          <div className="modal-heading"><h2 id="demo-tables-title">Cambiar mesa</h2><button type="button" aria-label="Cerrar" onClick={() => setIsChoosingTable(false)}>×</button></div>
          <p className="modal-help">Selecciona la mesa para esta cuenta.</p>
          <div className="modifier-options">
            {Array.from({ length: 9 }, (_, index) => `Mesa ${index + 1}`).map((label) => <button type="button" key={label} className={order.label === label ? "selected" : ""} aria-pressed={order.label === label} onClick={() => { dispatch({ type: "label-changed", label }); setIsChoosingTable(false); }}>{label}</button>)}
          </div>
        </section>
      </div>}

      {editingItem && <div className="modal-backdrop" role="presentation">
        <section className="touch-modal note-modal" role="dialog" aria-modal="true" aria-labelledby="demo-note-title">
          <div className="modal-heading"><h2 id="demo-note-title">Nota · {editingItem.name}</h2><button type="button" aria-label="Cerrar" onClick={() => setEditingItem(null)}>×</button></div>
          {editingItem.preparationState === "sent" && <p className="modal-help">La nota se actualizará en la comanda enviada.</p>}
          <div className="quick-notes">{QUICK_NOTES.map((note) => <button type="button" key={note} className={hasQuickNote(noteDraft, note) ? "selected" : ""} aria-pressed={hasQuickNote(noteDraft, note)} onClick={() => setNoteDraft((current) => toggleQuickNote(current, note))}>{note}</button>)}</div>
          <label>Comentarios para cocina<textarea value={noteDraft} maxLength={120} onChange={(event) => setNoteDraft(event.target.value)} /></label>
          <div className="modal-actions"><button type="button" onClick={() => setEditingItem(null)}>Cancelar</button><button className="access-primary" type="button" onClick={() => { dispatch({ type: "item-note-updated", itemId: editingItem.id, note: noteDraft }); setEditingItem(null); setNotice("Comentarios de la comanda actualizados"); }}>Guardar nota</button></div>
        </section>
      </div>}

      {isEditingDetails && <div className="modal-backdrop" role="presentation">
        <section className="touch-modal order-details-modal" role="dialog" aria-modal="true" aria-labelledby="demo-details-title">
          <div className="modal-heading"><h2 id="demo-details-title">Datos del pedido</h2><button type="button" aria-label="Cerrar" onClick={() => setIsEditingDetails(false)}>×</button></div>
          <div className="access-form">
            <label>Cliente (opcional)<input value={customerDraft} maxLength={80} placeholder="Nombre del cliente" onChange={(event) => setCustomerDraft(event.target.value)} /></label>
            <label>Programar envío a cocina (opcional)<input type="datetime-local" value={scheduleDraft} onChange={(event) => setScheduleDraft(event.target.value)} /></label>
          </div>
          <p className="modal-help">En esta demostración, el envío automático requiere mantener la pantalla abierta. La fecha se guarda en este dispositivo.</p>
          {scheduleDraft && <button className="order-details-button" type="button" onClick={() => setScheduleDraft("")}>Quitar programación</button>}
          {detailsError && <p className="form-error" role="alert">{detailsError}</p>}
          <div className="modal-actions"><button type="button" onClick={() => setIsEditingDetails(false)}>Cancelar</button><button className="access-primary" type="button" onClick={saveDetails}>Guardar datos del pedido</button></div>
        </section>
      </div>}
    </main>
  );
};
