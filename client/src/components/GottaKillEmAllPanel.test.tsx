import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { parseGottaKillEmAllResponse } from "../api/gotta-kill-em-all.js";
import { StatsPage } from "../pages/StatsPage.js";
import { GottaKillEmAllPanel } from "./GottaKillEmAllPanel.js";

const entry = {
  characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
  accountName: "SHANE", type: "Player" as const, uniqueCreatures: 2, totalKills: 7
};

function response(population: "players" | "all", overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-09-30T12:00:00.000Z",
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
    [{ path: "/stats", element: <StatsPage><GottaKillEmAllPanel /></StatsPage> }],
    { initialEntries: [`/stats?population=${population}`] }
  );
  return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Gotta Kill 'Em All panel", () => {
  it("renders the metric definition, character metadata, counts, and sorting", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("players")), {
      status: 200, headers: { "Content-Type": "application/json" }
    })));
    renderPanel(fetchMock);
    expect(await screen.findByRole("heading", { name: "Gotta Kill ’Em All" })).toBeTruthy();
    expect(screen.getByText(/creature template, not an individual spawned creature/u)).toBeTruthy();
    const cells = within(await screen.findByRole("table")).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "Thalgrim", "Dwarf", "Paladin", "80", "SHANE", "Player", "2", "7"
    ]);
    await userEvent.setup().click(screen.getByRole("button", { name: /Sort by Creature types/u }));
    expect(screen.getByRole("columnheader", { name: /Creature types/u }).getAttribute("aria-sort"))
      .toBe("descending");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("population=players"))).toBe(true);
  });

  it("keeps same-character Player and Bot histories visibly separate in All", async () => {
    renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("all", {
      count: 2,
      entries: [entry, { ...entry, type: "Bot", uniqueCreatures: 1, totalKills: 3 }]
    })), { status: 200 })) as ReturnType<typeof fetch>), "all");
    expect((await screen.findAllByText("Thalgrim")).length).toBe(2);
    expect(screen.getByText("Player")).toBeTruthy();
    expect(screen.getByText("Bot")).toBeTruthy();
  });

  it("renders loading, empty, unavailable, and retry states", async () => {
    const pending = renderPanel(vi.fn<typeof fetch>(() => new Promise(() => undefined)));
    expect(screen.getByText("Loading creature variety statistics...")).toBeTruthy();
    pending.unmount();

    const empty = renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("players", {
      coverage: { firstRecordedAt: null }, count: 0, entries: []
    })), { status: 200 }))));
    expect(await screen.findByText(/No recorded creature kills/u)).toBeTruthy();
    empty.unmount();

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response("players")), { status: 200 }));
    renderPanel(fetchMock);
    expect(await screen.findByText("Creature variety statistics are temporarily unavailable.")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Thalgrim")).toBeTruthy();
  });

  it("rejects malformed public responses", () => {
    expect(() => parseGottaKillEmAllResponse(response("players", {
      entries: [{ ...entry, uniqueCreatures: 8, totalKills: 7 }]
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parseGottaKillEmAllResponse(response("players", {
      entries: [{ ...entry, accountName: "shane" }]
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parseGottaKillEmAllResponse(response("players"), "all"))
      .toThrow(/temporarily unavailable/u);
  });
});
