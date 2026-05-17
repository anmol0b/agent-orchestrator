import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

function request(path: string, authorization?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: authorization ? { authorization } : undefined,
  });
}

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

describe("remote auth middleware", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does nothing when remote auth is not configured", () => {
    vi.stubEnv("AO_REMOTE_AUTH_PASSWORD", "");

    const response = middleware(request("/api/projects"));

    expect(response.status).toBe(200);
  });

  it("requires basic auth when a remote password is configured", () => {
    vi.stubEnv("AO_REMOTE_AUTH_USER", "ao");
    vi.stubEnv("AO_REMOTE_AUTH_PASSWORD", "secret");

    const response = middleware(request("/api/projects"));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Basic realm="AO Remote"');
  });

  it("accepts matching basic auth credentials", () => {
    vi.stubEnv("AO_REMOTE_AUTH_USER", "ao");
    vi.stubEnv("AO_REMOTE_AUTH_PASSWORD", "secret");

    const response = middleware(request("/api/projects", basic("ao", "secret")));

    expect(response.status).toBe(200);
  });

  it("allows public Next assets without credentials", () => {
    vi.stubEnv("AO_REMOTE_AUTH_USER", "ao");
    vi.stubEnv("AO_REMOTE_AUTH_PASSWORD", "secret");

    const response = middleware(request("/_next/static/chunk.js"));

    expect(response.status).toBe(200);
  });
});
