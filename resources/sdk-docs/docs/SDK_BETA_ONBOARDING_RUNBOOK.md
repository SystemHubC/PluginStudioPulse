# SDK Beta Onboarding Runbook

Updated: 2026-05-20

Этот runbook нужен для controlled beta с внешним разработчиком. Цель не
"дать ссылку на SDK", а безопасно провести полный путь: developer token,
локальная проверка, `.fppkg` upload, review, marketplace access, install и
self-host runtime.

Операционный launch-пакет для первой beta wave находится в
`docs/SDK_CONTROLLED_BETA_LAUNCH.md`. Используй его перед выдачей реального
developer access: он фиксирует candidate rules, hard preflight, evidence
record, stop conditions, anti-resale boundary and first-week monitoring.

## Что Уже Должно Быть Зеленым

Перед первым внешним разработчиком оператор запускает:

```bash
tools/sdk_first_developer_preflight.sh
```

`tools/sdk_beta_onboarding_gate.sh` остается локальным beta gate. Полный
first-developer preflight дополнительно проверяет production `/developers`,
public marketplace API на обоих доменах, Docker health для website/license API,
controlled-beta flags and old manual website container restart policy.

Если речь уже не о controlled beta, а о production/stage включении Broker
flags или trusted mutating actions, одного beta gate недостаточно. Для этого
используется `tools/sdk_production_readiness_gate.sh`,
`docs/BROKER_FLAGS_PRODUCTION_RUNBOOK.md` и
`docs/TRUSTED_MUTATING_ACTIONS_ROLLOUT_POLICY.md`.

Gate по умолчанию проверяет:

- SDK source tests, wheel build and clean-venv CLI smoke through
  `tools/sdk_release_gate.sh`;
- full marketplace beta E2E:
  `funpay-licenses/tests/test_plugin_marketplace_beta_e2e.py`;
- offline package review helper regressions:
  `funpay-licenses/tests/test_sdk_package_review_tool.py`;
- adjacent developer-token upload, package upload, public-review pending,
  admin approval, paid payment-webhook regression tests and Broker webhook
  push regressions;
- paid marketplace payout UI smoke through
  `tools/sdk_marketplace_payout_smoke.sh`: local paid checkout, payout-profile
  submission/review, payout candidates, manual payout batch, CSV export and
  `mark-paid`.

Для локальной диагностики можно временно отключать части gate:

```bash
RUN_SDK_RELEASE_GATE=0 tools/sdk_beta_onboarding_gate.sh
RUN_PACKAGE_REVIEW_TOOL=0 tools/sdk_beta_onboarding_gate.sh
RUN_MARKETPLACE_BETA_E2E=0 tools/sdk_beta_onboarding_gate.sh
RUN_MARKETPLACE_ADJACENT=0 tools/sdk_beta_onboarding_gate.sh
RUN_MARKETPLACE_PAYOUT_UI_SMOKE=0 tools/sdk_beta_onboarding_gate.sh
```

Не используй skip-переменные как release approval. Они только для поиска
проблемы. Gate принимает для них только `0` или `1`; если хотя бы одна часть
отключена, финальная строка будет `partial diagnostic run ok; not release
approval`, а не полноценный release approval, и команда завершится non-zero.
UI smoke sections must run sequentially because they temporarily move/restore
`funpay-website/.next`; do not run marketplace UI smoke scripts in parallel
with this gate.

## Beta Candidate Requirements

Developer подходит для beta, если выполнено все:

- есть активная подписка или другое custom-plugin entitlement;
- есть доступ к `/profile/developer`;
- developer понимает runtime boundary: `broker-poller` можно запускать через
  Desktop managed runner, но код не импортируется внутрь Worker/Backend;
- developer готов хранить `fppd_...` как production secret, а raw `fppb_...`
  использовать только в ручном fallback/debug flow;
- есть support URL, privacy URL и понятная refund/support policy для
  публичного marketplace продукта;
- для marketplace продукта заранее известны pricing type, price RUB, срок
  доступа/trial period при необходимости и текущий platform fee snapshot;
- developer согласен, что trusted mutating scopes требуют ручного review и
  могут быть выключены runtime flags.

Buyer для тестовой установки тоже должен иметь активную подписку/custom-plugin
entitlement. Public catalog может быть виден без entitlement, но user-state,
quote, claim, checkout and install должны fail-closed без entitlement.

## Secure Token Rules

Developer token:

- raw format: `fppd_...`;
- создается в `/profile/developer`;
- показывается один раз;
- хранится server-side hash-only;
- нужен только для SDK upload;
- не может install plugin, issue Broker token or grant buyer access.

Broker token:

- raw format: `fppb_...`;
- выдается только после buyer install;
- bound to installation/license/VPS/current version;
- хранится server-side hash-only;
- показывается один раз;
- используется external runtime process.

Запрещено:

- вставлять raw token в чат, issue, screenshot, README, fixture, `.env.example`,
  `funpay-pulse.plugin.json`, `.fppkg`, Dockerfile or systemd unit;
- передавать token в CLI через shell history, если есть `--token-file`;
- просить buyer/developer прислать raw token в support.

## Beta Quotas

Current controlled-beta limits:

- max 10 active non-expired SDK developer tokens per publisher license;
- max 50 active non-expired private invites per product.

If a developer hits the limit, revoke old developer tokens or revoke/expire old
invites before issuing new ones. Do not raise the limit just to work around
messy onboarding state; first verify that there is no leaked token, duplicated
automation or invite spam.

## Developer Local Flow

Developer ставит SDK и создает plugin:

```bash
python -m venv .venv
. .venv/bin/activate
pip install ./funpay_pulse_sdk-0.1.0-py3-none-any.whl

pulse-plugin init seller_auto_reply
cd seller_auto_reply
pulse-plugin emit fixtures/new_message.json --force
pulse-plugin check . --allow-localhost --require-fixtures
pulse-plugin test . --allow-localhost
pulse-plugin doctor . --allow-localhost --require-fixtures
```

Для trusted example локально явно добавляется `--trusted`, но это не approval:

```bash
pulse-plugin check . --allow-localhost --trusted --require-fixtures
pulse-plugin test . --allow-localhost --trusted
pulse-plugin doctor . --allow-localhost --trusted --require-fixtures
```

Upload через token file. Токен вводится скрыто, не попадает в shell history и
не хранится в env:

```bash
umask 077
token_file="$(mktemp "${TMPDIR:-/tmp}/pulse-developer-token.XXXXXX")"
trap 'rm -f "$token_file"' EXIT
printf 'Paste developer token: ' >&2
IFS= read -r -s developer_token
printf '\n' >&2
printf '%s\n' "$developer_token" > "$token_file"
unset developer_token

pulse-plugin publish . \
  --upload \
  --token-file "$token_file" \
  --api https://funpaypulse.com

rm -f "$token_file"
trap - EXIT
```

Expected upload boundary:

- creates or updates private product/package review artifact;
- does not publish public listing;
- does not grant buyer access;
- does not install plugin;
- does not return `fppb_...` Broker token;
- does not execute uploaded source code inside Pulse.

## Operator Package Review

Перед approve оператор должен проверить присланный `.fppkg` тем же verifier,
который используется на production upload:

```bash
funpay-licenses/.venv/bin/python tools/sdk_package_review.py /path/plugin.fppkg --public-marketplace --fail-on-manual-review --json
funpay-licenses/.venv/bin/python tools/sdk_package_review.py /path/plugin.fppkg --public-marketplace --fail-on-manual-review --json --trusted
```

Для обычного плагина без trusted-прав `--trusted` не нужен. Скрипт ничего не
загружает, не устанавливает и не исполняет. Он проверяет формат пакета,
манифест, package inventory, secret-like content, runtime URL, scopes,
marketplace metadata, package hashes, packaged fixtures/docs и suspicious
source markers вроде `subprocess`, runtime `pip install`, `eval/exec`,
unsafe deserialization и encoded loaders.

## Public Review Flow

Developer can submit public review through SDK CLI after package upload:

```bash
pulse-plugin publish . \
  --upload \
  --public-review \
  --trusted \
  --pricing-type subscription \
  --price-rub 350 \
  --access-duration-days 30 \
  --token-file "$token_file" \
  --api https://funpaypulse.com
```

Or the developer can keep the pricing/support/privacy/refund snapshot in
`funpay-pulse.marketplace.json` and call `publish --upload --public-review`
without price flags.

Minimum paid-product metadata before public review:

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

Reviewer checks:

- package exists and package hash matches current version;
- manifest hash, version, runtime type and scopes match the loaded review page;
- `pulse-plugin doctor . --require-fixtures` output was provided without raw
  tokens;
- package diff has no obvious secret/source-path issues;
- support URL, privacy URL and refund policy are present for public product;
- pricing type, price, access duration/trial days and platform fee snapshot
  are the expected values;
- trusted scopes are not approved unless the product is explicitly reviewed for
  trusted runtime and the corresponding runtime flags are enabled.

Admin approval must use the checklist fields:

- `permissions_reviewed`;
- `trusted_actions_reviewed`;
- `config_schema_reviewed`;
- `secrets_reviewed`;
- `package_diff_reviewed`;
- `support_refund_reviewed`.

If any item is not true, reject or ask for changes. Do not approve from a stale
browser tab after pricing policy, package or manifest changed.

Marketplace pricing rules:

- `free`: цена `0 ₽`, бессрочный доступ после claim;
- `one_time`: цена больше `0 ₽`, бессрочный доступ после оплаты;
- `subscription`: цена больше `0 ₽`, доступ на фиксированное число дней после
  одной оплаты; это не auto-renewal;
- `trial`: цена `0 ₽`, бесплатный доступ на фиксированное число дней;
- expired `subscription`/`trial` grants are treated inactive and lazily revoke
  linked installations plus active Broker tokens before account-state/review
  surfaces can show active access.

## Buyer Install Flow

Buyer flow for marketplace product:

1. Buyer opens public product page.
2. Buyer sees pricing model, permissions, support/privacy/refund metadata and
   review state.
3. Buyer claims a free/trial product or pays through marketplace checkout.
4. Provider webhook activates `PluginMarketplacePurchase(status="granted")`
   for paid products; free/trial products create the same non-transferable
   grant ledger without payment.
5. Buyer installs on an owned active VPS.
6. Buyer explicitly confirms scopes and manifest hash.
7. For `broker-poller`, Desktop starts managed runner without showing raw
   `fppb_...` in the renderer.
8. Manual token-file launch is used only for fallback/debug/unsupported runtime.

Manual fallback token file example:

```bash
sudo install -d -m 0700 /etc/funpay-pulse/plugins/seller-auto-reply
umask 077
token_file="$(mktemp "${TMPDIR:-/tmp}/pulse-broker-token.XXXXXX")"
trap 'rm -f "$token_file"' EXIT
printf 'Paste Broker token: ' >&2
IFS= read -r -s broker_token
printf '\n' >&2
printf '%s\n' "$broker_token" > "$token_file"
unset broker_token
sudo install -m 0600 "$token_file" /etc/funpay-pulse/plugins/seller-auto-reply/broker-token
rm -f "$token_file"
trap - EXIT
```

Runtime env example:

```bash
export FPP_BASE_URL=https://funpaypulse.com
export FPP_BROKER_TOKEN_FILE=/etc/funpay-pulse/plugins/seller-auto-reply/broker-token
python app.py
```

Runtime preflight:

```python
from funpay_pulse_sdk import BrokerClient

client = BrokerClient.from_env()
print(client.get_capabilities().scopes)
```

Do not ask the buyer to paste the raw token back into support. Ask for plugin
id, product id, installation id, redacted token prefix, timestamps and log lines
with secrets removed.

## Webhook Runtime Flow

Webhook runtime is allowed in beta only when the product manifest uses
`runtime.type="webhook"` and the license-server has
`CUSTOM_PLUGIN_BROKER_WEBHOOK_PUSH_ENABLED=true` plus
`CUSTOM_PLUGIN_BROKER_WEBHOOK_SIGNING_KEY` configured. For production-like beta
runtime reliability, also enable
`CUSTOM_PLUGIN_BROKER_SERVER_WEBHOOK_DISPATCH_ENABLED=true` with bounded
interval/limit values so due retries do not depend only on Worker/manual ticks.
Keep `CUSTOM_PLUGIN_BROKER_WEBHOOK_ALLOW_LOCALHOST=false` outside local
development.

The runtime still uses its Broker token to obtain the per-installation HMAC
secret:

```python
from funpay_pulse_sdk import BrokerClient

client = BrokerClient.from_env()
secret = client.get_webhook_secret().webhook_secret
```

Pulse sends POST requests to the manifest `runtime.url` with:

- `X-FPP-Signature`;
- `X-FPP-Timestamp`;
- `X-FPP-Nonce`;
- redacted Broker event envelope in the JSON body.

The plugin must verify the signature before processing. A 2xx response acks the
delivery. Non-2xx, timeout or invalid URL keeps the delivery pending/pollable,
so beta webhook plugins should keep a Broker polling fallback for recovery.
Do not treat webhook push as a hosted runtime or guaranteed background retry
SLA.

## Acceptance Checklist

Operator marks beta onboarding accepted only when all are true:

- `tools/sdk_beta_onboarding_gate.sh` passed without skip variables.
- Developer token was created and not exposed after one-time reveal.
- Developer token and private invite creation stayed under active beta quotas,
  or stale entries were revoked before creating new access.
- Developer package upload used SDK developer-token endpoint.
- Public listing was hidden before admin approval.
- Admin approval used completed checklist and expected package/manifest/price
  fields.
- Paid checkout/provider webhook granted access without manual DB edits.
- Buyer install required explicit scope and manifest confirmation.
- Raw Broker token appeared only in install response/UI.
- Broker `/api/v2/broker/capabilities` works with the token.
- Public/API responses did not expose license keys, connection tokens, token
  hashes or package storage paths.
- Runtime source was not copied into `Pulse backend` or `Pulse worker`.

## Rollback And Incident Response

If a package is bad before public approval:

- reject review;
- leave product private or return it to private workflow;
- ask developer to upload a fixed `.fppkg`;
- revoke leaked `fppd_...` developer token if needed.

If a public plugin is bad after approval:

- suspend or reject product through admin review state;
- revoke grants/tokens through marketplace-aware refund/revoke path when buyer
  access must be removed;
- rotate affected Broker tokens;
- keep ledger corrections immutable for paid products;
- document reason, product id, package hash, manifest hash and timestamps.

If a token leaks:

- never paste it into logs for analysis;
- rotate/revoke from Pulse UI/admin path;
- verify old token fails Broker auth;
- restart runtime with the new token file.

## What Not To Promise In Beta

Do not promise:

- Pulse-hosted plugin execution;
- webhook push hosted runtime/SLA beyond the current feature-flagged beta push
  with polling fallback;
- automatic payouts;
- automatic trusted mutating actions for everyone;
- that `tools/sdk_beta_onboarding_gate.sh` alone is enough to enable
  production Broker flags or trusted mutating action flags;
- access for users without active custom-plugin entitlement;
- resale prevention beyond installation/license/VPS binding, hash-only storage,
  one active token, revoke/rotate and abuse monitoring.

## Evidence Template

Use this for each beta developer:

```text
Developer:
Product:
Plugin id:
Package sha256:
Manifest sha256:
Price / fee:
Gate command:
Gate result:
Review decision:
Buyer test license:
Install VPS:
Broker capabilities checked:
Rollback tested:
Notes:
```
