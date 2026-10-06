import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const createOpaqueToken = (): string => randomBytes(32).toString("base64url");

export const hashDeviceToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const hashSessionToken = (token: string, pepper: string): string =>
  createHmac("sha256", pepper).update(token).digest("hex");

export const safeTokenMatches = (actualHash: string, expectedHash: string): boolean => {
  const actual = Buffer.from(actualHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

