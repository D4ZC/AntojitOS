import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PosApi, ApiError } from "./api/pos-api";
import type { SharedDelivery } from "./delivery";
import { deliveryStatusLabel } from "./delivery";
import { formatMoney } from "./format";
import "./delivery.css";

const CACHE_PREFIX = "antojit-os.delivery.v1.";
const tokenFromLocation = () => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export const deliveryHtml = (delivery: SharedDelivery): string => {
  const text = (value: string | null | undefined) => escapeHtml(value ?? "");
  const items = delivery.snapshot.items.map((item) => `<article><h3>${item.quantity} × ${text(item.productName)}</h3>${item.modifiers.length ? `<p>${text(item.modifiers.join(", "))}</p>` : ""}${item.note ? `<p>Nota: ${text(item.note)}</p>` : ""}</article>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comanda de reparto</title><style>body{font:18px system-ui,sans-serif;max-width:620px;margin:24px auto;padding:16px;color:#243c34}h1{font-size:28px}h2{font-size:22px}p,address{white-space:pre-wrap;overflow-wrap:anywhere}address{font-style:normal}article{padding:12px 0;border-bottom:1px solid #ddd}article h3{margin:0}small{color:#54645d}</style></head><body><h1>Comanda de reparto</h1><p>Repartidor: ${text(delivery.driverName)}</p><p>${text(deliveryStatusLabel[delivery.status])}</p><h2>${text(delivery.customerName || delivery.snapshot.label)}</h2><address>${text(delivery.address)}</address>${delivery.phone ? `<p>Teléfono: ${text(delivery.phone)}</p>` : ""}${delivery.notes ? `<p>Indicaciones: ${text(delivery.notes)}</p>` : ""}${items}<h2>Total del pedido: ${text(formatMoney(delivery.snapshot.totalInCents))}</h2><p>El cobro se confirma en caja.</p><small>Copia guardada el ${text(new Date().toLocaleString("es-MX"))}. Puede haber cambios posteriores; confirma la comanda antes de salir.</small></body></html>`;
};

export interface SharedDeliveryApi { sharedDelivery(token: string): Promise<{ assignment: SharedDelivery }> }
interface Props { api?: SharedDeliveryApi; storage?: Storage }
interface SavedDelivery { assignment: SharedDelivery; savedAt: string }

const readSaved = (storage: Storage, token: string): SavedDelivery | null => {
  const nullableText = (value: unknown) => value === null || typeof value === "string";
  const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
  try {
    const value = JSON.parse(storage.getItem(CACHE_PREFIX + token) ?? "null") as SavedDelivery | null;
    const delivery = value?.assignment;
    const snapshot = delivery?.snapshot;
    if (!value || !delivery || !snapshot || !Array.isArray(snapshot.items) ||
      typeof delivery.id !== "string" || typeof delivery.driverName !== "string" ||
      typeof delivery.address !== "string" || !nullableText(delivery.phone) ||
      !nullableText(delivery.customerName) || !nullableText(delivery.notes) ||
      !["assigned", "out_for_delivery", "delivered", "cancelled"].includes(delivery.status) ||
      typeof snapshot.accountId !== "string" || typeof snapshot.label !== "string" ||
      !nullableText(snapshot.customerName) || !Number.isSafeInteger(snapshot.totalInCents) || snapshot.totalInCents < 0 ||
      !snapshot.items.every((item) => item && typeof item.productName === "string" &&
        Number.isInteger(item.quantity) && item.quantity > 0 && Array.isArray(item.modifiers) &&
        item.modifiers.every((modifier) => typeof modifier === "string") && nullableText(item.note) &&
        Number.isSafeInteger(item.lineTotalInCents) && item.lineTotalInCents >= 0) ||
      !timestamp(value.savedAt) || !timestamp(delivery.updatedAt) ||
      !timestamp(delivery.expiresAt) || Date.parse(delivery.expiresAt) <= Date.now()) {
      storage.removeItem(CACHE_PREFIX + token);
      return null;
    }
    return value;
  } catch { return null; }
};

export const DeliveryApp = ({ api: injectedApi, storage = window.localStorage }: Props) => {
  const api = useMemo<SharedDeliveryApi>(() => injectedApi ?? new PosApi(import.meta.env.VITE_API_URL || "/api"), [injectedApi]);
  const [token, setToken] = useState(tokenFromLocation);
  const [saved, setSaved] = useState<SavedDelivery | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const mounted = useRef(false);
  const requestSequence = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const changed = () => setToken(tokenFromLocation());
    window.addEventListener("hashchange", changed);
    return () => { mounted.current = false; requestSequence.current++; window.removeEventListener("hashchange", changed); };
  }, []);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const current = () => mounted.current && sequence === requestSequence.current;
    setError(null);
    setOffline(false);
    setStorageError(false);
    if (!token) { setBusy(false); setSaved(null); setError("Abre el enlace de la comanda que te dio el negocio."); return; }
    const cached = readSaved(storage, token);
    setSaved(cached);
    setBusy(true);
    try {
      const result = await api.sharedDelivery(token);
      if (!current()) return;
      const next = { assignment: result.assignment, savedAt: new Date().toISOString() };
      setSaved(next);
      try { storage.setItem(CACHE_PREFIX + token, JSON.stringify(next)); }
      catch { setStorageError(true); }
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
        try { storage.removeItem(CACHE_PREFIX + token); } catch { /* Almacenamiento deshabilitado. */ }
        setSaved(null);
        setError("El enlace venció o la comanda cambió. Pide un nuevo enlace al negocio.");
      } else if (cached) {
        setOffline(true);
      } else {
        setError("Conéctate al Wi-Fi del negocio para abrir y guardar esta comanda antes de salir.");
      }
    } finally { if (current()) setBusy(false); }
  }, [api, storage, token]);

  useEffect(() => { void load(); }, [load]);

  const download = () => {
    if (!saved) return;
    const url = URL.createObjectURL(new Blob([deliveryHtml(saved.assignment)], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `comanda-reparto-${saved.assignment.id.slice(0, 8)}.html`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const delivery = saved?.assignment;
  return <main className="delivery-phone"><section>
    <header><span>AntojitOS · Reparto</span><h1>Comanda de entrega</h1>{delivery && <p>{delivery.driverName} · {deliveryStatusLabel[delivery.status]}</p>}</header>
    {busy && <p role="status">Consultando comanda…</p>}
    {error && <p className="delivery-note" role="alert">{error}</p>}
    {offline && <p className="delivery-note" role="status">Consulta sin conexión. Esta es la última copia guardada; puede haber cambios posteriores.</p>}
    {storageError && <p className="delivery-note" role="alert">No se pudo guardar en el navegador. Descarga el archivo para llevar la comanda.</p>}
    {delivery && <>
      <h2>{delivery.customerName || delivery.snapshot.label}</h2><address>{delivery.address}</address>
      {delivery.phone && <p>Teléfono: <a href={`tel:${delivery.phone.replace(/[^+\d]/g, "")}`}>{delivery.phone}</a></p>}
      {delivery.notes && <p className="delivery-note">{delivery.notes}</p>}
      <section aria-label="Productos de la entrega">{delivery.snapshot.items.map((item, index) => <article className="delivery-item" key={index}><strong>{item.quantity} × {item.productName}</strong>{item.modifiers.length > 0 && <span>{item.modifiers.join(", ")}</span>}{item.note && <span>Nota: {item.note}</span>}</article>)}</section>
      <h2>Total del pedido: {formatMoney(delivery.snapshot.totalInCents)}</h2><p>El cobro se confirma en caja.</p>
      <div className="delivery-actions"><button className="save-delivery" type="button" onClick={download}>Guardar comanda sin conexión</button><button type="button" disabled={busy} onClick={() => void load()}>Actualizar en Wi-Fi</button></div>
      <footer><p>Antes de salir, guarda el archivo y comprueba que puedes abrirlo desde Descargas. Así podrás consultarlo aunque no haya conexión.</p><p>Última copia: {new Date(saved.savedAt).toLocaleString("es-MX")}</p></footer>
    </>}
    {!delivery && <button type="button" disabled={busy} onClick={() => void load()}>Volver a intentar</button>}
  </section></main>;
};
