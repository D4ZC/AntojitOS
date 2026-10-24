import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogCategory, CatalogProduct } from "./api/types";
import { CatalogPricesEditor, type CatalogPricingApi } from "./CatalogPricesEditor";

const extras: CatalogProduct["modifierGroups"][number] = {
  id: "extras", name: "Extras", minimumSelections: 0, maximumSelections: 2,
  options: [
    { id: "cheese", name: "Queso extra", priceDeltaInCents: 500, available: true },
    { id: "bag", name: "En bolsa", priceDeltaInCents: 0, available: false },
  ],
};
const flauta: CatalogProduct = {
  id: "flauta", code: "FLAUTA", name: "Flauta", shortName: "Flauta", emoji: null, color: null,
  available: true, version: 3, priceInCents: 3500, modifierGroups: [extras],
};
const categories: CatalogCategory[] = [
  { id: "antojitos", code: "ANTOJITOS", name: "Antojitos", color: null, seasonal: false, products: [
    flauta,
    { ...flauta, id: "tostada", code: "TOSTADA", name: "Tostada", shortName: "Tostada", available: false, priceInCents: 3000 },
  ] },
  { id: "beverages", code: "BEBIDAS", name: "Bebidas", color: null, seasonal: false, products: [
    { ...flauta, id: "bote", code: "BOTE", name: "Bote", shortName: "Bote", priceInCents: 5000, modifierGroups: [] },
  ] },
];

const createApi = (): CatalogPricingApi => ({
  updateProductPrice: vi.fn().mockImplementation(async (productId, input) => ({ product: {
    id: productId, name: productId === "flauta" ? "Flauta" : "Tostada", priceInCents: input.priceInCents,
    available: productId !== "tostada", version: input.expectedVersion + 1,
  } })),
  updateModifierPrice: vi.fn().mockImplementation(async (modifierId, input) => ({ modifier: {
    id: modifierId, name: "Queso extra", priceDeltaInCents: input.priceDeltaInCents,
  } })),
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("CatalogPricesEditor", () => {
  it("guarda precios de productos fijos, conserva otros borradores y usa la versión recién guardada", async () => {
    const api = createApi();
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<CatalogPricesEditor api={api} categories={categories} onChanged={onChanged} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Precio base de Tostada"), { target: { value: "41" } });
    fireEvent.change(screen.getByLabelText("Precio base de Flauta"), { target: { value: "38,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar precio base de Flauta" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Flauta: precio base $38.50");
    expect(api.updateProductPrice).toHaveBeenCalledWith("flauta", { expectedVersion: 3, priceInCents: 3850 });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Precio base de Tostada")).toHaveValue("41");
    await waitFor(() => expect(screen.getByLabelText("Precio base de Flauta")).toBeEnabled());
    expect(screen.getByLabelText("Precio base de Flauta")).toHaveValue("38.50");
    fireEvent.change(screen.getByLabelText("Precio base de Flauta"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar precio base de Flauta" }));
    await waitFor(() => expect(api.updateProductPrice).toHaveBeenLastCalledWith("flauta", { expectedVersion: 4, priceInCents: 4000 }));
  });

  it("incluye productos no disponibles y cambia de categoría sin perder los borradores", async () => {
    const api = createApi();
    render(<CatalogPricesEditor api={api} categories={categories} initialCategoryId="antojitos" onChanged={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Precio base de Tostada"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Guardar precio base de Tostada" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "beverages" } });
    expect(screen.getByLabelText("Precio base de Bote")).toBeInTheDocument();
    expect(screen.queryByLabelText("Precio base de Tostada")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "antojitos" } });
    expect(screen.getByLabelText("Precio base de Tostada")).toHaveValue("0");
    fireEvent.click(screen.getByRole("button", { name: "Guardar precio base de Tostada" }));
    await waitFor(() => expect(api.updateProductPrice).toHaveBeenCalledWith("tostada", { expectedVersion: 3, priceInCents: 0 }));
  });

  it("muestra una sola vez los extras compartidos y actualiza su recargo", async () => {
    const api = createApi();
    render(<CatalogPricesEditor api={api} categories={categories} onChanged={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByLabelText("Precio adicional de Queso extra")).toHaveLength(1);
    expect(screen.getByText("Se utiliza en: Flauta, Tostada.")).toBeInTheDocument();
    expect(screen.getByText(/su precio adicional cambia en todos los productos/)).toBeInTheDocument();
    expect(screen.getByLabelText("Precio adicional de En bolsa")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Precio adicional de Queso extra"), { target: { value: "7.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar precio adicional de Queso extra" }));
    await waitFor(() => expect(api.updateModifierPrice).toHaveBeenCalledWith("cheese", { expectedPriceDeltaInCents: 500, priceDeltaInCents: 725 }));
    expect(await screen.findByRole("status")).toHaveTextContent("Queso extra: precio adicional $7.25");
  });

  it.each(["-1", "NaN", "Infinity", "10000.01", "2.999", "1e3", "999999999999"]) (
    "rechaza el precio inválido %s antes de enviarlo al servidor", (value) => {
      const api = createApi();
      render(<CatalogPricesEditor api={api} categories={categories} onChanged={vi.fn()} onClose={vi.fn()} />);
      fireEvent.change(screen.getByLabelText("Precio base de Flauta"), { target: { value } });
      expect(screen.getByLabelText("Precio base de Flauta")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("button", { name: "Guardar precio base de Flauta" })).toBeDisabled();
      expect(screen.getByText("Usa un precio de $0 a $10,000 con hasta 2 decimales.")).toBeInTheDocument();
      expect(api.updateProductPrice).not.toHaveBeenCalled();
    },
  );

  it("acepta el límite de $10,000 y busca opciones sin acentos", async () => {
    const api = createApi();
    render(<CatalogPricesEditor api={api} categories={categories} onChanged={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Buscar producto u opción"), { target: { value: "QUESO" } });
    expect(screen.getByLabelText("Precio adicional de Queso extra")).toBeInTheDocument();
    expect(screen.queryByLabelText("Precio base de Flauta")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Precio adicional de Queso extra"), { target: { value: "10000" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar precio adicional de Queso extra" }));
    await waitFor(() => expect(api.updateModifierPrice).toHaveBeenCalledWith("cheese", { expectedPriceDeltaInCents: 500, priceDeltaInCents: 1_000_000 }));
  });

  it("conserva el precio escrito ante conflicto y permite reintentar con la versión actualizada", async () => {
    const api = createApi();
    vi.mocked(api.updateProductPrice).mockRejectedValueOnce(new Error("El precio cambió en otra terminal. Actualiza el menú."));
    const onChanged = vi.fn();
    const props = { api, categories, onChanged, onClose: vi.fn() };
    const { rerender } = render(<CatalogPricesEditor {...props} />);
    fireEvent.change(screen.getByLabelText("Precio base de Flauta"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar precio base de Flauta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El precio cambió en otra terminal");
    expect(screen.getByLabelText("Precio base de Flauta")).toHaveValue("45");
    expect(onChanged).not.toHaveBeenCalled();
    const refreshed = categories.map((category) => ({ ...category, products: category.products.map((product) => product.id === "flauta" ? { ...product, version: 4, priceInCents: 4200 } : product) }));
    onChanged.mockImplementation(async () => { rerender(<CatalogPricesEditor {...props} categories={refreshed} />); });
    fireEvent.click(screen.getByRole("button", { name: "Recargar precios" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar precio base de Flauta" })).toBeEnabled());
    expect(screen.getByLabelText("Precio base de Flauta")).toHaveValue("45");
    expect(screen.getByRole("status")).toHaveTextContent("Tus cambios pendientes se conservaron");
    expect(api.updateProductPrice).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Guardar precio base de Flauta" }));
    await waitFor(() => expect(api.updateProductPrice).toHaveBeenLastCalledWith("flauta", { expectedVersion: 4, priceInCents: 4500 }));
  });

  it("bloquea navegación y cierre mientras guarda", async () => {
    const api = createApi();
    let finish: (() => void) | undefined;
    vi.mocked(api.updateProductPrice).mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ product: { id: "flauta", name: "Flauta", priceInCents: 4000, version: 4, available: true } });
    }));
    const onClose = vi.fn();
    render(<CatalogPricesEditor api={api} categories={categories} onChanged={vi.fn()} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Precio base de Flauta"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar precio base de Flauta" }));
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Listo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Recargar precios" })).toBeDisabled();
    expect(screen.getByLabelText("Categoría")).toBeDisabled();
    expect(screen.getByLabelText("Buscar producto u opción")).toBeDisabled();
    expect(screen.getByLabelText("Precio adicional de Queso extra")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish?.());
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeEnabled();
  });

  it("informa si falla el refresco después de guardar y conserva el precio y versión aceptados", async () => {
    const api = createApi();
    render(<CatalogPricesEditor api={api} categories={categories} onChanged={vi.fn().mockRejectedValue(new Error("Sin conexión"))} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Precio base de Flauta"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar precio base de Flauta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El precio se guardó, pero no se pudo actualizar el menú: Sin conexión");
    expect(screen.getByLabelText("Precio base de Flauta")).toHaveValue("40");
    expect(screen.getByRole("button", { name: "Guardar precio base de Flauta" })).toBeDisabled();
  });
});
