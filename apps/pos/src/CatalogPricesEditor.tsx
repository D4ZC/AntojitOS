import { useState } from "react";
import type { CatalogCategory, CatalogModifier, CatalogProduct, SeasonalProductChange } from "./api/types";
import { formatMoney } from "./format";

export interface CatalogPricingApi {
  updateProductPrice(productId: string, input: {
    expectedVersion: number;
    priceInCents: number;
  }): Promise<SeasonalProductChange>;
  updateModifierPrice(modifierId: string, input: {
    expectedPriceDeltaInCents: number;
    priceDeltaInCents: number;
  }): Promise<{ modifier: { id: string; name: string; priceDeltaInCents: number } }>;
}

interface CatalogPricesEditorProps {
  api: CatalogPricingApi;
  categories: CatalogCategory[];
  initialCategoryId?: string;
  onChanged(): Promise<void>;
  onClose(): void;
}

const centsToPesos = (cents: number): string =>
  cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);

const pesosToCents = (value: string): number | null => {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 1_000_000 ? cents : null;
};

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
const errorText = (error: unknown) => error instanceof Error ? error.message : "No fue posible guardar el cambio";

const PriceRow = ({
  id, name, description, additional, available, priceInCents, draft, busy, onDraft, onSave,
}: {
  id: string;
  name: string;
  description?: string;
  additional: boolean;
  available: boolean;
  priceInCents: number;
  draft: string | undefined;
  busy: boolean;
  onDraft(value: string): void;
  onSave(priceInCents: number): void;
}) => {
  const value = draft ?? centsToPesos(priceInCents);
  const parsed = pesosToCents(value);
  const invalid = draft !== undefined && parsed === null;
  const label = `${additional ? "Precio adicional" : "Precio base"} de ${name}`;
  return (
    <article className={`seasonal-row catalog-prices-row${available ? "" : " unavailable"}`}>
      <div className="catalog-prices-description">
        <strong>{name}</strong>
        {description && <small>{description}</small>}
        {!available && <small>No disponible actualmente</small>}
      </div>
      <label className="seasonal-price catalog-price-input">
        {additional ? "Adicional $" : "Precio base $"}
        <input
          value={value}
          inputMode="decimal"
          maxLength={12}
          aria-label={label}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          disabled={busy}
          onChange={(event) => onDraft(event.target.value)}
        />
      </label>
      <button
        className="seasonal-save"
        type="button"
        aria-label={`Guardar ${additional ? "precio adicional" : "precio base"} de ${name}`}
        disabled={busy || parsed === null || parsed === priceInCents}
        onClick={() => { if (parsed !== null) onSave(parsed); }}
      >Guardar</button>
      {invalid && <small className="form-error catalog-price-validation" id={`${id}-error`}>Usa un precio de $0 a $10,000 con hasta 2 decimales.</small>}
    </article>
  );
};

export const CatalogPricesEditor = ({ api, categories, initialCategoryId, onChanged, onClose }: CatalogPricesEditorProps) => {
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? "");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedProducts, setSavedProducts] = useState<Record<string, SeasonalProductChange["product"]>>({});
  const [savedModifiers, setSavedModifiers] = useState<Record<string, { basePriceInCents: number; priceInCents: number }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedCategories = categoryId ? categories.filter((category) => category.id === categoryId) : categories;
  const query = normalize(search.trim());
  const matches = (text: string) => !query || normalize(text).includes(query);
  const products = selectedCategories.flatMap((category) => category.products.map((product) => ({ category, product })));
  const groups = new Map<string, { name: string; products: Set<string>; options: Map<string, CatalogModifier> }>();
  const selectedGroupIds = new Set(products.flatMap(({ product }) => product.modifierGroups.map((group) => group.id)));
  for (const category of categories) {
    for (const product of category.products) {
      for (const group of product.modifierGroups) {
        if (!selectedGroupIds.has(group.id)) continue;
        const entry = groups.get(group.id) ?? { name: group.name, products: new Set<string>(), options: new Map<string, CatalogModifier>() };
        entry.products.add(product.name);
        group.options.forEach((option) => entry.options.set(option.id, option));
        groups.set(group.id, entry);
      }
    }
  }
  const visibleProducts = products.filter(({ category, product }) => matches(`${category.name} ${product.name} ${product.code}`));
  const visibleGroups = [...groups.entries()].flatMap(([id, group]) => {
    const allOptionsMatch = matches(`${group.name} ${[...group.products].join(" ")}`);
    const options = [...group.options.values()].filter((option) => allOptionsMatch || matches(option.name));
    return options.length ? [{ id, ...group, options }] : [];
  });
  const setDraft = (key: string, value: string) => setDrafts((current) => ({ ...current, [key]: value }));
  const clearDraft = (key: string) => setDrafts((current) => {
    const next = { ...current };
    delete next[key];
    return next;
  });
  const currentProduct = (product: CatalogProduct) => {
    const saved = savedProducts[product.id];
    return saved && saved.version >= product.version ? { ...product, ...saved } : product;
  };
  const currentModifierPrice = (modifier: CatalogModifier) => {
    const saved = savedModifiers[modifier.id];
    return saved && (modifier.priceDeltaInCents === saved.basePriceInCents || modifier.priceDeltaInCents === saved.priceInCents)
      ? saved.priceInCents : modifier.priceDeltaInCents;
  };
  const save = async (operation: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await operation();
      setNotice(message);
      try {
        await onChanged();
      } catch (refreshError) {
        setError(`El precio se guardó, pero no se pudo actualizar el menú: ${errorText(refreshError)}`);
      }
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setBusy(false);
    }
  };
  const saveProduct = (original: CatalogProduct, priceInCents: number) => void save(async () => {
    const product = currentProduct(original);
    const change = await api.updateProductPrice(product.id, { expectedVersion: product.version, priceInCents });
    setSavedProducts((current) => ({ ...current, [product.id]: change.product }));
    clearDraft(`product:${product.id}`);
    return `${change.product.name}: precio base ${formatMoney(change.product.priceInCents)}`;
  });
  const saveModifier = (modifier: CatalogModifier, priceDeltaInCents: number) => void save(async () => {
    const change = await api.updateModifierPrice(modifier.id, {
      expectedPriceDeltaInCents: currentModifierPrice(modifier),
      priceDeltaInCents,
    });
    setSavedModifiers((current) => ({ ...current, [modifier.id]: {
      basePriceInCents: modifier.priceDeltaInCents,
      priceInCents: change.modifier.priceDeltaInCents,
    } }));
    clearDraft(`modifier:${modifier.id}`);
    return `${change.modifier.name}: precio adicional ${formatMoney(change.modifier.priceDeltaInCents)}`;
  });
  const reloadPrices = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await onChanged();
      setSavedProducts({});
      setSavedModifiers({});
      setNotice("Precios actualizados. Tus cambios pendientes se conservaron; revísalos antes de guardar.");
    } catch (refreshError) {
      setError(`No fue posible recargar los precios: ${errorText(refreshError)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="touch-modal seasonal-editor catalog-prices-editor" role="dialog" aria-modal="true" aria-labelledby="catalog-prices-title" aria-busy={busy}>
        <div className="modal-heading">
          <div><span className="eyebrow">Administración</span><h2 id="catalog-prices-title">Precios del menú</h2></div>
          <button type="button" aria-label="Cerrar" autoFocus disabled={busy} onClick={onClose}>×</button>
        </div>
        <p className="modal-help">Cambia el precio base de los productos y los adicionales de sus opciones. Cada fila se guarda por separado; los precios guardados se aplican a los artículos que agregues después del cambio.</p>
        <div className="catalog-prices-toolbar">
          <label>Categoría<select value={categoryId} disabled={busy} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Todas las categorías</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select></label>
          <label>Buscar producto u opción<input type="search" value={search} disabled={busy} onChange={(event) => setSearch(event.target.value)} placeholder="Ej. flauta, queso, bote" /></label>
          <button className="seasonal-save" type="button" disabled={busy} onClick={() => void reloadPrices()}>Recargar precios</button>
        </div>
        {notice && <p className="modal-help" role="status">{notice}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {visibleProducts.length > 0 && <section className="catalog-prices-section" aria-label="Precios base">
          <h3>Precios base</h3>
          <div className="seasonal-rows catalog-prices-products">
            {visibleProducts.map(({ category, product: original }) => {
              const product = currentProduct(original);
              return <PriceRow key={product.id} id={`product-${product.id}`} name={product.name} description={category.name} additional={false} available={product.available} priceInCents={product.priceInCents} draft={drafts[`product:${product.id}`]} busy={busy} onDraft={(value) => setDraft(`product:${product.id}`, value)} onSave={(price) => saveProduct(original, price)} />;
            })}
          </div>
        </section>}
        {visibleGroups.length > 0 && <section className="catalog-prices-section" aria-label="Precios adicionales">
          <h3>Precios adicionales</h3>
          <p className="modal-help">El precio final suma el precio base y los adicionales elegidos. Al cambiar una opción compartida, su precio adicional cambia en todos los productos que la utilizan.</p>
          {visibleGroups.map((group) => <fieldset className="modifier-group" key={group.id}>
            <legend>{group.name}</legend>
            <p className="modal-help">Se utiliza en: {[...group.products].join(", ")}.</p>
            <div className="seasonal-rows">
              {group.options.map((modifier) => <PriceRow key={modifier.id} id={`modifier-${modifier.id}`} name={modifier.name} additional available={modifier.available} priceInCents={currentModifierPrice(modifier)} draft={drafts[`modifier:${modifier.id}`]} busy={busy} onDraft={(value) => setDraft(`modifier:${modifier.id}`, value)} onSave={(price) => saveModifier(modifier, price)} />)}
            </div>
          </fieldset>)}
        </section>}
        {visibleProducts.length === 0 && visibleGroups.length === 0 && <p className="modal-help">No hay productos u opciones que coincidan.</p>}
        <div className="modal-actions single-action"><button type="button" disabled={busy} onClick={onClose}>Listo</button></div>
      </section>
    </div>
  );
};
