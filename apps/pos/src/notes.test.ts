import { describe, expect, it } from "vitest";
import { composeNote, hasQuickNote, QUICK_NOTES, toggleQuickNote } from "./notes";

describe("observaciones rápidas", () => {
  it("ofrece Con todo y permite agregarlo sin perder comentarios", () => {
    expect(QUICK_NOTES).toContain("Con todo");
    const note = toggleQuickNote("Salsa aparte", "Con todo");
    expect(note).toBe("Salsa aparte, Con todo");
    expect(hasQuickNote(note, "con todo")).toBe(true);
    expect(toggleQuickNote(note, "Con todo")).toBe("Salsa aparte");
  });

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
