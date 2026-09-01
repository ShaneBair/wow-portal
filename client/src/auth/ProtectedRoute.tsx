import { Navigate } from "react-router";
import { useAuth } from "./auth-context.js";

export function ProtectedRoute({ children, returnTo }: {
  children: React.ReactNode;
  returnTo: "/boosts" | "/roster";
}) {
  const auth = useAuth();
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
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return children;
}
