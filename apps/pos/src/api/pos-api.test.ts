import { afterEach, describe, expect, it, vi } from "vitest";
import { PosApi } from "./pos-api";

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: vi.fn().mockResolvedValue(body),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PosApi", () => {
  it("registra la terminal con el token de arranque y sin sesión", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: "terminal-1",
      deviceToken: "device-secret",
      displayName: "Terminal 1",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const api = new PosApi("/api");
    await api.registerTerminal({
      bootstrapToken: "bootstrap-secret",
      terminalCode: "POS-01",
      displayName: "Terminal 1",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/terminals/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bootstrap-token": "bootstrap-secret",
      },
      body: JSON.stringify({
        siteCode: "PILOT",
        terminalCode: "POS-01",
        displayName: "Terminal 1",
        profile: "pos",
      }),
    });
  });

  it("envía sesión, idempotencia y versión al agregar un producto", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accountVersion: 3 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = new PosApi("/api", "access-token", () => "request-key");

    await api.addItem("account-1", {
      productId: "product-1",
      quantity: 1,
      expectedVersion: 2,
      modifierIds: ["modifier-1"],
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/accounts/account-1/items", {
      method: "POST",
      headers: {
        authorization: "Bearer access-token",
        "content-type": "application/json",
        "idempotency-key": "request-key",
      },
      body: JSON.stringify({
        productId: "product-1",
        quantity: 1,
        expectedVersion: 2,
        modifierIds: ["modifier-1"],
      }),
    });
  });

  it("convierte los errores HTTP en ApiError con un mensaje útil", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: ["PIN inválido", "Intenta otra vez"] }, 401)),
    );
    const api = new PosApi("/api");

    await expect(api.login({
      terminal: { id: "terminal-1", deviceToken: "secret", displayName: "Terminal 1" },
      employeeCode: "ADMIN",
      pin: "0000",
    })).rejects.toEqual(
      expect.objectContaining({
        status: 401,
        message: "PIN inválido. Intenta otra vez",
      }),
    );
  });

  it("impide llamadas protegidas cuando no hay sesión", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(new PosApi("/api").catalog()).rejects.toMatchObject({
      status: 401,
      message: "No existe una sesión",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
