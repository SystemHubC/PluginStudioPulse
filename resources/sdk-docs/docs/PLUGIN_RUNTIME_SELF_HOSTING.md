# Plugin Runtime Self-Hosting Guide

Updated: 2026-05-28

This guide is the manual/self-hosted fallback for third-party FunPay Pulse
plugins.

## Current Product Decision

FunPay Pulse does not import third-party plugin code into the `Pulse backend` or
`Pulse worker` application process.

Current default buyer flow for `runtime.type="broker-poller"` is Desktop
managed launch on the selected VPS. The raw Broker token is not shown in the
renderer.

Use this self-hosted flow when:

- the developer is testing locally;
- managed runner is not available on the target;
- the runtime type is not `broker-poller`;
- the developer intentionally operates the plugin as an external service.

Manual runtime flow:

1. Developer builds and uploads/reviews a `.fppkg` package.
2. User gets access through private grant, free claim or paid marketplace
   purchase.
3. User explicitly installs the plugin on an owned active VPS/license.
4. Operator obtains a one-time `fppb_...` Broker token through an approved
   manual/debug path.
5. The external plugin process runs outside the Pulse application process and
   calls Broker API with that token.

Do not ask ordinary buyers to paste console commands for marketplace
`broker-poller` plugins. That path should go through Desktop managed runner.

## What Runs Where

| Component | Runs in Pulse | Runs outside Pulse |
| --- | --- | --- |
| FunPay account sessions and encrypted account secrets | yes | no |
| Worker event observation and sanitization | yes | no |
| Broker event storage, grants, install policy and revoke checks | yes | no |
| Managed `broker-poller` sidecar process | sidecar service on selected VPS | no |
| Manual third-party plugin `app.py` / service code | no | yes |
| Plugin-owned third-party API calls | no | yes |
| Broker polling, ack and allowed actions | API only | yes |

The external runtime receives sanitized Broker events, not Worker internals. It
never receives `golden_key`, cookies, Pulse connection tokens or decrypted
FunPay account secrets.

## Recommended Deployment Options

### Option A: Buyer Self-Hosted Process

Use this for private plugins and simple marketplace plugins when the buyer owns
the runtime machine.

```bash
python -m venv .venv
. .venv/bin/activate
pip install funpay-pulse-sdk

export FPP_BASE_URL=https://funpaypulse.com
export FPP_BROKER_TOKEN_FILE=/etc/funpay-pulse/plugins/my-plugin/broker-token
python app.py
```

The plugin reads the Broker token from the file path, constructs
`BrokerClient`, polls events, and acks only after processing is durable.

### Option B: systemd Service

Use this for a persistent Linux/VPS install.

`/etc/funpay-pulse/plugins/my-plugin/env`:

```ini
FPP_BASE_URL=https://funpaypulse.com
FPP_BROKER_TOKEN_FILE=/etc/funpay-pulse/plugins/my-plugin/broker-token
```

Token file:

```bash
sudo install -d -m 0700 /etc/funpay-pulse/plugins/my-plugin
sudo install -m 0600 /dev/null /etc/funpay-pulse/plugins/my-plugin/broker-token
sudo sh -c 'printf "%s\n" "fppb_..." > /etc/funpay-pulse/plugins/my-plugin/broker-token'
```

Service:

```ini
[Unit]
Description=FunPay Pulse external plugin my-plugin
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=funpay-plugin
WorkingDirectory=/opt/funpay-pulse-plugins/my-plugin
EnvironmentFile=/etc/funpay-pulse/plugins/my-plugin/env
ExecStart=/opt/funpay-pulse-plugins/my-plugin/.venv/bin/python app.py
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/funpay-pulse-plugins/my-plugin

[Install]
WantedBy=multi-user.target
```

Do not put the raw token directly into the unit file. Keep it in a `0600` file
or a host secret store.

### Option C: Docker Container

Use this when the developer ships a container image or the buyer prefers
container deployment.

```yaml
services:
  my-plugin:
    image: registry.example.com/my-plugin:1.0.0
    restart: unless-stopped
    environment:
      FPP_BASE_URL: "https://funpaypulse.com"
      FPP_BROKER_TOKEN_FILE: "/run/secrets/fpp_broker_token"
    secrets:
      - fpp_broker_token

secrets:
  fpp_broker_token:
    file: ./secrets/fpp_broker_token
```

Do not bake `fppb_...` into the image, `.env.example`, Dockerfile, fixtures or
package archive.

### Option D: Developer-Hosted SaaS

Use this only if the plugin developer operates a multi-tenant service.

Required minimums:

- store each buyer's `fppb_...` token encrypted and scoped to that tenant;
- isolate queues, logs and external API credentials per installation;
- never show one buyer's token, config, events, logs or action ids to another;
- implement immediate rotate/revoke handling;
- redact token-like values in application logs;
- make the buyer aware that the runtime is hosted by the plugin developer, not
  by FunPay Pulse.

This model is convenient for buyers, but the developer becomes an operator of a
security-sensitive service. Pulse still enforces Broker token policy, grants,
current version, product review state and revoke checks on every Broker call.

## Broker Token Handling Rules

The raw `fppb_...` token is an installation-bound bearer secret. Treat it like
a production password.

Do:

- store it in a host secret store, `0600` file, systemd `EnvironmentFile`,
  Docker secret or managed secret manager;
- pass only the file path or secret reference to the plugin process;
- rotate it from Pulse UI after suspected exposure;
- use one token per installation;
- redact token-looking values in logs and support dumps.

Do not:

- commit it to Git;
- put it in `funpay-pulse.plugin.json`, fixtures, `.fppkg`, install config,
  screenshots or public docs;
- store it through Broker secret storage. Broker secret storage is for
  third-party provider keys used by the plugin, not for the plugin's own Broker
  token;
- print it in stdout/stderr;
- share one token across customers or VPS nodes.

## Minimal Runtime Loop

```python
import os
from pathlib import Path

from funpay_pulse_sdk import BrokerClient, PluginApp


def read_secret(name: str) -> str:
    file_name = os.getenv(f"{name}_FILE")
    if file_name:
        return Path(file_name).read_text(encoding="utf-8").strip()
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


client = BrokerClient(
    base_url=os.getenv("FPP_BASE_URL", "https://funpaypulse.com"),
    broker_token=read_secret("FPP_BROKER_TOKEN"),
)
app = PluginApp(client)


@app.on_new_message
def handle_message(event, context):
    context.client.write_log(
        "message processed",
        context={"delivery_id": event.delivery_id},
        idempotency_key=f"log-{event.delivery_id}",
    )


if __name__ == "__main__":
    app.run_forever()
```

Ack happens after the handler succeeds. For custom loops, persist your own work
first, then call `ack_event(delivery_id)`.

## Operational Checklist

Before telling a buyer the plugin is production-ready:

- `pulse-plugin doctor . --require-fixtures` passes.
- `.fppkg` was packed and uploaded/reviewed; runtime source was not copied into
  Pulse Worker.
- Broker token is stored outside source code and logs.
- Plugin has restart policy (`systemd`, Docker restart, process manager).
- Logs redact `fppb_...`, `fppd_...`, `fppi_...`, API keys and credentials.
- Actions use stable idempotency keys.
- Handler acks only after durable processing.
- Runtime checks `client.get_capabilities()` before optional actions/storage.
- Runbook explains how to rotate Broker token and restart the process.
- Support can identify installation id/plugin id without asking for raw tokens.

## Version And Upgrade Rules

An installed runtime may download only the package pinned to its own
installation/version. Product updates do not silently change what an existing
installation downloads.

For marketplace upgrades, keep this model:

1. Developer uploads a new `.fppkg` version.
2. Review/admin approval checks package diff, manifest hash, scopes and price
   snapshot.
3. Buyer explicitly upgrades/reinstalls and confirms changed scopes.
4. Runtime restarts with the same installation context or a freshly rotated
   Broker token if needed.

Package version diff UI is still a remaining product task.

## What Is Not Available In SDK v1

- Running uploaded Python/JS code inside Pulse Worker/Backend.
- Runtime types other than `broker-poller` in Desktop managed runner.
- Full per-plugin container/UID/cgroup sandbox SLA.
- Arbitrary network or filesystem capability grants from Pulse.
- Plugin-side config mutation.
- Automatic access to trusted mutating actions without product review, install
  confirmation and runtime flags.
