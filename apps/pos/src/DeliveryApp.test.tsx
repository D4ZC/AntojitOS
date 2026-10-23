import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api/pos-api";
import { DeliveryApp, deliveryHtml, type SharedDeliveryApi } from "./DeliveryApp";
import type { SharedDelivery } from "./delivery";

const token = "a".repeat(43);
const cacheKey = `antojit-os.delivery.v1.${token}`;

const makeDelivery = (): SharedDelivery => ({
  id: "delivery-12345678",
  driverName: "Luis",
  status: "assigned",
  customerName: "Ana López",
  phone: "+52 (555) 123-4567",
  address: "Calle 3 #20\nPuerta azul",
  notes: "Tocar el timbre dos veces",
  snapshot: {
    accountId: "account-1",
    label: "Pedido para llevar",
    customerName: "Ana López",
    totalInCents: 7000,
    items: [{ productName: "Flauta", quantity: 2, note: "Salsa aparte", modifiers: ["Con todo"], lineTotalInCents: 7000 }],
  },
  updatedAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString(),
});

const save = (assignment = makeDelivery()) => {
  localStorage.setItem(cacheKey, JSON.stringify({ assignment, savedAt: new Date().toISOString() }));
};

const createApi = (implementation = vi.fn().mockResolvedValue({ assignment: makeDelivery() })): SharedDeliveryApi => ({
  sharedDelivery: implementation,
});

beforeEach(() => {
  window.history.replaceState({}, "", `/reparto#token=${token}`);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("comanda móvil del repartidor", () => {
  it("abre con el enlace, muestra las instrucciones y guarda la copia sin pedir PIN", async () => {
    const api = createApi();
    render(<DeliveryApp api={api} />);

    expect(await screen.findByRole("heading", { name: "Ana López" })).toBeInTheDocument();
    expect(api.sharedDelivery).toHaveBeenCalledWith(token);
    expect(screen.getByText("2 × Flauta")).toBeInTheDocument();
    expect(screen.getByText("Con todo")).toBeInTheDocument();
    expect(screen.getByText("Nota: Salsa aparte")).toBeInTheDocument();
    expect(screen.getByText("Tocar el timbre dos veces")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+52 (555) 123-4567" })).toHaveAttribute("href", "tel:+525551234567");
    expect(screen.queryByLabelText("PIN")).not.toBeInTheDocument();
    expect(screen.queryByText(/Ingresar|Registrar terminal/)).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(cacheKey)!)).toMatchObject({ assignment: { id: "delivery-12345678" }, savedAt: expect.any(String) });
    expect(screen.getByRole("button", { name: "Guardar comanda sin conexión" })).toBeEnabled();
  });

  it("muestra la copia guardada al perder Wi-Fi y permite reintentar una actualización", async () => {
    save();
    const updated = { ...makeDelivery(), notes: "Nueva indicación del negocio" };
    const api = createApi(vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({ assignment: updated }));
    render(<DeliveryApp api={api} />);

    expect(await screen.findByText(/Consulta sin conexión/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ana López" })).toBeInTheDocument();
    expect(screen.getByText(/puede haber cambios posteriores/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Actualizar en Wi-Fi" }));
    expect(await screen.findByText("Nueva indicación del negocio")).toBeInTheDocument();
    expect(screen.queryByText(/Consulta sin conexión/)).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(cacheKey)!).assignment.notes).toBe(updated.notes);
  });

  it.each([401, 403, 404, 410])("elimina la copia y pide otro enlace ante respuesta %s", async (status) => {
    save();
    const api = createApi(vi.fn().mockRejectedValue(new ApiError(status, "Enlace inválido", {})));
    render(<DeliveryApp api={api} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("El enlace venció o la comanda cambió");
    expect(localStorage.getItem(cacheKey)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Ana López" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar comanda sin conexión" })).not.toBeInTheDocument();
  });

  it("descarta una copia vencida y exige abrir primero la comanda dentro del negocio", async () => {
    save({ ...makeDelivery(), expiresAt: new Date(Date.now() - 1_000).toISOString() });
    const api = createApi(vi.fn().mockRejectedValue(new TypeError("Sin red")));
    render(<DeliveryApp api={api} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Conéctate al Wi-Fi del negocio");
    expect(localStorage.getItem(cacheKey)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Ana López" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Consulta sin conexión/)).not.toBeInTheDocument();
  });

  it("descarta datos de caché dañados sin impedir una descarga nueva", async () => {
    const malformed = { ...makeDelivery(), snapshot: { ...makeDelivery().snapshot, items: {} } };
    localStorage.setItem(cacheKey, JSON.stringify({ assignment: malformed, savedAt: new Date().toISOString() }));
    const api = createApi();
    render(<DeliveryApp api={api} />);

    expect(await screen.findByText("2 × Flauta")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(cacheKey)!).assignment.snapshot.items).toHaveLength(1);
  });

  it("descarta una copia con teléfono malformado antes de intentar mostrarla sin conexión", async () => {
    const malformed = { ...makeDelivery(), phone: {} };
    localStorage.setItem(cacheKey, JSON.stringify({ assignment: malformed, savedAt: new Date().toISOString() }));
    render(<DeliveryApp api={createApi(vi.fn().mockRejectedValue(new TypeError("Sin Wi-Fi")))} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Conéctate al Wi-Fi del negocio");
    expect(localStorage.getItem(cacheKey)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Ana López" })).not.toBeInTheDocument();
  });

  it("ofrece el archivo cuando el navegador no permite guardar en su almacenamiento", async () => {
    const storage: Storage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(() => { throw new DOMException("Lleno", "QuotaExceededError"); }),
      removeItem: vi.fn(), key: vi.fn().mockReturnValue(null), clear: vi.fn(), length: 0,
    };
    render(<DeliveryApp api={createApi()} storage={storage} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar en el navegador");
    expect(screen.getByRole("heading", { name: "Ana López" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar comanda sin conexión" })).toBeEnabled();
  });

  it("pide el enlace si falta el token y no consulta la sesión del POS", async () => {
    window.history.replaceState({}, "", "/reparto");
    const api = createApi();
    render(<DeliveryApp api={api} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Abre el enlace de la comanda");
    expect(api.sharedDelivery).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("PIN")).not.toBeInTheDocument();
  });

  it("ignora una respuesta antigua si se abre el enlace de otra entrega", async () => {
    let finishFirst: (response: { assignment: SharedDelivery }) => void = () => undefined;
    const first = new Promise<{ assignment: SharedDelivery }>((resolve) => { finishFirst = resolve; });
    const secondToken = "b".repeat(43);
    const second = { ...makeDelivery(), id: "delivery-2", customerName: "Cliente nuevo" };
    const api = createApi(vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce({ assignment: second }));
    render(<DeliveryApp api={api} />);
    expect(api.sharedDelivery).toHaveBeenCalledWith(token);

    act(() => {
      window.history.replaceState({}, "", `/reparto#token=${secondToken}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(await screen.findByRole("heading", { name: "Cliente nuevo" })).toBeInTheDocument();
    await act(async () => { finishFirst({ assignment: makeDelivery() }); });
    expect(screen.getByRole("heading", { name: "Cliente nuevo" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ana López" })).not.toBeInTheDocument();
    expect(localStorage.getItem(cacheKey)).toBeNull();
  });

  it("permite reintentar si se quita el token mientras estaba consultando", async () => {
    const api = createApi(vi.fn().mockReturnValue(new Promise(() => undefined)));
    render(<DeliveryApp api={api} />);
    expect(screen.getByRole("status")).toHaveTextContent("Consultando comanda");
    act(() => {
      window.history.replaceState({}, "", "/reparto");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Abre el enlace de la comanda");
    expect(screen.queryByText("Consultando comanda…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver a intentar" })).toBeEnabled();
  });

  it("descarga un HTML autónomo sin necesitar una nueva consulta", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:delivery-copy");
    const revokeObjectURL = vi.fn();
    const BrowserUrl = URL;
    vi.stubGlobal("URL", class extends BrowserUrl {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    });
    let clicked: { href: string; download: string } | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked = { href: this.href, download: this.download };
    });
    const api = createApi();
    render(<DeliveryApp api={api} />);
    const download = await screen.findByRole("button", { name: "Guardar comanda sin conexión" });
    vi.useFakeTimers();
    fireEvent.click(download);

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clicked).toEqual({ href: "blob:delivery-copy", download: "comanda-reparto-delivery.html" });
    expect(api.sharedDelivery).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a[download]")).toBeNull();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:delivery-copy");
    expect(screen.getByText("Nota: Salsa aparte")).toBeInTheDocument();
  });
});

describe("archivo de comanda sin conexión", () => {
  it("incluye dirección, teléfono, total e instrucciones sin dependencias de red", () => {
    const html = deliveryHtml(makeDelivery());
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.documentElement.lang).toBe("es");
    expect(document.body.textContent).toContain("Ana López");
    expect(document.body.textContent).toContain("Calle 3 #20");
    expect(document.body.textContent).toContain("Teléfono: +52 (555) 123-4567");
    expect(document.body.textContent).toContain("Tocar el timbre dos veces");
    expect(document.body.textContent).toContain("Con todo");
    expect(document.body.textContent).toContain("Nota: Salsa aparte");
    expect(document.body.textContent).toContain("70.00");
    expect(document.body.textContent).toContain("El cobro se confirma en caja");
    expect(document.body.textContent).toContain("Puede haber cambios posteriores");
    expect(document.querySelector("script,link,img,iframe,video,audio")).toBeNull();
    expect(html).not.toContain(token);
  });

  it("escapa contenido del cliente y de los productos para evitar HTML ejecutable", () => {
    const injection = `<img src=x onerror="alert('x')"> & <script>evil()</script>`;
    const assignment = makeDelivery();
    assignment.customerName = injection;
    assignment.driverName = injection;
    assignment.phone = injection;
    assignment.address = injection;
    assignment.notes = injection;
    assignment.snapshot.items[0] = { ...assignment.snapshot.items[0]!, productName: injection, note: injection, modifiers: [injection] };
    const html = deliveryHtml(assignment);
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.querySelector("img,script,[onerror]")).toBeNull();
    expect(document.body.textContent?.split(injection)).toHaveLength(9);
    expect(html).toContain("&lt;img");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).toContain("&#39;");
  });
});
