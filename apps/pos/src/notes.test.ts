import { describe, expect, it } from "vitest";
import { composeNote, hasQuickNote, toggleQuickNote } from "./notes";

describe("observaciones rápidas", () => {
  it("agrega y quita observaciones sin perder la nota libre", () => {
    const withOnion = toggleQuickNote("Bien dorada", "Sin cebolla");
    expect(withOnion).toBe("Bien dorada, Sin cebolla");
    expect(hasQuickNote(withOnion, "sin cebolla")).toBe(true);
    expect(toggleQuickNote(withOnion, "Sin cebolla")).toBe("Bien dorada");
  });

  it("combina observaciones y texto libre", () => {
    expect(composeNote(["Sin salsa", "Sin lácteos"], "  aparte  ")).toBe("Sin salsa, Sin lácteos, aparte");
    expect(composeNote([], " ")).toBe("");
  });
});
