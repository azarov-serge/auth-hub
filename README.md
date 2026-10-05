# auth-hub

[English](README.md) | [Русский](README_RU.md)

Hidden iframe auth hub for shared HttpOnly refresh cookies across sibling subdomains.

- **Web Locks** (+ localStorage mutex fallback) — one network `/refresh` across tabs/SPAs on the hub origin
- **BroadcastChannel** — login/logout fan-out and access-token sync across hub iframes
- **postMessage client** — `AuthHubClient` for the host SPA (single-flight `refresh()`)

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

## Multi-tab refresh

Opening many tabs at once must not trigger parallel network `/refresh` calls when the backend **rotates** the refresh cookie: a second refresh can return 401, and a naive SPA that then calls server `logout` will kill the session for every tab.

The hub mitigates this:

| Mechanism | Behavior |
| --- | --- |
| Cache TTL | Default **120s** (`cacheTtlMs`, min 5s). Short TTL + rotation caused spurious second refreshes. |
| Mutex | `navigator.locks` when available; otherwise a localStorage mutex. |
| BC access sync | After a successful refresh, other hub iframes get `{ type: "access" }` and reuse the token. |
| Error fallback | If the network refresh fails but another tab already wrote the cache, return that access. |
| Client single-flight | Concurrent `refresh()` in the same tab share one in-flight promise. |

**Host SPA rule:** a failed refresh must **not** call server logout. Clear local access (`clearLocalSession`) and redirect to login if needed. Call hub `logout()` / `authManager.signOut()` only for an **explicit** user sign-out.

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
