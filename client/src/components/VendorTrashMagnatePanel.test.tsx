import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { parseVendorTrashMagnateResponse } from "../api/vendor-trash-magnate.js";
import { StatsPage } from "../pages/StatsPage.js";
import { VendorTrashMagnatePanel } from "./VendorTrashMagnatePanel.js";

const entry = {
  characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
  accountLogin: "SHANE", copper: "123456",
  displayMoney: "12 gold, 34 silver, 56 copper"
};

function response(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-09-29T18:00:00.000Z",
    population: "all-characters",
    coverage: { kind: "azerothcore-lifetime-counter" },
    count: 1,
    entries: [entry],
    ...overrides
  };
}

function renderPanel(fetchMagnate: typeof fetch) {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>((input, init) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (path === "/api/status") {
      return Promise.resolve(new Response(JSON.stringify({ online: true }), { status: 200 }));
    }
    return fetchMagnate(input, init);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const router = createMemoryRouter(
    [{ path: "/stats", element: <StatsPage><VendorTrashMagnatePanel /></StatsPage> }],
    { initialEntries: ["/stats?population=players"] }
  );
  return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Vendor Trash Magnate panel", () => {
  it("shows lifetime scope, accessible exact money, and stays fixed across population changes", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response()), {
      status: 200, headers: { "Content-Type": "application/json" }
    })));
    renderPanel(fetchMock);
    expect(await screen.findByRole("heading", { name: "Vendor Trash Magnate" })).toBeTruthy();
    expect(await screen.findByText("Thalgrim")).toBeTruthy();
    expect(screen.getByText("All current characters.")).toBeTruthy();
    expect(screen.getByText(/cumulative vendor-sales counter/u)).toBeTruthy();
    expect(screen.getByText(/before portal event collection/u)).toBeTruthy();
    expect(screen.queryByRole("time")).toBeNull();
    expect(within(screen.getByRole("table")).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "Thalgrim", "Dwarf", "Paladin", "80", "SHANE", "12 gold, 34 silver, 56 copper"
    ]);
    await userEvent.setup().click(screen.getByRole("button", { name: /Sort by Vendor earnings/u }));
    expect(screen.getByRole("columnheader", { name: /Vendor earnings/u }).getAttribute("aria-sort"))
      .toBe("descending");
    await userEvent.setup().click(screen.getByRole("radio", { name: "Players + bots" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/stats/vendor-trash-magnate");
  });

  it("sorts counters beyond Number.MAX_SAFE_INTEGER without precision loss", async () => {
    renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response({
      count: 2,
      entries: [
        {
          ...entry,
          characterName: "Lower",
          copper: "9007199254740992",
          displayMoney: "900719925474 gold, 9 silver, 92 copper"
        },
        {
          ...entry,
          characterName: "Higher",
          copper: "9007199254740993",
          displayMoney: "900719925474 gold, 9 silver, 93 copper"
        }
      ]
    })), { status: 200 }))));
    const table = await screen.findByRole("table");
    await userEvent.setup().click(screen.getByRole("button", { name: /Sort by Vendor earnings/u }));
    expect(within(table).getAllByRole("row")[1]?.textContent).toContain("Higher");
  });

  it("renders loading, empty, unavailable, and retry states", async () => {
    const pending = renderPanel(vi.fn<typeof fetch>(() => new Promise(() => undefined)));
    expect(screen.getByText("Loading Vendor Trash Magnate statistics...")).toBeTruthy();
    pending.unmount();

    const empty = renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response({
      count: 0, entries: []
    })), { status: 200 }))));
    expect(await screen.findByText(/No current characters have recorded vendor earnings/u)).toBeTruthy();
    empty.unmount();

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response()), { status: 200 }));
    renderPanel(fetchMock);
    expect(await screen.findByText("Vendor Trash Magnate statistics are temporarily unavailable.")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Thalgrim")).toBeTruthy();
  });

  it("rejects imprecise, oversized, or mismatched public counters", () => {
    expect(() => parseVendorTrashMagnateResponse(response({
      entries: [{ ...entry, copper: 123456 }]
    }))).toThrow(/temporarily unavailable/u);
    expect(() => parseVendorTrashMagnateResponse(response({
      entries: [{ ...entry, copper: "18446744073709551616" }]
    }))).toThrow(/temporarily unavailable/u);
    expect(() => parseVendorTrashMagnateResponse(response({
      entries: [{ ...entry, displayMoney: "1234 gold" }]
    }))).toThrow(/temporarily unavailable/u);
    expect(() => parseVendorTrashMagnateResponse(response({
      population: "players"
    }))).toThrow(/temporarily unavailable/u);
  });
});
