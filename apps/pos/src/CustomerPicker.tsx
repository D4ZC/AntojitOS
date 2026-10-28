import { useEffect, useId, useRef, useState } from "react";
import type { Customer, CustomerPickerApi } from "./customers";
import "./customers.css";

interface CustomerPickerProps {
  api: CustomerPickerApi;
  value: string | null;
  customerName?: string;
  onChange(customer: Customer | null): void;
  disabled?: boolean;
  canCreate?: boolean;
}

const emptyDraft = { name: "", phone: "", address: "", notes: "" };
const errorText = (error: unknown) => error instanceof Error ? error.message : "No fue posible cargar los clientes";

export const CustomerPicker = ({ api, value, customerName = "", onChange, disabled = false, canCreate = true }: CustomerPickerProps) => {
  const id = useId();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const savingRef = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void api.customers().then((next) => { if (active) setCustomers(next); })
      .catch((cause) => { if (active) setError(errorText(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, reload]);

  const search = query.trim().toLocaleLowerCase("es-MX");
  const available = customers.filter((customer) => customer.active && (
    customer.id === value || !search || `${customer.name} ${customer.phone ?? ""}`.toLocaleLowerCase("es-MX").includes(search)
  ));
  const selected = customers.find((customer) => customer.id === value);

  const save = async () => {
    if (disabled || savingRef.current) return;
    if (!draft.name.trim()) { setError("Escribe el nombre del cliente"); return; }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const { customer } = await api.createCustomer({
        name: draft.name.trim(), phone: draft.phone.trim() || null,
        address: draft.address.trim() || null, notes: draft.notes.trim() || null,
      });
      setCustomers((current) => [...current.filter((candidate) => candidate.id !== customer.id), customer]);
      setCreating(false);
      setQuery("");
      onChange(customer);
    } catch (cause) { setError(errorText(cause)); }
    finally { savingRef.current = false; setSaving(false); }
  };

  return (
    <section className="customer-picker" aria-label="Clientes frecuentes">
      <label htmlFor={`${id}-search`}>Buscar cliente frecuente</label>
      <input id={`${id}-search`} type="search" value={query} placeholder="Nombre o teléfono"
        disabled={disabled || loading || saving} onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
      <label htmlFor={`${id}-customer`}>Cliente frecuente</label>
      <select id={`${id}-customer`} value={value ?? ""} disabled={disabled || loading || saving}
        onChange={(event) => onChange(customers.find((customer) => customer.id === event.target.value) ?? null)}>
        <option value="">Sin cliente frecuente</option>
        {value && !available.some((customer) => customer.id === value) && (
          <option value={value} disabled>{selected?.name ?? (customerName || "Cliente del pedido")}{selected?.active === false ? " (inactivo)" : ""}</option>
        )}
        {available.map((customer) => <option key={customer.id} value={customer.id}>
          {customer.name}{customer.phone ? ` · ${customer.phone}` : ""}
        </option>)}
      </select>
      {loading && <p role="status">Cargando clientes…</p>}
      {!loading && !error && available.length === 0 && <p className="modal-help">No hay clientes que coincidan.</p>}
      {selected && <p className="customer-contact">{[selected.phone, selected.address].filter(Boolean).join(" · ")}</p>}
      {canCreate && !creating && <button type="button" disabled={disabled || loading || saving} onClick={() => {
        setDraft({ ...emptyDraft, name: customerName.trim() || query.trim() });
        setCreating(true);
        setError(null);
      }}>Nuevo cliente frecuente</button>}
      {creating && (
        <fieldset className="customer-create" disabled={disabled || saving} onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            void save();
          }
        }}>
          <legend>Nuevo cliente frecuente</legend>
          <label htmlFor={`${id}-name`}>Nombre del nuevo cliente</label>
          <input id={`${id}-name`} value={draft.name} maxLength={80} autoComplete="name"
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
          <label htmlFor={`${id}-phone`}>Teléfono del cliente</label>
          <input id={`${id}-phone`} type="tel" value={draft.phone} maxLength={60} autoComplete="tel"
            onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} />
          <label htmlFor={`${id}-address`}>Dirección del cliente</label>
          <textarea id={`${id}-address`} value={draft.address} maxLength={500} rows={2} autoComplete="street-address"
            onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))} />
          <label htmlFor={`${id}-notes`}>Notas del cliente</label>
          <textarea id={`${id}-notes`} value={draft.notes} maxLength={1000} rows={2}
            onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
          <div className="customer-actions"><button type="button" onClick={() => setCreating(false)}>Cancelar registro</button>
            <button type="button" onClick={() => void save()} disabled={!draft.name.trim()}>{saving ? "Guardando cliente…" : "Guardar cliente frecuente"}</button></div>
        </fieldset>
      )}
      {error && <div className="form-error" role="alert">{error}{!creating && <button type="button" disabled={disabled || loading} onClick={() => setReload((current) => current + 1)}>Reintentar clientes</button>}</div>}
    </section>
  );
};
