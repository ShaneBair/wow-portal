import { XMLParser, XMLValidator } from "fast-xml-parser";

export type SoapResult = {
  ok: boolean;
  output: string;
};

const soapParser = new XMLParser({
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
  processEntities: true
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeEscapedLineEndings(value: string): string {
  return value
    .replace(/&#(?:x0*d|0*13);/giu, "\r")
    .replace(/&#(?:x0*a|0*10);/giu, "\n");
}

export function parseSoapExecuteCommandResponse(xml: string): string {
  const validationResult = XMLValidator.validate(xml);

  if (validationResult !== true) {
    throw new Error("AzerothCore returned malformed SOAP XML.");
  }

  const document: unknown = soapParser.parse(xml);

  if (!isRecord(document) || !isRecord(document.Envelope) || !isRecord(document.Envelope.Body)) {
    throw new Error("AzerothCore returned an invalid SOAP envelope.");
  }

  const body = document.Envelope.Body;

  if (body.Fault !== undefined) {
    throw new Error("AzerothCore returned a SOAP fault.");
  }

  const commandResponse = body.executeCommandResponse;

  if (!isRecord(commandResponse)) {
    throw new Error("AzerothCore SOAP response did not contain a command result.");
  }

  const output = commandResponse.return ?? commandResponse.result;

  if (typeof output !== "string") {
    throw new Error("AzerothCore SOAP command result was not text.");
  }

  // AzerothCore's SOAP layer can encode command line endings twice, leaving
  // strings such as "&#xD;" after the XML parser performs its first decode.
  return decodeEscapedLineEndings(output);
}

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

  if (!response.ok) {
    return { ok: false, output: "" };
  }

  try {
    return { ok: true, output: parseSoapExecuteCommandResponse(body) };
  } catch {
    return { ok: false, output: "" };
  }
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
