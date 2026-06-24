import { useState, useEffect, useRef } from "react";

const MONTHS = ["January","February","March","April","May","June",
                 "July","August","September","October","November","December"];
const DAYS = ["Su","Mo","Tu","We","Th","Fr","Sa"];

// value: "YYYY-MM-DD" string or ""
// onChange: (value: "YYYY-MM-DD" | "") => void
export default function DatePicker({ value, onChange, placeholder = "Set date" }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const d = value ? new Date(value + "T12:00:00") : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const ref = useRef(null);

  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Sync view when value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value + "T12:00:00");
      setView({ year: d.getFullYear(), month: d.getMonth() });
    }
  }, [value]);

  const selected = value ? new Date(value + "T12:00:00") : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
  function firstDayOfMonth(year, month) { return new Date(year, month, 1).getDay(); }

  function pick(day) {
    const d = new Date(view.year, view.month, day);
    onChange(d.toISOString().slice(0, 10));
    setOpen(false);
  }

  function prevMonth() {
    setView(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 });
  }
  function nextMonth() {
    setView(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 });
  }

  const totalDays = daysInMonth(view.year, view.month);
  const startDay = firstDayOfMonth(view.year, view.month);
  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);

  const displayValue = selected
    ? selected.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";

  return (
    <div className="dp-wrap" ref={ref}>
      <button type="button" className="dp-trigger" onClick={() => setOpen(!open)}>
        {displayValue || <span className="dp-placeholder">{placeholder}</span>}
        {displayValue && (
          <span className="dp-clear" onClick={(e) => { e.stopPropagation(); onChange(""); }}>✕</span>
        )}
      </button>

      {open && (
        <div className="dp-popup">
          <div className="dp-head">
            <button type="button" className="dp-nav" onClick={prevMonth}>‹</button>
            <span className="dp-month">{MONTHS[view.month]} {view.year}</span>
            <button type="button" className="dp-nav" onClick={nextMonth}>›</button>
          </div>
          <div className="dp-grid">
            {DAYS.map(d => <span key={d} className="dp-dayname">{d}</span>)}
            {cells.map((day, i) => {
              if (!day) return <span key={`e${i}`} />;
              const thisDate = new Date(view.year, view.month, day);
              thisDate.setHours(0, 0, 0, 0);
              const isToday = thisDate.getTime() === today.getTime();
              const isSelected = selected &&
                selected.getFullYear() === view.year &&
                selected.getMonth() === view.month &&
                selected.getDate() === day;
              return (
                <button type="button" key={day}
                  className={`dp-day${isSelected ? " dp-sel" : ""}${isToday ? " dp-today" : ""}`}
                  onClick={() => pick(day)}>
                  {day}
                </button>
              );
            })}
          </div>
          <div className="dp-foot">
            <button type="button" className="link" onClick={() => { onChange(""); setOpen(false); }}>Clear</button>
            <button type="button" className="link" onClick={() => {
              const t = new Date();
              onChange(t.toISOString().slice(0, 10));
              setOpen(false);
            }}>Today</button>
          </div>
        </div>
      )}
    </div>
  );
}
