import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

describe("prototipo POS", () => {
  it("permite agregar un producto con un objetivo táctil", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /agregar taco al pastor/i }));

    expect(screen.getByText("Taco al pastor", { selector: ".order-item strong" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enviar a cocina/i })).toBeEnabled();
  });

  it("bloquea cambios de cantidad después de enviar la comanda", () => {
    vi.useFakeTimers();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /agregar taco al pastor/i }));
    fireEvent.click(screen.getByRole("button", { name: /enviar a cocina/i }));
    act(() => vi.advanceTimersByTime(500));

    expect(screen.getByText("En cocina")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /agregar una unidad de taco al pastor/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cobrar/i })).toBeEnabled();
  });

  it("permite asignar la cuenta a la mesa 9", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Cambiar mesa" }));
    fireEvent.click(screen.getByRole("button", { name: "Mesa 9" }));

    expect(screen.getByRole("button", { name: "Cambiar mesa" })).toHaveTextContent("Mesa 9");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("guarda comentarios después de enviar la comanda", () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /agregar taco al pastor/i }));
    fireEvent.click(screen.getByRole("button", { name: /enviar a cocina/i }));
    act(() => vi.advanceTimersByTime(500));
    fireEvent.click(screen.getByRole("button", { name: "Editar nota de Taco al pastor" }));
    fireEvent.click(screen.getByRole("button", { name: "Con todo" }));
    fireEvent.change(screen.getByLabelText("Comentarios para cocina"), { target: { value: "Con todo, servir aparte" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nota" }));

    expect(screen.getByText("Con todo, servir aparte")).toBeInTheDocument();
    expect(screen.getByText("En cocina")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /agregar una unidad de taco al pastor/i })).toBeDisabled();
  });

  it("guarda el cliente opcional al recargar y permite dejarlo vacío", () => {
    const view = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Cliente y programación" }));
    fireEvent.change(screen.getByLabelText("Cliente (opcional)"), { target: { value: "Lupita" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos del pedido" }));
    view.unmount();
    render(<App />);

    expect(screen.getByText("Cliente: Lupita")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cliente y programación" }));
    fireEvent.change(screen.getByLabelText("Cliente (opcional)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos del pedido" }));
    expect(screen.queryByText("Cliente: Lupita")).not.toBeInTheDocument();
  });

  it("envía automáticamente a la hora programada y restaura la programación al recargar", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2030, 9, 23, 13, 0, 0));
    const view = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /agregar taco al pastor/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cliente y programación" }));
    fireEvent.change(screen.getByLabelText("Programar envío a cocina (opcional)"), { target: { value: "2030-10-23T13:01" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos del pedido" }));
    expect(screen.getByRole("button", { name: /envío programado/i })).toBeDisabled();
    view.unmount();
    render(<App />);
    expect(screen.getByText("Pendiente")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("En cocina")).toBeInTheDocument();
    expect(screen.getByText(/Enviado según programación/)).toBeInTheDocument();
    expect(screen.getByText("Pedido programado enviado automáticamente a cocina")).toBeInTheDocument();
  });

  it("rechaza programar un pedido en el pasado", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2030, 9, 23, 13, 0, 0));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /agregar taco al pastor/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cliente y programación" }));
    fireEvent.change(screen.getByLabelText("Programar envío a cocina (opcional)"), { target: { value: "2030-10-23T12:59" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos del pedido" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Elige una fecha y hora futuras");
    expect(screen.getByRole("button", { name: /enviar a cocina/i })).toBeEnabled();
  });

  it("recupera un envío vencido al reabrir el demo y conserva el horario al editar el cliente", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2030, 9, 23, 13, 0, 0));
    const view = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /agregar taco al pastor/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cliente y programación" }));
    fireEvent.change(screen.getByLabelText("Programar envío a cocina (opcional)"), { target: { value: "2030-10-23T13:01" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos del pedido" }));
    view.unmount();
    act(() => vi.advanceTimersByTime(120_000));
    render(<App />);

    expect(screen.getByText("En cocina")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cliente y programación" }));
    fireEvent.change(screen.getByLabelText("Cliente (opcional)"), { target: { value: "Lupita" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos del pedido" }));
    expect(screen.getByText("Cliente: Lupita")).toBeInTheDocument();
    expect(screen.getByText(/Enviado según programación/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
