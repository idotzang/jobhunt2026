import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authConfigFromEnv, isPublicPath, isValidSession } from "@/lib/auth";
import { REQUEST_ID_HEADER, newRequestId } from "@/lib/request-id";

const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/;

export async function proxy(request: NextRequest) {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : newRequestId();
  const isPublic = isPublicPath(request.nextUrl.pathname);
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;

  if (!isPublic && !(await isValidSession(cookie, authConfigFromEnv()))) {
    const res = NextResponse.redirect(new URL("/login", request.url));
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  }

  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
