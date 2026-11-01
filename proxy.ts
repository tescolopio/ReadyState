import { NextResponse, type NextRequest } from "next/server";
import { requireTrialAccess, trialGateOn } from "@/lib/trial-access";

export function proxy(request: NextRequest) {
  const rejected = requireTrialAccess(request);
  if (rejected) return rejected;
  const response = NextResponse.next();
  if (trialGateOn()) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

export const config = { matcher: "/:path*" };
