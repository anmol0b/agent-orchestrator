import { type IncomingMessage } from "node:http";
import { createConnection } from "node:net";
import { type Duplex } from "node:stream";
import {
  activeRemoteAuth,
  isBasicAuthHeaderAllowed,
  verifyRemoteWsToken,
  type RemoteAuthCredentials,
} from "./remote-auth.js";

export function getTerminalProxyTarget(requestUrl: string | undefined): string | null {
  const url = new URL(requestUrl ?? "/", "ws://localhost");
  if (url.pathname === "/ao-terminal-mux") {
    url.pathname = "/mux";
    return `${url.pathname}${url.search}`;
  }
  if (url.pathname.startsWith("/ao-terminal/")) {
    url.pathname = url.pathname.slice("/ao-terminal".length);
    return `${url.pathname}${url.search}`;
  }
  return null;
}

export function isRemoteUpgradeAllowed(
  request: IncomingMessage,
  initialConfiguredAuth?: RemoteAuthCredentials,
): boolean {
  const expected = activeRemoteAuth(initialConfiguredAuth);
  if (!expected.password) return true;

  const url = new URL(request.url ?? "/", "ws://localhost");
  if (verifyRemoteWsToken(url.searchParams.get("auth_token"), expected)) {
    return true;
  }

  return isBasicAuthHeaderAllowed(request.headers.authorization, expected);
}

export function proxyTerminalUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  initialConfiguredAuth?: RemoteAuthCredentials,
): boolean {
  const targetPath = getTerminalProxyTarget(request.url);
  if (!targetPath) return false;
  if (!isRemoteUpgradeAllowed(request, initialConfiguredAuth)) {
    socket.destroy();
    return true;
  }

  const directTerminalPort = Number.parseInt(process.env["DIRECT_TERMINAL_PORT"] ?? "14801", 10);
  const upstream = createConnection({ host: "127.0.0.1", port: directTerminalPort });

  upstream.on("connect", () => {
    const headers = Object.entries(request.headers)
      .flatMap(([name, value]) => {
        if (Array.isArray(value)) return value.map((item) => `${name}: ${item}`);
        return value === undefined ? [] : [`${name}: ${value}`];
      })
      .join("\r\n");
    upstream.write(`GET ${targetPath} HTTP/${request.httpVersion}\r\n${headers}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on("error", () => {
    socket.destroy();
  });
  socket.on("error", () => {
    upstream.destroy();
  });

  return true;
}
