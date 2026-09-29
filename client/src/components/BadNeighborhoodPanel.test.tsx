import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { StatsPage } from "../pages/StatsPage.js";
import { parseBadNeighborhoodResponse } from "../api/bad-neighborhood.js";
import { BadNeighborhoodPanel } from "./BadNeighborhoodPanel.js";

function response(population: "players" | "all", overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-08-28T12:00:00.000Z",
    population,
    coverage: { comprehensiveSince: "2026-08-25T14:30:00.000Z" },
    omittedUnknownZoneDeaths: 2,
    entries: [{ zoneId: 12, zoneName: "Elwynn Forest", deaths: 9, uniqueVictims: 3 }],
    ...overrides
  };
}

function renderPanel(fetchImpl: typeof fetch) {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>((input, init) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (path === "/api/status") {
      return Promise.resolve(new Response(JSON.stringify({ online: true }), { status: 200 }));
    }
    return fetchImpl(input, init);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const router = createMemoryRouter(
    [{ path: "/stats", element: <StatsPage><BadNeighborhoodPanel /></StatsPage> }],
    { initialEntries: ["/stats?population=players"] }
  );
  return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe("Bad Neighborhood panel", () => {
  it("shows coverage, ranking, and omitted unknown locations", async () => {
    renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("players")), {
      status: 200, headers: { "Content-Type": "application/json" }
    }))));
    expect(await screen.findByRole("heading", { name: "Bad Neighborhood" })).toBeTruthy();
    expect(await screen.findByText("Elwynn Forest")).toBeTruthy();
    expect(screen.getByText(/Complete locations since/u)).toBeTruthy();
    expect(screen.getByText(/2 recorded deaths have no known zone/u)).toBeTruthy();
    const cells = within(screen.getByRole("table")).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual(["Elwynn Forest", "9", "3"]);
  });

  it("renders loading, empty, unavailable, and retry states", async () => {
    const pending = renderPanel(vi.fn<typeof fetch>(() => new Promise(() => undefined)));
    expect(screen.getByText("Loading Bad Neighborhood statistics...")).toBeTruthy();
    pending.unmount();

    const empty = renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("players", {
      omittedUnknownZoneDeaths: 0, entries: []
    })), { status: 200 }))));
    expect(await screen.findByText(/No recorded deaths with known locations/u)).toBeTruthy();
    empty.unmount();

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response("players")), { status: 200 }));
    renderPanel(fetchMock);
    expect(await screen.findByText("Bad Neighborhood statistics are temporarily unavailable.")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Elwynn Forest")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed public responses", () => {
    expect(() => parseBadNeighborhoodResponse(response("players", {
      entries: [{ zoneId: 12, zoneName: "Elwynn Forest", deaths: 2, uniqueVictims: 3 }]
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parseBadNeighborhoodResponse(response("players", {
      coverage: { comprehensiveSince: "not-a-date" }
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parseBadNeighborhoodResponse(response("players"), "all")).toThrow(/temporarily unavailable/u);
  });
});
