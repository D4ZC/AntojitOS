import { describe, expect, it } from "vitest";
import { composeNote, getQuickNoteGroups, hasQuickNote, QUICK_NOTES, toggleQuickNote, toggleQuickNotes } from "./notes";

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

  it("ofrece la preparación de tortas sin confundir los tacos de la misma categoría", () => {
    const torta = getQuickNoteGroups({ name: "Torta de pierna", categoryName: "Tortas y tacos" }).flatMap((group) => group.notes);
    expect(torta).toEqual(expect.arrayContaining(["Sin cebolla", "Con cebolla", "Sin col", "Con col", "Con salsa", "Sin salsa", "Sin frijoles", "Sin migajón", "Preparada en bolsa"]));
    const taco = getQuickNoteGroups({ name: "Taco sencillo", categoryName: "Tortas y tacos" }).flatMap((group) => group.notes);
    expect(taco).not.toContain("Sin migajón");
    expect(taco).not.toContain("Preparada en bolsa");
  });

  it.each(["Pozole", "Tostada", "Quesadilla", "Flauta", "Sope", "Gordita", "Enchilada", "Taco dorado"])("ofrece verdura, salsa y lácteos para %s", (name) => {
    const notes = getQuickNoteGroups({ name }).flatMap((group) => group.notes);
    expect(notes).toEqual(expect.arrayContaining(["Con col", "Sin col", "Con lechuga", "Sin lechuga", "Con picante", "Sin picante", "Con col y lechuga", "Sin crema", "Sin queso", "Sin crema ni queso", "Con salsa y queso", "Solo salsa"]));
  });

  it("aprovecha la categoría de variantes con nombres genéricos y omite instrucciones de comida en bebidas", () => {
    expect(getQuickNoteGroups({ name: "Orden grande", categoryCode: "FLAUTAS" }).flatMap((group) => group.notes)).toContain("Con col");
    expect(getQuickNoteGroups({ name: "Agua de jamaica", categoryName: "Bebidas" })).toEqual([]);
    expect(getQuickNoteGroups({ name: "Flan de la casa", categoryName: "Postres" })).toEqual([]);
  });

  it.each([
    ["Sin col, Salsa aparte", "Con col", "Salsa aparte, Con col"],
    ["Con col y lechuga, Bien doradas", "Sin lechuga", "Bien doradas, Sin lechuga"],
    ["Sin col, Sin lechuga, Aparte", "Con col y lechuga", "Aparte, Con col y lechuga"],
    ["Sin crema ni queso, Sin picante", "Con salsa y queso", "Sin picante, Con salsa y queso"],
    ["Con salsa y queso, Con col", "Solo salsa", "Solo salsa"],
    ["Sin lácteos, Sin col, Bien caliente", "Con todo", "Bien caliente, Con todo"],
    ["Con todo, Bien caliente", "Sin salsa", "Bien caliente, Sin salsa"],
    ["Sin frijoles, Sin migajón", "Con frijoles", "Sin migajón, Con frijoles"],
  ])("reemplaza indicaciones opuestas de %s con %s", (existing, next, expected) => {
    expect(toggleQuickNote(existing, next)).toBe(expected);
  });

  it("conserva y combina indicaciones compatibles en la selección del constructor", () => {
    expect(toggleQuickNotes(["Sin col", "Sin crema"], "Sin picante")).toEqual(["Sin col", "Sin crema", "Sin picante"]);
    expect(toggleQuickNotes(["Sin col", "Sin crema"], "Sin col")).toEqual(["Sin crema"]);
    expect(hasQuickNote("sin LACTEOS", "Sin lácteos")).toBe(true);
  });
});
