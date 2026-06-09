# FunPay Pulse Plugin SDK v1

Документ определяет первый безопасный SDK-контракт для сторонних плагинов.

SDK v1 не является текущим внутренним `PluginBase` контрактом. Внутренний `PluginBase` остается для first-party trusted plugins. Сторонние плагины используют Plugin Broker API и, для `broker-poller`, могут запускаться через managed runner.

## Цели

- Дать разработчикам возможность делать полезные автоматизации без доступа к Worker internals.
- Оставить FunPay credentials, database files, connection tokens и decrypted secrets внутри Pulse.
- Сделать permissions видимыми и enforceable.
- Дать локальное тестирование через fixtures.
- Поддержать private plugins и marketplace plugins одним manifest.

## Runtime Model

Текущий реализованный SDK/runtime subset — polling + ack + feature-flagged webhook push/retry + read-only install config + broker-token scoped installed `.fppkg` manifest/download + non-secret plugin storage + encrypted plugin secret storage + безопасный `logs.write` action через Plugin Broker API + Desktop managed runner для установленного `runtime.type=broker-poller`. Также добавлены read-only query actions `orders.get`, `orders.list`, `lots.get` и `lots.list`, чтобы плагины могли безопасно получать карточку связанного заказа/лота, account-bound список санитизированных заказов и account-bound список кэшированных лотов без доступа к Worker internals. Для trusted mutating actions `messages.send`, `orders.refund`, `orders.review.reply`, `lots.active.set`, `lots.price.set`, `lots.raise`, `blacklist.add` и `blacklist.remove` есть license-server queue/claim/report и mirrored Worker/Backend executor, но они выключены по умолчанию и требуют review/trusted runtime gates.

Текущий поток:

1. Pulse Worker видит событие.
2. Worker записывает очищенное событие в local outbox.
3. Worker публикует batch в license-server Broker.
4. Broker создает deliveries для active installations с matching event scopes.
5. Plugin app получает events через polling.
6. Plugin app подтверждает обработанные deliveries через ack.
7. Если current installed version имеет `runtime.type=webhook` и license-server включает `CUSTOM_PLUGIN_BROKER_WEBHOOK_PUSH_ENABLED`, Broker также пытается отправить signed POST на manifest `runtime.url`; 2xx ack-ает delivery, ошибка оставляет ее pollable.
8. License-server может повторять due webhook deliveries своим server-side dispatcher-ом; Worker/Backend также может вызывать signed `/api/v2/broker/webhook/dispatch` для per-VPS/manual retry без ожидания новых ingest-событий.
9. Plugin app может читать свой install config.
10. Если installation имеет `storage:own`, plugin app может хранить non-secret JSON state только в своем installation scope.
11. Если installation имеет `secrets:own`, plugin app может хранить и читать свои encrypted third-party secrets только в своем installation scope.
12. Если package download включен на license-server, plugin app может получить manifest и скачать ровно тот `.fppkg`, который привязан к установленной версии.
13. Если installation имеет `logs:write`, plugin app может отправить `logs.write` action в Broker queue.
14. Если installation имеет `orders:read`, plugin app может поставить `orders.get` query action только для delivery-bound заказа. Если installation имеет отдельный `orders:list`, plugin app может поставить `orders.list` query action для account-bound списка санитизированного order cache.
15. Если installation имеет `lots:read`, plugin app может поставить `lots.get` query action только для delivery-bound лота или `lots.list` query action для account-bound списка кэшированных лотов после события по этому аккаунту.
16. Если platform owner вручную включил trusted rollout для `messages:send`, plugin app может поставить `messages.send` в Broker queue, а Worker/Backend executor заберет и выполнит действие через локальные зашифрованные аккаунты.
17. Если platform owner вручную включил trusted rollout для `orders:refund`, plugin app может поставить `orders.refund` в Broker queue только по свежему delivery-bound заказу, а Worker/Backend executor выполнит возврат через локальные зашифрованные аккаунты.
18. Если platform owner вручную включил trusted rollout для `orders:review`, plugin app может поставить `orders.review.reply` в Broker queue только по свежему delivery-bound отзыву без ответа; rating выводит сервер из события, а не plugin app.
19. Если platform owner вручную включил trusted rollout для `lots:active`, plugin app может поставить `lots.active.set` в Broker queue, а Worker/Backend executor включит/выключит delivery-bound лот через локальные зашифрованные аккаунты.
20. Если platform owner вручную включил trusted rollout для `lots:price`, plugin app может поставить `lots.price.set` в Broker queue, а Worker/Backend executor изменит цену delivery-bound лота через локальные зашифрованные аккаунты.
21. Если platform owner вручную включил trusted rollout для `lots:raise`, plugin app может поставить `lots.raise` в Broker queue, а Worker/Backend executor поднимет delivery-bound лот через локальные зашифрованные аккаунты и локально выведенный category/subcategory context.
22. Если platform owner вручную включил trusted rollout для `blacklist:add` или `blacklist:remove`, plugin app может добавить delivery-bound пользователя в plugin-owned черный список или удалить только ранее созданную этим же plugin installation запись.
23. Plugin app может читать safe status/result по `action_id`, не получая обратно action input или Worker lease tokens.
24. Для installed `runtime.type=broker-poller` Desktop может отправить managed runtime command `start`, `stop` или `restart`. License-server проверяет owner/subscription/custom-plugin capability/product/grant/install state, а runner скачивает pinned `.fppkg`, проверяет package/runtime type и запускает plugin process через sidecar без показа raw Broker token в React renderer.

В SDK v1 сторонний Python, JS, native module или uploaded zip не выполняется внутри процесса Worker/Backend. Managed runner запускает `broker-poller` пакет вне Worker/Backend application process.

Runtime hosting decision: the default buyer flow for `broker-poller` is now
Pulse Desktop managed launch on the selected VPS. Self-hosted runtime remains
the fallback for local development, unsupported runtimes and developer-operated
services. The canonical fallback guide is `docs/PLUGIN_RUNTIME_SELF_HOSTING.md`.
Strong per-installation sandbox isolation is still a separate hardening task,
so the current runner must not be marketed as a complete sandbox/SLA.

Version upgrade boundary: changing an installed plugin version is treated as a
permission-changing operation, not as an automatic package swap. The website and
desktop APIs require the user/client to confirm the target current version's
manifest hash and scopes plus the current `install_revision`. On success the
server repins `version_id`, validates config against the target version schema,
revokes the old active Broker token and returns a new raw `fppb_...` token once.
An old or leaked token therefore cannot silently inherit new scopes after a
developer publishes a new version.

Реализовано сейчас:

- dependency-free polling/action client `BrokerClient`;
- `BrokerClient.get_webhook_secret()` and exported
  `broker_webhook_secret_from_dict(...)` for webhook HMAC secret retrieval;
- `BrokerClient.get_package_manifest()` and `BrokerClient.download_package()`
  for installed package delivery with SDK-side SHA-256 and size verification;
- CLI `pulse-plugin download-package` для скачивания installed `.fppkg` через
  Broker token из env/token-file без вывода raw token в stdout/stderr;
- high-level dispatcher `PluginApp` для handler-декораторов, ack-after-success и production polling loop;
- typed event helpers `parse_broker_event()`, `NewMessageEvent`, `NewOrderEvent`, `OrderConfirmedEvent`, `NewReviewEvent`;
- fixture-backed local test client `FixtureBrokerClient`;
- local package builder `pulse-plugin pack` / `build_plugin_package(...)` для deterministic `.fppkg` review artifact;
- server-side private package upload endpoint
  `POST /api/v2/plugin-marketplace/products/{product_public_id}/versions/package`
  для повторной проверки `.fppkg` и привязки artifact metadata к `PluginVersion`;
- broker package API `GET /api/v2/broker/package/manifest` и
  `GET /api/v2/broker/package/download`, scoped к текущей installation/version
  по raw Broker token;
- `GET /api/v2/broker/events`;
- `POST /api/v2/broker/events/{delivery_id}/ack`;
- `GET /api/v2/broker/config` для read-only config текущей установки;
- `GET /api/v2/broker/capabilities` для runtime feature/scopes preflight текущей установки;
- `GET /api/v2/broker/webhook/secret` для no-store получения derived
  per-installation HMAC secret под raw Broker token;
- Worker-only `POST /api/v2/broker/webhook/dispatch` для signed retry due
  webhook deliveries по VPS boundary без payload/token leakage;
- `GET/PUT/DELETE /api/v2/broker/storage/{key}` для non-secret per-installation JSON storage;
- `GET/PUT/DELETE /api/v2/broker/secrets/{key}` для encrypted per-installation secret storage;
- `POST /api/v2/broker/actions` для `logs.write`, `orders.get`, `orders.list`, `lots.get`, `lots.list`, feature-gated `messages.send`, feature-gated `orders.refund`, feature-gated `orders.review.reply`, feature-gated `lots.active.set`, feature-gated `lots.price.set`, feature-gated `lots.raise`, feature-gated `blacklist.add` и feature-gated `blacklist.remove`;
- `GET /api/v2/broker/actions/{action_id}` для safe status/result polling;
- HMAC Worker endpoints `POST /api/v2/broker/actions/claim` и `POST /api/v2/broker/actions/report` для executor path;
- Desktop runtime endpoints для installed plugins:
  `POST /api/v2/plugin-marketplace/desktop/installations/{installation_public_id}/runtime/start`,
  `/stop`, `/restart` и `/bootstrap`. Они не выполняют код в license-server и
  не возвращают raw Broker token в Desktop renderer;
- manifest validation for event plugins, current safe `storage:own`, `secrets:own`, `orders:read`, `orders:list`, `lots:read`, and current safe `logs:write` action.

## Public API Contract

SDK v1 совместимость определяется root-import поверхностью пакета:

```python
from funpay_pulse_sdk import BrokerClient, PluginApp, validate_manifest
```

Стабильным публичным контрактом считаются только имена из
`funpay_pulse_sdk.__all__`. Внутренние submodules (`funpay_pulse_sdk.broker`,
`funpay_pulse_sdk.marketplace`, `funpay_pulse_sdk.package` и т.д.) могут
содержать публично выглядящие классы и helper-функции, но они становятся частью
v1 только если экспортированы из root package.

В текущий v1 contract входят:

- `BrokerClient`, Broker dataclasses и `broker_*_from_dict` parsers;
- `PluginApp`, typed events и `parse_broker_event`;
- manifest validation, package builder и marketplace publish client helpers;
- `FixtureBrokerClient`, fixture loader, webhook signature helpers и permission constants;
- CLI entry point `pulse-plugin`.

Зафиксированный regression gate: `plugin-sdk/tests/test_public_api_contract.py`.
Он проверяет точный `__all__`, `from funpay_pulse_sdk import *`, entry point
`pulse-plugin`, критичные signatures (`BrokerClient`, `PluginApp`,
`validate_manifest`, `build_plugin_package`) и поля core Broker dataclasses
(`BrokerEvent`, `BrokerConfig`, `BrokerCapabilities`, `BrokerPackageManifest`,
`BrokerDownloadedPackage`).

Правило изменений: убрать/переименовать root export, изменить обязательный
параметр или убрать поле core dataclass нельзя как тихий patch. Такое изменение
нужно либо делать обратно совместимым, либо выпускать как новый major SDK
contract с миграционным описанием.

Не реализовано сейчас:

- automatic broad public `messages:send` / `orders:refund` / `orders:review` / `lots:active` / `lots:price` / `lots:raise` / `blacklist:add` / `blacklist:remove` registration rollout for external developers; controlled public rollout now has a separate manual policy and production gate;
- config write/update API from plugin side;
- automated publisher payout batches;
- upload of arbitrary plugin code into Worker/Backend process;
- full per-plugin container/UID/cgroup isolation for managed runner.

Текущий default manifest использует `runtime.type=broker-poller`.
`runtime.type=webhook` допустим для feature-flagged push-доставки; текущая
безопасная beta-рекомендация все равно держит polling как default и recovery
fallback.

## Manifest

Имя файла:

```text
funpay-pulse.plugin.json
```

Минимальный пример:

```json
{
  "manifest_version": "1.0",
  "plugin_id": "seller_auto_reply",
  "name": "Seller Auto Reply",
  "version": "1.0.0",
  "runtime": {
    "type": "broker-poller",
    "url": "https://example.com/funpay-pulse/broker-poller"
  },
  "events": ["events:new_message"],
  "scopes": [],
  "config_schema": {
    "type": "object",
    "properties": {
      "enabled": { "type": "boolean", "title": "Enabled", "default": true },
      "reply_template": { "type": "string", "title": "Reply template", "maxLength": 1000 }
    },
    "required": ["enabled", "reply_template"]
  },
  "ui_schema": {
    "enabled": {
      "ui:widget": "checkbox",
      "ui:help": "Можно временно отключить ответы без удаления плагина."
    },
    "reply_template": {
      "ui:widget": "textarea",
      "ui:rows": 4,
      "ui:placeholder": "Здравствуйте! Скоро отвечу."
    }
  }
}
```

Обязательные поля:

- `manifest_version`
- `plugin_id`
- `name`
- `version`
- `runtime`
- `events`
- `scopes`

Опциональные marketplace-поля внутри `funpay-pulse.plugin.json`:

- `description`
- `short_description`
- `category`
- `tags`
- `support_url`
- `privacy_url`
- `terms_url`
- `screenshots`
- `pricing`
- `publisher`

Файл `funpay-pulse.marketplace.json` - отдельный SDK-файл для public review.
Он принимает только pricing/listing/support metadata: `pricing_type`,
`price_rub`, `access_duration_days`, `trial_days`, `category`, `summary`,
`publisher`, `support`, `support_url`, `privacy_url`, `refund_policy`.
`publisher.name` и `publisher.url` валидируются как metadata пакета для
review/listing draft. Это не verified identity, не ownership proof и не trust
source. Публичный verified author приходит только из server-side author profile,
привязанного к seller license владельца `PluginProduct`.

Текущий template по умолчанию использует `broker-poller`: `events` может содержать поддерживаемые event scopes, а `scopes` может быть пустым. Текущие public-safe scopes: `logs:write`, `storage:own`, `secrets:own`, `orders:read`, `orders:list` и `lots:read`; SDK и license-server validator по умолчанию отклоняют `messages:send`, config writes и прочие future scopes. Для roadmap/CI есть явный флаг `allow_future_scopes`; для вручную проверенных trusted manifests есть отдельный `trusted=True` / CLI `--trusted`, который локально разрешает только reviewed mutating set (`messages:send`, `orders:refund`, `orders:review`, `lots:active`, `lots:price`, `lots:raise`, `blacklist:add`, `blacklist:remove`) и не заменяет platform review/runtime flags. Unrelated dangerous scopes вроде `lots:write`, `blacklist:write` и `accounts:read_sensitive` остаются отклоненными.

## Plugin ID Rules

Стабильный lowercase ID:

```text
^[a-z][a-z0-9_]{2,63}$
```

Reserved IDs:

- все текущие first-party plugin IDs;
- `pulse_*`;
- `funpay_*`;
- `admin_*`;
- `system_*`.

Marketplace plugins должны иметь глобально уникальные IDs. Private plugins могут использовать тот же синтаксис, но внутри системы дополнительно scoped by owner.

## Events

Events очищаются. Они не должны содержать golden keys, connection tokens, raw cookies, decrypted secrets или нерелевантные данные других аккаунтов.

MVP events:

- `events:new_order`
- `events:new_message`
- `events:new_review`
- `events:order_confirmed`

Пример event:

```json
{
  "delivery_id": "del_01H...",
  "event_id": "evt_01H...",
  "event_type": "events:new_message",
  "payload": {
    "schema_version": "broker.events.v1",
    "event_type": "events:new_message",
    "occurred_at": "2026-04-28T12:30:00Z",
    "account_id": "42",
    "account_username": "seller",
    "chat_id": "456",
    "message_id": "789",
    "buyer_id": "123",
    "buyer_username": "buyer",
    "author_id": "123",
    "author_username": "buyer",
    "text": "Здравствуйте",
    "is_own": false,
    "is_system": false,
    "sender_type": "buyer"
  },
  "created_at": "2026-04-28T12:30:00",
  "delivered_at": "2026-04-28T12:30:01"
}
```

Polling example:

```python
import logging
import os

from funpay_pulse_sdk import BrokerClient

logger = logging.getLogger("my_plugin")

client = BrokerClient(
    base_url="https://funpaypulse.com",
    broker_token=os.environ["FPP_BROKER_TOKEN"],
)

for event in client.poll_events(limit=50):
    # Persist/process first. Ack only after the work is durable.
    logger.info("received broker event %s delivery=%s", event.event_type, event.delivery_id)
    client.ack_event(event.delivery_id)
```

For local development against a local license-server only, `BrokerClient` can be created with `allow_insecure_localhost=True`. This accepts plain HTTP only for real loopback hosts such as `localhost`, `127.0.0.1` or `::1`; production plugin apps must use HTTPS.

## Local Development With Fixtures

Текущий `pulse-plugin init` создает broker-poller template:

```bash
pulse-plugin init seller_auto_reply
cd seller_auto_reply
pulse-plugin validate funpay-pulse.plugin.json --allow-localhost
pulse-plugin check . --allow-localhost
pulse-plugin pack . --allow-localhost
python app.py --fixtures fixtures/events.json
```

Для плагинов, которым нужен order/lot контекст, есть отдельный template:

```bash
pulse-plugin init seller_order_helper --template order-assistant
cd seller_order_helper
python app.py --fixtures fixtures/events.json --write-log-actions
```

`order-assistant` показывает правильный безопасный паттерн для внешних
разработчиков: сначала `client.get_capabilities()`, затем только доступные
read-only `orders.get`, `orders.list`, `lots.get`, `lots.list`, plugin-owned
storage для метрик и Broker secret storage для внешних credentials. FunPay
credentials, cookies, `golden_key`, connection tokens и raw Worker internals в
plugin app не передаются.

Для manually reviewed плагинов, которым нужны FunPay-mutating actions, есть
отдельный trusted template:

```bash
pulse-plugin init seller_trusted_helper --template trusted-actions
cd seller_trusted_helper
pulse-plugin check . --allow-localhost --trusted
python app.py --fixtures fixtures/events.json --demo-reply --demo-review-reply --demo-refund --demo-disable-lot --demo-price 42.5 --demo-raise-lot --demo-blacklist-add
```

Этот template намеренно не является default. Его manifest безопасен по
умолчанию и запрашивает только `logs:write`; разработчик должен добавить ровно
те trusted mutating scopes, которые реально нужны (`messages:send`,
`orders:refund`, `orders:review`, `lots:active`, `lots:price`, `lots:raise`,
`blacklist:add`, `blacklist:remove`), затем пройти `--trusted`
локально и platform review перед production-доступом.

В коде plugin app можно использовать fixture client:

```python
from funpay_pulse_sdk import FixtureBrokerClient, NewMessageEvent, parse_broker_event

client = FixtureBrokerClient.from_file("fixtures/events.json")

for event in client.poll_events(limit=50):
    typed = parse_broker_event(event)
    if isinstance(typed, NewMessageEvent):
        print(typed.chat_id, typed.text)
    client.ack_event(event.delivery_id)
```

Fixtures эмулируют poll/ack delivery loop и локальную запись actions. Они не заменяют регистрацию plugin product, не выдают реальный `fppb_...` Broker token и не включают реальные action scopes.

`pulse-plugin check . --allow-localhost` является локальным non-executing gate:
он валидирует manifest и fixture deliveries через SDK parser, но не импортирует
и не запускает `app.py`. Это безопаснее для проверки чужого plugin source tree;
исполнение логики плагина остается отдельным явным шагом через `python app.py
--fixtures ...`.

Bundled demo fixtures могут использовать `created_at: "fixture:now"`, чтобы
локальные примеры не устаревали. Для тестов stale delivery rejection нужно
создавать отдельные fixtures с фиксированным старым `created_at`.

`pulse-plugin doctor . --allow-localhost` является более строгим локальным gate:

- валидирует manifest;
- парсит fixtures, если они есть;
- запускает тот же package scanner/packer во временный `.fppkg`;
- удаляет временный artifact после проверки;
- не вызывает server, не создает product, не загружает package и не выдает
  Broker token.

`doctor` обязателен как release/preflight gate перед `pack`, `publish --upload`
и заявкой в публичный marketplace. Если плагин использует trusted mutating
scopes, тот же gate нужно запускать с явным `--trusted`; это не заменяет
платформенное ревью и только разрешает локальную проверку reviewed scope set.

## Examples

Практичные examples лежат в `plugin-sdk/examples` и проверяются SDK release
gate:

- `auto_reply` - trusted автоответ через `messages.send`;
- `order_assistant` - безопасный read-first помощник по заказам и лотам;
- `external_crm_notifier` - подготовка событий для внешней CRM без секретов в
  install config;
- `trusted_action_review_sample` - демонстрация trusted actions с выключенным
  поведением по умолчанию и отдельным `dangerous-demo-config.json` только для
  локального review-теста.

Для обычных examples:

```bash
pulse-plugin check . --allow-localhost --require-fixtures
pulse-plugin test . --allow-localhost
pulse-plugin doctor . --allow-localhost --require-fixtures
```

Для trusted examples:

```bash
pulse-plugin check . --allow-localhost --trusted --require-fixtures
pulse-plugin test . --allow-localhost --trusted --config dangerous-demo-config.json
pulse-plugin doctor . --allow-localhost --trusted --require-fixtures
```

Любой новый example должен проходить эти команды до добавления в документацию
или release gate.

Для tagged SDK release запускайте gate с artifact directory:

```bash
SDK_RELEASE_ARTIFACT_DIR=plugin-sdk/dist/release tools/sdk_release_gate.sh
```

Этот режим копирует собранный wheel в release directory и пишет рядом
`SHA256SUMS` и `SHA256SUMS.json`. Эти файлы должны публиковаться вместе с
wheel, чтобы можно было сверить именно тот SDK artifact, который прошел gate.

## Проверенный SDK Flow

Текущий проверенный путь разработки до private upload:

1. Разработчик создает plugin source через `pulse-plugin init`.
2. Локально гоняет `check`, `test`, `doctor` и `pack`.
3. SDK собирает deterministic `.fppkg` artifact.
4. Разработчик загружает artifact через `pulse-plugin publish --upload` и
   отдельный `fppd_...` developer token.
5. Pulse UI/marketplace устанавливает plugin пользователю.
6. Для `broker-poller` Desktop запускает managed runner: package скачивается,
   проверяется и стартует без показа raw Broker token в renderer.
7. Для ручного/self-host fallback external runtime запускается с Broker token,
   читает install config/events и при необходимости скачивает pinned installed
   artifact через `download-package`.

Локальный gate, который сейчас покрыт тестами SDK:

```bash
pulse-plugin init seller_auto_reply
cd seller_auto_reply
pulse-plugin check . --allow-localhost
pulse-plugin test . --allow-localhost --write-log-actions
pulse-plugin doctor . --allow-localhost
pulse-plugin pack . --allow-localhost
pulse-plugin publish . --dry-run --offline --allow-localhost
```

Для реального upload token-file нужно держать вне plugin repo:

```bash
umask 077
token_file="$(mktemp "${TMPDIR:-/tmp}/pulse-developer-token.XXXXXX")"
trap 'rm -f "$token_file"' EXIT
printf 'Paste developer token: ' >&2
IFS= read -r -s developer_token
printf '\n' >&2
printf '%s\n' "$developer_token" > "$token_file"
unset developer_token
pulse-plugin publish . --upload --token-file "$token_file" --api https://funpaypulse.com
```

Если пакет готов не только к private upload, но и к public marketplace review,
добавь pricing и public-review metadata в корень плагина:

```json
{
  "pricing_type": "subscription",
  "price_rub": 350,
  "access_duration_days": 30,
  "trial_days": 0,
  "category": "automation",
  "summary": "Short marketplace description.",
  "support": {
    "telegram": "@developer"
  },
  "support_url": "https://your-domain.ru/support",
  "privacy_url": "https://your-domain.ru/privacy",
  "refund_policy": "Возврат рассматривается вручную через поддержку."
}
```

После этого CLI возьмет pricing/public-review snapshot из файла:

```bash
pulse-plugin publish . \
  --upload \
  --public-review \
  --token-file "$token_file" \
  --api https://funpaypulse.com
```

CLI-флаги `--pricing-type`, `--price-rub`, `--access-duration-days` и
`--trial-days` остаются ручным override-ом поверх файла.

Этот upload flow не устанавливает plugin, не открывает public marketplace
листинг, не выдает Broker token, не включает trusted scopes и не заменяет
platform review.

## Package Artifact

`pulse-plugin pack` собирает локальный review artifact после `validate`/`check`:

```bash
pulse-plugin pack . --allow-localhost
```

Для manually reviewed trusted manifests нужно использовать тот же профиль, что
и при проверке:

```bash
pulse-plugin pack . --allow-localhost --trusted
```

Default output:

```text
dist/<plugin_id>-<version>.fppkg
```

Формат `.fppkg` сейчас:

- deterministic zip archive;
- root metadata file `funpay-pulse-package.json`;
- plugin source files under `plugin/`;
- package metadata: `package_format="funpay-pulse-plugin-package"`,
  `package_version=1`, `plugin_id`, `plugin_version`,
  `manifest_sha256`, `file_count`, `total_source_bytes`, per-file
  `path/size/sha256`;
- printed `package_sha256` is the server upload/review artifact identity.

Packer intentionally rejects:

- symlinks and unsafe paths;
- dotfiles/hidden paths;
- cache, VCS, venv, build and dist directories;
- native/binary/database file types such as `.so`, `.dll`, `.dylib`, `.exe`,
  `.pyc`, `.sqlite`, `.db`;
- oversized files and oversized source/package payloads;
- secret-like filenames such as token/password/cookie/private-key files;
- raw `fppb_...` Broker tokens, raw `fppi_...` invite tokens, private key
  blocks, Bearer/JWT/GitHub/OpenAI-style token patterns and obvious
  `golden_key` / `connection_token` / `broker_token` / generic token or secret
  assignments in text files;
- external or unsafe `--fixtures ../...` paths; package fixtures must be a
  relative file inside the plugin directory and included in the artifact when
  present.

Server private upload uses the same artifact boundary. The private endpoint:

```http
POST /api/v2/plugin-marketplace/products/{product_public_id}/versions/package
Content-Type: application/json

{
  "package_base64": "<base64 .fppkg>",
  "package_sha256": "optional expected sha256"
}
```

Server-side validation does not trust the local SDK packer. It recomputes the
package SHA-256, parses the zip safely, rejects unsafe paths/symlinks/native or
binary/database files, checks `funpay-pulse-package.json`, verifies every
inventory entry hash and size, validates `plugin/funpay-pulse.plugin.json`
through the license-server manifest validator, scans packaged text for obvious
secrets, and requires the package `plugin_id` to match the private product.

The server stores the artifact under `CUSTOM_PLUGIN_PACKAGE_STORAGE` using only
the computed package SHA-256. API responses expose only safe metadata:
`package_sha256`, `package_size_bytes`, `package_file_count` and
`package_uploaded_at`. Raw package bytes, source files and storage paths are not
returned.

This is still an artifact/review gate. It does not approve marketplace
publication, does not issue Broker tokens, does not install the plugin, and does
not execute plugin code inside Worker/Backend.

## Installed Package Delivery

После установки external runtime/SDK может получить только свою pinned версию
пакета по Broker token:

```http
GET /api/v2/broker/package/manifest
Authorization: Bearer fppb_...
```

Ответ `no-store` содержит `installation_id`, `product_public_id`, `plugin_id`,
version, runtime type, server-canonical `manifest_sha256`, manifest JSON,
installation scopes, config/install revisions и safe package metadata.
`package_storage_path`, token hashes, raw Broker token, buyer license ids,
payment/provider internals и package bytes в manifest response не возвращаются.

Скачать сам artifact можно отдельно:

```http
GET /api/v2/broker/package/download
Authorization: Bearer fppb_...
```

Download привязан к `installation.version_id`, а не к текущей версии продукта.
Перед отдачей server проверяет storage root, ожидаемую форму пути
`<sha[:2]>/<sha>.fppkg`, размер файла и SHA-256. Missing/tampered package
возвращает generic `409 plugin package integrity check failed`, без внутреннего
пути и без package SHA в ошибке. Фича закрыта по умолчанию флагом
`CUSTOM_PLUGIN_BROKER_PACKAGE_DOWNLOAD_ENABLED=false`.

В SDK это обычный BrokerClient flow:

```python
package_manifest = client.get_package_manifest()
download = client.download_package(
    expected_sha256=package_manifest.package_sha256,
)

assert download.package_sha256 == package_manifest.package_sha256
```

`download_package()` проверяет `X-Package-SHA256`, `X-Package-Size-Bytes`,
фактический размер payload и фактический SHA-256 перед тем, как вернуть bytes.
Клиент использует no-redirect opener и не принимает `package_storage_path` в
manifest response.

CLI flow для скачивания установленного artifact. Для операционной установки
предпочитай временный token-file, а не environment variable и не command-line
token:

```bash
umask 077
token_file="$(mktemp "${TMPDIR:-/tmp}/pulse-broker-token.XXXXXX")"
trap 'rm -f "$token_file"' EXIT
printf 'Paste Broker token: ' >&2
IFS= read -r -s broker_token
printf '\n' >&2
printf '%s\n' "$broker_token" > "$token_file"
unset broker_token
pulse-plugin download-package --api https://funpaypulse.com --broker-token-file "$token_file" --out installed.fppkg
```

`download-package` сначала читает manifest, затем скачивает package с
`expected_sha256=manifest.package_sha256`, не перезаписывает существующий файл
без `--force`, валидирует token до HTTP и не печатает raw Broker token. Для
реальных установок token-file лучше держать во временном файле вне plugin repo;
локальные `.pulse-broker-token` и `.pulse-developer-token` добавлены в SDK
`.gitignore` только как дополнительная страховка. Для локального
license-server plain HTTP разрешается только через явный
`--allow-insecure-localhost`.

## PluginApp Dispatcher

Обычный плагин не должен вручную писать цикл `poll -> parse -> handle -> ack`. Для этого в SDK есть `PluginApp`:

```python
from funpay_pulse_sdk import FixtureBrokerClient, NewMessageEvent, PluginApp

client = FixtureBrokerClient.from_file("fixtures/events.json")
app = PluginApp(client)

@app.on(NewMessageEvent)
def handle_message(event):
    print(event.chat_id, event.text)

app.process_once(limit=50)
```

Handler можно объявлять с одним аргументом `event` или с двумя аргументами `event, context`. `context` содержит текущий Broker client, read-only install config и `config_revision`.

Ack policy:

- delivery ack делается только после успешного завершения всех matching handlers;
- если handler падает, delivery остается unacked и Broker сможет отдать его повторно после visibility timeout;
- если включен `write_log_actions=True`, ошибка отправки `logs.write` тоже не ack-ает delivery;
- known typed event без handler ack-ается после parse, чтобы не создавать бесконечные повторы для событий, которые plugin явно не обрабатывает.

Production loop:

```python
app.run_forever(limit=50, poll_interval_seconds=3.0)
```

Async handlers:

```python
@app.on(NewMessageEvent)
async def handle_message(event, context):
    await do_work(event)

await app.process_once_async(limit=50)
```

Синхронный `process_once()` явно отклоняет `async def` handlers до polling, чтобы случайно не ack-нуть delivery без выполнения handler body.

## Install Config

External plugin app can read only its own installation config through the same Broker token:

```http
GET /api/v2/broker/config
Authorization: Bearer fppb_...
```

Response:

```json
{
  "config": {
    "enabled": true,
    "reply_template": "Здравствуйте"
  },
  "config_revision": 1
}
```

SDK:

```python
config = client.get_config().config
if config.get("enabled") is False:
    return
```

This is read-only. Plugin-side config mutation is not implemented yet.

## Runtime Capabilities

Плагин может получить feature/scopes snapshot своей installation:

```http
GET /api/v2/broker/capabilities
Authorization: Bearer fppb_...
```

Response:

```json
{
  "broker_events_enabled": true,
  "broker_actions_enabled": true,
  "broker_storage_enabled": true,
  "broker_secrets_enabled": true,
  "scopes": ["events:new_message", "logs:write", "storage:own", "secrets:own", "orders:read", "orders:list", "lots:read"],
  "supported_actions": ["logs.write", "lots.get", "lots.list", "orders.get", "orders.list"],
  "storage_authorized": true,
  "storage_limits": {
    "max_items": 128,
    "max_key_length": 128,
    "max_value_bytes": 16384,
    "max_total_bytes": 262144
  },
  "secret_storage_authorized": true,
  "secret_storage_limits": {
    "max_items": 64,
    "max_key_length": 128,
    "max_value_bytes": 16384,
    "max_total_bytes": 262144
  },
  "config_revision": 1
}
```

SDK:

```python
capabilities = client.get_capabilities()
if "logs.write" in capabilities.supported_actions:
    client.write_log("ready", idempotency_key="log-ready-v1")
```

Если установка имеет `orders:read`, `orders:list` или `lots:read`, `supported_actions` будет содержать соответствующие `orders.get`, `orders.list`, `lots.get` или `lots.list`. Эти query actions read-only, но все равно требуют явного подтверждения прав при установке. Если trusted runtime включает `messages.send`, `orders.refund`, `orders.review.reply`, `lots.active.set`, `lots.price.set` или `lots.raise`, `supported_actions` будет содержать соответствующие action names. Обычные установки не должны полагаться на эти значения без явной выдачи trusted scope.

## Plugin Storage

Current storage API is deliberately narrow and non-secret:

```http
PUT /api/v2/broker/storage/state
Authorization: Bearer fppb_...
Content-Type: application/json

{
  "value": {
    "counter": 1,
    "last_order_id": "ORD-1"
  }
}
```

Read:

```http
GET /api/v2/broker/storage/state
Authorization: Bearer fppb_...
```

Delete:

```http
DELETE /api/v2/broker/storage/state
Authorization: Bearer fppb_...
```

SDK:

```python
client.set_storage_item("state", {"counter": 1})
state = client.get_storage_item("state").value
client.delete_storage_item("state")
```

Rules:

- requires manifest/install scope `storage:own`;
- storage is isolated by `PluginInstallation`, not only by product or owner;
- max key length: 128 display-safe chars;
- max value size: 16 KiB;
- max items per installation: 128;
- max total stored value bytes per installation: 256 KiB;
- secret-like keys/values and raw `fppb_...` tokens are rejected;
- this is not secret storage and must not be used for FunPay credentials, API keys, passwords or golden keys.

## Plugin Secrets

Secret storage is separate from non-secret storage. It exists for third-party provider keys that a plugin needs at runtime.

```http
PUT /api/v2/broker/secrets/external_api_key
Authorization: Bearer fppb_...
Content-Type: application/json

{
  "value": "sk_test_external"
}
```

Set response returns metadata only:

```json
{
  "key": "external_api_key",
  "value_size_bytes": 16,
  "created": true,
  "updated_at": "2026-05-02T12:00:00"
}
```

Read:

```http
GET /api/v2/broker/secrets/external_api_key
Authorization: Bearer fppb_...
```

Delete:

```http
DELETE /api/v2/broker/secrets/external_api_key
Authorization: Bearer fppb_...
```

SDK:

```python
client.set_secret_item("external_api_key", "sk_test_external")
api_key = client.get_secret_item("external_api_key").value
client.delete_secret_item("external_api_key")
```

Rules:

- requires license-server `CUSTOM_PLUGIN_BROKER_SECRETS_ENABLED=true`;
- requires configured `CUSTOM_PLUGIN_SECRET_ENCRYPTION_KEY` as a Fernet key;
- requires manifest/install scope `secrets:own`;
- secrets are isolated by `PluginInstallation`;
- set responses never echo plaintext;
- key format: 1..128 chars, `A-Z a-z 0-9 . _ : -`;
- max value size: 16 KiB;
- max items per installation: 64;
- max total secret value bytes per installation: 256 KiB;
- Pulse/FunPay internal keys such as `golden_key`, `connection_token`, `signing_secret`, raw `fppb_...` Broker tokens and raw `fppi_...` invite tokens are rejected.

## Webhook Push Security

Webhook push delivery реализован как feature-flagged beta runtime for
`runtime.type="webhook"`. Plugin получает derived HMAC secret через Broker
token auth:

```python
from funpay_pulse_sdk import BrokerClient

secret = BrokerClient.from_env().get_webhook_secret().webhook_secret
```

Pulse отправляет webhook requests с headers:

- `X-FPP-Timestamp`
- `X-FPP-Nonce`
- `X-FPP-Signature`

Signature:

```text
hex(hmac_sha256(webhook_secret, timestamp + "." + nonce + "." + raw_body))
```

Правила:

- Reject timestamps старше 5 минут.
- Reject reused nonce/delivery pairs на стороне plugin, если plugin хранит
  idempotency state.
- Verify signature до JSON parsing.
- Webhook должен отвечать быстро; текущий server timeout по умолчанию 2 секунды.
- Долгую работу plugin должен делать асинхронно на своей стороне.
- Production webhook URL должен быть HTTPS, без credentials, и не должен
  указывать или резолвиться в private/link-local/multicast/reserved/non-public
  IP ranges. `localhost`/`127.*` разрешается только при
  `CUSTOM_PLUGIN_BROKER_WEBHOOK_ALLOW_LOCALHOST=true` для local development.
- License-server делает pinned connect к уже проверенному IP с original Host/SNI,
  не следует redirects и не читает webhook response body целиком. Поэтому
  runtime должен передавать смысл ошибки через свои логи, а не рассчитывать на
  хранение большого response body на стороне Pulse.
- 2xx response ack-ает delivery, non-2xx/timeout оставляет delivery pollable
  через `GET /api/v2/broker/events`.
- Повторные push attempts делает license-server server-side dispatcher и/или
  signed Worker/Backend dispatch tick. Dispatch не раскрывает plugin payload,
  webhook URL, raw Broker token или last_error; он возвращает только signed
  counters. Если Worker офлайн, polling fallback остается обязательным recovery
  path после восстановления runtime, но уже сохраненные due deliveries может
  повторить server-side dispatcher.

## Current Actions

Action API сейчас имеет два уровня:

- public-safe action: `logs.write`, required scope `logs:write`;
- delivery-bound read-only query action: `orders.get`, required scope `orders:read`;
- cached read-only query action: `orders.list`, required scope `orders:list`;
- delivery-bound read-only query action: `lots.get`, required scope `lots:read`;
- cached read-only query action: `lots.list`, required scope `lots:read`;
- trusted/feature-gated mutating action: `messages.send`, required scope `messages:send`, disabled by default and still rejected by normal private registration.
- trusted/feature-gated mutating action: `orders.refund`, required scope `orders:refund`, disabled by default and still rejected by normal private registration.
- trusted/feature-gated mutating action: `orders.review.reply`, required scope `orders:review`, disabled by default and still rejected by normal private registration.
- trusted/feature-gated mutating action: `lots.active.set`, required scope `lots:active`, disabled by default and still rejected by normal private registration.
- trusted/feature-gated mutating action: `lots.price.set`, required scope `lots:price`, disabled by default and still rejected by normal private registration.
- trusted/feature-gated mutating action: `lots.raise`, required scope `lots:raise`, disabled by default and still rejected by normal private registration.
- trusted/feature-gated mutating action: `blacklist.add`, required scope `blacklist:add`, disabled by default and still rejected by normal private registration.
- trusted/feature-gated mutating action: `blacklist.remove`, required scope `blacklist:remove`, disabled by default and still rejected by normal private registration.

`logs.write` request:

Пример:

```http
POST /api/v2/broker/actions
Authorization: Bearer fppb_...
Idempotency-Key: log-delivery-456-v1
Content-Type: application/json
```

```json
{
  "type": "logs.write",
  "input": {
    "level": "info",
    "message": "processed delivery",
    "context": { "delivery_id": "bld_..." }
  }
}
```

SDK convenience:

```python
client.write_log(
    "processed delivery",
    level="info",
    context={"delivery_id": event.delivery_id},
    idempotency_key=f"log-{event.delivery_id}",
)
```

Status/result:

```http
GET /api/v2/broker/actions/pla_...
Authorization: Bearer fppb_...
```

```json
{
  "success": true,
  "action_id": "pla_...",
  "action_type": "logs.write",
  "status": "queued",
  "idempotency_key_hash": "sha256-of-idempotency-key",
  "attempt_count": 0,
  "created_at": "2026-05-02T10:00:00",
  "updated_at": "2026-05-02T10:00:00",
  "claimed_at": null,
  "lease_until": null,
  "completed_at": null,
  "result": {},
  "error_code": null,
  "error_message": null
}
```

SDK:

```python
action = client.write_log(
    "processed delivery",
    level="info",
    context={"delivery_id": event.delivery_id},
    idempotency_key=f"log-{event.delivery_id}",
)
status = client.get_action(action.action_id)
```

Status/result lookup is installation-isolated, returns `Cache-Control: no-store`, and never returns action input or Worker `lease_token`.

For read/query actions, SDK callers should parse terminal success results
through typed helpers:

```python
status = client.get_action(action.action_id)
if status.status == "succeeded":
    order = status.order_result()
    print(order.order_id, order.buyer_username, order.price)
```

`BrokerActionStatus.order_result()`, `.orders_page_result()`,
`.lot_result()`, `.lots_page_result()` and `.order_refund_result()` all reject
non-`succeeded` statuses and mismatched action types.

Action security rules:

- required `Authorization: Bearer fppb_...`;
- required `Idempotency-Key`, unique per installation;
- same key + same normalized raw action/input digest returns the same action with `created=false`;
- same key + different action/input returns `409`;
- sensitive input keys, request metadata, and raw `fppb_...` values are redacted before DB storage and audit storage;
- SDK `BrokerClient` rejects unknown action types before HTTP submission.

### `orders.get`

`orders.get` is a read-only query action for a delivery-bound order. It uses the same Broker queue/claim/report path as executor actions, but it does not mutate FunPay.

SDK:

```python
capabilities = client.get_capabilities()
if "orders.get" in capabilities.supported_actions:
    action = client.get_order(
        account_id=event.account_id,
        order_id=event.order_id,
        delivery_id=event.delivery_id,
        idempotency_key=f"order-get-{event.delivery_id}",
    )
```

Typed result:

```python
status = client.get_action(action.action_id)
if status.status == "succeeded":
    order = status.order_result()
    print(order.order_id, order.status, order.buyer_username)
```

Rules:

- requires manifest/install scope `orders:read`;
- `account_id`, `order_id`, and `delivery_id` must come from a sanitized order/review Broker event;
- license-server verifies same installation, same VPS/license, delivered/acked delivery, event type, read freshness from immutable delivery `created_at`, and matching `account_id/order_id`;
- Worker/Backend reads the order through the local encrypted account and reports only a safe allowlist: order id/status, buyer id/name, chat id, lot id, title, price, quantity/category and review summary;
- `order_secrets`, buyer params, raw HTML, cookies, CSRF, full raw descriptions and credentials are not exposed.

### `orders.list`

`orders.list` is a read-only query action for the local sanitized order cache of one delivery-bound account. It does not call FunPay live APIs and does not decrypt `golden_key`.

SDK:

```python
capabilities = client.get_capabilities()
if "orders.list" in capabilities.supported_actions:
    action = client.list_orders(
        account_id=event.account_id,
        delivery_id=event.delivery_id,
        status="paid",
        limit=25,
        idempotency_key=f"orders-list-{event.delivery_id}-v1",
    )
```

Input:

```json
{
  "type": "orders.list",
  "input": {
    "account_id": "1",
    "delivery_id": "bld_...",
    "status": "paid",
    "limit": 25,
    "cursor": "99"
  }
}
```

Result shape:

```json
{
  "items": [
    {
      "account_id": "1",
      "order_id": "ABC123",
      "status": "paid",
      "buyer_username": "buyer",
      "chat_id": "123",
      "lot_id": "555",
      "title": "Safe order",
      "price": 10.5,
      "quantity": 1
    }
  ],
  "count": 1,
  "has_more": false,
  "next_cursor": null
}
```

Typed result:

```python
status = client.get_action(action.action_id)
if status.status == "succeeded":
    page = status.orders_page_result()
    for order in page.items:
        print(order.order_id, order.status)
```

Rules:

- requires manifest/install scope `orders:list`;
- input is `account_id`, `delivery_id`, optional `status` (`paid`, `closed`), optional `limit` from `1..50`, and optional positive integer `cursor`;
- license-server accepts only order/review deliveries (`events:new_order`, `events:order_confirmed`, `events:new_review`) and rejects message deliveries;
- license-server verifies same installation, same VPS/license, delivered/acked delivery, read freshness from immutable delivery `created_at`, and matching `account_id`;
- Worker/Backend reads only local `BrokerOrderCache` rows created from sanitized Broker events for an active local account;
- result uses the same safe order allowlist as `orders.get`;
- no live FunPay request is made, and `golden_key`, buyer params, raw HTML, raw descriptions, cookies, CSRF, proxy/user-agent and credentials are not exposed.

### `lots.get`

`lots.get` is a read-only query action for a delivery-bound lot. It returns cached safe lot metadata from the local Worker/Backend DB.

SDK:

```python
capabilities = client.get_capabilities()
if "lots.get" in capabilities.supported_actions:
    action = client.get_lot(
        account_id=event.account_id,
        lot_id=event.lot_id,
        delivery_id=event.delivery_id,
        idempotency_key=f"lot-get-{event.delivery_id}",
    )
```

Typed result:

```python
status = client.get_action(action.action_id)
if status.status == "succeeded":
    lot = status.lot_result()
    print(lot.lot_id, lot.title, lot.active)
```

Rules:

- requires manifest/install scope `lots:read`;
- `account_id`, `lot_id`, and `delivery_id` must come from a sanitized order Broker event;
- license-server verifies same installation, same VPS/license, delivered/acked delivery, event type, read freshness from immutable delivery `created_at`, and matching `account_id/lot_id`;
- Worker/Backend returns only safe cached lot fields: title, price, currency, active flag, auto-delivery flag, amount, category/subcategory and raise timestamps;
- raw FunPay edit fields, CSRF tokens, calculated buyer price tables and arbitrary lot form fields are not exposed.

### `lots.list`

`lots.list` is a read-only query action for the local cached lot list of one delivery-bound account. It does not refresh FunPay live data and does not expose raw lot edit forms.

SDK:

```python
capabilities = client.get_capabilities()
if "lots.list" in capabilities.supported_actions:
    action = client.list_lots(
        account_id=event.account_id,
        delivery_id=event.delivery_id,
        limit=50,
        idempotency_key=f"lots-list-{event.delivery_id}-v1",
    )
```

Input:

```json
{
  "type": "lots.list",
  "input": {
    "account_id": "1",
    "delivery_id": "bld_...",
    "limit": 50,
    "cursor": "555"
  }
}
```

Result shape:

```json
{
  "items": [
    {
      "account_id": "1",
      "lot_id": "555",
      "title": "Safe lot",
      "price": 99,
      "currency": "RUB",
      "active": true
    }
  ],
  "count": 1,
  "has_more": false,
  "next_cursor": null
}
```

Typed result:

```python
status = client.get_action(action.action_id)
if status.status == "succeeded":
    page = status.lots_page_result()
    for lot in page.items:
        print(lot.lot_id, lot.title, lot.active)
```

Rules:

- requires manifest/install scope `lots:read`;
- input is `account_id`, `delivery_id`, optional `limit` from `1..100`, and optional positive integer `cursor`;
- license-server verifies same installation, same VPS/license, delivered/acked delivery, read freshness from immutable delivery `created_at`, and matching `account_id`;
- Worker/Backend reads only local cached `Lot` rows for an active local account and orders by `funpay_lot_id`;
- result uses the same safe lot allowlist as `lots.get`;
- raw FunPay edit fields, CSRF tokens, hidden form payloads, buyer price tables, cookies, tokens and credentials are not exposed.

### `messages.send`

`messages.send` is implemented as a queue plus Worker/Backend executor foundation, not as direct plugin access to FunPay credentials.

Enablement requirements:

- license-server `CUSTOM_PLUGIN_BROKER_ACTIONS_ENABLED=true`;
- license-server `CUSTOM_PLUGIN_BROKER_MESSAGES_SEND_ENABLED=true`;
- installation has scope `messages:send`;
- product has `review_state="approved"` and `trust_state="trusted"`;
- Worker/Backend has `CUSTOM_PLUGIN_BROKER_ACTION_EXECUTOR_ENABLED=true`;
- the platform owner has allowed a trusted registration path that accepts `messages:send`.

Plugin request:

```json
{
  "type": "messages.send",
  "input": {
    "account_id": "42",
    "chat_id": "456",
    "delivery_id": "bld_...",
    "text": "Здравствуйте"
  }
}
```

Input rules:

- `account_id`: positive numeric account id from the sanitized event payload;
- `chat_id`: positive numeric chat id from the sanitized event payload;
- `delivery_id`: the Broker delivery id being handled; server verifies that account/chat match this delivery;
- `text`: string, 1..2000 chars after trim;
- raw Broker tokens, credentials, cookies, golden keys and secret-like values are rejected/redacted.

Executor behavior:

- Worker/Backend claims executable actions through HMAC-signed `/api/v2/broker/actions/claim`;
- license-server re-checks installation, product/version status, product trusted runtime state, license entitlement, VPS, grant status and required scope before claim;
- license-server verifies that `delivery_id` belongs to the same installation and that `account_id/chat_id` match the sanitized event payload;
- license-server requires a fresh delivery and limits how many sends can be created from one delivery;
- license-server applies atomic DB-backed quota buckets: queued/executing per installation, per-account/hour, per-chat/minute, per-delivery, and per-installation/day;
- claim marks `queued -> executing`, increments `attempt_count`, sets `claimed_at` and `lease_until`;
- claim returns a per-claim `lease_token`; stale reports with old attempt/lease metadata are rejected;
- Worker/Backend resolves local `Account.id`, decrypts local `golden_key`, and reuses existing `FunPayClient.send_message(chat_id, text)`;
- Worker/Backend keeps a local `broker_action_executions` ledger so a reclaimed already-succeeded action is reported again without sending a duplicate message;
- report goes through HMAC-signed `/api/v2/broker/actions/report`;
- report stores `succeeded` or `failed`, redacted result/error and audit rows;
- license-server returns replay counts for already terminal reports.
- plugin app observes terminal state through `client.get_action(action.action_id)`.

Exactly-once note: FunPay itself does not expose an idempotent message-send primitive. The executor prevents duplicate sends after a recorded local success, but a process crash after FunPay accepts the message and before local ledger/report persistence can still leave an unknown outcome. Treat `messages.send` as at-least-once under crash failure and keep plugin replies idempotent by content/idempotency key.

SDK:

```python
capabilities = client.get_capabilities()
if "messages.send" in capabilities.supported_actions:
    action = client.send_message(
        account_id=event.account_id,
        chat_id=event.chat_id,
        delivery_id=event.delivery_id,
        text="Здравствуйте",
        idempotency_key=f"reply-{event.delivery_id}",
    )
    status = client.get_action(action.action_id)
    if status.status == "succeeded":
        result = status.message_send_result()
        print(result.message_id)
```

Fixture tests must opt in explicitly:

```python
client = FixtureBrokerClient(events, allow_message_actions=True)
```

### `orders.refund`

`orders.refund` is a narrow trusted order-control foundation. It can refund only
one fresh order from an `events:new_order` delivery that the plugin actually
received. It does not expose arbitrary order history, delivery approval/reject,
buyer params, order secrets, raw FunPay fields, or direct FunPay credentials.

Enablement requirements:

- license-server `CUSTOM_PLUGIN_BROKER_ACTIONS_ENABLED=true`;
- license-server `CUSTOM_PLUGIN_BROKER_ORDERS_REFUND_ENABLED=true`;
- installation has scope `orders:refund`;
- product has `review_state="approved"` and `trust_state="trusted"`;
- Worker/Backend has `CUSTOM_PLUGIN_BROKER_ACTION_EXECUTOR_ENABLED=true`;
- the platform owner has allowed a trusted registration path that accepts `orders:refund`.

Plugin request:

```json
{
  "type": "orders.refund",
  "input": {
    "account_id": "42",
    "order_id": "ABCD1234",
    "delivery_id": "bld_..."
  }
}
```

Security rules:

- `account_id`: positive numeric account id from the sanitized new-order delivery payload;
- `order_id`: FunPay order id from the same sanitized delivery payload;
- `delivery_id`: the Broker delivery id being handled;
- server accepts only `events:new_order` deliveries and verifies installation, VPS/license, account and order binding before queueing;
- delivery must already be delivered or acked and fresh within one hour;
- if the sanitized event includes order status, it must be `paid`, `new` or `active`;
- server applies DB-backed quotas: queued/executing per installation, per-installation/day, per-account/hour, one refund per order and one refund per delivery;
- Worker/Backend re-checks local active `Account`, decrypts local `golden_key`, reads current order state, skips already-refunded orders idempotently, calls `FunPayClient.refund(...)` only for paid orders, writes an account warning log and reports only safe result fields.

SDK:

```python
capabilities = client.get_capabilities()
if "orders.refund" in capabilities.supported_actions:
    action = client.refund_order(
        account_id=event.account_id,
        order_id=event.order_id,
        delivery_id=event.delivery_id,
        idempotency_key=f"order-refund-{event.delivery_id}",
    )
    status = client.get_action(action.action_id)
    if status.status == "succeeded":
        result = status.order_refund_result()
        print(result.order_id, result.refunded, result.already_refunded)
```

Fixture tests must opt in explicitly:

```python
client = FixtureBrokerClient(events, allow_order_refund_actions=True)
```

### `orders.review.reply`

`orders.review.reply` is a narrow trusted review-reply foundation. It can reply
only to one fresh `events:new_review` delivery that belongs to the same
installation and has no existing reply. It does not expose buyer params, raw
FunPay forms, CSRF tokens, credentials, arbitrary rating edits, or direct Worker
access.

Enablement requirements:

- license-server `CUSTOM_PLUGIN_BROKER_ACTIONS_ENABLED=true`;
- license-server `CUSTOM_PLUGIN_BROKER_ORDERS_REVIEW_REPLY_ENABLED=true`;
- installation has scope `orders:review`;
- product has `review_state="approved"` and `trust_state="trusted"`;
- Worker/Backend has `CUSTOM_PLUGIN_BROKER_ACTION_EXECUTOR_ENABLED=true`;
- the platform owner has allowed a trusted registration path that accepts `orders:review`.

Plugin request:

```json
{
  "type": "orders.review.reply",
  "input": {
    "account_id": "42",
    "order_id": "ABCD1234",
    "delivery_id": "bld_...",
    "text": "Спасибо за отзыв."
  }
}
```

Security rules:

- `account_id`: positive numeric account id from the sanitized new-review delivery payload;
- `order_id`: FunPay order id from the same sanitized delivery payload;
- `delivery_id`: the Broker delivery id being handled;
- `text`: reply text, trimmed and capped at 1000 characters;
- server accepts only `events:new_review` deliveries and verifies installation, VPS/license, account and order binding before queueing;
- server rejects deliveries that already have `has_reply=true`;
- plugin input cannot include `rating`; server derives rating from the immutable sanitized review delivery and injects it only into Worker input;
- delivery must already be delivered or acked and fresh within one hour;
- server applies DB-backed quotas: queued/executing per installation, per-installation/day, per-account/hour, one reply per order and one reply per delivery;
- Worker/Backend re-checks local active `Account`, decrypts local `golden_key`, reads current order state, skips already-replied reviews idempotently, calls `FunPayClient.send_review(order_id, text, rating)`, updates local `BrokerOrderCache.review_has_reply`, writes an account log and reports only safe result fields.

SDK:

```python
capabilities = client.get_capabilities()
if "orders.review.reply" in capabilities.supported_actions:
    action = client.reply_to_review(
        account_id=event.account_id,
        order_id=event.order_id,
        delivery_id=event.delivery_id,
        text="Спасибо за отзыв.",
        idempotency_key=f"review-reply-{event.delivery_id}",
    )
    status = client.get_action(action.action_id)
    if status.status == "succeeded":
        result = status.order_review_reply_result()
        print(result.order_id, result.replied, result.already_replied)
```

Fixture tests must opt in explicitly:

```python
client = FixtureBrokerClient(events, allow_order_review_reply_actions=True)
```

### `lots.active.set`

`lots.active.set` is the first narrow lot-control foundation. It only toggles one delivery-bound lot on/off. It does not expose price edits, description edits, raw FunPay lot fields, bulk toggles, delivery settings, lot creation or lot copying.

Enablement requirements:

- license-server `CUSTOM_PLUGIN_BROKER_ACTIONS_ENABLED=true`;
- license-server `CUSTOM_PLUGIN_BROKER_LOTS_ACTIVE_SET_ENABLED=true`;
- installation has scope `lots:active`;
- product has `review_state="approved"` and `trust_state="trusted"`;
- Worker/Backend has `CUSTOM_PLUGIN_BROKER_ACTION_EXECUTOR_ENABLED=true`;
- the platform owner has allowed a trusted registration path that accepts `lots:active`.

Plugin request:

```json
{
  "type": "lots.active.set",
  "input": {
    "account_id": "42",
    "lot_id": "555",
    "enabled": false,
    "delivery_id": "bld_..."
  }
}
```

Security rules:

- `account_id`: positive numeric account id from the sanitized order delivery payload;
- `lot_id`: positive numeric FunPay lot id from the sanitized order delivery payload;
- `enabled`: boolean target state;
- `delivery_id`: the Broker delivery id being handled;
- server verifies installation, delivery, event type, account and lot binding before queueing;
- server applies DB-backed quotas per installation, account, lot and delivery;
- Worker/Backend re-checks local `Account`, local `Lot`, decrypted `golden_key`, calls `FunPayClient.set_lot_active(...)`, updates local `Lot.active`, writes an account log and reports safe result fields.

SDK:

```python
capabilities = client.get_capabilities()
if "lots.active.set" in capabilities.supported_actions:
    action = client.set_lot_active(
        account_id=event.account_id,
        lot_id=event.lot_id,
        enabled=False,
        delivery_id=event.delivery_id,
        idempotency_key=f"lot-active-{event.delivery_id}",
    )
    status = client.get_action(action.action_id)
    if status.status == "succeeded":
        result = status.lot_active_result()
        print(result.lot_id, result.active, result.already_set)
```

Fixture tests must opt in explicitly:

```python
client = FixtureBrokerClient(events, allow_lot_actions=True)
```

### `lots.price.set`

`lots.price.set` is a narrow trusted price-control foundation. It only changes one delivery-bound lot price. It does not expose description edits, raw FunPay lot fields, bulk price changes, delivery settings, lot creation or lot copying.

Enablement requirements:

- license-server `CUSTOM_PLUGIN_BROKER_ACTIONS_ENABLED=true`;
- license-server `CUSTOM_PLUGIN_BROKER_LOTS_PRICE_SET_ENABLED=true`;
- installation has scope `lots:price`;
- product has `review_state="approved"` and `trust_state="trusted"`;
- Worker/Backend has `CUSTOM_PLUGIN_BROKER_ACTION_EXECUTOR_ENABLED=true`;
- the platform owner has allowed a trusted registration path that accepts `lots:price`.

Plugin request:

```json
{
  "type": "lots.price.set",
  "input": {
    "account_id": "42",
    "lot_id": "555",
    "price": 42.5,
    "delivery_id": "bld_..."
  }
}
```

Security rules:

- `account_id`: positive numeric account id from the sanitized order delivery payload;
- `lot_id`: positive numeric FunPay lot id from the sanitized order delivery payload;
- `price`: positive finite number, max two decimals, bounded by the server max;
- `delivery_id`: the Broker delivery id being handled;
- server verifies installation, delivery, event type, account and lot binding before queueing;
- server applies DB-backed quotas per installation, account, lot and delivery;
- Worker/Backend re-checks local `Account`, local `Lot`, decrypted `golden_key`, calls `FunPayClient.set_lot_price(...)`, updates local `Lot.price`, writes an account log and reports safe result fields.

SDK:

```python
capabilities = client.get_capabilities()
if "lots.price.set" in capabilities.supported_actions:
    action = client.set_lot_price(
        account_id=event.account_id,
        lot_id=event.lot_id,
        price=42.5,
        delivery_id=event.delivery_id,
        idempotency_key=f"lot-price-{event.delivery_id}",
    )
    status = client.get_action(action.action_id)
    if status.status == "succeeded":
        result = status.lot_price_result()
        print(result.lot_id, result.price, result.already_set)
```

Fixture tests must opt in explicitly:

```python
client = FixtureBrokerClient(events, allow_lot_price_actions=True)
```

### `lots.raise`

`lots.raise` is a narrow trusted lot-raise foundation. FunPay raises by subcategory, so the Broker authorizes the action through one delivery-bound lot and then treats the actual effect as subcategory-level. The plugin cannot pass `game_id`, raw form fields, node ids, CSRF values, or bulk subcategory ids. Worker/Backend derives subcategory/category from the local `Lot` plus `FunPayClient.get_categories()`.

Enablement requirements:

- license-server `CUSTOM_PLUGIN_BROKER_ACTIONS_ENABLED=true`;
- license-server `CUSTOM_PLUGIN_BROKER_LOTS_RAISE_ENABLED=true`;
- installation has scope `lots:raise`;
- product has `review_state="approved"` and `trust_state="trusted"`;
- Worker/Backend has `CUSTOM_PLUGIN_BROKER_ACTION_EXECUTOR_ENABLED=true`;
- the platform owner has allowed a trusted registration path that accepts `lots:raise`.

Plugin request:

```json
{
  "type": "lots.raise",
  "input": {
    "account_id": "42",
    "lot_id": "555",
    "delivery_id": "bld_..."
  }
}
```

Security rules:

- `account_id`: positive numeric account id from the sanitized order delivery payload;
- `lot_id`: positive numeric FunPay lot id from the sanitized order delivery payload;
- `delivery_id`: the Broker delivery id being handled;
- server verifies installation, delivery, event type, account, lot and subcategory binding before queueing;
- delivery must be fresh within 1 hour and can be consumed for `lots.raise` only once;
- server applies DB-backed quotas per installation, account, lot window, subcategory window and delivery;
- Worker/Backend re-checks local `Account`, local `Lot`, decrypted `golden_key`, local cooldown metadata, calls `FunPayClient.raise_lots(...)`, updates local raise timestamps/cooldown, writes an account log and reports safe result fields.

SDK:

```python
capabilities = client.get_capabilities()
if "lots.raise" in capabilities.supported_actions and event.lot_id:
    action = client.raise_lots(
        account_id=event.account_id,
        lot_id=event.lot_id,
        delivery_id=event.delivery_id,
        idempotency_key=f"lot-raise-{event.delivery_id}",
    )
    status = client.get_action(action.action_id)
    if status.status == "succeeded":
        result = status.lots_raise_result()
        print(result.lot_id, result.raised, result.already_on_cooldown)
```

Fixture tests must opt in explicitly:

```python
client = FixtureBrokerClient(events, allow_lot_raise_actions=True)
```

### `blacklist.add` / `blacklist.remove`

`blacklist.add` and `blacklist.remove` are narrow trusted blacklist-control foundations. They do not expose broad `blacklist:write`, global blacklist edits, raw blacklist row ids, source/creator fields, or arbitrary usernames. The plugin can act only on a user from a fresh sanitized Broker delivery, and remove can delete only rows created by the same plugin installation through the Broker.

Enablement requirements:

- license-server `CUSTOM_PLUGIN_BROKER_ACTIONS_ENABLED=true`;
- license-server `CUSTOM_PLUGIN_BROKER_BLACKLIST_ADD_ENABLED=true` for `blacklist.add`;
- license-server `CUSTOM_PLUGIN_BROKER_BLACKLIST_REMOVE_ENABLED=true` for `blacklist.remove`;
- installation has scope `blacklist:add` or `blacklist:remove`;
- product has `review_state="approved"` and `trust_state="trusted"`;
- Worker/Backend has `CUSTOM_PLUGIN_BROKER_ACTION_EXECUTOR_ENABLED=true`;
- the platform owner has allowed a trusted registration path that accepts the requested blacklist scope.

Security rules:

- `account_id`, `username`, optional `buyer_id`, and `delivery_id` must come from the sanitized Broker delivery payload;
- own/system deliveries are rejected, so a plugin cannot blacklist the seller or service messages;
- delivery must be fresh within 24 hours;
- plugin input cannot set `is_global`, `source`, `created_by`, `entry_id`, raw owner fields, or notes;
- license-server injects a server-only owner marker before Worker claim;
- `blacklist.add` creates only account-local rows with source `plugin_broker`;
- omitted `expires_at` becomes a local default TTL in Worker/Backend; provided expiry must be future and no more than 180 days;
- `blacklist.remove` deletes only `plugin_broker` rows owned by the same installation, so manual/system/global/other-plugin blacklist records remain untouched;
- server applies DB-backed quotas per installation, account, delivery and target username.

SDK:

```python
capabilities = client.get_capabilities()
if "blacklist.add" in capabilities.supported_actions and event.buyer_username:
    action = client.add_to_blacklist(
        account_id=event.account_id,
        username=event.buyer_username,
        buyer_id=event.buyer_id,
        delivery_id=event.delivery_id,
        reason="Plugin policy trigger",
        idempotency_key=f"blacklist-add-{event.delivery_id}",
    )
    result = client.get_action(action.action_id).blacklist_add_result()
    print(result.username, result.added, result.already_present)

if "blacklist.remove" in capabilities.supported_actions and event.buyer_username:
    action = client.remove_from_blacklist(
        account_id=event.account_id,
        username=event.buyer_username,
        buyer_id=event.buyer_id,
        delivery_id=event.delivery_id,
        idempotency_key=f"blacklist-remove-{event.delivery_id}",
    )
    result = client.get_action(action.action_id).blacklist_remove_result()
    print(result.username, result.removed, result.already_absent)
```

Fixture tests must opt in explicitly:

```python
client = FixtureBrokerClient(
    events,
    allow_blacklist_add_actions=True,
    allow_blacklist_remove_actions=True,
)
```

Remaining scale work before broad automatic developer access:

- automated/broad trusted-action availability beyond the current manual
  policy in `docs/TRUSTED_MUTATING_ACTIONS_ROLLOUT_POLICY.md`;
- broader admin/reviewer UI beyond the current admin review API and production
  runbook in `docs/BROKER_FLAGS_PRODUCTION_RUNBOOK.md`.

Current admin review API:

- `GET /api/v2/admin/plugin-products/{product_public_id}/risk` returns an admin-only automated risk report for the current plugin product/version.
- The risk report derives requested scopes from `manifest_json` and blocks trust when stored scope columns drift from the manifest.
- `POST /api/v2/admin/plugin-products/{product_public_id}/review` can set `review_state` and `trust_state`.
- `trust_state="trusted"` requires `review_state="approved"` and a risk report without critical findings.
- `GET /api/v2/admin/plugin-actions/anomalies` returns an admin-only aggregate anomaly report for trusted mutating actions (`messages.send`, `orders.refund`, `orders.review.reply`, `lots.active.set`, `lots.price.set`, `lots.raise`, `blacklist.add`, `blacklist.remove`) without exposing action input.
- `funpay-admin` `/custom-plugins` exposes this reviewer workflow in UI: product list, risk findings, private/trusted approval, reject/suspend actions and anomaly summary.
- Production/stage flag enablement must pass `tools/sdk_production_readiness_gate.sh`; trusted mutating actions are approved through `docs/TRUSTED_MUTATING_ACTIONS_ROLLOUT_POLICY.md`, not by local `--trusted` alone.

Current install confirmation:

- `/profile/developer` shows requested plugin permissions before install;
- non-event permissions require explicit user confirmation;
- install API requires `confirmed_scopes` and `confirmed_manifest_sha256` for the current manifest version.

Current read action family:

- `orders.get`, `orders.list`, trusted `orders.refund` and trusted `orders.review.reply` are the current safe first `orders.*` operations.
- `lots.get`, `lots.list` and trusted `lots.raise` are the current safe first `lots.*` operations.
- `blacklist.add` and `blacklist.remove` are the current safe first trusted blacklist operations; broad `blacklist:write` is still not exposed.
- Broader order/lot/blacklist mutations stay future/trusted-only until review policy,
  limits, audit and marketplace monitoring are complete.

Future actions:

- `delivery.approve`
- `delivery.reject`

Каждый mutating action требует:

- matching scope;
- idempotency key;
- input schema validation;
- per-installation rate limit;
- audit record;
- visible status/result.

## Scopes

Current manifest uses `events` for event delivery. `scopes` is empty unless the plugin needs current public-safe `logs:write`, `storage:own`, `secrets:own`, `orders:read`, `orders:list` or `lots:read`.

Current event scopes:

- `events:new_order`
- `events:new_message`
- `events:new_review`
- `events:order_confirmed`

Current public-safe action/storage scopes:

- `logs:write`
- `storage:own`
- `secrets:own`
- `orders:read`
- `orders:list`
- `lots:read`

Trusted/future write/action scopes:

- `messages:send`
- `lots:active`
- `lots:price`
- `lots:raise`
- `lots:write`
- `orders:refund`
- `orders:review`
- `blacklist:add`
- `blacklist:remove`
- `delivery:approve`
- `delivery:reject`
- `blacklist:write`

Dangerous scopes требуют explicit user confirmation и marketplace review after the action pipeline exists.

## Config Schema

Используем JSON Schema subset.

Packaged manifest JSON Schema lists current safe scopes plus trusted-review-only
mutating scopes so editor tooling can recognize `messages:send`,
`orders:refund`, `orders:review`, `lots:active`, `lots:price`, `lots:raise`,
`blacklist:add`, and `blacklist:remove`. Runtime validation remains stricter: those reviewed scopes
require `--trusted`, and unrelated future/dangerous
scopes remain invalid.

Разрешенные types:

- `string`
- `number`
- `integer`
- `boolean`
- `array`
- `object`

Supported formats:

- `url`
- `email`
- `textarea`

Limits:

- max object depth: 6;
- max config size: 64 KiB;
- max string default length: 2 KiB;
- `format: "secret"` and secret-like config fields are still rejected in install config; use Broker secret storage after install instead.

## Settings UI

SDK v1 не принимает arbitrary React, HTML или JavaScript от сторонних
плагинов. Настройки рисуются из `config_schema`, а `ui_schema` только подсказывает
Pulse, какой контрол показать для конкретного поля.

Сейчас Desktop и website умеют безопасно рендерить:

- `string`;
- `boolean`;
- `integer`;
- `number`;
- scalar `enum`;
- простые `array` и nested `object`, когда они состоят из таких же safe-полей.

Поддержанные подсказки в `ui_schema`:

- `ui:widget`: `text`, `textarea`, `password`, `select`, `checkbox`, `number`;
- `ui:placeholder` или `placeholder`;
- `ui:help`;
- `ui:rows` для `textarea`, от 2 до 12 строк;
- `ui:enumNames` или `ui:options.enumNames` для человекочитаемых названий enum.

Если схема сложная или содержит неподдержанный shape, Pulse оставляет
`Расширенный JSON`. Это нормально: JSON остается source of truth, форма только
помогает пользователю не ошибиться в простых настройках.

Нельзя класть в `ui_schema` HTML, JS handlers, `javascript:` URLs, `eval`,
`window`, `document` и похожие строки. Validator отклоняет такие manifests.
`ui:render`, `config:read` и `config:write` остаются future-only scopes и не
нужны для обычных настроек установленного плагина.

## CLI

Планируемый CLI:

```text
pulse-plugin init seller_auto_reply
pulse-plugin validate
pulse-plugin dev
pulse-plugin emit fixtures/new_message.json
pulse-plugin test
pulse-plugin ui --target desktop
pulse-plugin ui --target telegram
pulse-plugin pack
pulse-plugin publish --dry-run
```

`validate` проверяет:

- manifest schema;
- ID format и reserved IDs;
- semver;
- permissions;
- UI schema;
- config schema;
- dangerous scopes;
- fixture coverage.

Текущий SDK CLI:

```text
pulse-plugin validate funpay-pulse.plugin.json --allow-localhost
pulse-plugin validate funpay-pulse.plugin.json --allow-localhost --trusted
pulse-plugin emit fixtures/new_message.json
pulse-plugin emit fixtures/new_order.json --force
pulse-plugin check . --allow-localhost
pulse-plugin check . --allow-localhost --trusted
pulse-plugin test . --allow-localhost
pulse-plugin test . --allow-localhost --config local-config.json --write-log-actions
pulse-plugin doctor . --allow-localhost
pulse-plugin doctor . --allow-localhost --trusted
pulse-plugin pack . --allow-localhost
pulse-plugin pack . --allow-localhost --trusted
pulse-plugin publish . --dry-run --allow-localhost --api https://funpaypulse.com
pulse-plugin publish . --dry-run --allow-localhost --offline
pulse-plugin publish . --upload --token-file "$token_file" --api https://funpaypulse.com
pulse-plugin publish . --upload --product-id plp_existing --api https://funpaypulse.com
```

`--trusted` нужен только для manually reviewed manifests с `messages:send`, `orders:refund`, `orders:review`, `lots:active`, `lots:price`, `lots:raise`, `blacklist:add` или `blacklist:remove`. Он не включает production runtime сам по себе: продукт все равно должен быть approved/trusted, установка должна подтвердить scopes, а license-server/Worker flags должны быть включены. `--trusted` не разрешает unrelated dangerous scopes.

`emit` генерирует один локальный Broker fixture для `events:new_message`,
`events:new_order`, `events:order_confirmed` или `events:new_review`. Если
`--event` не задан, тип события берется из имени файла; существующий файл не
перезаписывается без `--force`.

`test` валидирует manifest/fixtures, строит `FixtureBrokerClient` с
разрешениями из manifest scopes, импортирует `app.py` и вызывает
`run_once(client, *, limit=..., write_log_actions=...)`. Это developer runtime
test: он специально исполняет локальный Python-код плагина, поэтому его нельзя
использовать как безопасную проверку чужого непроверенного кода. Для
неисполняемой проверки остается `check`, для package readiness без записи
artifact — `doctor`.

`publish --dry-run` выполняет локальный `pack` и публичный server-side
manifest preflight через
`POST /api/v2/plugin-marketplace/products/validate`. Команда не создает
продукт, не загружает `.fppkg`, не устанавливает plugin и не выдает Broker
token. Для локальной проверки без сетевого запроса есть `--offline`. SDK
client не отправляет `Authorization`, не следует redirect, требует HTTPS кроме
явного localhost dev mode, ограничивает размер ответа и редактирует
secret-like error details перед выводом в CLI.

`publish --upload` использует отдельный SDK developer token с префиксом
`fppd_`, созданный в `/profile/developer`. Сервер хранит только SHA-256 hash
токена, raw token показывается один раз, а SDK отправляет его только как
`Authorization: Bearer ...` на отдельные SDK endpoints:

```text
POST /api/v2/plugin-marketplace/sdk/products/private
POST /api/v2/plugin-marketplace/sdk/products/{product_public_id}/versions/package
```

Эти endpoints не используют cookie и поэтому не ослабляют browser
`fp_session` + Origin guard на существующих website endpoints. SDK token
разрешает только register/upload review artifact path: он не ставит plugin,
не создает invite/grant, не выдает Broker token, не открывает payout/admin
операции и не включает trusted/dangerous manifest overrides. `pulse-plugin
pack` и server package verifier также отклоняют raw `fppd_...`, `fppb_...` и
`fppi_...` token content или token-looking path components в пакете без echo
сырого token-like filename в ошибке. Для CLI безопаснее использовать
`FUNPAY_PULSE_DEVELOPER_TOKEN` или `--token-file`, потому что `--token` может
попасть в shell history и process args.

Рекомендуемый token-file pattern для upload:

```bash
umask 077
token_file="$(mktemp "${TMPDIR:-/tmp}/pulse-developer-token.XXXXXX")"
trap 'rm -f "$token_file"' EXIT
printf '%s\n' "$FUNPAY_PULSE_DEVELOPER_TOKEN" > "$token_file"
pulse-plugin publish . --upload --token-file "$token_file" --api https://funpaypulse.com
```

После установки Broker token остается installation-bound bearer secret. Website
developer console умеет owner-only перевыпустить token для active installation:
старые active tokens сразу отзываются, новый raw `fppb_...` показывается один
раз. SDK/CLI не получает этот token автоматически и не должен хранить его в
пакете, manifest, fixture или логах.

Install-time public config and post-install public config are both validated
against the installed version `config_schema_json`.

Post-install public config меняется через website owner-only API, не через
Broker token и не через SDK token. Update требует `expected_config_revision` и
применяется через atomic CAS, валидируется как public-only JSON и затем
сверяется с `config_schema_json` установленной версии; Broker после этого читает новый config через
`GET /api/v2/broker/config`. Секреты все равно идут в Broker secret storage, а
не в install config.

Website и Desktop уже умеют рендерить безопасные поля из `config_schema` и
использовать `ui_schema` как metadata для виджета, placeholder, help text,
textarea rows и enum labels. Если safe-форма есть, raw JSON прячется в
`Расширенный JSON`; если форму построить нельзя, JSON остается видимым сразу.
`ui_schema` не является frontend-кодом и не может исполнять JS.

Дальше `test` нужно расширять до webhook signature verification, idempotency
assertions, дополнительных config-schema сценариев и UI rendering snapshots. Текущий
реализованный слой закрывает broker-poller runtime на fixture events и local
action recording.

## Developer Workflow

Private plugin:

1. Создать manifest.
2. Реализовать внешний polling worker на `BrokerClient`.
3. Запустить local tests.
4. Зарегистрировать private app в developer console.
5. Установить на свою VPS/license.
6. Смотреть logs и audit.

Marketplace plugin:

1. Сначала собрать private plugin.
2. Добавить marketplace metadata и pricing.
3. Добавить fixtures и docs.
4. Submit for review.
5. Исправить review findings.
6. Publish to marketplace.
7. Следить за installs, errors, ratings и payout ledger.

## Compatibility

SDK v1 отделен от first-party `PluginBase`.

Future SDK v2 может добавить:

- WASI runtime;
- container runtime;
- hosted plugin runtime;
- richer marketplace analytics;
- paid subscription plugins.

Но все это должно сохранить тот же scope/action/audit boundary.
