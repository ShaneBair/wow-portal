import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useRef } from "react";
import {
  PortalApiError,
  registerAccount,
  type RegistrationInput
} from "../api/portal.js";

function readRegistrationInput(form: HTMLFormElement): RegistrationInput {
  const data = new FormData(form);

  return {
    username: String(data.get("username") ?? ""),
    email: String(data.get("email") ?? ""),
    password: String(data.get("password") ?? ""),
    confirmPassword: String(data.get("confirmPassword") ?? ""),
    inviteCode: String(data.get("inviteCode") ?? "")
  };
}

export function RegistrationPanel() {
  const formRef = useRef<HTMLFormElement>(null);
  const registration = useMutation({
    mutationFn: registerAccount,
    retry: false
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    registration.mutate(readRegistrationInput(event.currentTarget), {
      onSuccess: () => formRef.current?.reset()
    });
  }

  let message = "";
  let messageClassName = "message";

  if (registration.isPending) {
    message = "Creating account...";
  } else if (registration.isSuccess) {
    message = registration.data.message;
    messageClassName += " success";
  } else if (registration.isError) {
    message = registration.error instanceof PortalApiError
      ? registration.error.message
      : "Registration failed.";
    messageClassName += " error";
  }

  return (
    <article className="panel">
      <h2>Create your account</h2>
      <p>Got an invite? Make your game account here.</p>

      <form ref={formRef} onSubmit={handleSubmit}>
        <label>Username
          <input name="username" autoComplete="username" maxLength={16} required />
        </label>

        <label>Email
          <input name="email" type="email" autoComplete="email" required />
        </label>

        <label>Password
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={64}
            required
          />
        </label>

        <label>Confirm password
          <input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={64}
            required
          />
        </label>

        <label>Invite code
          <input name="inviteCode" type="password" required />
        </label>

        <button type="submit" disabled={registration.isPending}>Create Game Account</button>
        <p className={messageClassName} role="status" aria-live="polite">{message}</p>
      </form>
    </article>
  );
}
