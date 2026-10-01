# auth-hub

[English](README.md) | [Русский](README_RU.md)

Hidden iframe auth hub for shared HttpOnly refresh cookies across sibling subdomains.

- **Web Locks** — one network `/refresh` across tabs/SPAs on the hub origin
- **BroadcastChannel** — optional login/logout fan-out
- **postMessage client** — `AuthHubClient` for the host SPA

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

Query on the hub page: `apiBase`, `syncLogout`, `refreshPath`, `logoutPath`, `parents`.

## License

MIT
