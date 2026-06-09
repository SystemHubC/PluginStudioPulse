# FunPay Pulse Plugin SDK: инструкция для разработчика

Обновлено: 2026-06-08

Этот SDK нужен для внешних плагинов FunPay Pulse. Важная мысль сразу: плагин не
импортируется внутрь `Pulse Worker` или `Backend` как обычный встроенный модуль.
Разработчик пишет отдельное Python-приложение, проверяет его локально, собирает
`.fppkg` и отправляет пакет на ревью.

После покупки или выдачи плагина пользователь ставит его в Desktop в разделе
`Мои плагины`. Для обычного `broker-poller` Desktop сам запускает managed
runner на выбранном VPS. Raw Broker-токен не показывается пользователю в
интерфейсе. Ручной запуск с token-file остается для разработки, отладки и
runtime-типов, которые managed runner пока не поддерживает.

## Что лежит в архиве

- `funpay_pulse_sdk-0.1.0-py3-none-any.whl` - Python SDK.
- `README.md` - техническая справка по CLI и Broker API.
- `SECURITY.md` - правила по токенам, секретам и пакетам.
- `CHANGELOG.md` - изменения SDK.
- `FunPay_Pulse_SDK_public_review_instruction.md` - эта инструкция в Markdown.
- `FunPay_Pulse_SDK_public_review_instruction.docx` - эта инструкция в Word.
- `docs/` - подробные справки по SDK v1, Broker runtime, self-host fallback и
  API reference.

Рядом с архивом лежат `SHA256SUMS` и `SHA256SUMS.json`. По ним можно проверить
wheel, документы и сам zip перед отправкой разработчику.

## Что нужно до начала

Нужен Python 3.10 или новее. На Windows лучше использовать PowerShell.

Проверить Python:

```bash
python --version
```

Если команда не найдена на Windows, попробуй:

```powershell
py --version
```

## Установка SDK

Создай папку под плагин и виртуальное окружение:

```bash
mkdir my_pulse_plugin
cd my_pulse_plugin
python -m venv .venv
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
pip install .\funpay_pulse_sdk-0.1.0-py3-none-any.whl
pulse-plugin --help
```

macOS/Linux:

```bash
. .venv/bin/activate
pip install ./funpay_pulse_sdk-0.1.0-py3-none-any.whl
pulse-plugin --help
```

Если `pulse-plugin --help` открыл справку, SDK установлен нормально.

## Быстрый старт

Создать базовый плагин:

```bash
pulse-plugin init seller_auto_reply
cd seller_auto_reply
```

Сгенерировать фикстуру события:

```bash
pulse-plugin emit fixtures/new_message.json --force
```

Проверить проект:

```bash
pulse-plugin check . --allow-localhost --require-fixtures
pulse-plugin test . --allow-localhost
pulse-plugin doctor . --allow-localhost --require-fixtures
```

Что делают команды:

- `check` проверяет манифест, права и фикстуры. Код плагина не запускается.
- `test` запускает локальный `app.py` на фикстурах. Используй только на своем
  коде или коде, которому доверяешь.
- `doctor` делает полный локальный preflight перед сборкой и upload.

Если плагин просит trusted-права, добавляй `--trusted`:

```bash
pulse-plugin check . --allow-localhost --trusted --require-fixtures
pulse-plugin test . --allow-localhost --trusted
pulse-plugin doctor . --allow-localhost --trusted --require-fixtures
```

## Локальный запуск без Pulse

До реальной установки можно работать на фикстурах:

```bash
python app.py --fixtures fixtures/events.json
```

Для локальной разработки `runtime.url` может быть `http://localhost:...`, но
только с флагом `--allow-localhost`.

Для публичного ревью нельзя оставлять:

- `localhost`;
- `127.0.0.1`;
- `example.com`;
- `example.org`;
- `example.net`;
- тестовый URL, который никто не поддерживает.

Если выбран `webhook`, нужен публичный HTTPS endpoint. Если выбран
`broker-poller`, runtime все равно должен быть реальным сервисом, который
разработчик или пользователь сможет запустить и поддерживать.

## Developer token

Developer token `fppd_...` создается в профиле разработчика на сайте Pulse. Он
нужен только для загрузки пакета на ревью.

Что важно:

- токен показывается один раз;
- у нас он хранится только как hash;
- он не устанавливает плагин;
- он не дает доступ покупателю;
- он не выдает Broker-токен;
- его нельзя отправлять в чат, вставлять в README, `.env`, fixtures, Dockerfile
  или скриншоты.

Безопасный upload через временный файл:

```bash
umask 077
token_file="$(mktemp "${TMPDIR:-/tmp}/pulse-developer-token.XXXXXX")"
trap 'rm -f "$token_file"' EXIT
printf 'Paste developer token: ' >&2
IFS= read -r -s developer_token
printf '\n' >&2
printf '%s\n' "$developer_token" > "$token_file"
unset developer_token
```

Windows PowerShell, простой вариант:

```powershell
New-Item -ItemType File token.txt
notepad token.txt
```

Вставь туда `fppd_...`, загрузи пакет и сразу удали `token.txt`. Не отправляй
этот файл вместе с плагином.

## Marketplace metadata

Рядом с `funpay-pulse.plugin.json` должен лежать
`funpay-pulse.marketplace.json`, если плагин идет в публичный маркетплейс.

Минимальный пример для платного доступа на 30 дней:

```json
{
  "pricing_type": "subscription",
  "price_rub": 350,
  "access_duration_days": 30,
  "trial_days": 0,
  "category": "automation",
  "summary": "Автоматически отвечает покупателю после оплаты заказа.",
  "publisher": {
    "name": "Название автора или студии",
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

Поля:

- `pricing_type`: `free`, `one_time`, `subscription` или `trial`.
- `price_rub`: цена в рублях. Для `free` обычно `0`.
- `access_duration_days`: срок доступа для `subscription`.
- `trial_days`: срок тестового доступа для `trial`.
- `category`: короткая категория для ревью.
- `summary`: короткое описание для модерации и витрины.
- `publisher.name`: имя автора или студии для черновика listing/review.
- `publisher.url`: HTTPS-ссылка автора или студии для черновика listing/review.
- `support.telegram`: Telegram разработчика или поддержки.
- `support_url`: HTTPS-страница поддержки.
- `privacy_url`: HTTPS-страница политики приватности.
- `refund_policy`: короткие условия возврата.

Важно: `publisher` в файле пакета не подтверждает личность автора, не доказывает
владение плагином и не считается источником доверия. Это только metadata из
пакета, чтобы ревьюеру и витрине было проще понять, что хотел указать
разработчик.

Публичная страница автора берется только с сервера Pulse. Разработчик должен
заполнить ее в профиле разработчика: `/profile/developer` -> `Страница автора`.
Именно этот server-side профиль связан с seller license и продуктами автора.
Если профиль не заполнен, публичная карточка плагина покажет `Автор не указан`,
даже если в `.fppkg` есть `publisher.name`.

Для публичного платного плагина поддержка, политика приватности и условия
возврата обязательны. Если они не заполнены, пакет может загрузиться, но review
helper отправит его на ручную доработку.

## Upload на ревью

Перед upload обычного плагина:

```bash
pulse-plugin doctor . --allow-localhost --require-fixtures
```

Если плагин просит trusted-права, добавь `--trusted`:

```bash
pulse-plugin doctor . --allow-localhost --trusted --require-fixtures
```

Обычный upload без заявки в публичный маркетплейс:

```bash
pulse-plugin publish . \
  --upload \
  --token-file "$token_file" \
  --api https://funpaypulse.com
```

Upload сразу с public-review:

```bash
pulse-plugin publish . \
  --upload \
  --public-review \
  --token-file "$token_file" \
  --api https://funpaypulse.com
```

Trusted-вариант:

```bash
pulse-plugin publish . \
  --upload \
  --public-review \
  --trusted \
  --token-file "$token_file" \
  --api https://funpaypulse.com
```

Перед отправкой платного публичного плагина админ может прогнать офлайн-ревью:

```bash
funpay-licenses/.venv/bin/python tools/sdk_package_review.py dist/<plugin_id>-<version>.fppkg --public-marketplace --fail-on-manual-review --json
```

Для trusted-плагина:

```bash
funpay-licenses/.venv/bin/python tools/sdk_package_review.py dist/<plugin_id>-<version>.fppkg --public-marketplace --fail-on-manual-review --json --trusted
```

Можно передать цену флагами, но лучше держать ее в
`funpay-pulse.marketplace.json`. Флаги нужны, если разово надо переопределить
файл:

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

Нормальный результат upload выглядит примерно так:

```text
publish: upload ok
publish: package uploaded for review; no install, no broker token issued
```

Это не ошибка. Upload не публикует плагин, не устанавливает его пользователю и
не выдает Broker-токен.

## Как плагин доходит до пользователя

1. Разработчик пишет плагин и проверяет его локально.
2. Разработчик собирает `.fppkg` и отправляет через `publish --upload`.
3. Админ проверяет пакет, права, фикстуры, цену, поддержку и условия возврата.
4. После approval продукт появляется в маркетплейсе.
5. Пользователь покупает или получает плагин на свой аккаунт Pulse.
6. В Desktop он открывает `Мои плагины`.
7. Там он выбирает плагин, нажимает `Установить`, выбирает VPS и подтверждает
   права.
8. Для `broker-poller` Desktop запускает плагин через managed runner.
9. Если managed runner недоступен или runtime не `broker-poller`, используется
   ручной self-host flow с token-file.

Пример ручного запуска runtime после установки:

```bash
export FPP_BASE_URL=https://funpaypulse.com
export FPP_BROKER_TOKEN=fppb_...
python app.py
```

Broker-токен нельзя просить у покупателя в raw-виде. Для managed runtime проси
диагностику из Desktop, а не сам токен:

- вывод `pulse-plugin doctor`;
- package sha256;
- скрин статуса установки в Desktop;
- логи из карточки SDK-плагина;
- описание, на каком событии ошибка повторяется.

Managed runner сейчас поддерживает только `runtime.type=broker-poller`. Для
`webhook` или других будущих runtime-типов нужен отдельный self-host/developer
hosted запуск.

## Права

Обычные права:

- `logs:write` - писать логи в Broker API;
- `storage:own` - хранить собственное JSON-состояние установки;
- `secrets:own` - хранить собственные сторонние секреты установки;
- `orders:read` - читать один заказ;
- `orders:list` - получать список заказов;
- `lots:read` - читать лоты.

События:

- `events:new_message`;
- `events:new_order`;
- `events:order_confirmed`;
- `events:new_review`.

Trusted-права:

- `messages:send` - отправка сообщений;
- `orders:refund` - возврат заказа;
- `orders:review` - ответ на отзыв;
- `lots:active` - включить или выключить лот;
- `lots:price` - изменить цену лота;
- `lots:raise` - поднять лот;
- `blacklist:add` - добавить пользователя в черный список;
- `blacklist:remove` - убрать пользователя из черного списка.

Если плагин просит trusted-права, локальные команды и upload запускаются с
`--trusted`. Это не approval. Approval делает только админ после ревью.

Future-only права:

- `ui:render`;
- `config:read`;
- `config:write`.

Сейчас их не надо использовать в обычной публичной регистрации. Настройки
установленного плагина идут через `config_schema`, а не через future-only UI
runtime.

## Что присылать на проверку

Разработчик присылает:

- `.fppkg`;
- `funpay-pulse.marketplace.json`;
- вывод `pulse-plugin doctor . --require-fixtures`;
- если есть trusted-права: вывод `pulse-plugin doctor . --trusted --require-fixtures`;
- вывод `tools/sdk_package_review.py ... --public-marketplace --json`;
- вывод `pulse-plugin publish ... --upload ...` без raw token;
- краткое описание: что делает плагин;
- цена и срок доступа;
- контакты поддержки;
- `support_url`, `privacy_url`, `refund_policy`;
- список прав и зачем они нужны.

Перед ручным review оператор запускает:

```bash
funpay-licenses/.venv/bin/python tools/sdk_package_review.py /path/plugin.fppkg --public-marketplace --fail-on-manual-review --json
```

Если плагину нужны `messages:send`, ответы на отзывы, возвраты, управление
лотами или blacklist, добавляется `--trusted`. Скрипт не запускает код плагина.
Он проверяет `.fppkg`, metadata, package hashes, секреты, suspicious source
markers, fixtures/docs и говорит, можно ли идти дальше к ручному review.

Нельзя присылать:

- `fppd_...`;
- `fppb_...`;
- реальные cookies;
- API keys;
- `golden_key`;
- пароли;
- private keys;
- `.env` с секретами.

## Частые ошибки

`localhost runtime.url is allowed only in dev mode`

Для локальной проверки добавь `--allow-localhost`. Для публичного ревью поставь
публичный HTTPS runtime URL.

`runtime.url uses placeholder host`

В манифесте остался `example.com` или похожий placeholder. Замени его на
реальный адрес.

`some scopes require trusted plugin review`

Добавь `--trusted`, если плагин реально отправляет сообщения, делает возвраты,
отвечает на отзывы, управляет лотами или blacklist.

`some scopes are future-only`

Убери `ui:render`, `config:read`, `config:write`. Они зарезервированы под
следующий этап SDK.

`secret-like content is not allowed`

В пакет попал токен, ключ, пароль или похожее значение. Убери секрет из
исходников, fixtures, README и `.env`.

`public marketplace metadata requires refund_policy`

Для публичного маркетплейса укажи условия возврата в
`funpay-pulse.marketplace.json`.

`publish: package uploaded for review; no install, no broker token issued`

Это нормально. Пакет загружен на ревью, но еще не опубликован и не установлен.
