import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { parsePetKillResponse } from "../api/pet-kills.js";
import { StatsPage } from "../pages/StatsPage.js";
import { PetKillsPanel } from "./PetKillsPanel.js";

const entry = {
  characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
  accountLogin: "SHANE", type: "Player" as const, petKills: 7, directKills: 4,
  totalKills: 11, petKillPercent: 63.6
};

function response(population: "players" | "all", overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-09-30T20:00:00.000Z",
    population,
    coverage: { firstRecordedAt: "2026-08-01T12:00:00.000Z" },
    count: 1,
    entries: [entry],
    ...overrides
  };
}

function renderPanel(fetchLeaderboard: typeof fetch, population: "players" | "all" = "players") {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>((input, init) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (path === "/api/status") {
      return Promise.resolve(new Response(JSON.stringify({ online: true }), { status: 200 }));
    }
    return fetchLeaderboard(input, init);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const router = createMemoryRouter(
    [{ path: "/stats", element: <StatsPage><PetKillsPanel /></StatsPage> }],
    { initialEntries: [`/stats?population=${population}`] }
  );
  return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Let the Pet Cook panel", () => {
  it("renders module attribution, character metadata, accessible percentage, and sorting", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("players")), {
      status: 200, headers: { "Content-Type": "application/json" }
    })));
    renderPanel(fetchMock);
    expect(await screen.findByRole("heading", { name: "Let the Pet Cook" })).toBeTruthy();
    expect(screen.getByText(/killing blows credited to their pets/u)).toBeTruthy();
    expect(screen.getByText(/does not measure pet damage or assists/u)).toBeTruthy();
    const cells = within(await screen.findByRole("table")).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "Thalgrim", "Dwarf", "Paladin", "80", "SHANE", "Player", "7", "4", "63.6%"
    ]);
    await userEvent.setup().click(screen.getByRole("button", { name: /Sort by Pet share/u }));
    expect(screen.getByRole("columnheader", { name: /Pet share/u }).getAttribute("aria-sort"))
      .toBe("descending");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("population=players"))).toBe(true);
  });

  it("shows 100.0% for pet-only kills and separates Player and Bot rows", async () => {
    renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("all", {
      count: 2,
      entries: [
        { ...entry, petKills: 1, directKills: 0, totalKills: 1, petKillPercent: 100 },
        {
          ...entry, type: "Bot", petKills: 2, directKills: 1,
          totalKills: 3, petKillPercent: 66.7
        }
      ]
    })), { status: 200 }))), "all");
    expect(await screen.findByText("100.0%")).toBeTruthy();
    expect(screen.getByText("66.7%")).toBeTruthy();
    expect(screen.getByText("Player")).toBeTruthy();
    expect(screen.getByText("Bot")).toBeTruthy();
  });

  it("renders loading, empty, unavailable, and retry states", async () => {
    const pending = renderPanel(vi.fn<typeof fetch>(() => new Promise(() => undefined)));
    expect(screen.getByText("Loading pet kill statistics...")).toBeTruthy();
    pending.unmount();

    const empty = renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("players", {
      coverage: { firstRecordedAt: null }, count: 0, entries: []
    })), { status: 200 }))));
    expect(await screen.findByText(/No recorded pet killing blows/u)).toBeTruthy();
    empty.unmount();

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response("players")), { status: 200 }));
    renderPanel(fetchMock);
    expect(await screen.findByText("Pet kill statistics are temporarily unavailable.")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Thalgrim")).toBeTruthy();
  });

  it("rejects inconsistent totals, percentages, and population", () => {
    expect(() => parsePetKillResponse(response("players", {
      entries: [{ ...entry, totalKills: 12 }]
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parsePetKillResponse(response("players", {
      entries: [{ ...entry, petKillPercent: 63.7 }]
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parsePetKillResponse(response("players", {
      entries: [{ ...entry, petKills: 0, directKills: 11, petKillPercent: 0 }]
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parsePetKillResponse(response("players"), "all"))
      .toThrow(/temporarily unavailable/u);
  });
});
