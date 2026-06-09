# Changelog

## 0.1.0

- Added Desktop managed runner documentation for installed `broker-poller`
  packages: install/start happens through Pulse UI, raw Broker tokens are not
  shown in the renderer, and manual token-file launch is now documented as a
  fallback.
- Documented managed runner fail-closed boundaries: `broker-poller` only,
  sidecar control token required, sidecar API base URL comes from runtime env,
  and full per-installation sandbox isolation remains future hardening.
- Added `BrokerClient` for Plugin Broker poll, ack, and safe `logs.write` actions.
- Added typed event helpers for `events:new_message`, `events:new_order`, `events:order_confirmed`, and `events:new_review`.
- Added `FixtureBrokerClient` for local offline plugin development.
- Added `PluginApp` dispatcher with typed handler decorators, ack-after-success, fixture mode, and production polling loop.
- Added async `PluginApp` dispatcher methods and sync-mode rejection for async handlers before polling.
- Added SDK support for read-only install config and non-secret per-installation storage.
- Added SDK support for encrypted per-installation secret storage through `secrets:own`.
- Added runtime capabilities support through `client.get_capabilities()`.
- Added `BrokerClient.get_package_manifest()` and `BrokerClient.download_package()` for broker-token scoped installed `.fppkg` delivery with SDK-side SHA-256 and size verification.
- Added `pulse-plugin download-package` for token-file/env based installed `.fppkg` download through Broker package delivery without printing raw Broker tokens.
- Hardened CLI token handling so raw `fppb_...`, `fppd_...`, and `fppi_...` values are redacted from command errors, malformed Broker tokens are rejected before HTTP, and downloaded package files use exclusive create unless `--force` is supplied.
- Added an end-to-end CLI regression that covers `init`, `check`, `test`, `doctor`, `pack`, `publish --upload`, and `download-package` with the same package bytes across upload/download.
- Added `BrokerClient.send_message(...)` and fixture support for `messages.send` behind explicit runtime/fixture enablement.
- Added `BrokerClient.refund_order(...)` and fixture support for trusted `orders.refund` behind explicit runtime/fixture enablement.
- Added `BrokerClient.reply_to_review(...)` and fixture support for trusted `orders.review.reply` behind explicit runtime/fixture enablement.
- Added `BrokerClient.set_lot_active(...)` and fixture support for trusted `lots.active.set` behind explicit runtime/fixture enablement.
- Added `BrokerClient.set_lot_price(...)` and fixture support for trusted `lots.price.set` behind explicit runtime/fixture enablement.
- Added `BrokerClient.raise_lots(...)` and fixture support for trusted `lots.raise` behind explicit runtime/fixture enablement.
- Added `BrokerClient.add_to_blacklist(...)`, `BrokerClient.remove_from_blacklist(...)`, and fixture support for trusted `blacklist.add`/`blacklist.remove` behind explicit runtime/fixture enablement.
- Added `BrokerClient.get_action(...)` and fixture support for safe Broker action status/result polling.
- Added typed SDK parsers for safe `orders.get`, `orders.list`, `orders.refund`, `orders.review.reply`, `messages.send`, `lots.get`, `lots.list`, `lots.active.set`, `lots.price.set`, `lots.raise`, `blacklist.add`, and `blacklist.remove` action results.
- Tightened `FixtureBrokerClient` parity for `messages.send` delivery/account/chat binding and delivery freshness.
- Added manifest trusted validation profile through `validate_manifest(..., trusted=True)`, `validate_manifest_file(..., trusted=True)`, and CLI `--trusted` for manually reviewed mutating-scope manifests; unrelated dangerous scopes remain rejected.
- Hardened action idempotency handling so secret-like idempotency keys are rejected and Broker responses expose only `idempotency_key_hash`.
- Added `pulse-plugin init` with the default `broker-poller` template.
- Added `pulse-plugin check` for non-executing manifest and fixture validation.
- Added `pulse-plugin emit` for safe local Broker fixture generation.
- Added `pulse-plugin test` for local trusted source runtime checks against fixtures, with manifest-derived fixture permissions and clean plugin failure output.
- Added `pulse-plugin doctor` for a full local manifest/fixture/package readiness gate that writes only a temporary `.fppkg` and never calls the server.
- Added `pulse-plugin pack` and `build_plugin_package(...)` for deterministic `.fppkg` review artifacts with manifest/fixture validation, file inventory hashes, full-file secret-like content rejection, safe in-tree fixture paths, and package SHA-256 output.
- Added `pulse-plugin publish --dry-run` and `MarketplaceClient` for local package preflight plus server-side public manifest dry-run validation without creating products, uploading packages, installing plugins, issuing Broker tokens, sending auth headers, following redirects, or printing secret-like server error details.
- Added authenticated `pulse-plugin publish --upload` through hash-only `fppd_...` developer tokens. Upload registers a private product when needed, uploads the `.fppkg` review artifact through SDK-only endpoints, supports safer `--token-file`, never prints the token, and still does not install plugins or issue Broker tokens.
- Added `pulse-plugin publish --upload --public-review` with explicit marketplace pricing flags, so developers can submit an uploaded package to public review without using a web cookie or exposing the SDK token.
- Added `funpay-pulse.marketplace.json` template metadata and SDK-side parsing, so public-review pricing, support, privacy and refund details can live in the plugin package while CLI pricing flags remain an explicit override.
- Added optional `publisher.name` and `publisher.url` marketplace metadata validation for review/listing drafts. This package metadata is intentionally not treated as verified identity; verified public author data comes only from the server-side author profile tied to the product owner license.
- Added public-review support metadata fields (`support_url`, `privacy_url`, `refund_policy`) to SDK templates and docs, and made package review surface missing support/privacy/refund details before a paid listing is approved.
- Added the `order-assistant` template for safe order/lot read workflows, storage, secret storage, and logs.
- Added manifest validation and packaged JSON Schema for known SDK scopes, including trusted-review-only mutating scopes.
- Explicitly rejected unknown action types in the SDK client before HTTP submission.
