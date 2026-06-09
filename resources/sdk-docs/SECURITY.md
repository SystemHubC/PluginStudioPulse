# Security Policy

FunPay Pulse SDK v0.1 is a preview SDK for external Plugin Broker apps.

## Supported Runtime

- SDK plugin code is not imported into the `Pulse worker` or `Pulse backend`
  application process.
- `runtime.type="broker-poller"` can be launched through the Desktop managed
  runner/sidecar on the selected VPS. The raw Broker token stays on the trusted
  runner path and is not shown in the Desktop renderer.
- Manual self-hosted launch remains available for development, unsupported
  runtimes and developer-operated services.
- The current Broker runtime supports polling, ack, typed event parsing, fixtures, read-only install config, non-secret per-installation storage, encrypted per-installation secret storage, `logs.write`, read-only `orders.get`/`orders.list`/`lots.get`/`lots.list`, safe action status/result polling, and disabled-by-default trusted queue/executor foundations for `messages.send`, `orders.refund`, `orders.review.reply`, `lots.active.set`, `lots.price.set`, `lots.raise`, `blacklist.add`, and `blacklist.remove`.
- `messages.send` requires all of these conditions before production use: installation scope `messages:send`, product `review_state="approved"` and `trust_state="trusted"`, license-server `CUSTOM_PLUGIN_BROKER_MESSAGES_SEND_ENABLED=true`, license-server Broker actions enabled, and Worker/Backend `CUSTOM_PLUGIN_BROKER_ACTION_EXECUTOR_ENABLED=true`.
- `messages.send` must be bound to a delivered Broker event: the server verifies `delivery_id`, `account_id`, and `chat_id` against the sanitized event payload before Worker can claim it. Local SDK fixtures mirror that binding when `allow_message_actions=True`.
- `orders.refund` requires installation scope `orders:refund`, product `review_state="approved"` and `trust_state="trusted"`, license-server `CUSTOM_PLUGIN_BROKER_ORDERS_REFUND_ENABLED=true`, license-server Broker actions enabled, and Worker/Backend `CUSTOM_PLUGIN_BROKER_ACTION_EXECUTOR_ENABLED=true`.
- `orders.refund` must be bound to a fresh `events:new_order` delivery: the server verifies `delivery_id`, `account_id`, and `order_id` against the sanitized event payload before Worker can claim it.
- `orders.review.reply` requires installation scope `orders:review`, product `review_state="approved"` and `trust_state="trusted"`, license-server `CUSTOM_PLUGIN_BROKER_ORDERS_REVIEW_REPLY_ENABLED=true`, license-server Broker actions enabled, and Worker/Backend `CUSTOM_PLUGIN_BROKER_ACTION_EXECUTOR_ENABLED=true`.
- `orders.review.reply` must be bound to a fresh unreplied `events:new_review` delivery: the server verifies `delivery_id`, `account_id`, and `order_id`, rejects plugin-supplied `rating`, derives the rating from the immutable delivery payload, and Worker/Backend reports only safe reply status metadata.
- `lots.active.set` requires installation scope `lots:active`, product `review_state="approved"` and `trust_state="trusted"`, license-server `CUSTOM_PLUGIN_BROKER_LOTS_ACTIVE_SET_ENABLED=true`, license-server Broker actions enabled, and Worker/Backend `CUSTOM_PLUGIN_BROKER_ACTION_EXECUTOR_ENABLED=true`.
- `lots.active.set` must be bound to a delivered order Broker event: the server verifies `delivery_id`, `account_id`, and `lot_id` against the sanitized event payload before Worker can claim it.
- `lots.price.set` requires installation scope `lots:price`, product `review_state="approved"` and `trust_state="trusted"`, license-server `CUSTOM_PLUGIN_BROKER_LOTS_PRICE_SET_ENABLED=true`, license-server Broker actions enabled, and Worker/Backend `CUSTOM_PLUGIN_BROKER_ACTION_EXECUTOR_ENABLED=true`.
- `lots.price.set` must be bound to a delivered order Broker event: the server verifies `delivery_id`, `account_id`, and `lot_id` against the sanitized event payload before Worker can claim it, and rejects non-finite, non-positive, over-precision, or over-limit prices before queueing.
- `lots.raise` requires installation scope `lots:raise`, product `review_state="approved"` and `trust_state="trusted"`, license-server `CUSTOM_PLUGIN_BROKER_LOTS_RAISE_ENABLED=true`, license-server Broker actions enabled, and Worker/Backend `CUSTOM_PLUGIN_BROKER_ACTION_EXECUTOR_ENABLED=true`.
- `lots.raise` must be bound to a fresh delivered order Broker event: the server verifies `delivery_id`, `account_id`, `lot_id`, and `subcategory_id` against the sanitized event payload before Worker can claim it. FunPay raises by subcategory, so Broker rate-limits the derived subcategory and rejects plugin-supplied `game_id`, raw FunPay form fields, node ids, CSRF values, or bulk subcategory lists; Worker/Backend derives the subcategory/category from the local `Lot`.
- `blacklist.add` requires installation scope `blacklist:add`, product `review_state="approved"` and `trust_state="trusted"`, license-server `CUSTOM_PLUGIN_BROKER_BLACKLIST_ADD_ENABLED=true`, license-server Broker actions enabled, and Worker/Backend `CUSTOM_PLUGIN_BROKER_ACTION_EXECUTOR_ENABLED=true`.
- `blacklist.remove` requires installation scope `blacklist:remove`, product `review_state="approved"` and `trust_state="trusted"`, license-server `CUSTOM_PLUGIN_BROKER_BLACKLIST_REMOVE_ENABLED=true`, license-server Broker actions enabled, and Worker/Backend `CUSTOM_PLUGIN_BROKER_ACTION_EXECUTOR_ENABLED=true`.
- `blacklist.add` and `blacklist.remove` must be bound to a fresh delivered Broker event for the same account and buyer/sender username. The server rejects own/system deliveries and plugin-supplied owner/global/source fields. Worker/Backend creates only account-local `plugin_broker` rows and removes only rows owned by the same plugin installation, so manual, system, global, and other-plugin blacklist records are protected.
- Action submit/status polling and Worker claim responses return `idempotency_key_hash`, not the raw `Idempotency-Key`. Status/result polling returns only safe status, redacted result/error metadata, timestamps, and attempt count. It does not return action input or Worker lease tokens. Prefer the typed `BrokerActionStatus` result helpers so extra raw response keys are ignored.
- `--trusted` only opens the reviewed mutating scope set: `messages:send`, `orders:refund`, `orders:review`, `lots:active`, `lots:price`, `lots:raise`, `blacklist:add`, and `blacklist:remove`. It does not allow unrelated dangerous scopes such as `lots:write`, `blacklist:write`, `public_chat:send`, or `accounts:read_sensitive`.
- Admin trusted-runtime approval is gated by `GET /api/v2/admin/plugin-products/{product_public_id}/risk` and `POST /api/v2/admin/plugin-products/{product_public_id}/review`; trusted state is rejected when the automated risk report contains critical findings. The risk report treats `manifest_json` as the source of truth for scopes and blocks trust when denormalized scope columns drift from the manifest.
- Admin trusted-runtime monitoring uses `GET /api/v2/admin/plugin-actions/anomalies` for aggregate `messages.send`/`orders.refund`/`orders.review.reply`/`lots.active.set`/`lots.price.set`/`lots.raise`/`blacklist.add`/`blacklist.remove` anomaly findings. It reports counts and public identifiers only, not action input.
- Developer/private review registration can accept `messages:send`, `orders:refund`, `orders:review`, `lots:active`, `lots:price`, `lots:raise`, `blacklist:add`, and `blacklist:remove` as review-pending scopes. Runtime use still requires admin trusted approval, the exact installation scope, Broker action flags and Worker/Backend executor flags.
- The trusted-actions template manifest is safe by default and requests only `logs:write`; developers must add exactly the trusted mutating scopes they need before review.
- `pulse-plugin pack` is a local artifact gate for review, not approval. It validates the manifest, validates fixtures when present, scans packaged text files in full within the SDK file-size limit, and rejects hidden files, symlinks, cache/build output, native/binary/database files, secret-like filenames, raw Broker/invite tokens, private keys, Bearer/JWT/GitHub/OpenAI-style token patterns, obvious token/golden-key assignments, and unsafe external fixture paths before writing a deterministic `.fppkg`.
- The SDK deliberately does not enable publisher payouts, arbitrary code upload
  into the Worker/Backend process, or a full sandbox/SLA for third-party code.
  Current managed runner isolation is an MVP sidecar boundary; stronger
  per-installation container/UID/cgroup isolation is still a hardening task.

## Secrets

Do not commit or log raw `fppb_...` Broker tokens. Store them in the plugin app secret store. Use Broker secret storage only for plugin-owned external provider credentials, not Pulse/FunPay internals such as `golden_key`, connection tokens, invite tokens or Broker tokens. Local fixtures do not issue real Broker tokens and do not grant real action scopes.

## Reporting

Report SDK, Broker, or marketplace security issues privately to the FunPay Pulse maintainer. Do not publish raw Broker tokens, invite tokens, signing secrets, or customer payloads in public reports.
