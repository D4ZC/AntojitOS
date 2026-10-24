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
  it("consulta el estado de impresión y pide el original sin repetir el cobro", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ receiptId: "receipt-1", jobs: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const api = new PosApi("/api", "access-token", () => "print-key");
    await api.receiptPrinting("receipt-1");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/sales/receipts/receipt-1/printing", {
      method: "GET", headers: { authorization: "Bearer access-token" }, body: undefined,
    });
    await api.printReceipt("receipt-1");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/sales/receipts/receipt-1/print", {
      method: "POST", headers: { authorization: "Bearer access-token", "content-type": "application/json", "idempotency-key": "print-key" }, body: JSON.stringify({}),
    });
  });

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

  it("cancela una cuenta con motivo e idempotencia", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      accountVersion: 2,
      status: "cancelled",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const api = new PosApi("/api", "access-token", () => "cancel-key");

    await api.cancelAccount("account-1", {
      expectedVersion: 1,
      reason: "Mesa abierta por error",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/accounts/account-1/cancellations", {
      method: "POST",
      headers: {
        authorization: "Bearer access-token",
        "content-type": "application/json",
        "idempotency-key": "cancel-key",
      },
      body: JSON.stringify({
        expectedVersion: 1,
        reason: "Mesa abierta por error",
      }),
    });
  });

  it("guarda cliente y programación y permite borrarlos explícitamente", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accountVersion: 4 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = new PosApi("/api", "access-token", () => "details-key");
    await api.updateAccountDetails("account-1", { expectedVersion: 3, customerName: null, scheduledFor: null });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/accounts/account-1/details", {
      method: "PATCH",
      headers: {
        authorization: "Bearer access-token",
        "content-type": "application/json",
        "idempotency-key": "details-key",
      },
      body: JSON.stringify({ expectedVersion: 3, customerName: null, scheduledFor: null }),
    });
  });

  it("consulta una comanda móvil con token aislado y sin enviar la sesión POS", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ assignment: { id: "delivery-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    await new PosApi("/api", "admin-session").sharedDelivery("delivery-secret");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/delivery/shared", {
      method: "GET", headers: { "x-delivery-token": "delivery-secret" }, body: undefined,
    });
  });

  it("registra pagos administrativos con versión, origen y clave de idempotencia", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ bill: { id: "bill-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const input = { expectedVersion: 2, amountInCents: 3500, methodCode: "CASH" as const, paidOn: "2026-10-23", source: "business_cash" as const };
    await new PosApi("/api", "admin-session", () => "payment-key").payAccountingBill("bill-1", input);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/accounting/bills/bill-1/payments", {
      method: "POST",
      headers: { authorization: "Bearer admin-session", "content-type": "application/json", "idempotency-key": "payment-key" },
      body: JSON.stringify(input),
    });
  });

  it("renueva un enlace de reparto sin guardar el token en una clave de reintento", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ token: "delivery-secret", expiresAt: "2099-01-01", version: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    await new PosApi("/api", "admin-session").shareDelivery("delivery-1", 1);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/delivery/assignments/delivery-1/share", {
      method: "POST", headers: { authorization: "Bearer admin-session", "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1 }),
    });
  });

  it("envía el cobro completo con una sola clave idempotente", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: "receipt-1",
      folio: "T-000001",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const api = new PosApi("/api", "access-token", () => "checkout-key");

    await api.checkoutAccount("account-1", {
      expectedVersion: 4,
      payments: [{
        methodCode: "CASH",
        amountInCents: 4200,
        tipInCents: 420,
        tenderedInCents: 5000,
      }],
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/sales/accounts/account-1/checkout", {
      method: "POST",
      headers: {
        authorization: "Bearer access-token",
        "content-type": "application/json",
        "idempotency-key": "checkout-key",
      },
      body: JSON.stringify({
        expectedVersion: 4,
        payments: [{
          methodCode: "CASH",
          amountInCents: 4200,
          tipInCents: 420,
          tenderedInCents: 5000,
        }],
      }),
    });
  });
});
