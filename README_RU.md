# auth-hub

Скрытый iframe auth hub для общих HttpOnly refresh-cookie между sibling-поддоменами.

- **Web Locks** — один сетевой `/refresh` между вкладками/SPA на origin хаба
- **BroadcastChannel** — опциональный fan-out login/logout
- **postMessage client** — `AuthHubClient` для host SPA

## Установка

```bash
npm install auth-hub
```

Скопируйте страницу хаба в статику (или разместите её на общем auth-origin):

```bash
cp node_modules/auth-hub/public/auth-hub.html public/auth-hub.html
```

Рекомендация для production: отдавайте `auth-hub.html` с общего origin, например `https://auth.corp.com/auth-hub.html`.

## Использование

```ts
import { AuthHubClient, buildAuthHubFrameUrl } from 'auth-hub';

const authHubClient = new AuthHubClient({
  accessToken: { key: 'access', storage: 'sessionStorage' },
  frameUrl: buildAuthHubFrameUrl({
    frameUrl: '/auth-hub.html', // или https://auth.corp.com/auth-hub.html
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

## Протокол

Канал: `auth-hub`

```
→ { channel, id, type: "refresh"|"logout"|"notifyLogin" }
← { channel, id, type, ok, payload?, error? }
← { channel, type: "event", payload: { command: "ready"|"logout"|"login" } }
```

Query-параметры страницы хаба: `apiBase`, `syncLogout`, `refreshPath`, `logoutPath`, `parents`.

## Лицензия

MIT
