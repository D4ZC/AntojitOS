import { useMemo, useReducer, useState } from "react";
import {
  createOrder,
  orderReducer,
  orderTotalInCents,
  pendingItemCount,
  type Product,
} from "@antojit-os/domain";
import { categories, favoriteProductIds, products } from "./catalog";
import { formatMoney } from "./format";

type CategoryId = (typeof categories)[number]["id"];

export const App = () => {
  const [activeCategory, setActiveCategory] = useState<CategoryId>("favorites");
  const [order, dispatch] = useReducer(orderReducer, undefined, () => createOrder());
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState("Listo para capturar");

  const visibleProducts = useMemo(
    () =>
      activeCategory === "favorites"
        ? products.filter((product) => favoriteProductIds.has(product.id))
        : products.filter((product) => product.category === activeCategory),
    [activeCategory],
  );

  const pendingCount = pendingItemCount(order);
  const total = orderTotalInCents(order);

  const addProduct = (product: Product) => {
    dispatch({ type: "product-added", product });
    setNotice(`${product.name} agregado`);
  };

  const sendToKitchen = () => {
    if (pendingCount === 0 || isSending) return;

    setIsSending(true);
    setNotice("Enviando comanda…");

    window.setTimeout(() => {
      dispatch({ type: "pending-items-sent" });
      setNotice("Comanda enviada a cocina");
      setIsSending(false);
    }, 500);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="AntojitOS">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span>Antojit<span>OS</span></span>
        </div>

        <div className="service-context">
          <button className="context-button" type="button" aria-label="Cambiar mesa">
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
          <div className="order-heading">
            <div>
              <span className="eyebrow">Cuenta actual</span>
              <h2 id="order-title">Orden #{order.id.slice(0, 4).toUpperCase()}</h2>
            </div>
            <button type="button" className="icon-button" aria-label="Más opciones">•••</button>
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
                    <button className="note-button" type="button" disabled={item.preparationState !== "pending"}>
                      + Nota
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
              disabled={pendingCount === 0 || isSending}
              onClick={sendToKitchen}
            >
              <span>{isSending ? "Enviando…" : "Enviar a cocina"}</span>
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
    </main>
  );
};

