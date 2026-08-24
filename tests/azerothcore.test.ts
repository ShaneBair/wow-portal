import assert from "node:assert/strict";
import test from "node:test";
import { parseSoapExecuteCommandResponse } from "../src/services/azerothcore.js";

test("extracts command text and decodes XML entities", () => {
  const xml = `<?xml version="1.0"?>
    <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:AC">
      <SOAP-ENV:Body>
        <ns1:executeCommandResponse>
          <return>PLAYERSTATS_ONLINE_V1 {&quot;location&quot;:&quot;A &amp; B&quot;}&amp;#xD;</return>
        </ns1:executeCommandResponse>
      </SOAP-ENV:Body>
    </SOAP-ENV:Envelope>`;

  assert.equal(
    parseSoapExecuteCommandResponse(xml),
    'PLAYERSTATS_ONLINE_V1 {"location":"A & B"}\r'
  );
});

test("rejects SOAP faults without exposing their contents", () => {
  const xml = `<?xml version="1.0"?>
    <SOAP:Envelope xmlns:SOAP="http://schemas.xmlsoap.org/soap/envelope/">
      <SOAP:Body>
        <SOAP:Fault><faultcode>SOAP-ENV:Client</faultcode><faultstring>sensitive detail</faultstring></SOAP:Fault>
      </SOAP:Body>
    </SOAP:Envelope>`;

  assert.throws(
    () => parseSoapExecuteCommandResponse(xml),
    (error: unknown) => error instanceof Error && error.message === "AzerothCore returned a SOAP fault."
  );
});

test("rejects malformed SOAP XML", () => {
  assert.throws(
    () => parseSoapExecuteCommandResponse("<Envelope><Body></Envelope>"),
    /malformed SOAP XML/u
  );
});
