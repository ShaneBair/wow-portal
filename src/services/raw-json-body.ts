import type { Request, Response } from "express";

const rawJsonBodies = new WeakMap<object, string>();

export function captureRawJsonBody(
  request: Request,
  _response: Response,
  buffer: Buffer,
  encoding: string
): void {
  rawJsonBodies.set(request, buffer.toString(encoding as BufferEncoding));
}

export function getRawJsonBody(request: object): string | undefined {
  return rawJsonBodies.get(request);
}
