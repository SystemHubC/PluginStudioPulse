# FunPay Pulse Plugin SDK: Public API Reference

Документ описывает текущий публичный контракт `funpay-pulse-sdk` для внешних
разработчиков. Источники правды на момент составления: код
`plugin-sdk/src/funpay_pulse_sdk`, regression gate
`plugin-sdk/tests/test_public_api_contract.py` и `docs/PLUGIN_SDK_V1.md`.

Главное правило: стабильным SDK v1 API считается только root import surface
пакета `funpay_pulse_sdk.__all__`. Submodules вроде
`funpay_pulse_sdk.broker`, `funpay_pulse_sdk.marketplace` и
`funpay_pulse_sdk.package` могут содержать публично выглядящие символы, но они
не являются SDK v1 контрактом, пока не экспортированы из root package.

## Установка и базовый импорт

```python
from funpay_pulse_sdk import BrokerClient, PluginApp, validate_manifest
```

CLI entry point зафиксирован как:

```text
pulse-plugin = "funpay_pulse_sdk.cli:main"
```

## Root Exports

Текущий точный список `from funpay_pulse_sdk import *`:

```python
ALLOWED_SCOPES
BrokerClient
BrokerClientError
BrokerConfig
BrokerEvent
BrokerBlacklistAddResult
BrokerBlacklistRemoveResult
BrokerAction
BrokerActionStatus
BrokerCapabilities
BrokerLotActiveSetResult
BrokerLotPriceSetResult
BrokerLotSummary
BrokerLotsPage
BrokerLotsRaiseResult
BrokerMessageSendResult
BrokerDownloadedPackage
BrokerOrderReview
BrokerOrderRefundResult
BrokerOrderReviewReplyResult
BrokerOrderSummary
BrokerOrdersPage
BrokerPackageManifest
BrokerSecretItem
BrokerSecretLimits
BrokerStorageItem
BrokerStorageLimits
CURRENT_ACTION_SCOPES
DANGEROUS_SCOPES
EVENT_SCOPES
EventParseError
FixtureBrokerClient
FUTURE_SAFE_SCOPES
NewMessageEvent
NewOrderEvent
NewReviewEvent
OrderConfirmedEvent
PluginEvent
PluginApp
PluginAppError
PluginContext
PluginPackageError
PluginPackageResult
SAFE_SCOPES
TRUSTED_MUTATING_SCOPES
TypedPluginEvent
ManifestValidationError
MarketplaceClient
MarketplaceClientError
MarketplaceManifestValidation
MarketplacePrivatePackageUpload
MarketplacePrivateProductRegistration
WebhookSignatureError
broker_action_from_dict
broker_action_status_from_dict
broker_blacklist_add_result_from_dict
broker_blacklist_remove_result_from_dict
broker_capabilities_from_dict
broker_config_from_dict
broker_event_from_dict
broker_lot_active_set_result_from_dict
broker_lot_price_set_result_from_dict
broker_lot_summary_from_dict
broker_lots_page_from_dict
broker_lots_raise_result_from_dict
broker_message_send_result_from_dict
broker_order_summary_from_dict
broker_order_refund_result_from_dict
broker_order_review_reply_result_from_dict
broker_orders_page_from_dict
broker_package_manifest_from_dict
broker_secret_item_from_dict
broker_storage_item_from_dict
build_plugin_package
load_manifest
load_event_fixtures
marketplace_manifest_validation_from_dict
marketplace_private_package_upload_from_dict
marketplace_private_product_registration_from_dict
parse_broker_event
sign_webhook_body
validate_manifest
validate_manifest_file
verify_webhook_signature
```

## BrokerClient

`BrokerClient` - dependency-free HTTP client для plugin runtime, который
работает только через Broker token `fppb_...`.

```python
client = BrokerClient(
    base_url="https://funpaypulse.com",
    broker_token="fppb_...",
)
```

Сигнатура конструктора:

```python
BrokerClient(
    *,
    base_url: str,
    broker_token: str,
    timeout_seconds: int = 10,
    allow_insecure_localhost: bool = False,
    opener: Any | None = None,
)
```

`base_url` должен быть HTTPS. Plain HTTP разрешается только для реальных
loopback hosts при `allow_insecure_localhost=True`. `broker_token` обязан
соответствовать форме `fppb_...`.

### Events, Config, Capabilities, Package

```python
poll_events(limit: int = 50) -> list[BrokerEvent]
ack_event(delivery_id: str) -> dict[str, Any]
get_config() -> BrokerConfig
get_capabilities() -> BrokerCapabilities
get_package_manifest() -> BrokerPackageManifest
download_package(*, expected_sha256: str | None = None) -> BrokerDownloadedPackage
```

Практичный event loop без `PluginApp`:

```python
for event in client.poll_events(limit=50):
    # Сначала обработать и сохранить результат, потом ack.
    client.ack_event(event.delivery_id)
```

`download_package()` скачивает установленный `.fppkg` и проверяет
`X-Package-SHA256`, `X-Package-Size-Bytes`, фактический размер и фактический
SHA-256. Если передан `expected_sha256`, он сравнивается с Broker response до
возврата bytes.

### Storage and Secrets

```python
get_storage_item(key: str) -> BrokerStorageItem
set_storage_item(key: str, value: Any) -> BrokerStorageItem
delete_storage_item(key: str) -> bool

get_secret_item(key: str) -> BrokerSecretItem
set_secret_item(key: str, value: str) -> BrokerSecretItem
delete_secret_item(key: str) -> bool
```

Storage требует scope `storage:own` и предназначен только для non-secret JSON
state. Secret storage требует scope `secrets:own` и возвращает value только на
read path; write response содержит metadata.

### Actions

Базовый метод:

```python
submit_action(
    action_type: str,
    action_input: dict[str, Any],
    *,
    idempotency_key: str,
) -> BrokerAction
```

Convenience wrappers:

```python
write_log(message: str, *, level: str = "info", context: dict[str, Any] | None = None, idempotency_key: str) -> BrokerAction
get_order(*, account_id: str | int, order_id: str, delivery_id: str, idempotency_key: str) -> BrokerAction
list_orders(*, account_id: str | int, delivery_id: str, status: str = "paid", limit: int = 25, cursor: str | int | None = None, idempotency_key: str) -> BrokerAction
get_lot(*, account_id: str | int, lot_id: str | int, delivery_id: str, idempotency_key: str) -> BrokerAction
list_lots(*, account_id: str | int, delivery_id: str, limit: int = 50, cursor: str | int | None = None, idempotency_key: str) -> BrokerAction
send_message(*, account_id: str | int, chat_id: str | int, delivery_id: str, text: str, idempotency_key: str) -> BrokerAction
refund_order(*, account_id: str | int, order_id: str, delivery_id: str, idempotency_key: str) -> BrokerAction
reply_to_review(*, account_id: str | int, order_id: str, delivery_id: str, text: str, idempotency_key: str) -> BrokerAction
set_lot_active(*, account_id: str | int, lot_id: str | int, enabled: bool, delivery_id: str, idempotency_key: str) -> BrokerAction
set_lot_price(*, account_id: str | int, lot_id: str | int, price: str | int | float, delivery_id: str, idempotency_key: str) -> BrokerAction
raise_lots(*, account_id: str | int, lot_id: str | int, delivery_id: str, idempotency_key: str) -> BrokerAction
add_to_blacklist(*, account_id: str | int, username: str, delivery_id: str, buyer_id: str | int | None = None, reason: str | None = None, block_messages: bool = True, block_delivery: bool = True, block_review_reply: bool = True, block_notifications: bool = False, expires_at: str | None = None, idempotency_key: str) -> BrokerAction
remove_from_blacklist(*, account_id: str | int, username: str, delivery_id: str, buyer_id: str | int | None = None, idempotency_key: str) -> BrokerAction
get_action(action_id: str) -> BrokerActionStatus
```

Action names, которые SDK принимает сейчас:

```text
logs.write
orders.get
orders.list
orders.refund
orders.review.reply
lots.get
lots.list
messages.send
lots.active.set
lots.price.set
lots.raise
blacklist.add
blacklist.remove
```

`logs.write`, `orders.get`, `orders.list`, `lots.get`, `lots.list` относятся к
текущему safe path при наличии соответствующих scopes/capabilities.
`messages.send`, `orders.refund`, `orders.review.reply`, `lots.active.set`,
`lots.price.set`, `lots.raise`, `blacklist.add`, `blacklist.remove` - trusted
mutating actions. Они не являются обычным public rollout для внешних
разработчиков и требуют reviewed manifest/platform enablement.

Результат action читается через `get_action(action_id)`. `BrokerActionStatus`
имеет helpers:

```python
require_succeeded()
order_result()
orders_page_result()
order_refund_result()
order_review_reply_result()
message_send_result()
lot_result()
lots_page_result()
lot_active_result()
lot_price_result()
lots_raise_result()
blacklist_add_result()
blacklist_remove_result()
```

## Broker Dataclasses

Core поля, зафиксированные contract test:

```text
BrokerEvent: delivery_id, event_id, event_type, payload, created_at, delivered_at
BrokerConfig: config, config_revision
BrokerCapabilities: broker_events_enabled, broker_actions_enabled, broker_storage_enabled, broker_secrets_enabled, broker_package_download_enabled, scopes, supported_actions, storage_authorized, storage_limits, secret_storage_authorized, secret_storage_limits, config_revision
BrokerPackageManifest: installation_id, product_public_id, plugin_id, plugin_name, version, runtime_type, manifest_sha256, manifest, scopes, config_revision, install_revision, package_sha256, package_size_bytes, package_file_count, package_metadata
BrokerDownloadedPackage: package_bytes, package_sha256, package_size_bytes, plugin_id, plugin_version
```

Другие root-exported Broker result models:

```text
BrokerAction: action_id, action_type, status, created, created_at, idempotency_key_hash, idempotency_key
BrokerActionStatus: action_id, action_type, status, attempt_count, created_at, updated_at, result, idempotency_key_hash, idempotency_key, claimed_at, lease_until, completed_at, error_code, error_message
BrokerOrderReview: stars, text, hidden, has_reply
BrokerOrderSummary: account_id, order_id, status, buyer_id, buyer_username, chat_id, lot_id, title, category, subcategory_id, occurred_at, subcategory_type, price, quantity, has_review, review_hidden, review_stars, review_text, review
BrokerOrdersPage: items, count, has_more, next_cursor
BrokerOrderRefundResult: order_id, refunded, status, already_refunded
BrokerOrderReviewReplyResult: order_id, replied, rating, already_replied
BrokerMessageSendResult: message_id
BrokerLotSummary: account_id, lot_id, title, price, currency, active, auto_delivery, amount, subcategory_id, subcategory_name, game_id, category_name, lot_type, last_raised, next_raise_available
BrokerLotsPage: items, count, has_more, next_cursor
BrokerLotActiveSetResult: lot_id, active, previous_active, already_set
BrokerLotPriceSetResult: lot_id, price, previous_price, already_set
BrokerLotsRaiseResult: lot_id, subcategory_id, raised, wait_time_seconds, next_raise_available, already_on_cooldown
BrokerBlacklistAddResult: account_id, username, buyer_id, added, already_present, expires_at
BrokerBlacklistRemoveResult: account_id, username, buyer_id, removed, already_absent, removed_count
BrokerStorageItem: key, value, created, updated_at
BrokerStorageLimits: max_items, max_key_length, max_value_bytes, max_total_bytes
BrokerSecretItem: key, value, value_size_bytes, created, updated_at
BrokerSecretLimits: max_items, max_key_length, max_value_bytes, max_total_bytes
```

## PluginApp

`PluginApp` - high-level dispatcher поверх `BrokerClient` или
`FixtureBrokerClient`. Он сам делает `poll -> parse -> dispatch -> ack` и
ack-ает delivery только после успешного завершения matching handlers.

```python
from funpay_pulse_sdk import BrokerClient, NewMessageEvent, PluginApp

client = BrokerClient(base_url="https://funpaypulse.com", broker_token="fppb_...")
app = PluginApp(client)

@app.on(NewMessageEvent)
def handle_message(event, context):
    if context.config.get("enabled") is False:
        return
    context.client.write_log(
        "message processed",
        idempotency_key=f"log-{event.delivery_id}",
    )

app.run_forever(limit=50, poll_interval_seconds=3.0)
```

Сигнатуры:

```python
PluginApp(client, *, logger: logging.Logger | None = None)
on(event_class)
process_once(*, limit: int = 50, write_log_actions: bool = False, ack: bool = True) -> int
process_once_async(*, limit: int = 50, write_log_actions: bool = False, ack: bool = True) -> int
run_forever(*, limit: int = 50, poll_interval_seconds: float = 3.0, write_log_actions: bool = False, stop_after_empty_polls: int | None = None) -> int
run_forever_async(*, limit: int = 50, poll_interval_seconds: float = 3.0, write_log_actions: bool = False, stop_after_empty_polls: int | None = None) -> int
```

Handler может принимать один аргумент `event` или два аргумента
`event, context`. `PluginContext` содержит:

```text
client, config, config_revision
```

Синхронный `process_once()` отклоняет `async def` handlers. Для async handlers
используй `process_once_async()` или `run_forever_async()`.

## Events

Поддержанные typed event classes:

```text
NewMessageEvent
NewOrderEvent
OrderConfirmedEvent
NewReviewEvent
```

Raw delivery переводится в typed model через:

```python
typed = parse_broker_event(event)
```

Если event type или payload не поддержан, SDK выбрасывает `EventParseError`.

Поля typed events:

```text
PluginEvent: raw
NewMessageEvent: raw, account_id, chat_id, message_id, buyer_id, buyer_username, author_id, author_username, text, is_own, is_system, sender_type
NewOrderEvent: raw, account_id, order_id, buyer_id, buyer_username, chat_id, lot_id, subcategory_id, quantity, amount, title, status
OrderConfirmedEvent: raw, account_id, order_id, buyer_id, buyer_username, chat_id, lot_id, subcategory_id, title, old_status, new_status
NewReviewEvent: raw, account_id, review_id, order_id, author_username, rating, text, has_reply
```

`PluginEvent` также дает properties из raw delivery:

```text
delivery_id, event_id, event_type, payload, occurred_at
```

Event scopes:

```text
events:new_order
events:new_message
events:new_review
events:order_confirmed
```

## Manifest and Permissions

Файл manifest:

```text
funpay-pulse.plugin.json
```

Минимальная форма:

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
  "config_schema": {},
  "ui_schema": {}
}
```

`config_schema` describes public installation settings. `ui_schema` is optional
metadata for rendering those settings in Pulse UI. It is not React/HTML/JS.

Supported `ui_schema` hints:

- `ui:widget`: `text`, `textarea`, `password`, `select`, `checkbox`, `number`;
- `ui:placeholder` or `placeholder`;
- `ui:help`;
- `ui:rows` for `textarea`;
- `ui:enumNames` or `ui:options.enumNames`.

For unsupported schema shapes Pulse keeps a raw JSON editor under
`Расширенный JSON`. Secret fields still do not belong in config; use Broker
secret storage after install.

Обязательные поля:

```text
manifest_version
plugin_id
name
version
runtime
events
scopes
```

`manifest_version` должен быть `"1.0"`. `version` проверяется как basic semver
`X.Y.Z`. `plugin_id` должен соответствовать:

```text
^[a-z][a-z0-9_]{2,63}$
```

Reserved prefixes:

```text
pulse_
funpay_
admin_
system_
```

Reserved first-party ids сейчас:

```text
autoresponder
autoticket
copylots
chatspam
offline_activite
trademanager
rentsteam
autosmm
autosteamns
viproblox
autorobux
autodiscordboost
autostars
emailcode
autogift
autoaiaccounts
autodump
```

Runtime types:

```text
broker-poller
webhook
```

Текущий рабочий default - `broker-poller`. `webhook` принимается как
forward-compatible metadata, но текущая доставка событий идет через polling.

SDK helpers:

```python
load_manifest(path) -> dict[str, Any]
validate_manifest_file(path, *, allow_localhost=False, allow_dangerous_scopes=False, allow_future_scopes=False, trusted=False) -> dict[str, Any]
validate_manifest(manifest, *, allow_localhost=False, allow_dangerous_scopes=False, allow_future_scopes=False, trusted=False) -> dict[str, Any]
```

При ошибке validation выбрасывается `ManifestValidationError`; список ошибок
лежит в `exc.errors`.

Permission constants:

```text
EVENT_SCOPES:
  events:new_order
  events:new_message
  events:new_review
  events:order_confirmed

CURRENT_ACTION_SCOPES:
  logs:write
  storage:own
  secrets:own
  orders:read
  orders:list
  lots:read

TRUSTED_MUTATING_SCOPES:
  messages:send
  orders:refund
  orders:review
  lots:active
  lots:price
  lots:raise
  blacklist:add
  blacklist:remove

FUTURE_SAFE_SCOPES:
  ui:render
  config:read
  config:write

DANGEROUS_SCOPES:
  lots:write
  delivery:approve
  delivery:reject
  blacklist:write
  public_chat:send
  accounts:read_sensitive
```

`SAFE_SCOPES = EVENT_SCOPES | CURRENT_ACTION_SCOPES | FUTURE_SAFE_SCOPES`.
`ALLOWED_SCOPES = SAFE_SCOPES | TRUSTED_MUTATING_SCOPES | DANGEROUS_SCOPES`.

Важно: `trusted=True` локально разрешает только reviewed mutating set из
`TRUSTED_MUTATING_SCOPES`. Это не включает production-доступ само по себе и не
заменяет platform review/runtime flags.

## Package Helpers

```python
build_plugin_package(
    plugin_dir,
    *,
    out=None,
    allow_localhost=False,
    allow_dangerous_scopes=False,
    allow_future_scopes=False,
    trusted=False,
    fixture_path="fixtures/events.json",
    require_fixtures=False,
) -> PluginPackageResult
```

`PluginPackageResult`:

```text
package_path
package_sha256
package_bytes
plugin_id
plugin_version
manifest_sha256
file_count
```

`build_plugin_package()` валидирует manifest, проверяет fixtures если они есть
или обязательны, затем собирает deterministic `.fppkg`. Default output:

```text
dist/<plugin_id>-<version>.fppkg
```

Пакет намеренно отклоняет unsafe paths, symlinks, dotfiles/hidden paths,
cache/VCS/venv/build/dist directories, native/binary/database files, secret-like
filenames и явные token/secret patterns в text files.

## Marketplace Helpers

`MarketplaceClient` используется для SDK publish/preflight flow.

```python
client = MarketplaceClient(base_url="https://funpaypulse.com")
```

Сигнатуры:

```python
MarketplaceClient(
    *,
    base_url: str = "https://funpaypulse.com",
    timeout_seconds: int = 10,
    allow_insecure_localhost: bool = False,
    opener: Any | None = None,
)

validate_manifest(manifest, *, allow_localhost=False, allow_dangerous_scopes=False, allow_future_scopes=False, trusted=False) -> MarketplaceManifestValidation
register_private_product(manifest, *, developer_token: str) -> MarketplacePrivateProductRegistration
upload_private_package(product_public_id: str, package_bytes: bytes, *, package_sha256: str, developer_token: str) -> MarketplacePrivatePackageUpload
submit_public_review(product_public_id: str, *, developer_token: str, pricing_type: str | None = None, price_rub: int = 0, access_duration_days: int | None = None, trial_days: int = 0) -> MarketplacePublicReviewSubmission
```

Result models:

```text
MarketplaceManifestValidation: valid, errors, warnings, plugin_id, version, manifest_sha256, scopes, dangerous_scopes, dry_run, raw
MarketplacePrivateProductRegistration: product_public_id, plugin_id, version, manifest_sha256, raw
MarketplacePrivatePackageUpload: product_public_id, plugin_id, version, package_sha256, package_size_bytes, package_file_count, broker_token, raw
MarketplacePublicReviewSubmission: product_public_id, plugin_id, pricing_type, price_rub, access_duration_days, trial_days, submitted, raw
```

`MarketplacePrivatePackageUpload.broker_token` всегда должен быть `None` в SDK
ответе. Upload private package не устанавливает plugin и не выдает runtime
Broker token.

## Fixture Testing

```python
load_event_fixtures(path) -> list[BrokerEvent]
FixtureBrokerClient(...)
FixtureBrokerClient.from_file(...)
```

Базовый пример:

```python
from funpay_pulse_sdk import FixtureBrokerClient, NewMessageEvent, PluginApp

client = FixtureBrokerClient.from_file(
    "fixtures/events.json",
    config={"enabled": True},
)
app = PluginApp(client)

@app.on(NewMessageEvent)
def handle_message(event):
    print(event.chat_id, event.text)

processed = app.process_once(limit=50)
assert processed >= 0
```

`FixtureBrokerClient` совместим с основными методами `BrokerClient`,
запоминает `acked_delivery_ids` и `submitted_actions`, но не выдает реальный
`fppb_...` token и не заменяет регистрацию/установку plugin.

## Webhook Signature Helpers

Экспортированы:

```python
sign_webhook_body(secret: str | bytes, timestamp: str | int, nonce: str, body: bytes) -> str
verify_webhook_signature(*, secret: str | bytes, body: bytes, headers: Mapping[str, str], tolerance_seconds: int = 300, now: int | None = None) -> bool
```

При ошибке проверки `verify_webhook_signature()` выбрасывает
`WebhookSignatureError`. Header names проверяются case-insensitively; helper
ожидает `X-FPP-Signature`, `X-FPP-Timestamp` и `X-FPP-Nonce`.

Webhook runtime пока не является текущим delivery path для внешних plugin apps;
основной runtime сейчас `broker-poller`.

## CLI Commands

Все команды доступны через `pulse-plugin`.

```text
pulse-plugin init
pulse-plugin emit
pulse-plugin validate
pulse-plugin check
pulse-plugin test
pulse-plugin doctor
pulse-plugin pack
pulse-plugin publish
pulse-plugin download-package
```

### init

```bash
pulse-plugin init <plugin_id> [--out OUT] [--template basic-webhook|broker-poller|order-assistant|trusted-actions]
```

Default template: `broker-poller`.

### emit

```bash
pulse-plugin emit <output> [--event EVENT] [--force]
```

`--event` принимает fixture event type или alias:

```text
new_message
new_order
order_confirmed
new_review
```

### validate

```bash
pulse-plugin validate [manifest] [--allow-localhost] [--allow-dangerous-scopes] [--allow-future-scopes] [--trusted]
```

Проверяет один manifest JSON. Default manifest path:
`funpay-pulse.plugin.json`.

### check

```bash
pulse-plugin check [plugin_dir] [--allow-localhost] [--allow-dangerous-scopes] [--allow-future-scopes] [--trusted] [--fixtures FIXTURES] [--require-fixtures]
```

Локальный non-executing gate: валидирует manifest и fixture deliveries, но не
импортирует и не запускает `app.py`.

### test

```bash
pulse-plugin test [plugin_dir] [--allow-localhost] [--allow-dangerous-scopes] [--allow-future-scopes] [--trusted] [--fixtures FIXTURES] [--config CONFIG] [--limit LIMIT] [--write-log-actions]
```

Запускает plugin code один раз против fixtures. `--config` - optional JSON
config; если не указан, defaults выводятся из `config_schema`.

### doctor

```bash
pulse-plugin doctor [plugin_dir] [--allow-localhost] [--allow-dangerous-scopes] [--allow-future-scopes] [--trusted] [--fixtures FIXTURES] [--require-fixtures]
```

Строгий локальный readiness gate: manifest, fixtures и временная package
проверка без сохранения/загрузки package. `doctor` обязателен перед `pack`,
private `publish --upload` и отправкой public marketplace review.

### pack

```bash
pulse-plugin pack [plugin_dir] [--allow-localhost] [--allow-dangerous-scopes] [--allow-future-scopes] [--trusted] [--fixtures FIXTURES] [--require-fixtures] [--out OUT]
```

Собирает `.fppkg`. Default output:

```text
dist/<plugin_id>-<version>.fppkg
```

### publish

```bash
pulse-plugin publish [plugin_dir] [--dry-run] [--upload] [--public-review] [--pricing-type free|one_time|subscription|trial] [--price-rub PRICE_RUB] [--access-duration-days DAYS] [--trial-days DAYS] [--offline] [--token TOKEN] [--token-file TOKEN_FILE] [--product-id PRODUCT_ID] [--base-url BASE_URL|--api BASE_URL] [--allow-insecure-localhost] [--allow-localhost] [--allow-dangerous-scopes] [--allow-future-scopes] [--trusted] [--fixtures FIXTURES] [--require-fixtures] [--out OUT]
```

`--dry-run` делает local package и server manifest preflight без создания
product. `--upload` регистрирует/загружает private package через developer
token, но перед server upload принудительно требует валидные fixtures и
проходит тот же local package scanner. `--offline` пропускает server dry-run и
выполняет только local package checks.

`--public-review` работает только вместе с `--upload`: после загрузки `.fppkg`
CLI отправляет SDK-token заявку на public review и фиксирует pricing/public-review snapshot.
Это не публикует листинг автоматически, не устанавливает plugin и не возвращает
Broker token.

Если в корне плагина есть `funpay-pulse.marketplace.json`, `publish
--public-review` берет pricing и public-review metadata из него:

```json
{
  "pricing_type": "subscription",
  "price_rub": 350,
  "access_duration_days": 30,
  "trial_days": 0,
  "category": "automation",
  "summary": "Short marketplace description.",
  "publisher": {
    "name": "Author or studio name",
    "url": "https://your-domain.ru"
  },
  "support": {
    "telegram": "@developer"
  },
  "support_url": "https://your-domain.ru/support",
  "privacy_url": "https://your-domain.ru/privacy",
  "refund_policy": "Возврат рассматривается вручную через поддержку."
}
```

`publisher.name` and `publisher.url` are package metadata for review/listing
drafts only. They are not verified identity, ownership proof or a trust source.
The public verified author is returned by the server-side author profile tied
to the seller license that owns the product.

Поля `category`, `summary`, `support`, `support_url`, `privacy_url` и
`refund_policy` проходят как packaged review metadata. Review helper отдельно
проверяет, что для публичного продукта есть контакт поддержки, privacy URL и
условия возврата. CLI-флаги pricing остаются override-ом поверх файла.

Примеры pricing:

```bash
pulse-plugin publish . --upload --public-review --pricing-type free --token-file "$token_file"
pulse-plugin publish . --upload --public-review --pricing-type one_time --price-rub 990 --token-file "$token_file"
pulse-plugin publish . --upload --public-review --pricing-type subscription --price-rub 350 --access-duration-days 30 --token-file "$token_file"
pulse-plugin publish . --upload --public-review --pricing-type trial --trial-days 7 --token-file "$token_file"
```

Практически безопаснее использовать `--token-file`, а не `--token`, потому что
command-line args могут попасть в shell history/process list.

### download-package

```bash
pulse-plugin download-package [--broker-token BROKER_TOKEN] [--broker-token-file BROKER_TOKEN_FILE] [--base-url BASE_URL|--api BASE_URL] [--out OUT] [--force] [--allow-insecure-localhost]
```

Скачивает installed `.fppkg` через raw Broker token. Команда сначала читает
package manifest, затем скачивает package с `expected_sha256` из manifest.
Default output:

```text
<plugin_id>-<version>.fppkg
```

Для production/runtime установки безопаснее token-file:

```bash
umask 077
token_file="$(mktemp "${TMPDIR:-/tmp}/pulse-broker-token.XXXXXX")"
printf '%s\n' "fppb_..." > "$token_file"
pulse-plugin download-package --api https://funpaypulse.com --broker-token-file "$token_file" --out installed.fppkg
rm -f "$token_file"
```

## Current Public Runtime Boundary

Сейчас внешний plugin runtime не выполняется внутри Pulse Worker/Backend.
Внешнее приложение работает отдельно и общается с Pulse только через Broker API
по `fppb_...` token.

Реализованный безопасный public path:

```text
events polling
event ack
read-only install config
runtime capabilities
installed package manifest/download
plugin-owned non-secret storage
plugin-owned encrypted secret storage
logs.write
orders.get / orders.list
lots.get / lots.list
local fixtures
local package build
private product/package SDK upload flow
```

Не считай доступным без отдельного reviewed/trusted rollout:

```text
messages.send
orders.refund
orders.review.reply
lots.active.set
lots.price.set
lots.raise
blacklist.add
blacklist.remove
webhook push delivery
plugin-side config mutation
запуск uploaded plugin code внутри Worker
```
