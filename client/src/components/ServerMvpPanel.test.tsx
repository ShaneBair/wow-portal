import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBossKillLeaderboardResponse } from "../api/boss-kill-leaderboard.js";
import { StatsPage } from "../pages/StatsPage.js";
import { ServerMvpPanel } from "./ServerMvpPanel.js";

const entries = [
  { characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80, accountLogin: "SHANE", isBot: false, bossKills: 12 },
  { characterName: "Zaria", race: "Human", class: "Mage", level: 40, accountLogin: "ZED", isBot: true, bossKills: 12 },
  { characterName: "Aaron", race: "Orc", class: "Warrior", level: 30, accountLogin: "ALPHA", isBot: false, bossKills: 3 }
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function pathOf(input: RequestInfo | URL): string {
  const url = typeof input === "string" ? new URL(input, "http://portal.test")
    : input instanceof URL ? input : new URL(input.url);
  return `${url.pathname}${url.search}`;
}

function leaderboard(population: "players" | "all", overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-08-28T12:00:00.000Z",
    population,
    coverage: { firstRecordedAt: "2026-08-19T19:37:55.990Z" },
    count: entries.length,
    entries,
    ...overrides
  };
}

function renderStats(
  bossFetch: (population: "players" | "all", signal?: AbortSignal) => Promise<Response>,
  options: { path?: string; allPanels?: boolean } = {}
) {
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const requestPath = pathOf(input);
    if (requestPath.startsWith("/api/stats/boss-kills?")) {
      const population = new URL(requestPath, "http://portal.test").searchParams.get("population") as "players" | "all";
      return bossFetch(population, init?.signal ?? undefined);
    }
    if (requestPath.startsWith("/api/stats/quest-completions?")) {
      const population = new URL(requestPath, "http://portal.test").searchParams.get("population");
      return Promise.resolve(jsonResponse({
        generatedAt: "2026-08-28T12:00:00.000Z", population,
        coverage: { firstRecordedAt: null }, count: 0, entries: []
      }));
    }
    if (requestPath.startsWith("/api/stats/deaths?")) {
      const population = new URL(requestPath, "http://portal.test").searchParams.get("population");
      return Promise.resolve(jsonResponse({
        generatedAt: "2026-08-28T12:00:00.000Z", population,
        coverage: { comprehensiveSince: "2026-08-19T00:00:00.000Z" }, count: 0, entries: []
      }));
    }
    if (requestPath === "/api/status") return Promise.resolve(jsonResponse({ online: true }));
    return Promise.resolve(jsonResponse({ error: "Not found." }, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } }
  });
  const element = options.allPanels ? <StatsPage /> : <StatsPage><ServerMvpPanel /></StatsPage>;
  const router = createMemoryRouter([{ path: "/stats", element }], {
    initialEntries: [options.path ?? "/stats?population=players"]
  });
  return {
    fetchMock,
    ...render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Server MVP panel", () => {
  it("renders accessible identity, loading, and exact metric scope", async () => {
    renderStats(() => new Promise(() => undefined));
    expect(await screen.findByRole("heading", { level: 3, name: "Server MVP" })).toBeTruthy();
    expect(screen.getByText("Most boss kills")).toBeTruthy();
    expect(screen.getByText("Loading boss kill statistics...")).toBeTruthy();
    expect(screen.getByText(/Pet kills credit the owner/u)).toBeTruthy();
    expect(screen.getByText(/Spell-credit-only encounters are excluded unless independently boss-marked/u)).toBeTruthy();
    expect(screen.getByText(/killing-blow credit, not group participation/u)).toBeTruthy();
    expect(document.querySelector(".server-mvp-panel .award-icon")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders empty and unavailable states without coupling other awards", async () => {
    const empty = renderStats((population) => Promise.resolve(jsonResponse(leaderboard(population, {
      coverage: { firstRecordedAt: null }, count: 0, entries: []
    }))));
    expect(await screen.findByText("No recorded boss kills for this population yet.")).toBeTruthy();
    expect(screen.getByText("No creature-kill coverage date is available. Pet kills credit the owner.")).toBeTruthy();
    empty.unmount();

    renderStats(() => Promise.resolve(jsonResponse({ error: "Unavailable." }, 503)), { allPanels: true });
    expect(await screen.findByText("Boss kill statistics are temporarily unavailable.")).toBeTruthy();
    expect(await screen.findByText("No recorded quest completions for this population yet.")).toBeTruthy();
    expect(await screen.findByText("No recorded deaths for this population yet.")).toBeTruthy();
  });

  it("marks tied winners and keyboard sorting does not change the winner summary", async () => {
    renderStats((population) => Promise.resolve(jsonResponse(leaderboard(population))));
    const summary = (await screen.findByText(/Co-winners:/u)).closest("p")!;
    expect(summary.textContent).toContain("Thalgrim (Player)");
    expect(summary.textContent).toContain("Zaria (Bot)");
    expect(summary.textContent).toContain("12 recorded boss killing blows each");
    expect(screen.getByText(/Recorded boss killing blows from/u)).toBeTruthy();

    const characterSort = screen.getByRole("button", { name: /Sort by Character/u });
    characterSort.focus();
    await userEvent.setup().keyboard("{Enter}");
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]?.textContent).toContain("Aaron");
    expect(screen.getByText(/Co-winners:/u).closest("p")?.textContent).toContain("Thalgrim (Player)");
    expect(document.querySelector(".boss-kill-table-container")).toBeTruthy();
  });

  it("requests distinct populations and clears old results during a transition", async () => {
    let resolveAll: ((response: Response) => void) | undefined;
    const { fetchMock } = renderStats((population) => population === "players"
      ? Promise.resolve(jsonResponse(leaderboard("players", {
          count: 1, entries: [{ ...entries[0], characterName: "PlayersWinner" }]
        })))
      : new Promise((resolve) => { resolveAll = resolve; }));
    expect(await screen.findByText("PlayersWinner")).toBeTruthy();
    await userEvent.setup().click(screen.getByLabelText("Players + bots"));
    expect(screen.queryByText("PlayersWinner")).toBeNull();
    expect(screen.getByText("Loading boss kill statistics...")).toBeTruthy();
    resolveAll?.(jsonResponse(leaderboard("all", {
      count: 1, entries: [{ ...entries[1], characterName: "CombinedWinner" }]
    })));
    expect(await screen.findByText("CombinedWinner")).toBeTruthy();
    const calls = fetchMock.mock.calls.filter(([input]) => pathOf(input).startsWith("/api/stats/boss-kills?"));
    expect(pathOf(calls[0]![0])).toBe("/api/stats/boss-kills?population=players");
    expect(pathOf(calls[1]![0])).toBe("/api/stats/boss-kills?population=all");
  });

  it("rejects malformed or internally expanded public responses", () => {
    expect(() => parseBossKillLeaderboardResponse(leaderboard("players", {
      coverage: { firstRecordedAt: null }
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parseBossKillLeaderboardResponse(leaderboard("players", {
      entries: [{ ...entries[0], creatureEntry: 36597 }], count: 1
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parseBossKillLeaderboardResponse(leaderboard("players", {
      entries: [{ ...entries[0], bossKills: Number.MAX_SAFE_INTEGER + 1 }], count: 1
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parseBossKillLeaderboardResponse(leaderboard("players", {
      generatedAt: "2026-02-30T12:00:00.000Z"
    }), "players")).toThrow(/temporarily unavailable/u);
  });
});
