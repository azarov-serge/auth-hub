# auth-hub

[English](README.md) | [Русский](README_RU.md)

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

## Хостинг

Два типичных варианта:

1. **Общий auth-origin** — отдельный поддомен, хаб как entry page, например `https://auth.corp.com/index.html`. Sibling-приложения (`app.corp.com`, `admin.corp.com`, …) грузят этот iframe. Удобно, когда refresh-cookie на `.corp.com` и несколько SPA делят один хаб.
2. **Тот же site / origin приложения** — хаб рядом со SPA, например `https://corp.com/auth-hub.html` (или относительный `/auth-hub.html`). Проще для одного product-origin.

В production при нескольких sibling-поддоменах предпочтителен вариант (1): один HttpOnly refresh-cookie и один mutex на refresh.

## Использование

```ts
import { AuthHubClient, buildAuthHubFrameUrl } from 'auth-hub';

const authHubClient = new AuthHubClient({
  accessToken: { key: 'access', storage: 'sessionStorage' },
  frameUrl: buildAuthHubFrameUrl({
    // (1) https://auth.corp.com/index.html
    // (2) https://corp.com/auth-hub.html  или  '/auth-hub.html'
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

## Кастомизация токенов

Страница хаба из пакета — отправная точка: скопируйте её и подстройте под свой API.

**В `auth-hub.html` (хаб):**

- Меняйте извлечение access из ответа refresh (`accessFrom`). По умолчанию поддерживаются строка, `{ access }` и `{ data: { access } }`.
- При необходимости меняйте `fetch` для refresh/logout (headers, method, body).
- В postMessage-ответе на refresh по-прежнему возвращайте `{ access: string }`, чтобы `AuthHubClient.refresh()` оставался совместимым.

**В host SPA (клиент):**

- После `refresh()` сохраняйте access сами (cookie, memory, свой store). `accessToken` у `AuthHubClient` нужен только чтобы знать, какой ключ чистить при logout через `clearLocalSession()`.
- После sign-in / на `login` вызывайте `notifyLogin()`, если другим вкладкам нужно перепроверить сессию.

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
