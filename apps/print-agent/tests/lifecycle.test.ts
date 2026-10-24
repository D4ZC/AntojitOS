import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ stop: false, events: [] as string[] }));
const job = vi.hoisted(() => ({ id: "job-in-progress", claimToken: "claim" }));
vi.mock("node:fs", () => ({ existsSync: () => state.stop }));
vi.mock("../src/config.js", () => ({
  readConfig: () => ({
    apiUrl: "http://127.0.0.1/api", agentId: "agent", agentToken: "secret",
    mode: "system", pollIntervalMs: 1,
  }),
}));
vi.mock("../src/api-client.js", () => ({
  ProductionAgentApi: class {
    async claim() { state.events.push("claim"); return { job }; }
    async complete() { state.events.push("acknowledged"); }
    async fail() { state.events.push("failed"); }
  },
}));
vi.mock("../src/printer.js", () => ({
  printJob: async () => {
    state.events.push("print-started");
    // Maintenance starts while this job is already being sent to the queue.
    state.stop = true;
    await Promise.resolve();
    state.events.push("print-finished");
  },
}));

let initialListeners: Map<NodeJS.Signals, Function[]>;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("PRINT_AGENT_STOP_FILE", "stop.requested");
  state.stop = false;
  state.events.length = 0;
  initialListeners = new Map((["SIGINT", "SIGTERM"] as NodeJS.Signals[]).map((signal) => [signal, process.listeners(signal)]));
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const [signal, listeners] of initialListeners) {
    for (const listener of process.listeners(signal)) {
      if (!listeners.includes(listener)) process.removeListener(signal, listener);
    }
  }
});

describe("mantenimiento del agente USB", () => {
  it("termina e informa la impresion actual antes de salir sin reclamar otra comanda", async () => {
    await import("../src/main.js");
    expect(state.events).toEqual(["claim", "print-started", "print-finished", "acknowledged"]);
  });

  it("una solicitud de parada previa impide reclamar nuevos trabajos", async () => {
    state.stop = true;
    await import("../src/main.js");
    expect(state.events).toEqual([]);
  });
});
