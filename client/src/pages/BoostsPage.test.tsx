import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";

const requestId = "0d6202eb-15c0-4e62-9cc2-f7697dd5866f";
const session = {
  authenticated: true,
  account: { username: "TEST_USER" },
  csrfToken: "c".repeat(43)
};
const overview = {
  characters: [
    { id: "42", name: "Thalgrim", level: 80, race: "Dwarf", class: "Paladin" },
    { id: "77", name: "Zaria", level: 40, race: "Human", class: "Mage" }
  ],
  money: {
    enabled: true,
    minimumGold: 1,
    maximumGoldPerRequest: 10_000,
    dailyGoldLimit: 20_000,
    dailyRequestLimit: 5
  },
  portableHoles: {
    enabled: true,
    name: "Hole Lotta Storage",
    itemName: "Portable Hole",
    itemCount: 4,
    slotsPerBag: 24,
    repeatable: true
  }
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function pathOf(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return new URL(input, "http://portal.test").pathname;
  }
  return input instanceof URL ? input.pathname : new URL(input.url).pathname;
}

function renderBoosts(fetchImplementation: typeof fetch) {
  const fetchMock = vi.fn<typeof fetch>(fetchImplementation);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false }
    }
  });
  const router = createMemoryRouter(
    [{ path: "*", element: <App /> }],
    { initialEntries: ["/boosts"] }
  );
  return {
    fetchMock,
    router,
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
  };
}

function standardFetch(options: {
  overview?: () => Promise<Response>;
  money?: (init?: RequestInit) => Promise<Response>;
  portableHoles?: (init?: RequestInit) => Promise<Response>;
} = {}): typeof fetch {
  return (input, init) => {
    const path = pathOf(input);
    if (path === "/api/auth/session") {
      return Promise.resolve(jsonResponse(session));
    }
    if (path === "/api/boosts") {
      return options.overview?.() ?? Promise.resolve(jsonResponse(overview));
    }
    if (path === "/api/boosts/money") {
      return options.money?.(init) ?? Promise.resolve(jsonResponse({
        requestId,
        status: "sent",
        message: "500 gold was sent to Thalgrim by in-game mail."
      }, 201));
    }
    if (path === "/api/boosts/portable-holes") {
      return options.portableHoles?.(init) ?? Promise.resolve(jsonResponse({
        requestId,
        status: "sent",
        message: "Four Portable Holes were sent to Thalgrim by in-game mail."
      }, 201));
    }
    return Promise.resolve(jsonResponse({ error: "Not found." }, 404));
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Boosts page", () => {
  it("loads owned characters, selects the first, and renders current limits", async () => {
    renderBoosts(standardFetch());

    expect(await screen.findByRole("heading", { level: 1, name: "Boosts" })).toBeTruthy();
    const selector = await screen.findByLabelText<HTMLSelectElement>("Choose a character");
    await waitFor(() => expect(selector.value).toBe("42"));
    expect(screen.getByRole("option", { name: "Thalgrim — Level 80 Paladin" })).toBeTruthy();
    expect(screen.getByText(/1–10,000 whole gold per request/u)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Hole Lotta Storage" })).toBeTruthy();
    expect(screen.getByText(/four 24-slot Portable Holes/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send gold" }).hasAttribute("disabled")).toBe(true);
    await waitFor(() => expect(document.title).toBe("Boosts | DaBoysZeroth"));
  });

  it("shows digits-only validation and keeps the action disabled", async () => {
    renderBoosts(standardFetch());
    const user = userEvent.setup();
    const input = await screen.findByLabelText<HTMLInputElement>("Gold amount");
    await waitFor(() => expect(input.disabled).toBe(false));
    await user.type(input, "1.5");
    await user.tab();

    expect(screen.getByText("Enter whole gold using digits only.")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("button", { name: "Send gold" }).hasAttribute("disabled")).toBe(true);
  });

  it("creates one UUID per activation, sends CSRF, and reports confirmed success", async () => {
    let moneyInit: RequestInit | undefined;
    const { fetchMock } = renderBoosts(standardFetch({
      money: (init) => {
        moneyInit = init;
        return Promise.resolve(jsonResponse({
          requestId,
          status: "sent",
          message: "500 gold was sent to Thalgrim by in-game mail."
        }, 201));
      }
    }));
    const user = userEvent.setup();
    const input = await screen.findByLabelText<HTMLInputElement>("Gold amount");
    await waitFor(() => expect(input.disabled).toBe(false));
    await user.type(input, "500");
    await user.click(screen.getByRole("button", { name: "Send gold" }));

    expect(await screen.findByText("500 gold was sent to Thalgrim by in-game mail.")).toBeTruthy();
    expect(input.value).toBe("");
    expect(new Headers(moneyInit?.headers).get("X-CSRF-Token")).toBe(session.csrfToken);
    expect(JSON.parse(String(moneyInit?.body))).toEqual({ requestId, characterId: "42", gold: 500 });
    expect(fetchMock.mock.calls.filter(([inputValue]) => pathOf(inputValue) === "/api/boosts/money")).toHaveLength(1);
  });

  it("confirms the character and quantity, supports cancel, and restores focus", async () => {
    renderBoosts(standardFetch());
    const user = userEvent.setup();
    const send = await screen.findByRole<HTMLButtonElement>("button", { name: "Send bags" });
    await waitFor(() => expect(send.disabled).toBe(false));
    await user.click(send);

    expect(screen.getByRole("heading", { level: 3, name: "Confirm bag delivery" })).toBeTruthy();
    expect(screen.getByText(/Send four 24-slot Portable Holes to Thalgrim/u)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Confirm" });
    await waitFor(() => expect(document.activeElement).toBe(confirm));

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Confirm bag delivery" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Send bags" })
    ));
  });

  it("sends only request and character IDs and permits another confirmed bundle", async () => {
    const calls: RequestInit[] = [];
    const { fetchMock } = renderBoosts(standardFetch({
      portableHoles: (init) => {
        calls.push(init ?? {});
        return Promise.resolve(jsonResponse({
          requestId,
          status: "sent",
          message: "Four Portable Holes were sent to Thalgrim by in-game mail."
        }, calls.length === 1 ? 201 : 200));
      }
    }));
    const user = userEvent.setup();
    const send = await screen.findByRole<HTMLButtonElement>("button", { name: "Send bags" });
    await waitFor(() => expect(send.disabled).toBe(false));

    await user.click(send);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Four Portable Holes were sent to Thalgrim by in-game mail.")).toBeTruthy();
    expect(new Headers(calls[0]?.headers).get("X-CSRF-Token")).toBe(session.csrfToken);
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ requestId, characterId: "42" });

    await user.click(screen.getByRole("button", { name: "Send bags" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(
      ([inputValue]) => pathOf(inputValue) === "/api/boosts/portable-holes"
    )).toHaveLength(2));
  });

  it("preserves an unknown delivery warning when the selected character changes", async () => {
    renderBoosts(standardFetch({
      portableHoles: () => Promise.resolve(jsonResponse({
        requestId,
        status: "unknown",
        error: "Delivery could not be confirmed and may already have arrived. Check your mail before sending another bundle."
      }, 503))
    }));
    const user = userEvent.setup();
    const send = await screen.findByRole<HTMLButtonElement>("button", { name: "Send bags" });
    await waitFor(() => expect(send.disabled).toBe(false));
    await user.click(send);
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/may already have arrived/u)).toBeTruthy();
    expect(screen.getByText(requestId)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Choose a character"), "77");
    expect(screen.getByText(/may already have arrived/u)).toBeTruthy();
    expect(screen.getByText(requestId)).toBeTruthy();
  });

  it("cancels an unsubmitted bag confirmation when the character changes", async () => {
    renderBoosts(standardFetch());
    const user = userEvent.setup();
    const send = await screen.findByRole<HTMLButtonElement>("button", { name: "Send bags" });
    await waitFor(() => expect(send.disabled).toBe(false));
    await user.click(send);
    await user.selectOptions(screen.getByLabelText("Choose a character"), "77");
    expect(screen.queryByRole("heading", { name: "Confirm bag delivery" })).toBeNull();
  });

  it("shows and locks an unconfirmed request with its request ID", async () => {
    renderBoosts(standardFetch({
      money: () => Promise.resolve(jsonResponse({
        requestId,
        status: "unknown",
        error: "Delivery could not be confirmed. Do not send again; give this request ID to an administrator."
      }, 503))
    }));
    const user = userEvent.setup();
    const input = await screen.findByLabelText<HTMLInputElement>("Gold amount");
    await waitFor(() => expect(input.disabled).toBe(false));
    await user.type(input, "500");
    await user.click(screen.getByRole("button", { name: "Send gold" }));

    expect(await screen.findByText(/Delivery could not be confirmed/u)).toBeTruthy();
    expect(screen.getByText(requestId)).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>("Choose a character").disabled).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("Gold amount").disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Send gold" }).hasAttribute("disabled")).toBe(true);
  });

  it("renders empty, disabled, and unavailable states", async () => {
    const empty = renderBoosts(standardFetch({
      overview: () => Promise.resolve(jsonResponse({
        characters: [],
        money: { ...overview.money, enabled: false },
        portableHoles: { ...overview.portableHoles, enabled: false }
      }))
    }));
    expect(await screen.findByText("This account does not have any characters yet.")).toBeTruthy();
    expect(screen.getByText("Free Money is currently disabled.")).toBeTruthy();
    expect(screen.getByText("This boost is currently unavailable.")).toBeTruthy();
    empty.unmount();

    renderBoosts(standardFetch({
      overview: () => Promise.resolve(jsonResponse({ error: "Boosts are temporarily unavailable." }, 503))
    }));
    expect(await screen.findByText("Your characters are temporarily unavailable.")).toBeTruthy();
  });

  it("returns to Login when the session expires during submission", async () => {
    const { router } = renderBoosts(standardFetch({
      money: () => Promise.resolve(jsonResponse({ error: "Log in to continue." }, 401))
    }));
    const user = userEvent.setup();
    const input = await screen.findByLabelText<HTMLInputElement>("Gold amount");
    await waitFor(() => expect(input.disabled).toBe(false));
    await user.type(input, "500");
    await user.click(screen.getByRole("button", { name: "Send gold" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toBe("?returnTo=%2Fboosts");
  });

  it("returns to Login when the session expires during bag delivery", async () => {
    const { router } = renderBoosts(standardFetch({
      portableHoles: () => Promise.resolve(jsonResponse({ error: "Log in to continue." }, 401))
    }));
    const user = userEvent.setup();
    const send = await screen.findByRole<HTMLButtonElement>("button", { name: "Send bags" });
    await waitFor(() => expect(send.disabled).toBe(false));
    await user.click(send);
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/login");
  });
});
