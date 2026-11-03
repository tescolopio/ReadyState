import { localConnectionRoute } from "@/lib/local-connection-runtime";

export const POST = (request: Request) => localConnectionRoute(request, "browser");
