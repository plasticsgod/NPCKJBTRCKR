const TITLES = { work_orders: "Work Orders", dashboard: "Dashboard", plastics: "Plastics Estimator", projects: "Projects" };

export default function Header({ page, email, onMenu, onSignOut }) {
  return (
    <header className="header">
      <button className="burger" onClick={onMenu} aria-label="Open menu">
        <span /><span /><span />
      </button>

      <div className="brand">
        <img className="brand-mark" src="/images/favicon.png" alt="NutraPack logo" />
        <span className="brand-name">NutraPack App</span>
        <span className="brand-sub">{TITLES[page]}</span>
      </div>

      <div className="header-right">
        <div className="account">
          <span className="account-email" title={email}>{email}</span>
          <button className="link" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </header>
  );
}
