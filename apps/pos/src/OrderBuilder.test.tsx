import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogCategory, CatalogProduct } from "./api/types";
import { OrderBuilder, type OrderBuilderLine } from "./OrderBuilder";

afterEach(cleanup);

const product: CatalogProduct = {
  id: "torta", code: "TORTA-PIERNA", name: "Torta de pierna", shortName: "Torta de pierna", emoji: null,
  color: null, available: true, version: 1, priceInCents: 6500, modifierGroups: [],
};
const category: CatalogCategory = { id: "tortas", code: "TORTAS", name: "Tortas y tacos", color: null, seasonal: false, products: [product] };

describe("indicaciones de preparación al agregar productos", () => {
  it("envía notas compatibles y texto libre sin cambiar el precio", async () => {
    const onSubmit = vi.fn(async (_lines: OrderBuilderLine[]) => []);
    render(<OrderBuilder category={category} initialProduct={product} busy={false} error={null} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Nota"), { target: { value: "Bien caliente" } });
    fireEvent.click(screen.getByRole("button", { name: "Con cebolla" }));
    fireEvent.click(screen.getByRole("button", { name: "Sin cebolla" }));
    fireEvent.click(screen.getByRole("button", { name: "Sin migajón" }));
    fireEvent.click(screen.getByRole("button", { name: "Preparada en bolsa" }));
    expect(screen.getByRole("button", { name: "Con cebolla" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Sin cebolla" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Agregar 1 a la orden · $65.00" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toEqual([expect.objectContaining({
      note: "Sin cebolla, Sin migajón, Preparada en bolsa, Bien caliente", modifierIds: [], quantity: 1,
    })]);
  });

  it("limita la nota combinada a los 200 caracteres de la API sin recortar el texto", () => {
    render(<OrderBuilder category={category} initialProduct={product} busy={false} error={null} onClose={vi.fn()} onSubmit={vi.fn(async () => [])} />);
    const input = screen.getByLabelText("Nota");
    const freeText = "a".repeat(190);
    fireEvent.change(input, { target: { value: freeText } });
    expect(screen.getByRole("button", { name: "Preparada en bolsa" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sin col" }));
    expect(input).toHaveValue(freeText);
    expect(input).toHaveAttribute("maxLength", "191");
    expect(screen.getByRole("button", { name: "Sin cebolla" })).toBeDisabled();
  });

  it("reemplaza una indicación opuesta escrita a mano y conserva el comentario restante", async () => {
    const onSubmit = vi.fn(async (_lines: OrderBuilderLine[]) => []);
    render(<OrderBuilder category={category} initialProduct={product} busy={false} error={null} onClose={vi.fn()} onSubmit={onSubmit} />);
    const freeText = "a".repeat(191);
    fireEvent.change(screen.getByLabelText("Nota"), { target: { value: `Sin col, ${freeText}` } });
    expect(screen.getByRole("button", { name: "Sin col" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Con col" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Con col" }));
    expect(screen.getByLabelText("Nota")).toHaveValue(freeText);
    expect(screen.getByRole("button", { name: "Sin col" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Agregar 1 a la orden · $65.00" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]?.[0]?.note).toBe(`Con col, ${freeText}`);
    expect(onSubmit.mock.calls[0]?.[0]?.[0]?.note.length).toBe(200);
  });

  it("quita con un toque la opción escrita a mano que ya aparece seleccionada", async () => {
    const onSubmit = vi.fn(async (_lines: OrderBuilderLine[]) => []);
    render(<OrderBuilder category={category} initialProduct={product} busy={false} error={null} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Nota"), { target: { value: "Con col, Bien caliente" } });
    expect(screen.getByRole("button", { name: "Con col" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Con col" }));
    expect(screen.getByLabelText("Nota")).toHaveValue("Bien caliente");
    expect(screen.getByRole("button", { name: "Con col" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Agregar 1 a la orden · $65.00" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]?.[0]?.note).toBe("Bien caliente");
  });

  it("cambia las notas al cambiar de producto y no muestra verdura para bebidas", () => {
    const drink = { ...product, id: "refresco", code: "REFRESCO", name: "Refresco", shortName: "Refresco" };
    render(<OrderBuilder category={{ ...category, products: [product, drink] }} initialProduct={product} busy={false} error={null} onClose={vi.fn()} onSubmit={vi.fn(async () => [])} />);
    fireEvent.click(screen.getByRole("button", { name: "Sin migajón" }));
    fireEvent.click(screen.getByRole("button", { name: /Refresco\$65.00/ }));
    expect(screen.queryByRole("button", { name: "Sin migajón" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Con col" })).not.toBeInTheDocument();
  });
});
