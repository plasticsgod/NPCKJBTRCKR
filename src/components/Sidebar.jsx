const NAV = [
  { id: "dashboard", label: "Dashboard" },
  { id: "projects", label: "Projects" },
  { id: "work_orders", label: "Work Orders", match: ["work_orders", "plastic_work_orders"] },
  { id: "rfq", label: "RFQ" },
  { id: "plastics", label: "Plastics Estimator" },
  { id: "customers", label: "Customers" },
];

export default function Sidebar({ open, page, isInternal = true, onClose, onNavigate }) {
  const items = isInternal ? NAV : NAV.filter((item) => item.id === "projects");
  const isActive = (item) => (item.match ? item.match.includes(page) : page === item.id);
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
          {items.map((item) => (
            <li key={item.id}>
              <button
                className={`nav-link ${isActive(item) ? "active" : ""}`}
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
