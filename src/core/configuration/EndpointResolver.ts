function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
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
  const isHttpsPage =
    typeof window !== "undefined" && window.location.protocol === "https:";
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
  if (typeof window === "undefined") {
    return "localhost";
  }
  return deriveAudienceFromHostname(window.location.hostname);
}

export function getApiOrigin(): string {
  const configuredApiDomain = envValue("API_DOMAIN");
  if (configuredApiDomain) {
    return normalizeOrigin(configuredApiDomain, "http");
  }

  if (typeof window === "undefined") {
    return "http://localhost:8787";
  }

  if (isLocalhost(window.location.hostname)) {
    const localApiHost = localStorage.getItem("apiHost");
    if (localApiHost) {
      return normalizeOrigin(localApiHost, "http");
    }
    return "http://localhost:8787";
  }

  return `https://api.${deriveAudienceFromHostname(window.location.hostname)}`;
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

  if (typeof window === "undefined") {
    return "ws://localhost:8787";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
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
