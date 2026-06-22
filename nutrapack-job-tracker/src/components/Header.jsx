export default function Header({ count, view, onView, email, onNew, onSignOut }) {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" />
        <span className="brand-name">NutraPack</span>
        <span className="brand-sub">Job Tracker</span>
      </div>

      <div className="header-right">
        <div className="toggle">
          <button
            className={view === "table" ? "toggle-on" : ""}
            onClick={() => onView("table")}
          >
            Table
          </button>
          <button
            className={view === "board" ? "toggle-on" : ""}
            onClick={() => onView("board")}
          >
            Board
          </button>
        </div>

        <span className="count">
          {count} {count === 1 ? "job" : "jobs"}
        </span>

        <button className="btn-accent" onClick={onNew}>
          + New Job
        </button>

        <div className="account">
          <span className="account-email" title={email}>
            {email}
          </span>
          <button className="link" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
