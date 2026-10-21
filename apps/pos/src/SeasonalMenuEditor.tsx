import { useState } from "react";
import type { CatalogCategory, CatalogProduct, SeasonalProductChange } from "./api/types";
import { formatMoney } from "./format";

export interface SeasonalMenuApi {
  createSeasonalProduct(input: {
    categoryId: string;
    name: string;
    priceInCents: number;
  }): Promise<SeasonalProductChange>;
  updateSeasonalProduct(
    productId: string,
    input: { expectedVersion: number; name?: string; priceInCents?: number; available?: boolean },
  ): Promise<SeasonalProductChange>;
}

interface SeasonalMenuEditorProps {
  api: SeasonalMenuApi;
  category: CatalogCategory;
  onChanged(): Promise<void>;
  onClose(): void;
}

const pesosToCents = (value: string): number | null => {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
};

const centsToPesos = (cents: number): string =>
  cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : "No fue posible guardar el cambio";

const SeasonalRow = ({
  product,
  disabled,
  onSave,
}: {
  product: CatalogProduct;
  disabled: boolean;
  onSave(product: CatalogProduct, change: { name?: string; priceInCents?: number; available?: boolean }): Promise<void>;
}) => {
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(centsToPesos(product.priceInCents));
  const priceInCents = pesosToCents(price);
  const nameChanged = name.trim() !== product.name;
  const priceChanged = priceInCents !== null && priceInCents !== product.priceInCents;
  const valid = name.trim().length >= 2 && priceInCents !== null;

  return (
    <article className={product.available ? "seasonal-row" : "seasonal-row unavailable"}>
      <label>Platillo<input value={name} maxLength={80} disabled={disabled} onChange={(event) => setName(event.target.value)} /></label>
      <label className="seasonal-price">Precio $<input value={price} inputMode="decimal" disabled={disabled} aria-label={`Precio de ${product.name}`} onChange={(event) => setPrice(event.target.value)} /></label>
      <button
        className={product.available ? "seasonal-toggle on" : "seasonal-toggle"}
        type="button"
        aria-pressed={product.available}
        disabled={disabled}
        onClick={() => void onSave(product, { available: !product.available })}
      >
        {product.available ? "Hoy sí" : "Hoy no"}
      </button>
      <button
        className="seasonal-save"
        type="button"
        disabled={disabled || !valid || (!nameChanged && !priceChanged)}
        onClick={() => void onSave(product, {
          ...(nameChanged ? { name: name.trim() } : {}),
          ...(priceChanged && priceInCents !== null ? { priceInCents } : {}),
        })}
      >
        Guardar
      </button>
    </article>
  );
};

export const SeasonalMenuEditor = ({ api, category, onChanged, onClose }: SeasonalMenuEditorProps) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const newPriceInCents = pesosToCents(newPrice);

  const run = async (operation: () => Promise<SeasonalProductChange>, message: (change: SeasonalProductChange) => string) => {
    setBusy(true);
    setError(null);
    try {
      const change = await operation();
      await onChanged();
      setNotice(message(change));
      return true;
    } catch (operationError) {
      setError(errorText(operationError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async (
    product: CatalogProduct,
    change: { name?: string; priceInCents?: number; available?: boolean },
  ) => {
    await run(
      () => api.updateSeasonalProduct(product.id, { expectedVersion: product.version, ...change }),
      ({ product: saved }) => `${saved.name}: ${formatMoney(saved.priceInCents)} · ${saved.available ? "disponible hoy" : "no disponible hoy"}`,
    );
  };

  const create = async () => {
    if (newPriceInCents === null) return;
    const created = await run(
      () => api.createSeasonalProduct({
        categoryId: category.id,
        name: newName.trim(),
        priceInCents: newPriceInCents,
      }),
      ({ product }) => `${product.name} agregado al menú`,
    );
    if (created) {
      setNewName("");
      setNewPrice("");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="touch-modal seasonal-editor" role="dialog" aria-modal="true" aria-labelledby="seasonal-title">
        <div className="modal-heading">
          <div><span className="eyebrow">Administración</span><h2 id="seasonal-title">{category.name}</h2></div>
          <button type="button" aria-label="Cerrar" onClick={onClose}>×</button>
        </div>
        <p className="modal-help">Cambia el precio o el nombre y toca Guardar. “Hoy no” oculta el platillo para los meseros sin borrarlo.</p>
        <div className="seasonal-rows">
          {category.products.map((product) => (
            // La clave incluye la versión para que la fila tome los valores guardados.
            <SeasonalRow key={`${product.id}:${product.version}`} product={product} disabled={busy} onSave={save} />
          ))}
        </div>
        <fieldset className="modifier-group seasonal-new">
          <legend>Nuevo platillo</legend>
          <div className="seasonal-row">
            <label>Platillo<input value={newName} maxLength={80} disabled={busy} placeholder="Ej. Pozole verde" onChange={(event) => setNewName(event.target.value)} /></label>
            <label className="seasonal-price">Precio $<input value={newPrice} inputMode="decimal" disabled={busy} aria-label="Precio del nuevo platillo" onChange={(event) => setNewPrice(event.target.value)} /></label>
            <button className="seasonal-save" type="button" disabled={busy || newName.trim().length < 2 || newPriceInCents === null} onClick={() => void create()}>Agregar</button>
          </div>
        </fieldset>
        {notice && <p className="modal-help" role="status">{notice}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions single-action"><button type="button" onClick={onClose}>Listo</button></div>
      </section>
    </div>
  );
};
