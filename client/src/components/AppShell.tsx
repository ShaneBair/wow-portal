import { Outlet } from "react-router";

export function AppShell() {
  return (
    <div className="shell">
      <div className="primary-navigation-slot" />
      <Outlet />
    </div>
  );
}
