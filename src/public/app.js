const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const form = document.getElementById("registerForm");
const formMessage = document.getElementById("formMessage");
const playerCount = document.getElementById("playerCount");
const playersMessage = document.getElementById("playersMessage");
const playersTableContainer = document.getElementById("playersTableContainer");
const playersTableBody = document.getElementById("playersTableBody");
let rosterRefreshInFlight = false;

async function refreshStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();

    statusDot.classList.remove("online", "offline");

    if (data.online) {
      statusDot.classList.add("online");
      statusText.textContent = "Server online";
    } else {
      statusDot.classList.add("offline");
      statusText.textContent = "Server offline";
    }
  } catch {
    statusDot.classList.add("offline");
    statusText.textContent = "Server unavailable";
  }
}

function showRosterMessage(message, count) {
  playersTableBody.replaceChildren();
  playersTableContainer.hidden = true;
  playersMessage.hidden = false;
  playersMessage.textContent = message;

  if (typeof count === "number") {
    playerCount.hidden = false;
    playerCount.textContent = String(count);
    playerCount.setAttribute("aria-label", `${count} real players online`);
  } else {
    playerCount.hidden = true;
    playerCount.textContent = "";
    playerCount.removeAttribute("aria-label");
  }
}

function createRosterCell(label, value, className) {
  const cell = document.createElement("td");
  cell.dataset.label = label;
  cell.textContent = String(value);

  if (className) {
    cell.className = className;
  }

  return cell;
}

function showRoster(players) {
  const rows = document.createDocumentFragment();

  for (const player of players) {
    const row = document.createElement("tr");
    row.append(
      createRosterCell("Account", player.accountLogin, "account-name"),
      createRosterCell("Character", player.characterName, "character-name"),
      createRosterCell("Race", player.race),
      createRosterCell("Class", player.class),
      createRosterCell("Level", player.level, "numeric-cell"),
      createRosterCell("Location", player.location)
    );
    rows.append(row);
  }

  playersTableBody.replaceChildren(rows);
  playersMessage.hidden = true;
  playersTableContainer.hidden = false;
  playerCount.hidden = false;
  playerCount.textContent = String(players.length);
  playerCount.setAttribute("aria-label", `${players.length} real players online`);
}

async function refreshRoster() {
  if (rosterRefreshInFlight) {
    return;
  }

  rosterRefreshInFlight = true;

  try {
    const response = await fetch("/api/online-players", { cache: "no-store" });
    const data = await response.json();

    if (!response.ok || !Array.isArray(data.players)) {
      throw new Error("Online roster unavailable.");
    }

    if (data.players.length === 0) {
      showRosterMessage("No real players are online.", 0);
      return;
    }

    showRoster(data.players);
  } catch {
    showRosterMessage("The online roster is temporarily unavailable.");
  } finally {
    rosterRefreshInFlight = false;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  formMessage.className = "message";
  formMessage.textContent = "Creating account...";

  const data = Object.fromEntries(new FormData(form).entries());

  try {
    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Registration failed.");
    }

    formMessage.classList.add("success");
    formMessage.textContent = result.message;
    form.reset();
  } catch (error) {
    formMessage.classList.add("error");
    formMessage.textContent = error.message;
  }
});

refreshStatus();
refreshRoster();
setInterval(refreshStatus, 30000);
setInterval(refreshRoster, 30000);
