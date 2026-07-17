// Shared confirmation modal — the centered, styled dialog used app-wide for
// destructive actions (replaces browser confirm() and the old bottom bars).
//
// Usage: keep a small state object and render <ConfirmModal> once:
//   const [confirmState, setConfirmState] = useState(null);
//   ...
//   onClick={() => setConfirmState({
//     title: "Delete task?",
//     message: "Are you sure? This cannot be undone.",
//     confirmLabel: "Delete task",
//     onConfirm: () => actuallyDelete(id),
//   })}
//   ...
//   <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
export default function ConfirmModal({ state, onClose }) {
  if (!state) return null;
  const { title, message, confirmLabel = "Delete", onConfirm } = state;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
        </div>
        <div className="modal-body">
          <p>{message}</p>
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-danger" onClick={() => { onConfirm && onConfirm(); onClose(); }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
