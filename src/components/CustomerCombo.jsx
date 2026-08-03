import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

// A styled "type or pick" customer field. Free text is allowed (so brokering
// customers can be new names), with a filtered dropdown of existing customers.
// The menu is portalled to <body> with fixed positioning so it never clips
// inside the modal or spills off the edge (same trick as the status picker).
export default function CustomerCombo({ value, onChange, customers = [], placeholder = "Type or pick a customer" }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);

  const q = (value || "").trim().toLowerCase();
  const matches = q
    ? customers.filter((c) => (c || "").toLowerCase().includes(q))
    : customers;

  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const PH = 260, GAP = 6, EDGE = 8;
      let top = r.bottom + GAP;
      let flip = false;
      if (top + PH > window.innerHeight - EDGE) {
        const up = r.top - GAP - PH;
        top = up >= EDGE ? up : Math.max(EDGE, window.innerHeight - PH - EDGE);
        flip = true;
      }
      setCoords({ top, left: r.left, width: r.width, flip });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <div className="cust-combo" ref={wrapRef}>
      <input
        ref={inputRef}
        className="cust-combo-input"
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      <span className="cust-combo-caret" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </span>
      {open && coords && createPortal(
        <div className="cust-combo-menu" ref={menuRef}
          style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width, zIndex: 1000, transformOrigin: coords.flip ? "bottom left" : "top left" }}>
          {matches.length === 0 ? (
            <div className="cust-combo-empty">No matches — press Enter to use “{value}”.</div>
          ) : (
            matches.map((c) => (
              <button type="button" key={c}
                className={"cust-combo-option" + (c === value ? " is-current" : "")}
                onClick={() => { onChange(c); setOpen(false); }}>
                {c}
              </button>
            ))
          )}
        </div>, document.body)}
    </div>
  );
}
