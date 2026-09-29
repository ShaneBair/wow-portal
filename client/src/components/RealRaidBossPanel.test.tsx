import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { parseRealRaidBossResponse } from "../api/real-raid-boss.js";
import { StatsPage } from "../pages/StatsPage.js";
import { RealRaidBossPanel } from "./RealRaidBossPanel.js";

function response(population: "players" | "all", overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-08-28T12:00:00.000Z",
    population,
    coverage: { firstRecordedAt: "2026-08-19T19:37:22.256Z" },
    entries: [{ creatureEntry: 448, creatureName: "Hogger", characterKills: 9, uniqueVictims: 3 }],
    ...overrides
  };
}

function renderPanel(fetchRaidBoss: typeof fetch) {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>((input, init) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (path === "/api/status") {
      return Promise.resolve(new Response(JSON.stringify({ online: true }), { status: 200 }));
    }
    return fetchRaidBoss(input, init);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const router = createMemoryRouter(
    [{ path: "/stats", element: <StatsPage><RealRaidBossPanel /></StatsPage> }],
    { initialEntries: ["/stats?population=players"] }
  );
  return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Real Raid Boss panel", () => {
  it("shows scope, coverage, table values, and a textual rank", async () => {
    renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("players")), {
      status: 200, headers: { "Content-Type": "application/json" }
    }))));
    expect(await screen.findByRole("heading", { name: "The Real Raid Boss" })).toBeTruthy();
    expect(await screen.findByText("Hogger")).toBeTruthy();
    expect(screen.getByText(/Only recorded creature killing blows/u)).toBeTruthy();
    expect(screen.getByText(/Recorded creature deaths since/u)).toBeTruthy();
    expect(screen.getByLabelText("Rank 1").textContent).toBe("#1");
    const cells = within(screen.getByRole("table")).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual(["#1", "Hogger", "9", "3"]);
  });

  it("renders loading, empty, unavailable, and retry states", async () => {
    const pending = renderPanel(vi.fn<typeof fetch>(() => new Promise(() => undefined)));
    expect(screen.getByText("Loading Real Raid Boss statistics...")).toBeTruthy();
    pending.unmount();

    const empty = renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("players", {
      coverage: { firstRecordedAt: null }, entries: []
    })), { status: 200 }))));
    expect(await screen.findByText(/No recorded creature killing blows/u)).toBeTruthy();
    empty.unmount();

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response("players")), { status: 200 }));
    renderPanel(fetchMock);
    expect(await screen.findByText("Real Raid Boss statistics are temporarily unavailable.")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Hogger")).toBeTruthy();
  });

  it("rejects malformed public rows", () => {
    expect(() => parseRealRaidBossResponse(response("players", {
      entries: [{ creatureEntry: 448, creatureName: "Hogger", characterKills: 2, uniqueVictims: 3 }]
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parseRealRaidBossResponse(response("players", {
      coverage: { firstRecordedAt: null }
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parseRealRaidBossResponse(response("players"), "all")).toThrow(/temporarily unavailable/u);
  });
});
