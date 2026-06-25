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

export function toast(message, opts = {}) {
  const item = {
    id: nextId++,
    message,
    type: opts.type || "info",            // "info" | "success" | "error"
    duration: opts.duration ?? 3200,      // ms; 0 = stay until dismissed
  };
  listeners.forEach((fn) => fn(item));
  return item.id;
}
toast.success = (message, opts = {}) => toast(message, { ...opts, type: "success" });
toast.error = (message, opts = {}) =>
  toast(message, { type: "error", duration: opts.duration ?? 5000, ...opts });
toast.info = (message, opts = {}) => toast(message, { ...opts, type: "info" });

function Icon({ type }) {
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
    function add(item) {
      setItems((prev) => [...prev, item]);
      if (item.duration > 0) {
        setTimeout(() => {
          setItems((prev) => prev.filter((x) => x.id !== item.id));
        }, item.duration);
      }
    }
    listeners.push(add);
    return () => { listeners = listeners.filter((fn) => fn !== add); };
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
