import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { parsePunchingUpResponse } from "../api/punching-up.js";
import { StatsPage } from "../pages/StatsPage.js";
import { PunchingUpPanel } from "./PunchingUpPanel.js";

const entry = {
  characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
  accountLogin: "SHANE", type: "Player" as const, actorLevelAtKill: 18,
  creatureEntry: 448, creatureName: "Hogger", creatureLevel: 23,
  levelDelta: 5, killMethod: "direct" as const, occurredAt: "2026-08-20T18:30:00.000Z"
};

function response(population: "players" | "all", overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-09-30T21:00:00.000Z",
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
    [{ path: "/stats", element: <StatsPage><PunchingUpPanel /></StatsPage> }],
    { initialEntries: [`/stats?population=${population}`] }
  );
  return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Punching Up panel", () => {
  it("renders the plain-language record, method, date, metadata, and sorting", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("players")), {
      status: 200, headers: { "Content-Type": "application/json" }
    })));
    renderPanel(fetchMock);
    expect(await screen.findByRole("heading", { name: "Punching Up" })).toBeTruthy();
    expect(screen.getByText(/killing blow does not prove the fight was solo/u)).toBeTruthy();
    const cells = within(await screen.findByRole("table")).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "Thalgrim", "Dwarf", "Paladin", "80", "SHANE", "Player",
      "Level 18 defeated Level 23 Hogger (+5)", "Direct", "Aug 20, 2026"
    ]);
    expect(screen.getAllByRole("time").some((element) =>
      element.getAttribute("datetime") === "2026-08-20T18:30:00.000Z" &&
      element.textContent === "Aug 20, 2026"
    )).toBe(true);
    await userEvent.setup().click(screen.getByRole("button", { name: /Sort by Personal record/u }));
    expect(screen.getByRole("columnheader", { name: /Personal record/u }).getAttribute("aria-sort"))
      .toBe("descending");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("population=players"))).toBe(true);
  });

  it("labels pet records and renders unknown creature fallbacks", async () => {
    renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("all", {
      entries: [{
        ...entry,
        type: "Bot",
        actorLevelAtKill: 20,
        creatureEntry: 999999,
        creatureName: "Unknown creature #999999",
        creatureLevel: 26,
        levelDelta: 6,
        killMethod: "pet",
        occurredAt: "2026-08-21T18:30:00.000Z"
      }]
    })), { status: 200 }))), "all");
    expect(await screen.findByText(/Level 20 defeated Level 26 Unknown creature #999999/)).toBeTruthy();
    expect(screen.getByText("Pet")).toBeTruthy();
    expect(screen.getByText("Bot")).toBeTruthy();
  });

  it("renders loading, empty, unavailable, and retry states", async () => {
    const pending = renderPanel(vi.fn<typeof fetch>(() => new Promise(() => undefined)));
    expect(screen.getByText("Loading Punching Up statistics...")).toBeTruthy();
    pending.unmount();

    const empty = renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("players", {
      coverage: { firstRecordedAt: null }, count: 0, entries: []
    })), { status: 200 }))));
    expect(await screen.findByText(/No qualifying higher-level creature kills/u)).toBeTruthy();
    empty.unmount();

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response("players")), { status: 200 }));
    renderPanel(fetchMock);
    expect(await screen.findByText("Punching Up statistics are temporarily unavailable.")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Thalgrim")).toBeTruthy();
  });

  it("rejects invalid levels, deltas, methods, timestamps, and populations", () => {
    expect(() => parsePunchingUpResponse(response("players", {
      entries: [{ ...entry, actorLevelAtKill: 0 }]
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parsePunchingUpResponse(response("players", {
      entries: [{ ...entry, levelDelta: 4 }]
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parsePunchingUpResponse(response("players", {
      entries: [{ ...entry, killMethod: "guardian" }]
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parsePunchingUpResponse(response("players", {
      entries: [{ ...entry, occurredAt: "2026-07-01T00:00:00.000Z" }]
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parsePunchingUpResponse(response("players"), "all"))
      .toThrow(/temporarily unavailable/u);
  });
});
