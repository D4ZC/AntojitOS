export const MAX_NOTE_LENGTH = 200;
export const QUICK_NOTES = ["Con todo", "Sin lácteos", "Sin salsa", "Sin cebolla", "Sin verdura", "Sin rábano", "Con rábano"] as const;

export interface QuickNoteContext {
  name: string;
  code?: string;
  categoryName?: string;
  categoryCode?: string;
}

export interface QuickNoteGroup {
  label: string;
  notes: readonly string[];
}

const normalize = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const NOTE_SEPARATOR = ", ";

const noteParts = (note: string): string[] =>
  note.split(",").map((part) => part.trim()).filter(Boolean);

const garnishes: QuickNoteGroup = {
  label: "Verdura",
  notes: ["Sin verdura", "Con col", "Sin col", "Con lechuga", "Sin lechuga", "Con col y lechuga", "Sin col ni lechuga", "Con cebolla", "Sin cebolla", "Sin rábano", "Con rábano"],
};
const sauces: QuickNoteGroup = {
  label: "Salsa y picante",
  notes: ["Con salsa", "Sin salsa", "Con picante", "Sin picante", "Salsa aparte"],
};
const dairy: QuickNoteGroup = {
  label: "Crema y queso",
  notes: ["Sin crema", "Sin queso", "Sin crema ni queso", "Con salsa y queso", "Solo salsa"],
};

/** Las indicaciones son notas de cocina; los rellenos y extras se eligen en sus modificadores. */
export const getQuickNoteGroups = (context: QuickNoteContext): QuickNoteGroup[] => {
  const product = normalize(`${context.code ?? ""} ${context.name}`);
  const category = normalize(`${context.categoryCode ?? ""} ${context.categoryName ?? ""}`);
  if (/(bebida|postre|refresco|agua fresca|cerveza|jugo|flan|horchata|jamaica)/.test(`${product} ${category}`)) return [];
  if (/torta/.test(product) || (/torta/.test(category) && !/taco/.test(product))) {
    return [
      { label: "Verdura", notes: ["Sin verdura", "Sin cebolla", "Con cebolla", "Sin col", "Con col", "Sin rábano", "Con rábano"] },
      { label: "Preparación", notes: ["Con salsa", "Sin salsa", "Sin frijoles", "Con frijoles", "Sin migajón", "Preparada en bolsa"] },
      { label: "Otras indicaciones", notes: ["Con todo", "Salsa aparte"] },
    ];
  }
  if (/(pozole|tostada|quesadilla|flauta|sope|gordita|enchilada|taco.*dorado)/.test(`${product} ${category}`)) {
    return [{ label: "General", notes: ["Con todo"] }, garnishes, sauces, dairy];
  }
  return [{ label: "Observaciones frecuentes", notes: QUICK_NOTES }];
};

type Ingredient = "col" | "lechuga" | "cebolla" | "rabano" | "salsa" | "picante" | "crema" | "queso" | "frijoles";
type Ingredients = Partial<Record<Ingredient, boolean>>;
const ingredients: Record<string, Ingredients> = {
  "con col y lechuga": { col: true, lechuga: true },
  "sin col ni lechuga": { col: false, lechuga: false },
  "sin crema ni queso": { crema: false, queso: false },
  "sin lacteos": { crema: false, queso: false },
  "sin verdura": { col: false, lechuga: false, cebolla: false, rabano: false },
  "con salsa y queso": { salsa: true, queso: true },
  "solo salsa": { salsa: true, crema: false, queso: false, col: false, lechuga: false, cebolla: false, rabano: false },
  "salsa aparte": { salsa: false },
};

const noteIngredients = (note: string): Ingredients => {
  const normalized = normalize(note);
  const match = /^(con|sin) (col|lechuga|cebolla|rabano|salsa|picante|crema|queso|frijoles)$/.exec(normalized);
  return match ? { [match[2]!]: match[1] === "con" } : ingredients[normalized] ?? {};
};

const notesConflict = (existing: string, next: string): boolean => {
  const previousIngredients = noteIngredients(existing);
  const nextIngredients = noteIngredients(next);
  if ((normalize(existing) === "con todo" && normalize(next) === "salsa aparte") ||
    (normalize(next) === "con todo" && normalize(existing) === "salsa aparte")) return false;
  if (normalize(existing) === "con todo") return Object.keys(nextIngredients).length > 0;
  if (normalize(next) === "con todo") return Object.keys(previousIngredients).length > 0;
  return (Object.keys(nextIngredients) as Ingredient[]).some((ingredient) =>
    previousIngredients[ingredient] !== undefined && previousIngredients[ingredient] !== nextIngredients[ingredient],
  );
};

export const hasQuickNote = (note: string, quickNote: string): boolean =>
  noteParts(note).some((part) => normalize(part) === normalize(quickNote));

/** Agrega o quita una indicación, reemplazando las opciones opuestas y conservando el texto libre. */
export const toggleQuickNotes = (notes: readonly string[], quickNote: string): string[] => {
  const alreadySelected = notes.some((note) => normalize(note) === normalize(quickNote));
  return alreadySelected
    ? notes.filter((note) => normalize(note) !== normalize(quickNote))
    : [...notes.filter((note) => !notesConflict(note, quickNote)), quickNote];
};

export const toggleQuickNote = (note: string, quickNote: string): string =>
  toggleQuickNotes(noteParts(note), quickNote).join(NOTE_SEPARATOR);

export const composeNote = (quickNotes: readonly string[], freeText: string): string =>
  [...quickNotes, freeText.trim()].filter(Boolean).join(NOTE_SEPARATOR);

/** Mantiene sincronizadas las selecciones y las indicaciones reconocidas escritas a mano. */
export const toggleQuickNoteDraft = (quickNotes: readonly string[], freeText: string, quickNote: string): { quickNotes: string[]; freeText: string } => {
  const alreadySelected = hasQuickNote(composeNote(quickNotes, freeText), quickNote);
  const retain = (note: string) => alreadySelected
    ? normalize(note) !== normalize(quickNote)
    : !notesConflict(note, quickNote);
  return {
    quickNotes: [...quickNotes.filter(retain), ...(alreadySelected ? [] : [quickNote])],
    freeText: noteParts(freeText).filter(retain).join(NOTE_SEPARATOR),
  };
};
