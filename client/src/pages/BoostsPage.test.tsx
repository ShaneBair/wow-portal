import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  },
  arcaneTome: {
    enabled: true,
    name: "Tomeward Bound",
    itemName: "Arcane Tome of Displacement",
    itemCount: 1,
    repeatable: true
  },
  characterLevel: {
    enabled: true,
    name: "Level Up, Buttercup",
    maximumLevel: 80,
    xpWillReset: true
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
  arcaneTome?: (init?: RequestInit) => Promise<Response>;
  characterLevel?: (init?: RequestInit) => Promise<Response>;
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
    if (path === "/api/boosts/arcane-tome") {
      return options.arcaneTome?.(init) ?? Promise.resolve(jsonResponse({
        requestId,
        status: "sent",
        message: "An Arcane Tome of Displacement was sent to Thalgrim by in-game mail."
      }, 201));
    }
    if (path === "/api/boosts/character-level") {
      return options.characterLevel?.(init) ?? Promise.resolve(jsonResponse({
        requestId,
        status: "applied",
        character: { id: "77", name: "Zaria", level: 60 },
        message: "Zaria is now level 60."
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
    expect(screen.getByRole("heading", { level: 2, name: "Tomeward Bound" })).toBeTruthy();
    expect(screen.getByText("each character can own only one at a time.", { exact: false })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Level Up, Buttercup" })).toBeTruthy();
    expect(screen.getByText("This character is already at the maximum level.")).toBeTruthy();
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

  it("confirms and sends one fixed Arcane Tome, then preserves an unknown warning", async () => {
    let call = 0;
    let sentInit: RequestInit | undefined;
    renderBoosts(standardFetch({
      arcaneTome: (init) => {
        call += 1;
        sentInit = init;
        return Promise.resolve(call === 1 ? jsonResponse({
          requestId,
          status: "sent",
          message: "An Arcane Tome of Displacement was sent to Thalgrim by in-game mail."
        }, 201) : jsonResponse({
          requestId,
          status: "unknown",
          error: "Delivery could not be confirmed and may already have arrived. Check your in-game mail before sending another tome."
        }, 503));
      }
    }));
    const user = userEvent.setup();
    const send = await screen.findByRole<HTMLButtonElement>("button", { name: "Send tome" });
    await waitFor(() => expect(send.disabled).toBe(false));
    await user.click(send);
    expect(screen.getByText("Send one Arcane Tome of Displacement to Thalgrim by in-game mail?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("An Arcane Tome of Displacement was sent to Thalgrim by in-game mail.")).toBeTruthy();
    expect(JSON.parse(String(sentInit?.body))).toEqual({ requestId, characterId: "42" });

    await user.click(screen.getByRole("button", { name: "Send tome" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/Check your in-game mail before sending another tome/u)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Choose a character"), "77");
    expect(screen.getByText(requestId)).toBeTruthy();
  });

  it("shows authoritative slider bounds, resets per character, and applies a level boost", async () => {
    let levelInit: RequestInit | undefined;
    renderBoosts(standardFetch({
      characterLevel: (init) => {
        levelInit = init;
        return Promise.resolve(jsonResponse({
          requestId,
          status: "applied",
          character: { id: "77", name: "Zaria", level: 60 },
          message: "Zaria is now level 60."
        }, 201));
      }
    }));
    const user = userEvent.setup();
    const selector = await screen.findByLabelText<HTMLSelectElement>("Choose a character");
    await screen.findByRole("option", { name: /Zaria/u });
    await user.selectOptions(selector, "77");
    const slider = screen.getByLabelText<HTMLInputElement>("Target level");
    expect(slider.min).toBe("41");
    expect(slider.max).toBe("80");
    expect(slider.step).toBe("1");
    expect(slider.value).toBe("41");
    expect(screen.getByText("Your current experience progress will reset when the level changes.")).toBeTruthy();

    fireEvent.change(slider, { target: { value: "60" } });
    expect(slider.value).toBe("60");
    await user.click(screen.getByRole("button", { name: "Raise level" }));
    expect(screen.getByText("Raise Zaria from level 40 to level 60? Current experience progress will reset.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Confirm level boost" }));
    expect(await screen.findByText("Zaria is now level 60.")).toBeTruthy();
    expect(JSON.parse(String(levelInit?.body))).toEqual({ requestId, characterId: "77", targetLevel: 60 });
  });

  it("cancels level confirmation and resets target when the selected character changes", async () => {
    renderBoosts(standardFetch());
    const user = userEvent.setup();
    const selector = await screen.findByLabelText<HTMLSelectElement>("Choose a character");
    await screen.findByRole("option", { name: /Zaria/u });
    await user.selectOptions(selector, "77");
    const slider = screen.getByLabelText<HTMLInputElement>("Target level");
    fireEvent.change(slider, { target: { value: "60" } });
    await user.click(screen.getByRole("button", { name: "Raise level" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Raise level" })));
    await user.selectOptions(selector, "42");
    expect(screen.queryByLabelText("Target level")).toBeNull();
    expect(screen.getByText("This character is already at the maximum level.")).toBeTruthy();
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
        portableHoles: { ...overview.portableHoles, enabled: false },
        arcaneTome: { ...overview.arcaneTome, enabled: false },
        characterLevel: { ...overview.characterLevel, enabled: false }
      }))
    }));
    expect(await screen.findByText("This account does not have any characters yet.")).toBeTruthy();
    expect(screen.getByText("Free Money is currently disabled.")).toBeTruthy();
    expect(screen.getAllByText("This boost is currently unavailable.")).toHaveLength(3);
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
