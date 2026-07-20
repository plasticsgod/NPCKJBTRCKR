import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Lightweight global toasts. No context/provider wiring required: mount a
// single <Toaster/> once (in App.jsx), then call toast(...) from anywhere:
//
//   import { toast } from "./components/Toaster";
//   toast.success("Moved to Packaging");
//   toast.error("Could not save");
//   toast("Heads up");                       // neutral/info
//
// ---------------------------------------------------------------------------

let listeners = [];
let nextId = 1;

function emit(action) { listeners.forEach((fn) => fn(action)); }

export function toast(message, opts = {}) {
  const item = {
    id: nextId++,
    message,
    type: opts.type || "info",            // "info" | "success" | "error" | "loading"
    duration: opts.duration ?? 3200,      // ms; 0 = stay until dismissed
  };
  emit({ kind: "add", item });
  return item.id;
}
toast.success = (message, opts = {}) => toast(message, { ...opts, type: "success" });
toast.error = (message, opts = {}) =>
  toast(message, { type: "error", duration: opts.duration ?? 5000, ...opts });
toast.info = (message, opts = {}) => toast(message, { ...opts, type: "info" });
// A persistent "loading" toast (stays until you update or dismiss it).
toast.loading = (message, opts = {}) => toast(message, { ...opts, type: "loading", duration: 0 });
toast.dismiss = (id) => emit({ kind: "dismiss", id });
toast.update = (id, message, opts = {}) =>
  emit({ kind: "update", id, patch: { message, type: opts.type || "info", duration: opts.duration ?? 3200 } });

function Icon({ type }) {
  if (type === "loading") {
    return (
      <svg className="toast-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    );
  }
  if (type === "success") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (type === "error") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16.5h.01" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5h.01" />
    </svg>
  );
}

export function Toaster() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    function handle(action) {
      if (action.kind === "add") {
        setItems((prev) => [...prev, action.item]);
        if (action.item.duration > 0) {
          setTimeout(() => {
            setItems((prev) => prev.filter((x) => x.id !== action.item.id));
          }, action.item.duration);
        }
      } else if (action.kind === "dismiss") {
        setItems((prev) => prev.filter((x) => x.id !== action.id));
      } else if (action.kind === "update") {
        setItems((prev) => prev.map((x) => (x.id === action.id ? { ...x, ...action.patch } : x)));
        if (action.patch.duration > 0) {
          setTimeout(() => {
            setItems((prev) => prev.filter((x) => x.id !== action.id));
          }, action.patch.duration);
        }
      }
    }
    listeners.push(handle);
    return () => { listeners = listeners.filter((fn) => fn !== handle); };
  }, []);

  function dismiss(id) {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }

  if (items.length === 0) return null;

  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={"toast toast-" + t.type}
          onClick={() => dismiss(t.id)}
        >
          <span className="toast-icon" aria-hidden="true"><Icon type={t.type} /></span>
          <span className="toast-msg">{t.message}</span>
          <button
            className="toast-x"
            onClick={(e) => { e.stopPropagation(); dismiss(t.id); }}
            aria-label="Dismiss notification"
          >×</button>
        </div>
      ))}
    </div>
  );
}
