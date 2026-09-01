import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { loginToPortal } from "../api/auth.js";
import { PortalApiError } from "../api/portal.js";
import { useAuth } from "../auth/auth-context.js";
import { DocumentTitle } from "../components/DocumentTitle.js";

function safeReturnPath(value: string | null): "/" | "/boosts" | "/roster" {
  return value === "/boosts" || value === "/roster" ? value : "/";
}

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnPath(searchParams.get("returnTo"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: loginToPortal,
    retry: false,
    onSuccess: (session) => {
      setPassword("");
      auth.setAuthenticated(session);
      void navigate(returnTo, { replace: true });
    },
    onError: () => setPassword("")
  });

  if (!auth.isLoading && auth.session?.authenticated) {
    return <Navigate to={returnTo} replace />;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    login.mutate({ username, password });
  }

  const message = login.isPending
    ? "Logging in..."
    : login.isError
      ? login.error instanceof PortalApiError
        ? login.error.message
        : "Login failed."
      : "";

  return (
    <main>
      <DocumentTitle>Log In | DaBoysZeroth</DocumentTitle>
      <header className="hero auth-hero">
        <div>
          <p className="eyebrow">PORTAL ACCOUNT</p>
          <h1>Log in</h1>
          <p className="lede">
            Use your WotLK account credentials to start a separate, time-limited portal session.
          </p>
        </div>
      </header>

      <section className="panel login-panel" aria-labelledby="loginHeading">
        <h2 id="loginHeading">Game account</h2>
        <form onSubmit={handleSubmit}>
          <label>Account name
            <input
              name="username"
              autoComplete="username"
              minLength={3}
              maxLength={16}
              value={username}
              onChange={(event) => setUsername(event.currentTarget.value)}
              required
            />
          </label>
          <label>Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              minLength={1}
              maxLength={64}
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
            />
          </label>
          <button type="submit" disabled={login.isPending}>Log in</button>
          <p
            className={`message${login.isError ? " error" : ""}`}
            role="status"
            aria-live="polite"
          >
            {message}
          </p>
        </form>
      </section>
    </main>
  );
}
