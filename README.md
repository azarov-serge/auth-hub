# auth-hub

[English](README.md) | [Русский](README_RU.md)

Hidden iframe auth hub for shared HttpOnly refresh cookies across sibling subdomains.

- **Web Locks** (+ localStorage mutex fallback) — one network `/refresh` across tabs/SPAs on the hub origin
- **BroadcastChannel** — login/logout fan-out and access-token sync across hub iframes
- **postMessage client** — `AuthHubClient` with single-flight `refresh()`, retries, and parent share-cache

## Install

```bash
npm install auth-hub
```

Copy the hub page into your static assets (or host it on a shared auth origin):

```bash
cp node_modules/auth-hub/public/auth-hub.html public/auth-hub.html
```

## Hosting

Two common setups:

1. **Shared auth origin** — dedicate a subdomain and serve the hub as its entry page, e.g. `https://auth.corp.com/index.html`. Sibling apps (`app.corp.com`, `admin.corp.com`, …) load this iframe. Best when refresh cookies are scoped to `.corp.com` and many SPAs share one hub.
2. **Same site / app origin** — put the hub next to the SPA, e.g. `https://corp.com/auth-hub.html` (or a relative `/auth-hub.html`). Simpler for a single product origin.

Prefer (1) in production when several sibling subdomains must share one HttpOnly refresh cookie and one refresh mutex.

## Usage

```ts
import { AuthHubClient, buildAuthHubFrameUrl } from 'auth-hub';

const authHubClient = new AuthHubClient({
  accessToken: { key: 'access', storage: 'sessionStorage' },
  // timeoutMs: 45_000,      // default — many tabs queue iframe HTTP + Web Lock
  // refreshRetries: 3,      // transient timeout / network only
  frameUrl: buildAuthHubFrameUrl({
    // (1) https://auth.corp.com/index.html
    // (2) https://corp.com/auth-hub.html  or  '/auth-hub.html'
    frameUrl: 'https://auth.corp.com/index.html',
    apiBase: 'https://api.corp.com',
    syncLogout: true,
    parents: window.location.origin,
    refreshPath: '/token/v1/refresh',
    logoutPath: '/auth/v1/logout',
    // optional; hub default is 120000
    // cacheTtlMs: 120_000,
  }),
});

await authHubClient.connect();
const { access } = await authHubClient.refresh();
authHubClient.onEvent((payload) => {
  if (payload.command === 'logout') {
    authHubClient.clearLocalSession();
  }
});
```

Helpers for host bootstrap (re-exported): `isTransientHubError`, `isDefinitiveAuthFailure` (401 / empty access). Treat only definitive failures as logged-out; retry or wait on transient timeouts while the cookie is still valid.

## Multi-tab refresh

Opening many tabs at once stresses two layers: each tab has its own iframe (browser HTTP connection pool) **and** a shared Web Lock on the hub. Bootstrap can time out while the cookie is still alive — that is not a logout.

Also, parallel network `/refresh` with cookie **rotation** can return 401 on a second call; a naive SPA that then hits server `logout` kills the session for every tab.

Mitigations:

| Mechanism | Behavior |
| --- | --- |
| Hub cache TTL | Default **120s** (`cacheTtlMs`, min 5s). Short TTL + rotation caused spurious second refreshes. |
| Mutex | `navigator.locks` when available; otherwise a localStorage mutex. |
| BC access sync | After a successful refresh, other hub iframes get `{ type: "access" }` and reuse the token. |
| Hub error fallback | If the network refresh fails but another tab already wrote the hub cache, return that access. |
| Parent share-cache | Client writes access to parent `localStorage` (`auth-hub-share-*`, **120s**). Sibling tabs can take it **before** their own iframe is ready. |
| Timeout / retries | Default `timeoutMs` **45s**, `refreshRetries` **3** on transient errors. After hub timeout, iframe is destroyed so `connect()` can remount. |
| Client single-flight | Concurrent `refresh()` in the same tab share one in-flight promise. |

**Host SPA rule:** a failed refresh must **not** call server logout. Clear local access (`clearLocalSession`) and redirect to login only on definitive auth failure. Call hub `logout()` only for an **explicit** user sign-out.

## Customizing tokens

The packaged hub page is a starting point — copy it and adapt to your API.

**In `auth-hub.html` (hub):**

- Change how the access token is read from the refresh response (`accessFrom`). Defaults cover a bare string, `{ access }`, and `{ data: { access } }`.
- Adjust `fetch` for refresh/logout (headers, method, body) if your backend differs.
- Keep returning `{ access: string }` in the postMessage refresh payload so `AuthHubClient.refresh()` stays compatible.

**In the host SPA (client):**

- Persist the access token yourself after `refresh()` (cookie, memory, your store). `accessToken` on `AuthHubClient` only tells the client which key to clear on logout via `clearLocalSession()`.
- On `login` / after sign-in, call `notifyLogin()` if other tabs should re-check the session.

## Protocol

Channel: `auth-hub`

```
→ { channel, id, type: "refresh"|"logout"|"notifyLogin" }
← { channel, id, type, ok, payload?, error? }
← { channel, type: "event", payload: { command: "ready"|"logout"|"login" } }
```

Hub BroadcastChannel (`auth-hub-sync`): `login` / `logout` fan-out, plus `access` to sync the cached token across hub iframes.

Query on the hub page: `apiBase`, `syncLogout`, `refreshPath`, `logoutPath`, `parents`, `cacheTtlMs` (optional, default `120000`).

## License

MIT
