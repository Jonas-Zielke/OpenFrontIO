function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

interface RuntimeLocation {
  protocol: string;
  host: string;
  hostname: string;
}

function getRuntimeLocation(): RuntimeLocation | null {
  const locationLike = (
    globalThis as { location?: Partial<RuntimeLocation> | undefined }
  ).location;
  if (
    !locationLike ||
    typeof locationLike.protocol !== "string" ||
    typeof locationLike.host !== "string" ||
    typeof locationLike.hostname !== "string"
  ) {
    return null;
  }
  return {
    protocol: locationLike.protocol,
    host: locationLike.host,
    hostname: locationLike.hostname,
  };
}

function ensureLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeWorkerPath(workerPath: string): string {
  return ensureLeadingSlash(workerPath.replace(/^\/+/, ""));
}

function normalizeOrigin(value: string, target: "http" | "ws"): string {
  const trimmed = trimTrailingSlash(value.trim());
  const hasProtocol = /^[a-z]+:\/\//i.test(trimmed);
  const location = getRuntimeLocation();
  const isHttpsPage = location?.protocol === "https:";
  const prefixed = hasProtocol
    ? trimmed
    : `${target === "http"
        ? isHttpsPage
          ? "https"
          : "http"
        : isHttpsPage
          ? "wss"
          : "ws"}://${trimmed}`;

  try {
    const url = new URL(prefixed);
    let protocol = url.protocol;
    if (target === "http") {
      if (protocol === "ws:") protocol = "http:";
      if (protocol === "wss:") protocol = "https:";
      if (protocol !== "http:" && protocol !== "https:") protocol = "https:";
    } else {
      if (protocol === "http:") protocol = "ws:";
      if (protocol === "https:") protocol = "wss:";
      if (protocol !== "ws:" && protocol !== "wss:") protocol = "wss:";
    }
    return `${protocol}//${url.host}`;
  } catch {
    return trimTrailingSlash(prefixed);
  }
}

function envValue(name: "API_DOMAIN" | "WEBSOCKET_URL"): string | null {
  const value = process?.env?.[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function deriveAudienceFromHostname(hostname: string): string {
  return hostname.split(".").slice(-2).join(".");
}

function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

export function getAudience(): string {
  const location = getRuntimeLocation();
  if (!location) {
    return "localhost";
  }
  return deriveAudienceFromHostname(location.hostname);
}

export function getApiOrigin(): string {
  const configuredApiDomain = envValue("API_DOMAIN");
  if (configuredApiDomain) {
    return normalizeOrigin(configuredApiDomain, "http");
  }

  const location = getRuntimeLocation();
  if (!location) {
    return "http://localhost:8787";
  }

  if (isLocalhost(location.hostname)) {
    const localApiHost =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("apiHost")
        : null;
    if (localApiHost) {
      return normalizeOrigin(localApiHost, "http");
    }
    return "http://localhost:8787";
  }

  // In self-hosted deployments (Render, Docker, etc.), API is usually same-origin.
  return `${location.protocol}//${location.host}`;
}

export function getApiUrl(path: string): string {
  return `${getApiOrigin()}${ensureLeadingSlash(path)}`;
}

export function getWebSocketOrigin(): string {
  const configuredWsDomain = envValue("WEBSOCKET_URL");
  if (configuredWsDomain) {
    return normalizeOrigin(configuredWsDomain, "ws");
  }

  const configuredApiDomain = envValue("API_DOMAIN");
  if (configuredApiDomain) {
    return normalizeOrigin(configuredApiDomain, "ws");
  }

  const location = getRuntimeLocation();
  if (!location) {
    return "ws://localhost:8787";
  }

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}`;
}

export function getWebSocketUrl(path: string): string {
  return `${getWebSocketOrigin()}${ensureLeadingSlash(path)}`;
}

export function getWorkerApiUrl(workerPath: string, path: string): string {
  return `${getApiOrigin()}${normalizeWorkerPath(workerPath)}${ensureLeadingSlash(path)}`;
}

export function getWorkerWebSocketUrl(
  workerPath: string,
  path?: string,
): string {
  const suffix = path ? ensureLeadingSlash(path) : "";
  return `${getWebSocketOrigin()}${normalizeWorkerPath(workerPath)}${suffix}`;
}
