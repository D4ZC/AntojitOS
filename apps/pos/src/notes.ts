export const QUICK_NOTES = ["Con todo", "Sin lácteos", "Sin salsa", "Sin cebolla"] as const;

const NOTE_SEPARATOR = ", ";

const noteParts = (note: string): string[] =>
  note.split(",").map((part) => part.trim()).filter(Boolean);

export const hasQuickNote = (note: string, quickNote: string): boolean =>
  noteParts(note).some((part) => part.toLowerCase() === quickNote.toLowerCase());

/** Agrega o quita una observación frecuente sin perder el texto libre de la nota. */
export const toggleQuickNote = (note: string, quickNote: string): string => {
  const parts = noteParts(note);
  const next = hasQuickNote(note, quickNote)
    ? parts.filter((part) => part.toLowerCase() !== quickNote.toLowerCase())
    : [...parts, quickNote];
  return next.join(NOTE_SEPARATOR);
};

export const composeNote = (quickNotes: readonly string[], freeText: string): string =>
  [...quickNotes, freeText.trim()].filter(Boolean).join(NOTE_SEPARATOR);
