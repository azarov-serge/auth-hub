# auth-hub

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

Production recommendation: serve `auth-hub.html` from a shared origin, e.g. `https://auth.corp.com/auth-hub.html`.

## Usage

```ts
import { AuthHubClient, buildAuthHubFrameUrl } from 'auth-hub';

const authHubClient = new AuthHubClient({
  accessToken: { key: 'access', storage: 'sessionStorage' },
  frameUrl: buildAuthHubFrameUrl({
    frameUrl: '/auth-hub.html', // or https://auth.corp.com/auth-hub.html
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
