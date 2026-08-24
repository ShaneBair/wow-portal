import { NavLink, Outlet } from "react-router";

export function AppShell() {
  return (
    <div className="shell">
      <nav className="primary-navigation" aria-label="Primary">
        <NavLink to="/" end>Home</NavLink>
        <NavLink to="/stats" end>Stats</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
