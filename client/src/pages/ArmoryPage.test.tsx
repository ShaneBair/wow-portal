import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";

const session = { authenticated: true, account: { username: "TEST_USER" }, csrfToken: "c".repeat(43) };
const summaries = [{ id: "42", name: "Kneecappin", level: 19, race: "Night Elf", class: "Hunter" }];
const item = {
  entry: 16846, name: "Giantstalker's Helmet", quality: 4, qualityName: "Epic", itemLevel: 66,
  requiredLevel: 60, inventoryType: "Head", bonding: "Binds when picked up", armor: 343, block: 0,
  stats: [{ name: "Agility", value: 23 }], sockets: ["Red"], resistances: [],
  durability: { current: 80, maximum: 85 }
};
const scalingItem = {
  ...item,
  entry: 44096,
  name: "Battleworn Thrash Blade",
  inventoryType: "One-Hand",
  stats: [],
  sockets: [],
  damageScalesWithLevel: true
};
const character = {
  ...summaries[0], generatedAt: "2026-10-13T16:00:00.000Z",
  equipment: Array.from({ length: 19 }, (_, slot) => ({
    slot,
    name: ["Head", "Neck", "Shoulders", "Shirt", "Chest", "Waist", "Legs", "Feet", "Wrists", "Hands",
      "Finger 1", "Finger 2", "Trinket 1", "Trinket 2", "Back", "Main hand", "Off hand", "Ranged", "Tabard"][slot],
    item: slot === 0 ? item : slot === 15 ? scalingItem : null
  })),
  talentLoadouts: [{ index: 0, name: "Talents", active: true, points: 1, trees: [{
    name: "Beast Mastery", points: 1, talents: [{
      spellId: 19552, name: "Improved Aspect of the Monkey", rank: 1, maximumRank: 3, tier: 0, column: 0
    }]
  }] }]
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function pathOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? new URL(input, "http://portal.test").pathname
    : input instanceof URL ? input.pathname : new URL(input.url).pathname;
}
function renderArmory(initialPath = "/armory/42", detailResponse: () => Promise<Response> =
  () => Promise.resolve(jsonResponse({ character }))) {
  const fetchMock = vi.fn<typeof fetch>((input) => {
    const path = pathOf(input);
    if (path === "/api/auth/session") return Promise.resolve(jsonResponse(session));
    if (path === "/api/armory") return Promise.resolve(jsonResponse({ characters: summaries }));
    if (path === "/api/armory/42") return detailResponse();
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

describe("authenticated armory page", () => {
  it("renders character gear, local tooltip, tap dialog, talents, links, title, and navigation", async () => {
    const user = userEvent.setup();
    renderArmory();
    expect(await screen.findByRole("heading", { level: 2, name: "Kneecappin" })).toBeTruthy();
    expect(screen.getByText("Night Elf Hunter")).toBeTruthy();
    expect(screen.getAllByText("Giantstalker's Helmet").length).toBeGreaterThan(0);
    const itemButton = screen.getByRole("button", { name: /Giantstalker's Helmet/u });
    expect(itemButton.getAttribute("aria-describedby")).toBeTruthy();
    await user.click(itemButton);
    const dialog = screen.getByRole("dialog", { name: "Giantstalker's Helmet" });
    expect(within(dialog).getByText("+23 Agility")).toBeTruthy();
    expect(within(dialog).getByText("Durability 80 / 85")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Open on Wowhead" }).getAttribute("href"))
      .toBe("https://www.wowhead.com/wotlk/item=16846");
    expect(screen.getByText("Improved Aspect of the Monkey")).toBeTruthy();
    expect(screen.getAllByText("Damage scales with character level").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Improved Aspect of the Monkey" }).getAttribute("href"))
      .toBe("https://www.wowhead.com/wotlk/spell=19552");
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Armory" }).getAttribute("aria-current")).toBe("page");
    await waitFor(() => expect(document.title).toBe("Kneecappin | Armory | DaBoysZeroth"));
  });

  it("navigates from the picker and handles not-found and malformed responses safely", async () => {
    const user = userEvent.setup();
    const picker = renderArmory("/armory");
    const select = await screen.findByRole("combobox", { name: "Choose a character" });
    await screen.findByRole("option", { name: "Kneecappin — Level 19 Hunter" });
    await user.selectOptions(select, "42");
    await waitFor(() => expect(picker.router.state.location.pathname).toBe("/armory/42"));
    expect(await screen.findByText("Latest saved server state")).toBeTruthy();
    picker.unmount();

    renderArmory("/armory/42", () => Promise.resolve(jsonResponse({ error: "missing" }, 404)));
    expect(await screen.findByText("That character is not available in the armory.")).toBeTruthy();
  });

  it("clears an expired session and rejects malformed detail payloads", async () => {
    const expired = renderArmory("/armory/42", () => Promise.resolve(jsonResponse({ error: "Log in to continue." }, 401)));
    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeTruthy();
    expect(expired.router.state.location.pathname).toBe("/login");
    expect(expired.router.state.location.search).toBe("?returnTo=%2Farmory");
    expired.unmount();

    renderArmory("/armory/42", () => Promise.resolve(jsonResponse({ character: { ...character, equipment: [] } })));
    expect(await screen.findByText("The armory is temporarily unavailable.")).toBeTruthy();
  });
});
