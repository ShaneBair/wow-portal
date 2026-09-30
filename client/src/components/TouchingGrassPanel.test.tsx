import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { parseTouchingGrassResponse } from "../api/touching-grass.js";
import { StatsPage } from "../pages/StatsPage.js";
import { TouchingGrassPanel } from "./TouchingGrassPanel.js";

const entry = {
  characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
  accountLogin: "SHANE", type: "Player" as const, zonesVisited: 14, mapsVisited: 3,
  firstRecordedAt: "2026-08-02T12:00:00.000Z",
  lastRecordedAt: "2026-08-20T18:30:00.000Z"
};

function response(population: "players" | "all", overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-08-28T12:00:00.000Z",
    population,
    coverage: { firstRecordedAt: "2026-08-01T12:00:00.000Z" },
    count: 1,
    entries: [entry],
    ...overrides
  };
}

function renderPanel(fetchTouchingGrass: typeof fetch) {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>((input, init) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (path === "/api/status") {
      return Promise.resolve(new Response(JSON.stringify({ online: true }), { status: 200 }));
    }
    return fetchTouchingGrass(input, init);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const router = createMemoryRouter(
    [{ path: "/stats", element: <StatsPage><TouchingGrassPanel /></StatsPage> }],
    { initialEntries: ["/stats?population=players"] }
  );
  return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Touching Grass panel", () => {
  it("renders recorded-location copy, metadata, counts, spans, and sorting", async () => {
    renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("players")), {
      status: 200, headers: { "Content-Type": "application/json" }
    }))));
    expect(await screen.findByRole("heading", { name: "Touching Grass" })).toBeTruthy();
    expect(await screen.findByText("Thalgrim")).toBeTruthy();
    expect(screen.getByText(/zones with recorded activity/u)).toBeTruthy();
    expect(screen.getByText(/not distance traveled or the Explorer achievement/u)).toBeTruthy();
    const cells = within(screen.getByRole("table")).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "Thalgrim", "Dwarf", "Paladin", "80", "SHANE", "Player", "14", "3",
      "Aug 2, 2026 – Aug 20, 2026"
    ]);
    await userEvent.setup().click(screen.getByRole("button", { name: /Sort by Zones/u }));
    expect(screen.getByRole("columnheader", { name: /Zones/u }).getAttribute("aria-sort")).toBe("descending");
  });

  it("renders loading, empty, unavailable, and retry states", async () => {
    const pending = renderPanel(vi.fn<typeof fetch>(() => new Promise(() => undefined)));
    expect(screen.getByText("Loading Touching Grass statistics...")).toBeTruthy();
    pending.unmount();

    const empty = renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("players", {
      coverage: { firstRecordedAt: null }, count: 0, entries: []
    })), { status: 200 }))));
    expect(await screen.findByText(/No zones with recorded activity/u)).toBeTruthy();
    empty.unmount();

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response("players")), { status: 200 }));
    renderPanel(fetchMock);
    expect(await screen.findByText("Touching Grass statistics are temporarily unavailable.")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Thalgrim")).toBeTruthy();
  });

  it("rejects malformed public responses", () => {
    expect(() => parseTouchingGrassResponse(response("players", {
      entries: [{ ...entry, zonesVisited: 0 }]
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parseTouchingGrassResponse(response("players", {
      entries: [{ ...entry, firstRecordedAt: "2026-08-21T00:00:00.000Z" }]
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parseTouchingGrassResponse(response("players"), "all")).toThrow(/temporarily unavailable/u);
  });
});
