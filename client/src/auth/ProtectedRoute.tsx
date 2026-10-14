import { Navigate, useLocation } from "react-router";
import { useAuth } from "./auth-context.js";

function protectedReturnPath(basePath: "/boosts" | "/roster" | "/armory" | "/settings", search: string): string {
  if (basePath !== "/armory" || !search) return basePath;
  const parameters = new URLSearchParams(search);
  const names = parameters.getAll("character");
  if ([...parameters.keys()].some((key) => key !== "character") || names.length !== 1) return basePath;
  const name = names[0]!;
  if (!name || Array.from(name).length > 128 || /[\u0000-\u001f\u007f]/u.test(name)) return basePath;
  return `/armory?${new URLSearchParams({ character: name }).toString()}`;
}

export function ProtectedRoute({ children, returnTo }: {
  children: React.ReactNode;
  returnTo: "/boosts" | "/roster" | "/armory" | "/settings";
}) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.isLoading) {
    return (
      <main>
        <p className="players-message">Checking your portal session...</p>
      </main>
    );
  }
  if (auth.isError) {
    return (
      <main>
        <p className="players-message">Portal session is temporarily unavailable.</p>
      </main>
    );
  }
  if (!auth.session?.authenticated) {
    if (auth.loginNotice) {
      return <Navigate to="/login" replace />;
    }
    const destination = protectedReturnPath(returnTo, location.search);
    return <Navigate to={`/login?returnTo=${encodeURIComponent(destination)}`} replace />;
  }
  return children;
}
