const NAV = [
  { id: "dashboard", label: "Dashboard" },
  { id: "work_orders", label: "Work Orders" },
  { id: "plastics", label: "Plastics Estimator" },
];

export default function Sidebar({ open, page, onClose, onNavigate }) {
  return (
    <>
      <div
        className={`nav-overlay ${open ? "show" : ""}`}
        onClick={onClose}
      />
      <nav className={`nav ${open ? "open" : ""}`}>
        <div className="nav-head">
          <span className="brand-name">NutraPack</span>
          <button className="link" onClick={onClose} aria-label="Close menu">Close</button>
        </div>
        <ul className="nav-list">
          {NAV.map((item) => (
            <li key={item.id}>
              <button
                className={`nav-link ${page === item.id ? "active" : ""}`}
                onClick={() => onNavigate(item.id)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
