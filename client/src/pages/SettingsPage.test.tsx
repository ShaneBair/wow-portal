import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";

const csrfToken = "c".repeat(43);
const session = { authenticated: true, account: { username: "TEST_USER" }, csrfToken };

function response(body: unknown, status = 200): Response {
  return status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function pathOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return new URL(input, "http://portal.test").pathname;
  return input instanceof URL ? input.pathname : new URL(input.url).pathname;
}

function renderSettings(changeResponse: Response) {
  const fetchMock = vi.fn<typeof fetch>((input) => {
    const path = pathOf(input);
    if (path === "/api/auth/session") return Promise.resolve(response(session));
    if (path === "/api/account/password") return Promise.resolve(changeResponse);
    return Promise.resolve(response({ error: "Not found." }, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
  const queryClient = new QueryClient({ defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false }
  } });
  const router = createMemoryRouter([{ path: "*", element: <App /> }], { initialEntries: ["/settings"] });
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>);
  return { fetchMock, queryClient, router };
}

afterEach(() => vi.unstubAllGlobals());

describe("account settings password change", () => {
  it("shows authenticated navigation and clears all password fields after a safe failure", async () => {
    renderSettings(response({ error: "The current password is incorrect." }, 401));
    const user = userEvent.setup();
    expect(await screen.findByRole("link", { name: "Settings" })).toBeTruthy();
    expect(screen.getAllByText("TEST_USER")).toHaveLength(2);
    const current = screen.getByLabelText<HTMLInputElement>("Current password");
    const next = screen.getByLabelText<HTMLInputElement>("New password");
    const confirm = screen.getByLabelText<HTMLInputElement>("Confirm new password");
    expect(current.autocomplete).toBe("current-password");
    expect(next.autocomplete).toBe("new-password");
    await user.type(current, "WrongPass1!");
    await user.type(next, "NewPass2!");
    await user.type(confirm, "NewPass2!");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("The current password is incorrect.")).toBeTruthy();
    expect(current.value).toBe("");
    expect(next.value).toBe("");
    expect(confirm.value).toBe("");
    expect(document.activeElement).toBe(current);
  });

  it("submits CSRF, clears protected caches, signs out, and shows an in-memory confirmation", async () => {
    const { fetchMock, queryClient, router } = renderSettings(response(undefined, 204));
    const user = userEvent.setup();
    const current = await screen.findByLabelText<HTMLInputElement>("Current password");
    queryClient.setQueryData(["protected", "private"], { secret: true });
    queryClient.setQueryData(["account-visible", "private"], { secret: true });
    await user.type(current, "OldPass1!");
    await user.type(screen.getByLabelText("New password"), "NewPass2!");
    await user.type(screen.getByLabelText("Confirm new password"), "NewPass2!");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("Password changed. Log in with your new password.")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toBe("");
    const call = fetchMock.mock.calls.find(([input]) => pathOf(input) === "/api/account/password");
    expect(new Headers(call?.[1]?.headers).get("X-CSRF-Token")).toBe(csrfToken);
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      currentPassword: "OldPass1!", newPassword: "NewPass2!", confirmNewPassword: "NewPass2!"
    });
    await waitFor(() => {
      expect(queryClient.getQueryData(["protected", "private"])).toBeUndefined();
      expect(queryClient.getQueryData(["account-visible", "private"])).toBeUndefined();
    });
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });
});
