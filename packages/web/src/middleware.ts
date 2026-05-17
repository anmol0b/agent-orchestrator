import { NextResponse, type NextRequest } from "next/server";

const REALM = "AO Remote";

function remoteAuthPassword(): string | undefined {
  const password = process.env["AO_REMOTE_AUTH_PASSWORD"];
  return password && password.length > 0 ? password : undefined;
}

function remoteAuthUser(): string {
  return process.env["AO_REMOTE_AUTH_USER"] || "ao";
}

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}"`,
    },
  });
}

function decodeBasicAuth(header: string | null): { username: string; password: string } | null {
  const match = /^Basic\s+(.+)$/i.exec(header ?? "");
  if (!match) return null;

  try {
    const decoded = atob(match[1]);
    const separator = decoded.indexOf(":");
    if (separator === -1) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function isPublicAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/icon" ||
    pathname === "/apple-icon" ||
    pathname === "/icon-192" ||
    pathname === "/icon-512"
  );
}

function isLocalHost(host: string | null): boolean {
  const rawHost = host ?? "";
  const bracketEnd = rawHost.indexOf("]");
  const hostname = (rawHost.startsWith("[") && bracketEnd !== -1
    ? rawHost.slice(0, bracketEnd + 1)
    : rawHost.split(":")[0]
  )?.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

export function middleware(request: NextRequest) {
  const password = remoteAuthPassword();
  if (!password || isPublicAsset(request.nextUrl.pathname) || isLocalHost(request.headers.get("host"))) {
    return NextResponse.next();
  }

  const credentials = decodeBasicAuth(request.headers.get("authorization"));
  if (!credentials) return unauthorized();

  if (credentials.username !== remoteAuthUser() || credentials.password !== password) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
