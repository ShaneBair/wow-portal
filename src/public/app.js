const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const form = document.getElementById("registerForm");
const formMessage = document.getElementById("formMessage");

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
setInterval(refreshStatus, 30000);
