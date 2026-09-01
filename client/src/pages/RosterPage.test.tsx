import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { formatPlayedDuration } from "./RosterPage.js";

const session = { authenticated: true, account: { username: "TEST_USER" }, csrfToken: "c".repeat(43) };
const roster = {
  generatedAt: "2026-08-28T16:00:00.000Z",
  accountCount: 2,
  characterCount: 3,
  accounts: [{
    accountLogin: "SHANE",
    characters: [
      { characterName: "Eori", level: 10, class: "Rogue", race: "Human", totalPlayedSeconds: 4_321 },
      { characterName: "Thalgrim", level: 80, class: "Paladin", race: "Dwarf", totalPlayedSeconds: 1_055_040 }
    ]
  }, {
    accountLogin: "FRIEND",
    characters: [{ characterName: "Mira", level: 42, class: "Mage", race: "Gnome", totalPlayedSeconds: 42 }]
  }]
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function pathOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? new URL(input, "http://portal.test").pathname
    : input instanceof URL ? input.pathname : new URL(input.url).pathname;
}

function renderRoster(rosterResponse: () => Promise<Response>, initialPath = "/roster") {
  const fetchMock = vi.fn<typeof fetch>((input) => {
    const path = pathOf(input);
    if (path === "/api/auth/session") return Promise.resolve(jsonResponse(session));
    if (path === "/api/roster") return rosterResponse();
    return Promise.resolve(jsonResponse({ error: "Not found." }, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
  const queryClient = new QueryClient({ defaultOptions: {
    queries: { gcTime: Infinity, retry: false, refetchOnWindowFocus: false }, mutations: { retry: false }
  } });
  const router = createMemoryRouter([{ path: "*", element: <App /> }], { initialEntries: [initialPath] });
  return { fetchMock, queryClient, router, ...render(
    <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
  ) };
}

afterEach(() => vi.unstubAllGlobals());

describe("authenticated roster page", () => {
  it("renders grouped semantic tables, counts, fields, durations, title, and active navigation", async () => {
    renderRoster(() => Promise.resolve(jsonResponse(roster)));
    expect(await screen.findByRole("heading", { level: 1, name: "Roster" })).toBeTruthy();
    expect(await screen.findByText("2 accounts · 3 characters")).toBeTruthy();
    const shaneHeading = screen.getByRole("heading", { level: 2, name: "SHANE" });
    const section = shaneHeading.closest("section");
    expect(section).toBeTruthy();
    const table = within(section!).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Character", "Level", "Class", "Race", "Time played"
    ]);
    expect(within(table).getByText("Thalgrim")).toBeTruthy();
    expect(within(table).getByText("Paladin")).toBeTruthy();
    expect(within(table).getByText("Dwarf")).toBeTruthy();
    expect(within(table).getByLabelText("12 days, 5 hours, 4 minutes").textContent).toBe("12d 5h 4m");
    expect(screen.getByLabelText("42 seconds").textContent).toBe("42s");
    const navigation = screen.getByRole("navigation", { name: "Primary" });
    expect(within(navigation).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Home", "Stats", "Roster", "Boosts"
    ]);
    const rosterLink = screen.getByRole("link", { name: "Roster" });
    expect(rosterLink.getAttribute("aria-current")).toBe("page");
    expect(screen.getAllByRole("navigation", { name: "Primary" })).toHaveLength(1);
    await waitFor(() => expect(document.title).toBe("Roster | DaBoysZeroth"));
  });

  it("renders loading, empty, and unavailable states without polling", async () => {
    let resolveRoster!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveRoster = resolve; });
    const loading = renderRoster(() => pending);
    expect(await screen.findByText("Loading roster...")).toBeTruthy();
    resolveRoster(jsonResponse({ ...roster, accountCount: 0, characterCount: 0, accounts: [] }));
    expect(await screen.findByText("No player characters are on the roster yet.")).toBeTruthy();
    expect(loading.fetchMock.mock.calls.filter(([input]) => pathOf(input) === "/api/roster")).toHaveLength(1);
    loading.unmount();

    renderRoster(() => Promise.resolve(jsonResponse({ error: "raw internal detail" }, 503)));
    expect(await screen.findByText("The roster is temporarily unavailable.")).toBeTruthy();
    expect(screen.queryByText("raw internal detail")).toBeNull();
  });

  it("clears the session and returns to Login when the roster session expires", async () => {
    const { router, queryClient } = renderRoster(() => Promise.resolve(jsonResponse({ error: "Log in to continue." }, 401)));
    queryClient.setQueryData(["account-visible", "roster", "old"], roster);
    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toBe("?returnTo=%2Froster");
    expect(screen.queryByRole("link", { name: "Roster" })).toBeNull();
    expect(queryClient.getQueryData(["account-visible", "roster", "old"])).toBeUndefined();
  });

  it("rejects malformed response counts and renders database strings as text", async () => {
    const invalid = renderRoster(() => Promise.resolve(jsonResponse({ ...roster, characterCount: 99 })));
    expect(await screen.findByText("The roster is temporarily unavailable.")).toBeTruthy();
    invalid.unmount();

    const hostile = {
      generatedAt: roster.generatedAt, accountCount: 1, characterCount: 1,
      accounts: [{ accountLogin: "<i>ACCOUNT</i>", characters: [{
        characterName: "<b>Hero</b>", level: 1, class: "Warrior", race: "Human", totalPlayedSeconds: 0
      }] }]
    };
    const rendered = renderRoster(() => Promise.resolve(jsonResponse(hostile)));
    expect(await screen.findByText("<i>ACCOUNT</i>")).toBeTruthy();
    expect(screen.getByText("<b>Hero</b>")).toBeTruthy();
    expect(rendered.container.querySelector("i, b")).toBeNull();
  });
});

describe("played duration formatting", () => {
  it("formats seconds and the largest day/hour/minute units without rounding", () => {
    expect(formatPlayedDuration(0)).toEqual({ compact: "0s", full: "0 seconds" });
    expect(formatPlayedDuration(1)).toEqual({ compact: "1s", full: "1 second" });
    expect(formatPlayedDuration(59)).toEqual({ compact: "59s", full: "59 seconds" });
    expect(formatPlayedDuration(60)).toEqual({ compact: "1m", full: "1 minute" });
    expect(formatPlayedDuration(11_520)).toEqual({ compact: "3h 12m", full: "3 hours, 12 minutes" });
    expect(formatPlayedDuration(1_055_099)).toEqual({ compact: "12d 5h 4m", full: "12 days, 5 hours, 4 minutes" });
  });
});
