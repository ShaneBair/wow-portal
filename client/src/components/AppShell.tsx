import { useMutation } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router";
import { logoutFromPortal } from "../api/auth.js";
import { useAuth } from "../auth/auth-context.js";

export function AppShell() {
  const auth = useAuth();
  const authenticatedSession = auth.session?.authenticated ? auth.session : undefined;
  const logout = useMutation({
    mutationFn: logoutFromPortal,
    retry: false,
    onSuccess: () => auth.setSignedOut()
  });

  return (
    <div className="shell">
      <div className="shell-header">
        <nav className="primary-navigation" aria-label="Primary">
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/stats" end>Stats</NavLink>
          <NavLink to="/boosts" end>Boosts</NavLink>
        </nav>
        <div className="auth-actions" aria-label="Portal account">
          {auth.isLoading && <span>Checking session...</span>}
          {!auth.isLoading && !auth.session?.authenticated && (
            <NavLink to="/login">Log in</NavLink>
          )}
          {!auth.isLoading && authenticatedSession && (
            <>
              <span className="auth-account-name">{authenticatedSession.account.username}</span>
              <button
                type="button"
                className="auth-logout"
                disabled={logout.isPending}
                onClick={() => logout.mutate(authenticatedSession.csrfToken)}
              >
                Log out
              </button>
            </>
          )}
        </div>
      </div>
      {logout.isError && (
        <p className="message error auth-message" role="status">Logout failed.</p>
      )}
      <Outlet />
    </div>
  );
}
