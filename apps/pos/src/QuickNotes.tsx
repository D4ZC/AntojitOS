import { getQuickNoteGroups, hasQuickNote, MAX_NOTE_LENGTH, toggleQuickNote, type QuickNoteContext } from "./notes";

interface QuickNotesProps {
  context: QuickNoteContext;
  note: string;
  onToggle(note: string): void;
}

export const QuickNotes = ({ context, note, onToggle }: QuickNotesProps) => (
  <div className="quick-note-groups">
    {getQuickNoteGroups(context).map((group) => (
      <div className="quick-note-group" key={group.label} role="group" aria-label={group.label}>
        <small>{group.label}</small>
        <div className="quick-notes">
          {group.notes.map((quickNote) => {
            const selected = hasQuickNote(note, quickNote);
            return (
              <button
                className={selected ? "selected" : ""}
                type="button"
                key={quickNote}
                aria-pressed={selected}
                disabled={!selected && toggleQuickNote(note, quickNote).length > MAX_NOTE_LENGTH}
                onClick={() => onToggle(quickNote)}
              >{quickNote}</button>
            );
          })}
        </div>
      </div>
    ))}
  </div>
);
