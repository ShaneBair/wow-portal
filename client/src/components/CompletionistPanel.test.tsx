import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseQuestCompletionLeaderboardResponse } from "../api/quest-completion-leaderboard.js";
import { StatsPage } from "../pages/StatsPage.js";
import { CompletionistPanel } from "./CompletionistPanel.js";

const entries = [
  { characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80, accountLogin: "SHANE", isBot: false, questCompletions: 84 },
  { characterName: "Zaria", race: "Human", class: "Mage", level: 40, accountLogin: "ZED", isBot: true, questCompletions: 84 },
  { characterName: "Aaron", race: "Orc", class: "Warrior", level: 30, accountLogin: "ALPHA", isBot: false, questCompletions: 10 }
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
  questFetch: (population: "players" | "all", signal?: AbortSignal) => Promise<Response>,
  path = "/stats?population=players"
) {
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const requestPath = pathOf(input);
    if (requestPath.startsWith("/api/stats/quest-completions?")) {
      const population = new URL(requestPath, "http://portal.test").searchParams.get("population") as "players" | "all";
      return questFetch(population, init?.signal ?? undefined);
    }
    if (requestPath === "/api/status") return Promise.resolve(jsonResponse({ online: true }));
    return Promise.resolve(jsonResponse({ error: "Not found." }, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const router = createMemoryRouter(
    [{ path: "/stats", element: <StatsPage><CompletionistPanel /></StatsPage> }],
    { initialEntries: [path] }
  );
  return {
    fetchMock,
    router,
    ...render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Completionist panel", () => {
  it("renders accessible title, subtitle, loading, and repeatable scope copy", async () => {
    renderStats(() => new Promise(() => undefined));
    expect(await screen.findByRole("heading", { level: 3, name: "Completionist" })).toBeTruthy();
    expect(screen.getByText("Most quests completed")).toBeTruthy();
    expect(screen.getByText("Loading quest completion statistics...")).toBeTruthy();
    expect(screen.getByText(/Repeatable quests count each time/u)).toBeTruthy();
    expect(screen.getByText("📜").getAttribute("aria-hidden")).toBe("true");
  });

  it("renders valid empty and unavailable states", async () => {
    const empty = renderStats((population) => Promise.resolve(jsonResponse(leaderboard(population, {
      coverage: { firstRecordedAt: null }, count: 0, entries: []
    }))));
    expect(await screen.findByText("No recorded quest completions for this population yet.")).toBeTruthy();
    empty.unmount();

    renderStats(() => Promise.resolve(jsonResponse({ error: "Unavailable." }, 503)));
    expect(await screen.findByText("Quest completion statistics are temporarily unavailable.")).toBeTruthy();
  });

  it("marks all tied winners and keeps the server winner after client sorting", async () => {
    renderStats((population) => Promise.resolve(jsonResponse(leaderboard(population))));
    const summary = (await screen.findByText(/Co-winners:/u)).closest("p")!;
    expect(summary.textContent).toContain("Thalgrim (Player)");
    expect(summary.textContent).toContain("Zaria (Bot)");
    expect(summary.textContent).toContain("84 recorded quest completions each");
    expect(screen.getByText(/Recorded quest completions from/u)).toBeTruthy();

    await userEvent.setup().click(screen.getByRole("button", { name: /Sort by Character/u }));
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]?.textContent).toContain("Aaron");
    expect(screen.getByText(/Co-winners:/u).closest("p")?.textContent).toContain("Thalgrim (Player)");
  });

  it("requests distinct populations and never keeps old rows under the new filter", async () => {
    let resolveAll: ((response: Response) => void) | undefined;
    const { fetchMock } = renderStats((population) => population === "players"
      ? Promise.resolve(jsonResponse(leaderboard("players", {
          count: 1,
          entries: [{ ...entries[0], characterName: "PlayersWinner" }]
        })))
      : new Promise((resolve) => { resolveAll = resolve; }));
    expect(await screen.findByText("PlayersWinner")).toBeTruthy();
    await userEvent.setup().click(screen.getByLabelText("Players + bots"));
    expect(screen.queryByText("PlayersWinner")).toBeNull();
    expect(screen.getByText("Loading quest completion statistics...")).toBeTruthy();
    resolveAll?.(jsonResponse(leaderboard("all", {
      count: 1,
      entries: [{ ...entries[1], characterName: "CombinedWinner" }]
    })));
    expect(await screen.findByText("CombinedWinner")).toBeTruthy();
    const questCalls = fetchMock.mock.calls.filter(([input]) => pathOf(input).startsWith("/api/stats/quest-completions?"));
    expect(pathOf(questCalls[0]![0])).toBe("/api/stats/quest-completions?population=players");
    expect(pathOf(questCalls[1]![0])).toBe("/api/stats/quest-completions?population=all");
  });

  it("rejects malformed public responses", () => {
    expect(() => parseQuestCompletionLeaderboardResponse(leaderboard("players", {
      coverage: { firstRecordedAt: null }
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parseQuestCompletionLeaderboardResponse(leaderboard("players", {
      entries: [{ ...entries[0], characterGuid: 42 }], count: 1
    }), "all")).toThrow(/temporarily unavailable/u);
    expect(() => parseQuestCompletionLeaderboardResponse(leaderboard("players", {
      entries: [{ ...entries[0], questCompletions: Number.MAX_SAFE_INTEGER + 1 }], count: 1
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parseQuestCompletionLeaderboardResponse(leaderboard("players", {
      generatedAt: "2026-02-30T12:00:00.000Z"
    }), "players")).toThrow(/temporarily unavailable/u);
  });
});
