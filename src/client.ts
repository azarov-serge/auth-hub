/**
 * Client for the hidden `auth-hub.html` iframe.
 * Web Locks and BroadcastChannel live on the hub origin; the SPA talks via postMessage.
 * Access tokens are written by the host app; this client only clears the configured storage key.
 */

export const AUTH_HUB_CHANNEL = "auth-hub";

export type AuthHubCommand = "refresh" | "logout" | "notifyLogin";
export type AuthHubEventCommand = "ready" | "logout" | "login";

export type AuthHubRefreshPayload = {
  access: string;
};

export type AuthHubEventPayload = {
  command: AuthHubEventCommand;
};

export type AuthHubWebStorageName = "localStorage" | "sessionStorage";

/** Where access lives in the parent SPA (must match what the auth layer writes). */
export type AuthHubAccessTokenConfig = {
  key: string;
  storage: AuthHubWebStorageName;
};

export type AuthHubClientOptions = {
  accessToken: AuthHubAccessTokenConfig;
  /** Absolute or relative URL of auth-hub.html (with query config). */
  frameUrl: string;
  timeoutMs?: number;
};

export type BuildAuthHubFrameUrlOptions = {
  /** Hub page URL (path or absolute). */
  frameUrl: string;
  /** API base for credentialed fetch inside the hub. Required by the hub page. */
  apiBase: string;
  /** Fan-out login/logout via BroadcastChannel inside the hub. Default: true. */
  syncLogout?: boolean;
  /** Comma-separated parent origins allowlist. Default: `window.location.origin`. */
  parents?: string;
  refreshPath: string;
  logoutPath: string;
};

/** Response to a SPA request (same `id`). */
type HubResponse = {
  channel: typeof AUTH_HUB_CHANNEL;
  id: string;
  type: AuthHubCommand;
  ok: boolean;
  payload?: unknown;
  error?: string;
};

/** Push event from the hub (no request id). */
type HubEventMessage = {
  channel: typeof AUTH_HUB_CHANNEL;
  type: "event";
  payload: AuthHubEventPayload;
};

type Pending = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type AuthHubEventListener = (payload: AuthHubEventPayload) => void;

const requireNonEmpty = (value: string | undefined, name: string): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`buildAuthHubFrameUrl: ${name} is required`);
  }
  return trimmed;
};

/** Builds iframe URL with query config expected by `auth-hub.html`. */
export const buildAuthHubFrameUrl = (
  options: BuildAuthHubFrameUrlOptions
): string => {
  const frameUrl = requireNonEmpty(options.frameUrl, "frameUrl");
  const apiBase = requireNonEmpty(options.apiBase, "apiBase");
  const refreshPath = requireNonEmpty(options.refreshPath, "refreshPath");
  const logoutPath = requireNonEmpty(options.logoutPath, "logoutPath");

  const url = new URL(frameUrl, window.location.href);
  url.searchParams.set("apiBase", apiBase);
  url.searchParams.set("syncLogout", String(options.syncLogout ?? true));
  url.searchParams.set("parents", options.parents ?? window.location.origin);
  url.searchParams.set("refreshPath", refreshPath);
  url.searchParams.set("logoutPath", logoutPath);
  return url.toString();
};

export class AuthHubClient {
  private readonly accessToken: AuthHubAccessTokenConfig;
  private readonly frameUrl: string;
  private readonly frameOrigin: string;
  private readonly timeoutMs: number;

  private iframe: HTMLIFrameElement | null = null;
  private reqSeq = 0;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<AuthHubEventListener>();
  private ready: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;

  constructor(options: AuthHubClientOptions) {
    this.accessToken = options.accessToken;
    this.frameUrl = options.frameUrl;
    this.frameOrigin = new URL(this.frameUrl).origin;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (
      event.origin !== this.frameOrigin ||
      event.source !== this.iframe?.contentWindow
    ) {
      return;
    }

    const data = event.data as HubResponse | HubEventMessage | null;
    if (!data || data.channel !== AUTH_HUB_CHANNEL) {
      return;
    }

    if (data.type === "event") {
      if (data.payload?.command === "ready") {
        this.resolveReady?.();
        this.resolveReady = null;
      }

      this.listeners.forEach((listener) => listener(data.payload));
      return;
    }

    const wait = data.id ? this.pending.get(data.id) : undefined;
    if (!wait) {
      return;
    }

    clearTimeout(wait.timer);
    this.pending.delete(data.id);
    if (data.ok) {
      wait.resolve(data.payload);
    } else {
      wait.reject(new Error(data.error ?? `AuthHubClient: ${data.type}`));
    }
  };

  /** Mounts the hidden iframe and waits for `ready`. Repeat calls return the same promise. */
  connect(): Promise<void> {
    if (this.ready) {
      return this.ready;
    }

    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("AuthHubClient: hub timeout"));
      }, this.timeoutMs);

      this.resolveReady = () => {
        clearTimeout(timer);
        resolve();
      };
    });

    window.addEventListener("message", this.onMessage);

    const iframe = document.createElement("iframe");
    iframe.src = this.frameUrl;
    iframe.title = "Auth hub";
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    Object.assign(iframe.style, {
      position: "fixed",
      width: "0",
      height: "0",
      border: "0",
      opacity: "0",
    });
    this.iframe = iframe;
    document.body.appendChild(iframe);

    return this.ready;
  }

  onEvent(listener: AuthHubEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Mutex and POST refresh run inside the iframe. Host app persists the access token. */
  async refresh(): Promise<AuthHubRefreshPayload> {
    const payload = (await this.call("refresh")) as AuthHubRefreshPayload;
    if (!payload?.access) {
      throw new Error("AuthHubClient: empty access");
    }
    return payload;
  }

  /** POST logout via hub. Always clears local access. */
  async logout(): Promise<void> {
    try {
      await this.call("logout");
    } finally {
      this.clearLocalSession();
    }
  }

  /** Fan-out login to other tabs/SPAs when syncLogout is enabled on the hub. */
  notifyLogin(): Promise<void> {
    return this.call("notifyLogin").then(() => undefined);
  }

  clearLocalSession(): void {
    window[this.accessToken.storage].removeItem(this.accessToken.key);
  }

  private async call(type: AuthHubCommand): Promise<unknown> {
    await this.connect();
    const win = this.iframe?.contentWindow;
    if (!win) {
      throw new Error("AuthHubClient: iframe not ready");
    }

    const id = String(++this.reqSeq);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`AuthHubClient: timeout (${type})`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      win.postMessage({ channel: AUTH_HUB_CHANNEL, id, type }, this.frameOrigin);
    });
  }
}
