interface Props {
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}

export default function CoverRepositionControls({
  saving,
  onSave,
  onCancel,
}: Props) {
  return (
    <div className="cover-reposition-ui">
      <div className="cover-reposition-hint">Drag image to reposition</div>
      <div className="cover-reposition-actions">
        <button type="button" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={saving} onClick={onSave}>
          {saving ? "Saving…" : "Save position"}
        </button>
      </div>
    </div>
  );
}
