import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AccountPasswordApiError, changeAccountPassword } from "../api/account.js";
import { PortalApiError } from "../api/portal.js";
import { useAuth } from "../auth/auth-context.js";
import { DocumentTitle } from "../components/DocumentTitle.js";

export function SettingsPage() {
  const auth = useAuth();
  const session = auth.session?.authenticated ? auth.session : undefined;
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const currentRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  function clearPasswords(): void {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
  }

  const changePassword = useMutation({
    mutationFn: (input: Parameters<typeof changeAccountPassword>[0]) =>
      changeAccountPassword(input, session?.csrfToken ?? ""),
    retry: false,
    onSuccess: () => {
      clearPasswords();
      auth.completePasswordChange();
      void navigate("/login", { replace: true });
    },
    onError: (error) => {
      clearPasswords();
      if (error instanceof AccountPasswordApiError && error.sessionInvalidated) {
        auth.requireLogin(error.message);
        void navigate("/login", { replace: true });
        return;
      }
      currentRef.current?.focus();
    }
  });

  useEffect(() => clearPasswords, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    changePassword.reset();
    setValidationMessage("");
    if (Array.from(currentPassword).length < 1 || Array.from(currentPassword).length > 64) {
      setValidationMessage("Enter your current password.");
      currentRef.current?.focus();
      return;
    }
    if (Array.from(newPassword).length < 8 || Array.from(newPassword).length > 16) {
      setValidationMessage("The new password must be 8 to 16 characters.");
      newRef.current?.focus();
      return;
    }
    if (newPassword === currentPassword) {
      setValidationMessage("The new password must differ from the current password.");
      newRef.current?.focus();
      return;
    }
    if (confirmNewPassword !== newPassword) {
      setValidationMessage("The new passwords must match.");
      confirmRef.current?.focus();
      return;
    }
    changePassword.mutate({ currentPassword, newPassword, confirmNewPassword });
  }

  const clientError = validationMessage || (newPassword && newPassword === currentPassword
    ? "The new password must differ from the current password."
    : confirmNewPassword && confirmNewPassword !== newPassword
      ? "The new passwords must match."
      : "");
  const message = changePassword.isPending
    ? "Changing password..."
    : changePassword.isError
      ? changePassword.error instanceof PortalApiError
        ? changePassword.error.message
        : "Password change failed."
      : clientError;

  return (
    <main>
      <DocumentTitle>Settings | DaBoysZeroth</DocumentTitle>
      <header className="hero auth-hero">
        <div>
          <p className="eyebrow">PORTAL ACCOUNT</p>
          <h1>Settings</h1>
          <p className="lede">Manage the credentials used for both the portal and game client.</p>
        </div>
      </header>
      <section className="panel login-panel" aria-labelledby="passwordHeading">
        <h2 id="passwordHeading">Change password</h2>
        <p>Signed in as <span className="auth-account-name">{session?.account.username}</span></p>
        <form onSubmit={handleSubmit}>
          <label>Current password
            <input ref={currentRef} type="password" autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.currentTarget.value)} required />
          </label>
          <label>New password
            <input ref={newRef} type="password" autoComplete="new-password"
              value={newPassword}
              aria-describedby="passwordGuidance"
              onChange={(event) => setNewPassword(event.currentTarget.value)} required />
          </label>
          <p id="passwordGuidance" className="form-guidance">Use 8 to 16 characters.</p>
          <label>Confirm new password
            <input ref={confirmRef} type="password" autoComplete="new-password"
              value={confirmNewPassword}
              onChange={(event) => setConfirmNewPassword(event.currentTarget.value)} required />
          </label>
          <button type="submit" disabled={changePassword.isPending}>Change password</button>
          <p className={`message${message && !changePassword.isPending ? " error" : ""}`}
            role="status" aria-live="polite">{message}</p>
        </form>
      </section>
    </main>
  );
}
