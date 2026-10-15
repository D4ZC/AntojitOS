import { afterEach, describe, expect, it, vi } from "vitest";
import { createUuid } from "../src";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createUuid", () => {
  it("usa una alternativa compatible cuando randomUUID no está disponible", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(17);
        return bytes;
      },
    });

    expect(createUuid()).toBe("11111111-1111-4111-9111-111111111111");
  });
});
