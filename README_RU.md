# auth-hub

[English](README.md) | [Русский](README_RU.md)

Скрытый iframe auth hub для общих HttpOnly refresh-cookie между sibling-поддоменами.

- **Web Locks** (+ fallback mutex на localStorage) — один сетевой `/refresh` между вкладками/SPA на origin хаба
- **BroadcastChannel** — fan-out login/logout и синхронизация access между iframe хаба
- **postMessage client** — `AuthHubClient` с single-flight `refresh()`, retry и parent share-cache

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
  // timeoutMs: 45_000,      // по умолчанию — очередь iframe HTTP + Web Lock при многих вкладках
  // refreshRetries: 3,      // только transient timeout / network
  frameUrl: buildAuthHubFrameUrl({
    // (1) https://auth.corp.com/index.html
    // (2) https://corp.com/auth-hub.html  или  '/auth-hub.html'
    frameUrl: 'https://auth.corp.com/index.html',
    apiBase: 'https://api.corp.com',
    syncLogout: true,
    parents: window.location.origin,
    refreshPath: '/token/v1/refresh',
    logoutPath: '/auth/v1/logout',
    // опционально; в хабе по умолчанию 120000
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

Хелперы для bootstrap (реэкспорт): `isTransientHubError`, `isDefinitiveAuthFailure` (401 / empty access). Logout только на definitive; на transient — retry / ждать, пока cookie ещё жива.

## Multi-tab refresh

Пачка вкладок бьёт по двум слоям: у каждой свой iframe (пул HTTP-соединений браузера) **и** общий Web Lock на хабе. Bootstrap может упереться в timeout при живой cookie — это не logout.

Параллельный сетевой `/refresh` при **ротации** cookie может дать 401 на втором вызове; наивный SPA с серверным `logout` убьёт сессию у всех.

Смягчения:

| Механизм | Поведение |
| --- | --- |
| Hub cache TTL | По умолчанию **120с** (`cacheTtlMs`, мин. 5с). Короткий TTL + ротация давали лишний второй refresh. |
| Mutex | `navigator.locks`, если есть; иначе mutex на localStorage. |
| BC sync access | После успешного refresh другие iframe хаба получают `{ type: "access" }` и переиспользуют токен. |
| Fallback в хабе | Если сетевой refresh упал, но другая вкладка уже записала кеш хаба — вернуть этот access. |
| Parent share-cache | Клиент пишет access в `localStorage` родителя (`auth-hub-share-*`, **120с**). Соседние вкладки берут его **до** готовности своего iframe. |
| Timeout / retries | По умолчанию `timeoutMs` **45с**, `refreshRetries` **3** на transient. После hub timeout iframe уничтожается — `connect()` может смонтировать заново. |
| Single-flight в клиенте | Параллельные `refresh()` в одной вкладке делят один in-flight promise. |

**Правило для host SPA:** failed refresh **не** должен вызывать серверный logout. `clearLocalSession` + redirect на login — только при definitive auth failure. Hub `logout()` — только при **явном** выходе пользователя.

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

BroadcastChannel хаба (`auth-hub-sync`): fan-out `login` / `logout`, плюс `access` для синка кеша между iframe хаба.

Query-параметры страницы хаба: `apiBase`, `syncLogout`, `refreshPath`, `logoutPath`, `parents`, `cacheTtlMs` (опционально, по умолчанию `120000`).

## Лицензия

MIT
