import { PortalApiError } from "./portal.js";

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
}

export class AccountPasswordApiError extends PortalApiError {
  constructor(message: string, readonly sessionInvalidated: boolean) {
    super(message);
    this.name = "AccountPasswordApiError";
  }
}

function publicError(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" && error.length <= 256 ? error : undefined;
}

export async function changeAccountPassword(
  input: ChangePasswordInput,
  csrfToken: string
): Promise<void> {
  const response = await fetch("/api/account/password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken
    },
    credentials: "same-origin",
    body: JSON.stringify(input)
  });
  if (response.status === 204) return;
  let body: unknown;
  try { body = await response.json() as unknown; } catch { body = undefined; }
  const message = publicError(body) ?? "Password change failed.";
  throw new AccountPasswordApiError(
    message,
    response.status === 409 || message.startsWith("The result could not be confirmed.")
  );
}
