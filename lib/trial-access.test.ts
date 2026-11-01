import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { requireTrialAccess } from "./trial-access";
import { proxy } from "@/proxy";
import { GET as configGet } from "@/app/api/config/route";
import { GET, POST } from "@/app/api/ttx/route";

const password = "synthetic-trial-password-for-tests";
const request = (credential?: string, path = "/api/ttx") => new NextRequest(`https://trial.example${path}`, {
  headers: credential ? { authorization: `Basic ${Buffer.from(credential).toString("base64")}` } : {},
});

describe("private trial access", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("READYSTATE_TRIAL_PASSWORD", password);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("keeps ordinary local self-hosting unchanged", () => {
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("READYSTATE_TRIAL_PASSWORD", undefined);
    expect(requireTrialAccess(request())).toBeNull();
  });

  it.each([undefined, "", "short"])("fails closed on Vercel with an invalid password: %s", (value) => {
    vi.stubEnv("READYSTATE_TRIAL_PASSWORD", value);
    expect(requireTrialAccess(request())?.status).toBe(503);
  });

  it("requires the exact username and password and prevents caching challenges", () => {
    for (const value of [undefined, "trial:wrong", `other:${password}`]) {
      const denied = requireTrialAccess(request(value));
      expect(denied?.status).toBe(401);
      expect(denied?.headers.get("www-authenticate")).toContain("Basic");
      expect(denied?.headers.get("cache-control")).toContain("no-store");
    }
    expect(requireTrialAccess(request(`trial:${password}`))).toBeNull();
  });

  it("rejects malformed authorization", () => {
    const req = request();
    req.headers.set("authorization", "Basic !!!");
    expect(requireTrialAccess(req)?.status).toBe(401);
  });

  it("protects pages, assets and APIs through the proxy", () => {
    for (const path of ["/", "/journal", "/settings", "/api/config", "/api/ttx", "/_next/static/test.js"]) {
      expect(proxy(request(undefined, path)).status).toBe(401);
      expect(proxy(request(`trial:${password}`, path)).headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("protects API handlers even when called without the proxy", async () => {
    expect((await configGet(request())).status).toBe(401);
    expect(GET(request()).status).toBe(401);
    // No body or provider settings: authorization must run before parsing/model resolution.
    expect((await POST(request())).status).toBe(401);
    expect(GET(request(`trial:${password}`)).status).toBe(200);
  });

  it("treats an empty password as unset locally, so a blank .env line doesn't lock a local server", () => {
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("READYSTATE_TRIAL_PASSWORD", "");
    expect(requireTrialAccess(request())).toBeNull();
    expect(proxy(request()).headers.get("cache-control")).toBeNull();
  });

  it("also gates a local server when the trial password is configured", () => {
    vi.stubEnv("VERCEL", undefined);
    expect(requireTrialAccess(request())?.status).toBe(401);
  });
});
