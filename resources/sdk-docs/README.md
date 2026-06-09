# FunPay Pulse SDK

Local SDK for Custom Plugin Platform Broker plugins.

The current safe runtime is polling, ack, optional feature-flagged webhook push, install config, storage/secrets, `logs.write`, read-only order/lot query actions, and Desktop-managed launch for installed `broker-poller` packages:

- plugin code runs outside the `Pulse worker` and `Pulse backend` Python processes;
- for `runtime.type="broker-poller"`, Pulse Desktop can install and start the
  package through the managed runner on the selected VPS without showing the raw
  Broker token in the renderer;
- manual self-hosted launch is still available as a fallback for development,
  unsupported runtimes and custom operations;
- plugin app polls `/api/v2/broker/events` with a raw `fppb_...` Broker token;
- plugin app acknowledges processed deliveries through `/api/v2/broker/events/{delivery_id}/ack`;
- plugin app reads its own install config through `/api/v2/broker/config`;
- plugin app can read the installed package manifest and download its pinned
  `.fppkg` through `/api/v2/broker/package/manifest` and
  `/api/v2/broker/package/download` when package download is enabled;
- plugin app can use non-secret per-installation JSON storage through `/api/v2/broker/storage/{key}` if the installation has `storage:own`;
- plugin app can store and read its own encrypted third-party secrets through `/api/v2/broker/secrets/{key}` if the installation has `secrets:own`;
- plugin app can submit `/api/v2/broker/actions` with `logs.write` if the installation has `logs:write`;
- plugin app can submit read-only `orders.get`, `orders.list`, `lots.get`, and `lots.list` if the installation has the matching `orders:read`, `orders:list`, or `lots:read` scope;
- plugin app can poll safe action status/result through `/api/v2/broker/actions/{action_id}`;
- plugin app with `runtime.type="webhook"` can fetch its derived HMAC secret through `/api/v2/broker/webhook/secret` and verify pushed deliveries when `CUSTOM_PLUGIN_BROKER_WEBHOOK_PUSH_ENABLED=true`;
- FunPay-mutating `messages.send`, `orders.refund`, `orders.review.reply`, `lots.active.set`, `lots.price.set`, `lots.raise`, `blacklist.add`, and `blacklist.remove` are available only for explicit scopes on products with `review_state="approved"` and `trust_state="trusted"` plus enabled Worker/Backend executor; arbitrary code upload is not implemented.

## Create A Plugin

```bash
pulse-plugin init seller_auto_reply
cd seller_auto_reply
pulse-plugin emit fixtures/new_message.json --force
pulse-plugin validate funpay-pulse.plugin.json --allow-localhost
pulse-plugin check . --allow-localhost
pulse-plugin test . --allow-localhost
pulse-plugin doctor . --allow-localhost
pulse-plugin pack . --allow-localhost
pulse-plugin publish . --dry-run --allow-localhost --api https://funpaypulse.com
python app.py --fixtures fixtures/events.json
```

`init` creates the current default `broker-poller` template. It can run locally against JSON fixtures before the developer has a real installation or Broker token.

The default manifest uses `runtime.type = "broker-poller"`. `webhook` is
available through the `basic-webhook` template for feature-flagged push
delivery; polling remains the default because it is easier to operate and
debug during beta.

## Verified Release Flow

The current SDK path is:

1. Create and test the plugin locally.
2. Build a deterministic `.fppkg` review artifact.
3. Upload the artifact to a private product with an SDK developer token.
4. Install the plugin from Pulse Desktop or marketplace.
5. For `broker-poller`, Desktop sends a managed start command. The runner
   downloads the pinned package, verifies hashes and starts the plugin with an
   installation-bound Broker token outside the Worker/Backend process.
6. If managed runner is unavailable, or if the runtime is not `broker-poller`,
   use `download-package` and the manual token-file flow from the self-hosting
   guide.

Important runtime boundary: SDK plugins are not imported into
`Pulse backend` or `Pulse worker`. The managed path runs package code in the
plugin runner/sidecar on the selected VPS. The manual fallback runs on the
buyer or developer host and talks to Pulse only through Broker API. See
`docs/PLUGIN_RUNTIME_SELF_HOSTING.md` for systemd, Docker and token-file
deployment patterns.

For a local workspace smoke from the repository root, install the SDK into a
clean virtual environment:

```bash
python -m venv .venv
. .venv/bin/activate
pip install ./plugin-sdk
```

The release gate that is currently covered by tests is:

```bash
pulse-plugin init seller_auto_reply
cd seller_auto_reply
pulse-plugin check . --allow-localhost
pulse-plugin test . --allow-localhost --write-log-actions
pulse-plugin doctor . --allow-localhost
pulse-plugin pack . --allow-localhost
pulse-plugin publish . --dry-run --offline --allow-localhost
```

From the repository root, run the full SDK release gate before tagging or
shipping an SDK build:

```bash
tools/sdk_release_gate.sh
```

For a tag/release artifact directory with published checksums, pass
`SDK_RELEASE_ARTIFACT_DIR`:

```bash
SDK_RELEASE_ARTIFACT_DIR=plugin-sdk/dist/release tools/sdk_release_gate.sh
```

That mode copies the built wheel into the artifact directory and writes
`SHA256SUMS` plus `SHA256SUMS.json` next to it. Publish those checksum files
with the wheel so operators and reviewers can pin the SDK build they tested.

The gate compiles SDK sources, runs the SDK test suite, builds a wheel, installs
that wheel into a clean virtual environment, verifies root public imports and
the `pulse-plugin` console entry point, then runs `init`, `emit`, `validate`,
`check`, `test`, `doctor`, `pack` and offline `publish --dry-run` for the
default template plus `check`/`test`/`doctor` for the order-assistant and
trusted-actions templates. It also runs `check`, `test` and `doctor` against
the committed examples in `plugin-sdk/examples`, including trusted examples
with explicit `--trusted` and demo configs.

For controlled external-developer beta, operators should run the larger
onboarding gate and follow the runbook:

```bash
tools/sdk_beta_onboarding_gate.sh
```

Runbook: `docs/SDK_BETA_ONBOARDING_RUNBOOK.md`. It covers developer-token
handling, public review, paid marketplace install, managed runner start,
manual Broker-token fallback and rollback.

Developer handoff checklist: `docs/SDK_DEVELOPER_HANDOFF.md`. Operator package
review helper:

```bash
funpay-licenses/.venv/bin/python tools/sdk_package_review.py /path/plugin.fppkg --public-marketplace --fail-on-manual-review --json
funpay-licenses/.venv/bin/python tools/sdk_package_review.py /path/plugin.fppkg --public-marketplace --fail-on-manual-review --json --trusted
```

The review helper is offline: it does not upload, store, install or execute the
plugin. It reuses the same server-side `.fppkg` verifier as production upload
and reports runtime, scopes, package hashes, marketplace metadata, source-scan
findings and manual review flags.

## Config UI

User settings are described by `config_schema`. `ui_schema` is only a safe hint
for how Pulse should draw those fields in Desktop and on the website.

Current supported `ui_schema` keys:

- `ui:widget`: `text`, `textarea`, `password`, `select`, `checkbox`, `number`;
- `ui:placeholder` or `placeholder`;
- `ui:help`;
- `ui:rows` for `textarea`;
- `ui:enumNames` or `ui:options.enumNames`.

Example:

```json
{
  "config_schema": {
    "type": "object",
    "properties": {
      "reply_text": {
        "type": "string",
        "title": "Текст ответа",
        "maxLength": 1000
      },
      "mode": {
        "type": "string",
        "title": "Режим",
        "enum": ["safe", "fast"]
      }
    },
    "required": ["reply_text"]
  },
  "ui_schema": {
    "reply_text": {
      "ui:widget": "textarea",
      "ui:rows": 4,
      "ui:placeholder": "Здравствуйте! Скоро отвечу.",
      "ui:help": "Не добавляйте сюда токены, cookies или ключи."
    },
    "mode": {
      "ui:widget": "select",
      "ui:enumNames": ["Аккуратный", "Быстрый"]
    }
  }
}
```

Do not put HTML, JavaScript handlers, `javascript:` URLs or secret values into
`ui_schema`. Pulse validates it as JSON metadata, not as frontend code. Complex
schemas still have the raw JSON fallback in `Расширенный JSON`.

## Webhook Push

Webhook push is a beta runtime option, not the default template. A webhook
installation still uses the one-time `fppb_...` Broker token to fetch its
derived signing secret:

```python
from funpay_pulse_sdk import BrokerClient

client = BrokerClient.from_env()
webhook_secret = client.get_webhook_secret().webhook_secret
```

Pulse signs pushed deliveries with `X-FPP-Signature`, `X-FPP-Timestamp` and
`X-FPP-Nonce`. Use `verify_webhook_signature(...)` before processing the body.
Failed push attempts remain pollable through the normal Broker event API, so
webhook runtimes should keep a polling fallback for recovery.

## Examples

Production-shaped examples live in `plugin-sdk/examples`:

- `auto_reply` - trusted auto-reply through `messages.send`;
- `order_assistant` - read-first order and lot inspection with plugin-owned
  metrics storage;
- `external_crm_notifier` - sanitized CRM event outbox without secrets in
  install config;
- `trusted_action_review_sample` - manually reviewed mutating action sample
  with dangerous behavior disabled by default.

Every example must keep this local preflight green:

```bash
pulse-plugin check . --allow-localhost --require-fixtures
pulse-plugin test . --allow-localhost
pulse-plugin doctor . --allow-localhost --require-fixtures
```

For trusted examples, add `--trusted`. The trusted review sample uses
`dangerous-demo-config.json` only for local tests; do not use that file as an
installation config.

```bash
pulse-plugin check . --allow-localhost --trusted --require-fixtures
pulse-plugin test . --allow-localhost --trusted --config dangerous-demo-config.json
pulse-plugin doctor . --allow-localhost --trusted --require-fixtures
```

`doctor` is the required release preflight before a plugin is packed, uploaded
or submitted for public review. It validates the manifest, fixtures and package
artifact without creating products, uploading packages or issuing Broker
tokens. `publish --upload` also enforces valid fixtures and the same local
package scanner before any server upload.

For real upload, create an SDK publish token in `/profile/developer` and pass
it through a temporary token file outside the plugin repository. Do not paste
the raw token into shell history or export it into the process environment:

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
rm -f "$token_file"
trap - EXIT
```

To send the uploaded package straight to public marketplace review, keep the
pricing and public-review metadata in `funpay-pulse.marketplace.json` and add
`--public-review`. This still does not publish the listing; it only creates the
admin review request:

```json
{
  "pricing_type": "subscription",
  "price_rub": 350,
  "access_duration_days": 30,
  "trial_days": 0,
  "category": "automation",
  "summary": "Short marketplace description.",
  "publisher": {
    "name": "Your public author name",
    "url": "https://your-domain.ru"
  },
  "support": {
    "telegram": "@developer"
  },
  "support_url": "https://your-domain.ru/support",
  "privacy_url": "https://your-domain.ru/privacy",
  "refund_policy": "Refunds are reviewed manually through support."
}
```

For public paid plugins, fill publisher, support, privacy and refund fields
before upload. `publisher.name` and `publisher.url` are package metadata for
review and listing drafts only. They are not a verified identity, ownership
proof or trust source. Public verified author data comes only from the server
author profile tied to the seller license that owns the product.

The review helper treats missing support contacts, privacy policy or refund
terms as a manual-review blocker. Do not leave placeholder runtime URLs such
as `example.com` or `localhost` in the production manifest.

```bash
pulse-plugin publish . \
  --upload \
  --public-review \
  --trusted \
  --token-file "$token_file" \
  --api https://funpaypulse.com
```

The CLI flags `--pricing-type`, `--price-rub`, `--access-duration-days` and
`--trial-days` still work and override the metadata file when you need a manual
one-off submission.

`publish --upload` fails if `fixtures/events.json` is missing or invalid. Use
`--fixtures <relative-path>` when the review fixture lives at another packaged
path.

The upload step does not install the plugin, publish it to the public
marketplace, grant user access, approve trusted scopes, or return a Broker
token. Installation and token reveal stay in the Pulse UI/marketplace flow.

## Public API Contract

SDK v1 compatibility is defined by the root package export surface:

```python
from funpay_pulse_sdk import BrokerClient, PluginApp, validate_manifest
```

Names listed in `funpay_pulse_sdk.__all__` are the stable v1 import contract.
Submodules such as `funpay_pulse_sdk.broker` and implementation helpers may be
used internally by the SDK, but a symbol is not public v1 unless it is exported
from the root package.

The stable v1 surface includes:

- `BrokerClient`, Broker response dataclasses and `broker_*_from_dict`
  parsers;
- `PluginApp`, typed events and `parse_broker_event`;
- manifest validation, package building, marketplace publish client helpers;
- fixture test client, webhook signature helpers and permission constants;
- CLI entry point `pulse-plugin`.

The repository test suite contains `tests/test_public_api_contract.py`, which
pins root exports, critical method signatures, core Broker dataclass fields and
the `pulse-plugin` entry point. Any breaking change should be intentional,
documented, and shipped as a new major SDK contract instead of silently changing
v1.

For plugins that need order/lot context, start from the read-first order
assistant template:

```bash
pulse-plugin init seller_order_helper --template order-assistant
cd seller_order_helper
pulse-plugin test . --allow-localhost
python app.py --fixtures fixtures/events.json --write-log-actions
```

That template demonstrates capability preflight, read-only `orders.*` and
`lots.*` actions, plugin-owned storage, and Broker secret storage without
touching FunPay credentials.

For manually reviewed plugins that need mutating actions, use the separate
trusted template:

```bash
pulse-plugin init seller_trusted_helper --template trusted-actions
cd seller_trusted_helper
pulse-plugin check . --allow-localhost --trusted
pulse-plugin test . --allow-localhost --trusted
python app.py --fixtures fixtures/events.json --demo-reply --demo-review-reply --demo-refund --demo-disable-lot --demo-price 42.5 --demo-raise-lot --demo-blacklist-add
```

The template manifest is safe by default and requests only `logs:write`; add
exactly the needed trusted mutating scope before review.

For manually reviewed trusted plugins, validate the manifest with the explicit
trusted profile:

```bash
pulse-plugin validate funpay-pulse.plugin.json --allow-localhost --trusted
pulse-plugin check . --allow-localhost --trusted
```

`--trusted` only validates the manifest locally. Production still requires
platform approval, trusted product state, install confirmation, and enabled
Broker/Worker flags before mutating actions are available.

The webhook-signature template is available for feature-flagged webhook push:

```bash
pulse-plugin init seller_auto_reply --template basic-webhook
```

## Local Fixtures

Before registering a plugin product, run the local non-executing check:

```bash
pulse-plugin check . --allow-localhost
```

`check` validates `funpay-pulse.plugin.json` and parses fixture deliveries with
the SDK event parser. It does not import or execute `app.py`, so it is suitable
as a safe local gate for generated plugins and reviewed plugin source trees.
Use `--trusted` only for manually reviewed manifests that request
`messages:send`, `orders:refund`, `orders:review`, `lots:active`, `lots:price`, `lots:raise`, `blacklist:add`, or `blacklist:remove`.
Bundled demo fixtures use `created_at: "fixture:now"` so local examples remain
fresh; use fixed old timestamps in your own tests when you need to assert stale
delivery rejection.

Create a single local fixture with `emit`:

```bash
pulse-plugin emit fixtures/new_order.json
pulse-plugin emit fixtures/new_review.json --force
```

`emit` supports `new_message`, `new_order`, `order_confirmed`, and
`new_review`. If `--event` is omitted, the command infers the event type from
the output filename and writes a Broker poll response compatible with
`FixtureBrokerClient`.

To execute your local plugin code once against fixtures, use `test`:

```bash
pulse-plugin test . --allow-localhost
pulse-plugin test . --allow-localhost --config local-config.json --write-log-actions
```

`test` validates the manifest and fixtures, derives fixture-client permissions
from manifest scopes, imports `app.py`, and calls `run_once(client, *,
limit=..., write_log_actions=...)`. It is a developer runtime test, so run it
only on source code you trust; unlike `check`, it intentionally executes local
plugin Python code.

For the full local readiness gate without writing a `.fppkg` into `dist/`, use
`doctor`:

```bash
pulse-plugin doctor . --allow-localhost
```

`doctor` validates the manifest, parses fixtures when present, runs the same
package scanner/packer in a temporary file, and then deletes the artifact. It
does not call the server, create a product, upload a package or return a Broker
token.

## Package A Plugin

After `check` passes, build a local review artifact:

```bash
pulse-plugin pack . --allow-localhost
```

The default output is `dist/<plugin_id>-<version>.fppkg`. Trusted manifests
that request reviewed mutating scopes must be packaged with the same trusted
profile used for validation:

```bash
pulse-plugin pack . --allow-localhost --trusted
```

The `.fppkg` file is a deterministic zip archive. It contains
`funpay-pulse-package.json` at the archive root and the plugin source tree under
`plugin/`. Package metadata includes plugin id, plugin version, manifest
SHA-256, package file inventory, per-file SHA-256 values, and source byte count.
The printed `package_sha256` is the future upload/review artifact identity.

`pack` validates the manifest, validates fixtures when present, and rejects
hidden files, symlinks, cache/build directories, native/binary/database files,
secret-like filenames, raw `fppb_...` Broker tokens, raw `fppi_...` invite
tokens, raw `fppd_...` developer publish tokens, private keys,
Bearer/JWT/GitHub/OpenAI-style token patterns, and
obvious token/golden-key assignments. It scans each packaged text file in full
within the SDK file-size limit. It is still a local packaging gate, not
marketplace approval and not production installation.

Before uploading, run publication preflight:

```bash
pulse-plugin publish . --dry-run --allow-localhost --api https://funpaypulse.com
```

`publish --dry-run` runs the same local package checks and also calls the
license-server public dry-run manifest validator at
`/api/v2/plugin-marketplace/products/validate`. It does not create a product,
does not upload the `.fppkg`, does not install a plugin and never returns a
Broker token. The SDK client sends no `Authorization`, blocks redirects,
requires HTTPS except explicit localhost dev mode, and redacts secret-like
error details before CLI output. Use `--offline` when you need a local-only
preflight without a server request.

To upload the package to your private plugin review queue from the SDK, create
an SDK publish token in `/profile/developer` and pass it through a temporary
token file outside the plugin repository:

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
rm -f "$token_file"
trap - EXIT
```

`publish --upload` registers a private product when `--product-id` is omitted,
then uploads the locally built `.fppkg` to
`/api/v2/plugin-marketplace/sdk/products/.../versions/package`. The developer
token is sent only as an `Authorization: Bearer` header and is never printed by
the CLI. Prefer `--token-file` over `--token` because command-line arguments can
leak through shell history and process lists.
Upload is still a review step: it does not install the plugin, grant
access, approve marketplace publication or return a Broker token. Use
`--product-id plp_...` to upload a new package to an existing private product.
Add `--public-review` only when the package is ready for marketplace review.
By default the CLI reads `funpay-pulse.marketplace.json` from the plugin root.
Pricing, support, privacy and refund fields in that file are packaged with the
review artifact. Pricing fields also become the default public-review snapshot:

```json
{
  "pricing_type": "subscription",
  "price_rub": 350,
  "access_duration_days": 30,
  "trial_days": 0,
  "category": "automation",
  "summary": "Short marketplace description.",
  "publisher": {
    "name": "Your public author name",
    "url": "https://your-domain.ru"
  },
  "support": {
    "telegram": "@developer"
  },
  "support_url": "https://your-domain.ru/support",
  "privacy_url": "https://your-domain.ru/privacy",
  "refund_policy": "Refunds are reviewed manually through support."
}
```

For public marketplace review, keep the file honest: real price, review-facing
publisher name, real support contact, real privacy page, real refund policy,
and a runtime URL that somebody can actually operate. The publisher block is
not used as verified identity or ownership. Pulse shows verified author data
only from the server-side author profile for the product owner license.
`localhost` is only for local checks with `--allow-localhost`.

Manual CLI pricing flags are still accepted and override the metadata file:

```bash
pulse-plugin publish . --upload --public-review --pricing-type free --token-file "$token_file"
pulse-plugin publish . --upload --public-review --pricing-type one_time --price-rub 990 --token-file "$token_file"
pulse-plugin publish . --upload --public-review --pricing-type subscription --price-rub 350 --access-duration-days 30 --token-file "$token_file"
pulse-plugin publish . --upload --public-review --pricing-type trial --trial-days 7 --token-file "$token_file"
```

Use `FixtureBrokerClient` when testing plugin logic without a live license-server:

```python
from funpay_pulse_sdk import FixtureBrokerClient, parse_broker_event

client = FixtureBrokerClient.from_file("fixtures/events.json")

for event in client.poll_events(limit=50):
    typed = parse_broker_event(event)
    print(typed.event_type, typed.delivery_id)
    client.ack_event(event.delivery_id)
```

Fixtures simulate delivery, ack, and local action recording. They do not grant real action scopes and they do not prove that a plugin is installed for a real user.

By default fixtures reject optional read/query/write actions except `logs.write`. For tests of order/lot query plugins or trusted message/lot plugins, opt in explicitly:

```python
read_client = FixtureBrokerClient(events, allow_read_actions=True)
lots_only_client = FixtureBrokerClient(events, read_scopes={"lots:read"})
secret_client = FixtureBrokerClient(events, allow_secret_storage=True)
client = FixtureBrokerClient(events, allow_message_actions=True)
lot_client = FixtureBrokerClient(events, allow_lot_actions=True)
price_client = FixtureBrokerClient(events, allow_lot_price_actions=True)
raise_client = FixtureBrokerClient(events, allow_lot_raise_actions=True)
refund_client = FixtureBrokerClient(events, allow_order_refund_actions=True)
review_client = FixtureBrokerClient(events, allow_order_review_reply_actions=True)
blacklist_client = FixtureBrokerClient(
    events,
    allow_blacklist_add_actions=True,
    allow_blacklist_remove_actions=True,
)
```

## Plugin App Dispatcher

For normal plugin code use `PluginApp` instead of writing the poll/parse/ack loop by hand:

```python
from funpay_pulse_sdk import FixtureBrokerClient, NewMessageEvent, PluginApp

client = FixtureBrokerClient.from_file("fixtures/events.json")
app = PluginApp(client)

@app.on(NewMessageEvent)
def handle_message(event):
    print(event.chat_id, event.text)

app.process_once(limit=50)
```

Handlers are acknowledged only after they finish successfully. If a handler raises an exception, the delivery stays unacked and can be redelivered by the Broker after the visibility timeout.

Production plugin apps can use the same dispatcher with `app.run_forever(...)`.
If handlers are declared with `async def`, use `await app.process_once_async(...)` or `await app.run_forever_async(...)`; the synchronous dispatcher rejects async handlers before polling so it cannot ack unprocessed deliveries.

## Install Config

Plugins can read only their own installation config through the Broker token:

```python
config = client.get_config().config
if config.get("enabled") is False:
    return
```

The SDK fixture client accepts local config for tests:

```python
client = FixtureBrokerClient(events, config={"enabled": True})
```

## Runtime Capabilities

Plugins can inspect their current installation runtime state before using optional features:

```python
capabilities = client.get_capabilities()
if "logs.write" in capabilities.supported_actions:
    client.write_log("ready", idempotency_key="log-ready-v1")
```

The response includes enabled Broker flags, installed scopes, supported action types, storage/secrets authorization, storage/secrets limits, and `config_revision`.

## Installed Package Download

When package download is enabled for the Broker runtime, plugins can fetch the
package manifest and verify the downloaded `.fppkg` through SDK helpers:

```python
package_manifest = client.get_package_manifest()
download = client.download_package(
    expected_sha256=package_manifest.package_sha256,
)

print(package_manifest.plugin_id, package_manifest.version)
print(download.package_sha256, download.package_size_bytes)
```

`download_package()` verifies `X-Package-SHA256`, `X-Package-Size-Bytes`, the
actual payload size, and the actual payload SHA-256 before returning bytes. The
SDK rejects redirects through the same no-redirect opener used by other Broker
requests. The manifest parser rejects internal fields such as
`package_storage_path`; package delivery is scoped by the server to the current
installation and installed version.

For operational installs where you only need the reviewed artifact on disk, use
the CLI. Prefer a temporary token file over an environment variable or
command-line token:

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
rm -f "$token_file"
trap - EXIT
```

`download-package` reads the package manifest first, downloads with the manifest
SHA-256 as the expected hash, refuses to overwrite an existing file without
`--force`, validates the token before opening HTTP, and never prints the raw
Broker token. Local `.pulse-broker-token` and `.pulse-developer-token` files are
ignored by the SDK `.gitignore`, but for real installs prefer a temporary file
outside the plugin repository.

## Plugin Storage

Plugins with `storage:own` can store small non-secret JSON state by key:

```python
client.set_storage_item("state", {"counter": 1})
state = client.get_storage_item("state").value
client.delete_storage_item("state")
```

Storage is scoped to one installation. Keys and values that look like tokens,
passwords, API keys, golden keys or other secrets are rejected.

## Plugin Secrets

Plugins with `secrets:own` can store encrypted third-party secrets by key:

```python
client.set_secret_item("external_api_key", "sk_test_external")
api_key = client.get_secret_item("external_api_key").value
client.delete_secret_item("external_api_key")
```

The set response returns metadata only and never echoes the secret value. Secret
storage is scoped to one installation, encrypted at rest by the license-server
key, and rejects Pulse/FunPay internal token names such as `golden_key`,
`connection_token`, Broker tokens and invite tokens. Use it for external
provider keys, not for stealing or moving Pulse credentials.

## Production Polling

For normal `broker-poller` installs, Pulse Desktop starts the managed runner
after installation. The raw `fppb_...` token stays on the trusted runner path
and is not shown in the renderer.

Use the manual polling flow only when you are developing locally, debugging a
specific install, or running a runtime type the managed runner does not support
yet. In that case, run the plugin app as an external process with a token file:

```bash
export FPP_BASE_URL=https://funpaypulse.com
export FPP_BROKER_TOKEN_FILE=/etc/funpay-pulse/plugins/seller-auto-reply/broker-token
python app.py
```

Keep the Broker token in host secret storage or a root-owned token file. Do not
commit it to the repository, put it in process-manager command lines or print it
in logs.

For local development against a local license-server only, `BrokerClient(..., allow_insecure_localhost=True)` permits plain HTTP for real loopback hosts such as `localhost`, `127.0.0.1` and `::1`. Production plugin apps must use HTTPS.

For manual process supervision, use the deployment guide:

```text
docs/PLUGIN_RUNTIME_SELF_HOSTING.md
```

It documents the fallback story: self-hosted process, systemd, Docker secrets,
developer-hosted SaaS boundaries and rotate/revoke handling. The default
Desktop buyer flow for `broker-poller` should use the managed runner instead
of asking the buyer to paste console commands.

## Safe Actions

Current action support is intentionally narrow:

- `logs.write`
- required manifest/install scope: `logs:write`
- required `Idempotency-Key`
- endpoint: `POST /api/v2/broker/actions`

Example:

```python
client.write_log(
    "processed delivery",
    level="info",
    context={"delivery_id": event.delivery_id},
    idempotency_key=f"log-{event.delivery_id}",
)
```

Every queued action can be checked later:

```python
action = client.write_log("ready", idempotency_key="log-ready-v1")
status = client.get_action(action.action_id)
print(status.status, status.result)
```

The status/result response intentionally does not return action input or Worker lease tokens.
It also returns `idempotency_key_hash`, not the raw `Idempotency-Key`.
For read actions, parse succeeded results through typed helpers instead of
hand-reading raw dictionaries:

```python
status = client.get_action(action.action_id)
if status.status == "succeeded":
    order = status.order_result()
    print(order.order_id, order.buyer_username, order.price)
```

`orders.get`, `orders.list`, `lots.get`, and `lots.list` are read-only query actions. They are still queued through Broker actions, so the platform keeps idempotency, audit, revocation, HMAC Worker claim/report, and safe result filtering.

```python
capabilities = client.get_capabilities()
if "orders.get" in capabilities.supported_actions:
    client.get_order(
        account_id=event.account_id,
        order_id=event.order_id,
        delivery_id=event.delivery_id,
        idempotency_key=f"order-get-{event.delivery_id}",
    )

if "orders.list" in capabilities.supported_actions:
    client.list_orders(
        account_id=event.account_id,
        delivery_id=event.delivery_id,
        status="paid",
        limit=25,
        idempotency_key=f"orders-list-{event.delivery_id}-v1",
    )

if "lots.get" in capabilities.supported_actions:
    client.get_lot(
        account_id=event.account_id,
        lot_id=event.lot_id,
        delivery_id=event.delivery_id,
        idempotency_key=f"lot-get-{event.delivery_id}",
    )

if "lots.list" in capabilities.supported_actions:
    client.list_lots(
        account_id=event.account_id,
        delivery_id=event.delivery_id,
        limit=50,
        idempotency_key=f"lots-list-{event.delivery_id}-v1",
    )
```

When a read action has reached `succeeded`, the SDK exposes typed result
parsers on `BrokerActionStatus`:

```python
order = client.get_action(order_action.action_id).order_result()
orders = client.get_action(orders_action.action_id).orders_page_result()
lot = client.get_action(lot_action.action_id).lot_result()
lots = client.get_action(lots_action.action_id).lots_page_result()

print(order.order_id, orders.items[0].status, lot.title, lots.has_more)
```

These helpers reject non-succeeded statuses and mismatched action types, so a
developer does not accidentally parse a failed action or a log action as an
order result.

Trusted mutating actions expose the same pattern:

```python
message = client.get_action(message_action.action_id).message_send_result()
refund = client.get_action(refund_action.action_id).order_refund_result()
active = client.get_action(active_action.action_id).lot_active_result()
price = client.get_action(price_action.action_id).lot_price_result()
blacklist_add = client.get_action(blacklist_add_action.action_id).blacklist_add_result()
blacklist_remove = client.get_action(blacklist_remove_action.action_id).blacklist_remove_result()

print(message.message_id, refund.refunded, active.active, price.price)
print(blacklist_add.added, blacklist_remove.removed)
```

`orders.get` requires `orders:read` and returns only a safe order summary for the delivery-bound order. `orders.list` requires the separate `orders:list` scope, accepts `account_id`, `delivery_id`, optional `status` (`paid`, `closed`), optional `limit` from `1..50`, optional `cursor`, and returns only a paginated safe list from the local sanitized order cache. `lots.get` requires `lots:read` and returns only safe cached lot metadata for the delivery-bound lot. `lots.list` also requires `lots:read`, accepts `account_id`, `delivery_id`, optional `limit` from `1..100`, optional `cursor`, and returns only a paginated safe list of cached lots for the delivery-bound account. The production Broker verifies delivery binding and freshness from immutable delivery creation time; redelivery does not extend the read window. The local fixture client enforces delivery binding for read actions when `allow_read_actions=True` or granular `read_scopes` are used. Raw order secrets, buyer params, CSRF tokens, raw FunPay edit fields and credentials are not exposed.

`messages.send` is exposed through `client.send_message(...)`, but production use requires an installation with `messages:send`, a product approved/trusted by the platform, and an enabled Worker/Backend action executor. Ordinary private registration may still reject `messages:send` until the platform owner enables that rollout path.

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

`account_id`, `chat_id`, and `delivery_id` must come from the sanitized Broker event. The server verifies that the action is bound to that delivery before Worker can claim it. The local fixture client mirrors that binding when `allow_message_actions=True`. Do not pass FunPay credentials, cookies, Broker tokens or arbitrary user-supplied ids.

`orders.refund` is exposed through `client.refund_order(...)`, but production use requires an installation with `orders:refund`, a product approved/trusted by the platform, and enabled Worker/Backend action executor. It can refund only one fresh `events:new_order` delivery-bound order and never exposes FunPay credentials or arbitrary order mutation.

```python
capabilities = client.get_capabilities()
if "orders.refund" in capabilities.supported_actions:
    action = client.refund_order(
        account_id=event.account_id,
        order_id=event.order_id,
        delivery_id=event.delivery_id,
        idempotency_key=f"order-refund-{event.delivery_id}",
    )
    result = client.get_action(action.action_id).order_refund_result()
    print(result.order_id, result.refunded, result.already_refunded)
```

`orders.review.reply` is exposed through `client.reply_to_review(...)`, but production use requires an installation with `orders:review`, a product approved/trusted by the platform, and enabled Worker/Backend action executor. It can reply only to one fresh `events:new_review` delivery for the same order. The plugin supplies reply text only; Pulse derives the required FunPay review rating from the immutable delivery payload and rejects plugin-supplied `rating`.

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
    result = client.get_action(action.action_id).order_review_reply_result()
    print(result.order_id, result.replied, result.already_replied)
```

`lots.active.set` is exposed through `client.set_lot_active(...)`, but production use requires an installation with `lots:active`, a product approved/trusted by the platform, and enabled Worker/Backend action executor. It only toggles one delivery-bound lot and does not expose price edits, description edits, raw FunPay lot fields or bulk operations.

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

`account_id`, `lot_id`, and `delivery_id` must come from a sanitized order Broker event. The server verifies that the action is bound to that delivery before Worker can claim it.

`lots.price.set` is exposed through `client.set_lot_price(...)`, but production use requires an installation with `lots:price`, a product approved/trusted by the platform, and enabled Worker/Backend action executor. It only changes one delivery-bound lot price and does not expose description edits, raw FunPay lot fields or bulk operations.

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

`lots.raise` is exposed through `client.raise_lots(...)`, but production use requires an installation with `lots:raise`, a product approved/trusted by the platform, and enabled Worker/Backend action executor. It accepts only `account_id`, `lot_id`, and `delivery_id` from a sanitized order delivery. FunPay raises by subcategory, so Pulse authorizes the action through a delivery-bound lot, derives the subcategory/category from the local lot cache, rate-limits by subcategory, and rejects raw `game_id`, node ids, FunPay forms, CSRF fields, or bulk subcategory operations from the plugin.

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

`blacklist.add` and `blacklist.remove` are exposed through
`client.add_to_blacklist(...)` and `client.remove_from_blacklist(...)`, but
production use requires the matching `blacklist:add` or `blacklist:remove`
scope, a product approved/trusted by the platform, and enabled Worker/Backend
action executor. The plugin can act only on a buyer/sender from a fresh
sanitized delivery. Add creates only plugin-owned per-account blacklist rows;
remove deletes only rows created by the same plugin installation, so manual,
system, global and other-plugin blacklist entries are protected.

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

`BrokerClient.submit_action()` rejects unknown action types locally before it opens an HTTP request.

## Typed Events

`parse_broker_event()` maps raw Broker deliveries to typed helpers:

- `NewMessageEvent`
- `NewOrderEvent`
- `OrderConfirmedEvent`
- `NewReviewEvent`

Unknown event types or malformed payloads raise `EventParseError`.
