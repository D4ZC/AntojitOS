import { useState } from "react";
import type { CatalogCategory, CatalogProduct } from "./api/types";
import { formatMoney } from "./format";
import { composeNote, QUICK_NOTES } from "./notes";

export interface OrderBuilderLine {
  key: string;
  product: CatalogProduct;
  modifierIds: string[];
  quantity: number;
  note: string;
}

interface OrderBuilderProps {
  category: CatalogCategory;
  initialProduct: CatalogProduct;
  busy: boolean;
  error: string | null;
  onClose(): void;
  /** Devuelve las claves de las líneas que sí se agregaron a la cuenta. */
  onSubmit(lines: OrderBuilderLine[]): Promise<string[]>;
}

const MAX_QUANTITY = 99;

const hasOptions = (product: CatalogProduct): boolean =>
  product.modifierGroups.some((group) => group.options.some((option) => option.available));

const unitPrice = (product: CatalogProduct, modifierIds: string[]): number =>
  product.priceInCents + product.modifierGroups
    .flatMap((group) => group.options)
    .filter((option) => modifierIds.includes(option.id))
    .reduce((total, option) => total + option.priceDeltaInCents, 0);

const lineDescription = (line: Pick<OrderBuilderLine, "product" | "modifierIds" | "note">): string =>
  [
    ...line.product.modifierGroups
      .flatMap((group) => group.options)
      .filter((option) => line.modifierIds.includes(option.id))
      .map((option) => option.name),
    line.note,
  ].filter(Boolean).join(" · ");

const sameConfiguration = (left: OrderBuilderLine, right: Omit<OrderBuilderLine, "key" | "quantity">) =>
  left.product.id === right.product.id &&
  left.note === right.note &&
  left.modifierIds.length === right.modifierIds.length &&
  left.modifierIds.every((id) => right.modifierIds.includes(id));

let lineSequence = 0;

export const OrderBuilder = ({
  category,
  initialProduct,
  busy,
  error,
  onClose,
  onSubmit,
}: OrderBuilderProps) => {
  const [product, setProduct] = useState(initialProduct);
  const [modifierIds, setModifierIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [quickNotes, setQuickNotes] = useState<string[]>([]);
  const [freeNote, setFreeNote] = useState("");
  const [touched, setTouched] = useState(true);
  const [lines, setLines] = useState<OrderBuilderLine[]>([]);

  const siblings = category.products.filter((candidate) => candidate.available);
  const note = composeNote(quickNotes, freeNote);
  const currentIsValid = product.modifierGroups.every((group) => {
    const groupIds = new Set(group.options.map((option) => option.id));
    const count = modifierIds.filter((id) => groupIds.has(id)).length;
    return count >= group.minimumSelections && count <= group.maximumSelections;
  });
  // La configuración en pantalla cuenta como una línea más solo si el mesero la tocó;
  // así no se cuela una pieza extra después de usar "Agregar otra variante".
  const includeCurrent = currentIsValid && (touched || lines.length === 0);
  const pending = includeCurrent
    ? [...lines, { key: "current", product, modifierIds, quantity, note }]
    : lines;
  const pendingCount = pending.reduce((total, line) => total + line.quantity, 0);
  const pendingTotal = pending.reduce(
    (total, line) => total + unitPrice(line.product, line.modifierIds) * line.quantity,
    0,
  );

  const resetCurrent = (nextProduct: CatalogProduct, nextTouched: boolean) => {
    setProduct(nextProduct);
    setModifierIds([]);
    setQuantity(1);
    setQuickNotes([]);
    setFreeNote("");
    setTouched(nextTouched);
  };

  const toggleModifier = (group: CatalogProduct["modifierGroups"][number], modifierId: string) => {
    setTouched(true);
    setModifierIds((current) => {
      if (current.includes(modifierId)) return current.filter((id) => id !== modifierId);
      const groupIds = new Set(group.options.map((option) => option.id));
      const selectedInGroup = current.filter((id) => groupIds.has(id));
      const withoutGroup = current.filter((id) => !groupIds.has(id));
      if (group.maximumSelections === 1) return [...withoutGroup, modifierId];
      if (selectedInGroup.length >= group.maximumSelections) return current;
      return [...current, modifierId];
    });
  };

  const toggleQuickNote = (quickNote: string) => {
    setTouched(true);
    setQuickNotes((current) =>
      current.includes(quickNote)
        ? current.filter((value) => value !== quickNote)
        : [...current, quickNote],
    );
  };

  const stageCurrent = () => {
    if (!currentIsValid) return;
    const configuration = { product, modifierIds, note };
    setLines((current) => {
      const existing = current.find((line) => sameConfiguration(line, configuration));
      if (existing) {
        return current.map((line) =>
          line === existing
            ? { ...line, quantity: Math.min(MAX_QUANTITY, line.quantity + quantity) }
            : line,
        );
      }
      lineSequence += 1;
      return [...current, { ...configuration, key: `line-${lineSequence}`, quantity }];
    });
    resetCurrent(product, false);
  };

  const changeLineQuantity = (key: string, delta: number) => {
    setLines((current) =>
      current.map((line) =>
        line.key === key
          ? { ...line, quantity: Math.max(1, Math.min(MAX_QUANTITY, line.quantity + delta)) }
          : line,
      ),
    );
  };

  const submit = async () => {
    if (pending.length === 0) return;
    lineSequence += 1;
    const submitted = pending.map((line) =>
      line.key === "current" ? { ...line, key: `line-${lineSequence}` } : line,
    );
    const added = new Set(await onSubmit(submitted));
    // Si algo falló a la mitad, solo quedan en la lista las líneas que faltan.
    setLines(submitted.filter((line) => !added.has(line.key)));
    if (includeCurrent) resetCurrent(product, false);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="touch-modal order-builder" role="dialog" aria-modal="true" aria-labelledby="modifier-title">
        <div className="modal-heading">
          <div><span className="eyebrow">Personalizar · {category.name}</span><h2 id="modifier-title">{product.name}</h2></div>
          <button type="button" aria-label="Cerrar" onClick={onClose}>×</button>
        </div>

        {siblings.length > 1 && (
          <div className="builder-products" role="group" aria-label={`Productos de ${category.name}`}>
            {siblings.map((sibling) => (
              <button
                className={sibling.id === product.id ? "selected" : ""}
                type="button"
                key={sibling.id}
                aria-pressed={sibling.id === product.id}
                onClick={() => resetCurrent(sibling, true)}
              >
                <strong>{sibling.shortName}</strong><small>{formatMoney(sibling.priceInCents)}</small>
              </button>
            ))}
          </div>
        )}

        {hasOptions(product) && product.modifierGroups.map((group) => (
          <fieldset className="modifier-group" key={group.id}>
            <legend>{group.name} <small>{group.minimumSelections > 0 ? group.maximumSelections === 1 ? "Elige una" : group.minimumSelections === 1 ? "Elige una o varias" : `Elige de ${group.minimumSelections} a ${group.maximumSelections}` : `Opcional · máximo ${group.maximumSelections}`}</small></legend>
            <div className="modifier-options">
              {group.options.filter((option) => option.available).map((option) => (
                <button className={modifierIds.includes(option.id) ? "selected" : ""} type="button" key={option.id} aria-pressed={modifierIds.includes(option.id)} onClick={() => toggleModifier(group, option.id)}>
                  <span>{option.name}</span><small>{option.priceDeltaInCents === 0 ? "Sin costo" : `+ ${formatMoney(option.priceDeltaInCents)}`}</small>
                </button>
              ))}
            </div>
          </fieldset>
        ))}

        <fieldset className="modifier-group">
          <legend>Observaciones <small>Opcional</small></legend>
          <div className="quick-notes">
            {QUICK_NOTES.map((quickNote) => (
              <button className={quickNotes.includes(quickNote) ? "selected" : ""} type="button" key={quickNote} aria-pressed={quickNotes.includes(quickNote)} onClick={() => toggleQuickNote(quickNote)}>{quickNote}</button>
            ))}
          </div>
          <label className="builder-note">Nota<input value={freeNote} maxLength={120} placeholder="Otra indicación para cocina" onChange={(event) => { setTouched(true); setFreeNote(event.target.value); }} /></label>
        </fieldset>

        <div className="builder-current">
          <div className="item-actions" role="group" aria-label="Cantidad de esta variante">
            <button type="button" aria-label="Quitar una pieza" disabled={quantity <= 1} onClick={() => { setTouched(true); setQuantity((value) => value - 1); }}>−</button>
            <output aria-label={`Cantidad de esta variante: ${quantity}`}>{quantity}</output>
            <button type="button" aria-label="Agregar una pieza" disabled={quantity >= MAX_QUANTITY} onClick={() => { setTouched(true); setQuantity((value) => value + 1); }}>+</button>
          </div>
          <button className="builder-stage" type="button" disabled={!currentIsValid || busy} onClick={stageCurrent}>+ Agregar otra variante</button>
        </div>

        {lines.length > 0 && (
          <section className="builder-lines" aria-label="Variantes por agregar">
            {lines.map((line) => (
              <article key={line.key}>
                <div>
                  <strong>{line.product.shortName}</strong>
                  {lineDescription(line) && <small>{lineDescription(line)}</small>}
                </div>
                <div className="item-actions">
                  <button type="button" aria-label={`Quitar una pieza de ${line.product.shortName}`} disabled={line.quantity <= 1} onClick={() => changeLineQuantity(line.key, -1)}>−</button>
                  <output aria-label={`Cantidad: ${line.quantity}`}>{line.quantity}</output>
                  <button type="button" aria-label={`Agregar una pieza de ${line.product.shortName}`} disabled={line.quantity >= MAX_QUANTITY} onClick={() => changeLineQuantity(line.key, 1)}>+</button>
                  <button className="cancel-button" type="button" onClick={() => setLines((current) => current.filter((candidate) => candidate.key !== line.key))}>Quitar</button>
                </div>
                <strong>{formatMoney(unitPrice(line.product, line.modifierIds) * line.quantity)}</strong>
              </article>
            ))}
          </section>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button className="access-primary" type="button" disabled={pending.length === 0 || busy} onClick={() => void submit()}>
            {pendingCount > 0 ? `Agregar ${pendingCount} a la orden · ${formatMoney(pendingTotal)}` : "Agregar a la orden"}
          </button>
        </div>
      </section>
    </div>
  );
};
