type SoapResult = {
  ok: boolean;
  output: string;
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function getSoapConfig() {
  const url = process.env.ACORE_SOAP_URL;
  const username = process.env.ACORE_SOAP_USER;
  const password = process.env.ACORE_SOAP_PASSWORD;

  if (!url || !username || !password) {
    throw new Error("AzerothCore SOAP environment variables are not configured.");
  }

  return { url, username, password };
}

export async function executeAzerothCoreCommand(command: string): Promise<SoapResult> {
  const { url, username, password } = getSoapConfig();

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope
  xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ns1="urn:AC">
  <SOAP-ENV:Body>
    <ns1:executeCommand>
      <command>${escapeXml(command)}</command>
    </ns1:executeCommand>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  const authorization = Buffer.from(`${username}:${password}`).toString("base64");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${authorization}`,
      "Content-Type": "text/xml; charset=utf-8",
      "SOAPAction": "urn:AC#executeCommand"
    },
    body: envelope,
    signal: AbortSignal.timeout(8000)
  });

  const body = await response.text();

  if (!response.ok || body.includes("<SOAP-ENV:Fault>") || body.includes("<SOAP:Fault>")) {
    return { ok: false, output: body };
  }

  return { ok: true, output: body };
}

export async function createAccount(
  username: string,
  password: string,
  email: string
): Promise<SoapResult> {
  return executeAzerothCoreCommand(`account create ${username} ${password} ${email}`);
}

export async function getServerInfo(): Promise<SoapResult> {
  return executeAzerothCoreCommand("server info");
}
