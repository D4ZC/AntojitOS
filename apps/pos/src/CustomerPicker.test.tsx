import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerPicker } from "./CustomerPicker";
import type { Customer, CustomerPickerApi } from "./customers";

const ana: Customer = { id: "ana", name: "Ana López", phone: "3331234567", address: "Calle 1", notes: null,
  active: true, version: 0, createdAt: "2026-10-28T12:00:00Z" };
const createApi = (overrides: Partial<CustomerPickerApi> = {}): CustomerPickerApi => ({
  customers: vi.fn().mockResolvedValue([ana, { ...ana, id: "inactive", name: "Inactivo", active: false }]),
  createCustomer: vi.fn().mockResolvedValue({ customer: { ...ana, id: "new", name: "Lupita" } }),
  ...overrides,
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("selector de clientes frecuentes", () => {
  it("busca por teléfono, selecciona clientes activos y permite quitarlos", async () => {
    const api = createApi(); const onChange = vi.fn();
    const { rerender } = render(<CustomerPicker api={api} value={null} onChange={onChange} />);
    await screen.findByRole("option", { name: "Ana López · 3331234567" });
    expect(screen.queryByRole("option", { name: "Inactivo" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar cliente frecuente"), { target: { value: "333123" } });
    expect(screen.getByRole("option", { name: "Ana López · 3331234567" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Cliente frecuente"), { target: { value: "ana" } });
    expect(onChange).toHaveBeenLastCalledWith(ana);
    rerender(<CustomerPicker api={api} value="ana" onChange={onChange} />);
    expect(screen.getByText("3331234567 · Calle 1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Cliente frecuente"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("crea un cliente con contacto y dirección y lo selecciona sin enviar el formulario padre", async () => {
    const api = createApi(); const onChange = vi.fn(); const onSubmit = vi.fn((event) => event.preventDefault());
    render(<form onSubmit={onSubmit}><CustomerPicker api={api} value={null} customerName="Lupita" onChange={onChange} /></form>);
    await screen.findByRole("option", { name: "Ana López · 3331234567" });
    fireEvent.click(screen.getByRole("button", { name: "Nuevo cliente frecuente" }));
    expect(screen.getByLabelText("Nombre del nuevo cliente")).toHaveValue("Lupita");
    fireEvent.change(screen.getByLabelText("Teléfono del cliente"), { target: { value: " 3338889999 " } });
    fireEvent.change(screen.getByLabelText("Dirección del cliente"), { target: { value: " Calle 2 " } });
    fireEvent.keyDown(screen.getByLabelText("Nombre del nuevo cliente"), { key: "Enter" });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "new", name: "Lupita" })));
    expect(api.createCustomer).toHaveBeenCalledWith({ name: "Lupita", phone: "3338889999", address: "Calle 2", notes: null });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Nombre del nuevo cliente")).not.toBeInTheDocument();
  });

  it("muestra errores de carga y registro y permite reintentar", async () => {
    const api = createApi({ customers: vi.fn().mockRejectedValueOnce(new Error("Sin conexión")).mockResolvedValue([ana]),
      createCustomer: vi.fn().mockRejectedValue(new Error("No se guardó")) });
    const onChange = vi.fn();
    render(<CustomerPicker api={api} value={null} onChange={onChange} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sin conexión");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar clientes" }));
    await screen.findByRole("option", { name: "Ana López · 3331234567" });
    fireEvent.click(screen.getByRole("button", { name: "Nuevo cliente frecuente" }));
    fireEvent.change(screen.getByLabelText("Nombre del nuevo cliente"), { target: { value: "Nuevo" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cliente frecuente" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se guardó");
    expect(screen.getByLabelText("Nombre del nuevo cliente")).toHaveValue("Nuevo");
    expect(onChange).not.toHaveBeenCalled();
  });
});
