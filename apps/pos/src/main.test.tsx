import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";

const { unmount } = vi.hoisted(() => ({ unmount: { current: undefined as (() => void) | undefined } }));
vi.mock("react-dom/client", async (original) => {
  const actual = await original<typeof import("react-dom/client")>();
  return { createRoot: (...args: Parameters<typeof actual.createRoot>) => {
    const root = actual.createRoot(...args);
    unmount.current = () => root.unmount();
    return root;
  } };
});

afterEach(async () => {
  await act(async () => unmount.current?.());
  unmount.current = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("entrada de la aplicación instalada", () => {
  it("abre la comanda móvil sin pedir PIN ni registrar terminal", async () => {
    vi.stubEnv("VITE_REMOTE_MODE", "true");
    vi.stubEnv("VITE_APP_MODE", "kds");
    window.history.replaceState({}, "", "/reparto");
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => { await import("./main"); });
    expect(screen.getByRole("heading", { name: "Comanda de entrega" })).toBeInTheDocument();
    expect(screen.queryByLabelText("PIN")).not.toBeInTheDocument();
  });

  for (const path of ["/?mode=kds", "/kds/", "/kds"]) {
    it(`abre cocina desde ${path} aunque la instalación sea POS`, async () => {
      vi.stubEnv("VITE_REMOTE_MODE", "true");
      vi.stubEnv("VITE_APP_MODE", "pos");
      window.history.replaceState({}, "", path);
      document.body.innerHTML = '<div id="root"></div>';
      await act(async () => { await import("./main"); });
      expect(screen.getByRole("heading", { name: "Configurar pantalla de cocina" })).toBeInTheDocument();
      expect(screen.queryByText("Selecciona una mesa")).not.toBeInTheDocument();
    });
  }
});
