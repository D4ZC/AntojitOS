import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
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
});
