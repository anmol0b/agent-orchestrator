import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  createDefaultGlobalConfig,
  getGlobalConfigPath,
  loadGlobalConfig,
} from "@aoagents/ao-core";

export type RemoteAuthCredentials = {
  username: string;
  password?: string;
};

const TOKEN_VERSION = "v1";
const TOKEN_TTL_MS = 5 * 60 * 1000;

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string): string | null {
  try {
    return Buffer.from(input, "base64url").toString("utf-8");
  } catch {
    return null;
  }
}

function getTokenSecret(): string | undefined {
  return (
    process.env.AO_REMOTE_WS_TOKEN_SECRET?.trim() ||
    process.env.AO_REMOTE_AUTH_PASSWORD?.trim() ||
    readConfiguredRemoteAuth().password
  );
}

export function ensureRemoteWsTokenSecret(): string {
  const existing = process.env.AO_REMOTE_WS_TOKEN_SECRET?.trim() || undefined;
  if (existing) return existing;
  const secret = randomBytes(32).toString("base64url");
  process.env.AO_REMOTE_WS_TOKEN_SECRET = secret;
  return secret;
}

export function decodeBasicToken(
  input: string | undefined | null,
): { username: string; password: string } | null {
  if (!input) return null;
  try {
    const decoded = Buffer.from(input, "base64").toString("utf-8");
    const separator = decoded.indexOf(":");
    if (separator === -1) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

export function readConfiguredRemoteAuth(): RemoteAuthCredentials {
  const config = loadGlobalConfig(getGlobalConfigPath()) ?? createDefaultGlobalConfig();
  const remoteAccess =
    config.remoteAccess && typeof config.remoteAccess === "object"
      ? (config.remoteAccess as { username?: string; password?: string })
      : undefined;

  return {
    username: remoteAccess?.username?.trim() || "ao",
    password: remoteAccess?.password?.trim() || undefined,
  };
}

export function activeRemoteAuth(initialConfiguredAuth?: RemoteAuthCredentials): RemoteAuthCredentials {
  const configured = readConfiguredRemoteAuth();
  if (
    initialConfiguredAuth &&
    (configured.username !== initialConfiguredAuth.username ||
      configured.password !== initialConfiguredAuth.password)
  ) {
    return configured;
  }

  return {
    username: process.env.AO_REMOTE_AUTH_USER || initialConfiguredAuth?.username || configured.username,
    password: process.env.AO_REMOTE_AUTH_PASSWORD || initialConfiguredAuth?.password || configured.password,
  };
}

function credentialFingerprint(credentials: RemoteAuthCredentials, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${credentials.username}:${credentials.password ?? ""}`)
    .digest("base64url");
}

export function createRemoteWsToken(credentials: RemoteAuthCredentials): string | undefined {
  const secret = getTokenSecret();
  if (!secret) return undefined;

  const payload = base64UrlEncode(
    JSON.stringify({
      u: credentials.username,
      c: credentialFingerprint(credentials, secret),
      exp: Date.now() + TOKEN_TTL_MS,
      n: randomBytes(12).toString("base64url"),
    }),
  );
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${TOKEN_VERSION}.${payload}.${signature}`;
}

export function verifyRemoteWsToken(
  token: string | undefined | null,
  expectedCredentials: RemoteAuthCredentials,
): boolean {
  const secret = getTokenSecret();
  if (!secret || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return false;
  const [, payload, signature] = parts;
  if (!payload || !signature) return false;

  const expectedSignature = createHmac("sha256", secret).update(payload).digest("base64url");
  const provided = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);
  if (
    provided.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(provided, expectedSignatureBuffer)
  ) {
    return false;
  }

  const rawPayload = base64UrlDecode(payload);
  if (!rawPayload) return false;

  try {
    const parsed = JSON.parse(rawPayload) as { u?: unknown; c?: unknown; exp?: unknown };
    return (
      parsed.u === expectedCredentials.username &&
      parsed.c === credentialFingerprint(expectedCredentials, secret) &&
      typeof parsed.exp === "number" &&
      parsed.exp >= Date.now()
    );
  } catch {
    return false;
  }
}

export function isBasicAuthHeaderAllowed(
  authorization: string | string[] | undefined,
  expected: RemoteAuthCredentials,
): boolean {
  if (!expected.password) return true;
  const header = Array.isArray(authorization) ? authorization[0] : (authorization ?? "");
  const headerMatch = /^Basic\s+(.+)$/i.exec(header);
  const credentials = decodeBasicToken(headerMatch?.[1]);
  return credentials?.username === expected.username && credentials.password === expected.password;
}
