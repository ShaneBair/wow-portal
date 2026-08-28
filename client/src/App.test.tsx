import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

const emptyRoster = {
  generatedAt: "2026-08-24T12:00:00.000Z",
  count: 0,
  players: []
};

const populatedRoster = {
  generatedAt: "2026-08-24T12:00:00.000Z",
  count: 1,
  players: [{
    accountLogin: "SHANE",
    characterName: "Thalgrim",
    race: "Dwarf",
    class: "Paladin",
    level: 42,
    location: "Stranglethorn Vale"
  }]
};

const emptyDeaths = {
  generatedAt: "2026-08-24T16:00:00.000Z",
  population: "players",
  coverage: {
    comprehensiveSince: "2026-08-25T14:30:00.000Z"
  },
  count: 0,
  entries: []
};

const emptyQuestCompletions = {
  generatedAt: "2026-08-24T16:00:00.000Z",
  population: "players",
  coverage: { firstRecordedAt: null },
  count: 0,
  entries: []
};

const emptyBossKills = {
  generatedAt: "2026-08-24T16:00:00.000Z",
  population: "players",
  coverage: { firstRecordedAt: null },
  count: 0,
  entries: []
};

const anonymousSession = { authenticated: false };

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.pathname;
  }

  return new URL(input.url).pathname;
}

function installFetchMock(options: {
  status?: () => Promise<Response>;
  roster?: () => Promise<Response>;
  deaths?: () => Promise<Response>;
  session?: () => Promise<Response>;
  login?: () => Promise<Response>;
  logout?: () => Promise<Response>;
  registration?: () => Promise<Response>;
} = {}): FetchMock {
  const fetchMock = vi.fn<typeof fetch>((input) => {
    const path = requestPath(input);

    if (path === "/api/status") {
      return options.status?.() ?? Promise.resolve(jsonResponse({ online: true }));
    }

    if (path === "/api/online-players") {
      return options.roster?.() ?? Promise.resolve(jsonResponse(emptyRoster));
    }

    if (path.startsWith("/api/stats/deaths?")) {
      return options.deaths?.() ?? Promise.resolve(jsonResponse(emptyDeaths));
    }

    if (path.startsWith("/api/stats/quest-completions?")) {
      return Promise.resolve(jsonResponse(emptyQuestCompletions));
    }

    if (path.startsWith("/api/stats/boss-kills?")) {
      return Promise.resolve(jsonResponse(emptyBossKills));
    }

    if (path === "/api/auth/session") {
      return options.session?.() ?? Promise.resolve(jsonResponse(anonymousSession));
    }

    if (path === "/api/auth/login") {
      return options.login?.() ?? Promise.resolve(jsonResponse({
        error: "The account name or password is incorrect."
      }, 401));
    }

    if (path === "/api/auth/logout") {
      return options.logout?.() ?? Promise.resolve(new Response(null, { status: 204 }));
    }

    if (path === "/api/register") {
      return options.registration?.() ?? Promise.resolve(jsonResponse({
        message: "Account created! You can now log into DaBoysZeroth."
      }, 201));
    }

    return Promise.resolve(jsonResponse({ error: "Not found." }, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderRoute(path = "/") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        refetchOnWindowFocus: false,
        retry: false
      },
      mutations: { retry: false }
    }
  });
  const router = createMemoryRouter(
    [{ path: "*", element: <App /> }],
    { initialEntries: [path] }
  );

  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  return { ...result, router };
}

function expectCurrentNavigationLink(name: "Home" | "Stats" | "Boosts") {
  const navigation = screen.getByRole("navigation", { name: "Primary" });
  const links = within(navigation).getAllByRole("link");
  const currentLinks = links.filter((link) => link.getAttribute("aria-current") === "page");

  expect(links.map((link) => ({ name: link.textContent, href: link.getAttribute("href") }))).toEqual([
    { name: "Home", href: "/" },
    { name: "Stats", href: "/stats" },
    { name: "Boosts", href: "/boosts" }
  ]);
  expect(currentLinks).toHaveLength(1);
  expect(currentLinks[0]?.textContent).toBe(name);
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  });
}

describe("application routes", () => {
  it("renders the Home route with one page heading and its title", async () => {
    installFetchMock();
    renderRoute();

    expect(screen.getByRole("heading", { level: 1, name: "DaBoysZeroth" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expectCurrentNavigationLink("Home");
    await waitFor(() => expect(document.title).toBe("DaBoysZeroth"));
  });

  it("renders the Stats controls route with one page heading and its title", async () => {
    const fetchMock = installFetchMock();
    renderRoute("/stats");

    expect(screen.getByRole("heading", { level: 1, name: "Stats" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Show" })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Players only" }).checked).toBe(true);
    expect(screen.getByRole("heading", { level: 2, name: "Most Deaths" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expectCurrentNavigationLink("Stats");
    await waitFor(() => expect(document.title).toBe("Stats | DaBoysZeroth"));
    await screen.findByText("No recorded deaths for this population yet.");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("keeps Stats current when query parameters are present", async () => {
    const fetchMock = installFetchMock();
    renderRoute("/stats?population=bots");

    expectCurrentNavigationLink("Stats");
    await screen.findByText("No recorded deaths for this population yet.");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("navigates through links and browser history with matching titles and active states", async () => {
    const fetchMock = installFetchMock();
    const user = userEvent.setup();
    const { router } = renderRoute();
    await screen.findByText("Server online");
    await screen.findByText("No real players are online.");
    const homeRequestCount = fetchMock.mock.calls.length;

    await user.click(screen.getByRole("link", { name: "Stats" }));
    expect(screen.getByRole("heading", { level: 1, name: "Stats" })).toBeTruthy();
    expectCurrentNavigationLink("Stats");
    await waitFor(() => expect(document.title).toBe("Stats | DaBoysZeroth"));
    await screen.findByText("No recorded deaths for this population yet.");
    expect(fetchMock).toHaveBeenCalledTimes(homeRequestCount + 4);

    await act(async () => {
      await router.navigate(-1);
    });
    expect(screen.getByRole("heading", { level: 1, name: "DaBoysZeroth" })).toBeTruthy();
    expectCurrentNavigationLink("Home");
    await waitFor(() => expect(document.title).toBe("DaBoysZeroth"));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(homeRequestCount));
    const requestCountBeforeForward = fetchMock.mock.calls.length;

    await act(async () => {
      await router.navigate(1);
    });
    expect(screen.getByRole("heading", { level: 1, name: "Stats" })).toBeTruthy();
    expectCurrentNavigationLink("Stats");
    await waitFor(() => expect(document.title).toBe("Stats | DaBoysZeroth"));
    expect(fetchMock).toHaveBeenCalledTimes(requestCountBeforeForward + 1);
  });

  it("renders a client-side not-found page for an unmatched route", async () => {
    const fetchMock = installFetchMock();
    renderRoute("/not-a-page");

    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Return home" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    expect(screen.queryAllByRole("link", { current: "page" })).toHaveLength(0);
    await waitFor(() => expect(document.title).toBe("Page Not Found | DaBoysZeroth"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not render or initialize the Stats population filter on Home", () => {
    installFetchMock();
    renderRoute();

    expect(screen.queryByRole("group", { name: "Show" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Players only" })).toBeNull();
  });
});

describe("server status", () => {
  it("shows the loading state", () => {
    const status = createDeferred<Response>();
    const roster = createDeferred<Response>();
    installFetchMock({ status: () => status.promise, roster: () => roster.promise });
    renderRoute();

    expect(screen.getByText("Checking server...")).toBeTruthy();
  });

  it.each([
    { name: "online", body: { online: true }, status: 200, message: "Server online" },
    { name: "offline", body: { online: false }, status: 503, message: "Server offline" }
  ])("shows the $name state", async ({ body, status, message }) => {
    installFetchMock({ status: () => Promise.resolve(jsonResponse(body, status)) });
    renderRoute();

    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("shows unavailable for an invalid status response", async () => {
    installFetchMock({ status: () => Promise.resolve(jsonResponse({ online: "maybe" })) });
    renderRoute();

    expect(await screen.findByText("Server unavailable")).toBeTruthy();
  });
});

describe("online roster", () => {
  it("shows the loading state", () => {
    const status = createDeferred<Response>();
    const roster = createDeferred<Response>();
    installFetchMock({ status: () => status.promise, roster: () => roster.promise });
    renderRoute();

    expect(screen.getByText("Checking who is online...")).toBeTruthy();
  });

  it("shows a populated roster", async () => {
    installFetchMock({ roster: () => Promise.resolve(jsonResponse(populatedRoster)) });
    renderRoute();

    expect(await screen.findByRole("cell", { name: "Thalgrim" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Stranglethorn Vale" })).toBeTruthy();
    expect(screen.getByLabelText("1 real players online").textContent).toBe("1");
  });

  it("shows an empty roster", async () => {
    installFetchMock();
    renderRoute();

    expect(await screen.findByText("No real players are online.")).toBeTruthy();
    expect(screen.getByLabelText("0 real players online").textContent).toBe("0");
  });

  it("shows unavailable when the roster request fails", async () => {
    installFetchMock({ roster: () => Promise.resolve(jsonResponse({ error: "Unavailable" }, 503)) });
    renderRoute();

    expect(await screen.findByText("The online roster is temporarily unavailable.")).toBeTruthy();
  });

  it("renders API-derived strings as text rather than HTML", async () => {
    const maliciousName = "<img src=x onerror=alert(1)>";
    installFetchMock({
      roster: () => Promise.resolve(jsonResponse({
        ...populatedRoster,
        players: [{ ...populatedRoster.players[0], characterName: maliciousName }]
      }))
    });
    renderRoute();

    expect(await screen.findByText(maliciousName)).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("registration", () => {
  async function fillRegistrationForm() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Username"), "NewPlayer");
    await user.type(screen.getByLabelText("Email"), "player@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "password123");
    await user.type(screen.getByLabelText("Invite code"), "friends-only");
    return user;
  }

  it("submits typed data, reports success, and resets the form", async () => {
    const fetchMock = installFetchMock();
    renderRoute();
    const user = await fillRegistrationForm();

    await user.click(screen.getByRole("button", { name: "Create Game Account" }));

    expect(await screen.findByText("Account created! You can now log into DaBoysZeroth.")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Username").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("Email").value).toBe("");

    const registrationCall = fetchMock.mock.calls.find(([input]) => requestPath(input) === "/api/register");
    expect(registrationCall).toBeDefined();
    expect(JSON.parse(String(registrationCall?.[1]?.body))).toEqual({
      username: "NewPlayer",
      email: "player@example.com",
      password: "password123",
      confirmPassword: "password123",
      inviteCode: "friends-only"
    });
  });

  it("shows a public validation error and preserves useful input", async () => {
    installFetchMock({
      registration: () => Promise.resolve(jsonResponse({ error: "Passwords do not match." }, 400))
    });
    renderRoute();
    const user = await fillRegistrationForm();

    await user.click(screen.getByRole("button", { name: "Create Game Account" }));

    expect(await screen.findByText("Passwords do not match.")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Username").value).toBe("NewPlayer");
    expect(screen.getByLabelText<HTMLInputElement>("Email").value).toBe("player@example.com");
  });
});

describe("polling", () => {
  it("refreshes status and roster after 30 seconds without overlapping in-flight requests", async () => {
    vi.useFakeTimers();
    const secondStatus = createDeferred<Response>();
    const secondRoster = createDeferred<Response>();
    let statusRequests = 0;
    let rosterRequests = 0;

    installFetchMock({
      status: () => {
        statusRequests += 1;
        return statusRequests === 1
          ? Promise.resolve(jsonResponse({ online: true }))
          : secondStatus.promise;
      },
      roster: () => {
        rosterRequests += 1;
        return rosterRequests === 1
          ? Promise.resolve(jsonResponse(emptyRoster))
          : secondRoster.promise;
      }
    });
    renderRoute();
    await flushMicrotasks();

    expect(statusRequests).toBe(1);
    expect(rosterRequests).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(statusRequests).toBe(2);
    expect(rosterRequests).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(statusRequests).toBe(2);
    expect(rosterRequests).toBe(2);

    secondStatus.resolve(jsonResponse({ online: true }));
    secondRoster.resolve(jsonResponse(emptyRoster));
    await flushMicrotasks();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(statusRequests).toBe(3);
    expect(rosterRequests).toBe(3);
  });
});
