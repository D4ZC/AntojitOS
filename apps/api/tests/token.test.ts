import { describe, expect, it } from "vitest";
import {
  createOpaqueToken,
  hashDeviceToken,
  hashSessionToken,
  safeTokenMatches,
} from "../src/security/token.js";

describe("tokens locales", () => {
  it("genera tokens aleatorios y conserva sólo hashes", () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();

    expect(first).toHaveLength(43);
    expect(first).not.toBe(second);
    expect(hashDeviceToken(first)).toHaveLength(64);
    expect(hashSessionToken(first, "pepper")).not.toBe(
      hashSessionToken(first, "another-pepper"),
    );
  });

  it("compara hashes sin comparación directa de texto", () => {
    const hash = hashDeviceToken("terminal-secret");
    expect(safeTokenMatches(hashDeviceToken("terminal-secret"), hash)).toBe(true);
    expect(safeTokenMatches(hashDeviceToken("other-secret"), hash)).toBe(false);
  });
});

