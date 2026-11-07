# iumrah Business — Flight Hub v1 (этап 1, 07.11.2026)

## Что фактически добавлено

- iOS/macOS Catalyst Business → «Авиабилеты» → **«Мониторинг»**: публичная read-only панель нового каталога, статусы пяти поставщиков, рейсы и тарифы, stale / not-connected. Компоновка вкладок адаптирована под узкий iPhone.
- `Backend/FlightHubWorker/`: **отдельный**, не связанный с отелями Cloudflare Worker + новая D1-схема. Все новые таблицы только в `FLIGHTS_DB`.
- `Backend/AirlineMonitors/`: три независимых Python/Playwright адаптера (`centrum`, `uzbekistan`, `flynas`), задача на 30-дневный скользящий горизонт **по уже зарегистрированным рейсам**; ограничение количества проверок, строгая проверка рейса/маршрута/даты/цены, остановка при CAPTCHA, артефакты диагностики. Это не бронирование и не система обхода защиты.
- Endpoints для Ignav, AeroDataBox и ботов; хранение `flights`, `flight_offers`, `price_history`, `monitor_runs`, `unmatched_observations`.
- Скрипты `import-curated.mjs` и `ingest-ignav.mjs` для переноса идентификаторов опубликованных рейсов и передачи свежих one-way результатов соответственно. Round-trip total не делится ошибочно на два направления.
- Server-side AeroDataBox verification для **существующих** рейсов по номеру через API RapidAPI (вручную, после подключения ключа).

## Важно: границы текущего этапа

**Этот ZIP устанавливает код, но не подключает новую Cloudflare D1 и не меняет GitHub Secrets.** Нужны отдельно D1 ID, Cloudflare account/zone, токены и доменный маршрут. Старый HotelsWorker, старые D1, гостиничный каталог и все действующие бронирования не изменяются.

**Боты пока не проверены на живой выдаче цен**: публичные сайты могут менять DOM, показывать CAPTCHA, не выводить номер рейса и тариф в одной карточке или ограничивать автоматизацию. Селекторы в `config/*.json` — начальные консервативные кандидаты, не подтверждённые селекторы. До успешного реального теста статус именно `site_changed`, а не «работает». Не пытаться обойти защиту или условия сайтов. Для промышленного источника цен предпочтительны официальные агентские/NDC API с разрешением.

**AeroDataBox не даёт цену/багаж по тарифу.** Он проверяет расписание; бот собирает багаж лишь при явной привязке к одному тарифу. Отсутствующие «места осталось» не выдумываются.

**Business пока остаётся подключён к действующему Package Engine**, а Flight Hub — параллельная read-only система. Переключение конфигуратора на новый сервер — отдельный этап с синхронизацией каталогов и тестированием суммы пакета; этот патч не меняет текущие публичные цены пакетов или checkout.

## 1. Установка накопительным ZIP

В корень `lattice-mobile-main` загрузить архив с названием `iumrah-business-*.zip`.

Существующий workflow `.github/workflows/apply-zip.yml` **не распаковывает файлы внутри `.github/workflows/`**. Поэтому файл с ежедневным расписанием необходимо отдельно вручную добавить через GitHub → Add file → Create new file:

- путь: `.github/workflows/flight-hub-daily.yml`
- содержимое: `Backend/AirlineMonitors/github-workflow-template/flight-hub-daily.yml`

Не нужно запускать старый `Deploy Hotels Cloud`: новый Hub независим. iOS TestFlight-сборка понадобится для появления вкладки в приложении.

## 2. Позднее: новая D1 и Secrets (второй этап)

Из директории `Backend/FlightHubWorker`:

```bash
npm install
npx wrangler login                   # именно новый Cloudflare аккаунт
npx wrangler d1 create iumrah-flights
cp wrangler.toml.example wrangler.toml
# В wrangler.toml прописать ID только НОВОЙ D1
npx wrangler d1 migrations apply FLIGHTS_DB --remote --config wrangler.toml
npx wrangler secret put BOT_INGEST_TOKEN --config wrangler.toml
npx wrangler secret put IGNAV_INGEST_TOKEN --config wrangler.toml
npx wrangler secret put AERODATABOX_INGEST_TOKEN --config wrangler.toml
npx wrangler secret put ADMIN_TOKEN --config wrangler.toml
npx wrangler secret put AERODATABOX_RAPIDAPI_KEY --config wrangler.toml
npx wrangler deploy --config wrangler.toml
```

Пока зона `iumrah.app` не переведена на новый аккаунт, Worker можно тестировать по URL `*.workers.dev` (полученному от Wrangler). **В коде Business URL пока `https://iumrah.app/api/flight-hub`**, поэтому соответствующий route `/api/flight-hub*` нужно добавить после переноса маршрутизации домена либо отдельно изменить `AppConfig.flightHubBaseURL` на доступный домен Hub. Без этого панель честно отображает ошибку соединения.

GitHub Actions Secrets для шаблона workflow:

- `FLIGHT_HUB_URL`: прямой **HTTPS** URL нового Worker, например реальный адрес workers.dev (без завершающего `/`);
- `FLIGHT_HUB_BOT_TOKEN`: то же значение, что `BOT_INGEST_TOKEN` в новом Worker.

Остальные API-ключи хранятся **только** в secrets/на сервере, не в Swift или Git. Не копировать старые database IDs/токены из отельного аккаунта.

## 3. Сначала заполнить мастер-рейсы

Боты **не создают** рейсы. Если мастер-рейсов пока нет, `/v1/monitor/tasks` вернёт пустой список — это нормально. Перенести опубликованные рейсы из старого read-only `flights-feed/*.json` (можно просто скачать JSON вручную):

```bash
cd Backend/FlightHubWorker
node scripts/import-curated.mjs /path/to/flight-feed.json         # предварительная проверка
FLIGHT_HUB_URL=https://<real-worker-url> FLIGHT_HUB_ADMIN_TOKEN=<token> \
  node scripts/import-curated.mjs /path/to/flight-feed.json --push
```

Импортирует только понятные идентификаторы: авиакомпания/номер/маршрут/дата, без отелей, PII и старых цен. Неполные рейсы пропускаются; запись не удаляет старые рейсы из исходной базы.

Для свежей выдачи Ignav после поиска (формат response `curation-search`, **только один сегмент/one-way**):

```bash
FLIGHT_HUB_URL=https://<real-worker-url> FLIGHT_HUB_IGNAV_TOKEN=<token> \
  node scripts/ingest-ignav.mjs /path/to/ignav-search-response.json --push
```

`/v1/admin/aerodatabox/refresh` — проверка нескольких мастер-рейсов через AeroDataBox, POST `{"limit":3}` с `Authorization: Bearer ADMIN_TOKEN`. Нет тарифа/цены в AeroDataBox. Это платные запросы по выбранному плану.

## 4. Проверить Worker + одну авиакомпанию

```bash
curl https://<real-worker-url>/health
curl https://<real-worker-url>/v1/public/status
curl https://<real-worker-url>/v1/public/flights

cd Backend/AirlineMonitors
python -m pip install -r requirements.txt
python -m playwright install chromium
FLIGHT_HUB_URL=https://<real-worker-url> FLIGHT_HUB_BOT_TOKEN=<token> \
  python -m monitor.cli --provider centrum --limit 1
```

В случае ошибки бот записывает `output/centrum/diagnostics/*` и **не заменяет цену выдуманной**. Отчёты с ошибок GitHub Actions сохраняются в artifacts. Повторить с `uzbekistan` и `flynas` после согласования условий и проверки формы сайта.

Расписание шаблона: `0 3 * * *` UTC = **08:00 Asia/Tashkent**. На каждый запуск — до 14 существующих рейсов на авиакомпанию, сортировка по самому старому обновлению, 30 дней вперёд. Это не гарантирует ежедневную проверку каждого рейса, если их больше 14; лимит можно изменить после проверки нагрузок.

## 5. Контракт новой авиабазы

- `POST /v1/ingest/{ignav|aerodatabox|centrum|uzbekistan|flynas|legacy_import}` — авторизованный приём до 100 записей с массивом `records`; токен зависит от источника.
- `GET /v1/monitor/tasks?provider=centrum&limit=14` — авторизованный список зарегистрированных рейсов для бота.
- `GET /v1/public/status` — read-only health/статистика источников.
- `GET /v1/public/flights?origin=TAS&destination=JED&limit=40` — read-only рейсы и цены по источникам, `fresh` — только оценка свежести наблюдения, не реальная гарантия наличия.
- `GET /v1/admin/unmatched` — авторизованный аудит неподтверждённых соответствий.
- `POST /v1/admin/aerodatabox/refresh` — авторизованная выборочная проверка AeroDataBox.

Пример данных бота для **существующего** рейса:

```json
{"records":[{"airline_code":"C6","flight_number":"C6401","origin":"TAS","destination":"JED","departure_date":"2026-12-12","amount_minor":1250000,"currency":"UZS","fare_brand":"Optimal","adults":1,"observed_at":"2026-12-11T08:00:00Z","price_scope":"site_displayed_not_checkout_verified","source_url":"https://b2c.centrum-air.com/"}],"status":"ok"}
```

Цена — **пример формата, не реальная котировка**. Для USD/SAR amount_minor — сотые доли; для UZS — целые сумы. Сопоставление строгое `airline_code + flight_number + origin + destination + departure_date`. История записывается при изменении цены; старые наблюдения не заменяют новые. Если мастер-рейса нет, запись идёт в `unmatched_observations`.

## 6. Последующая миграция сервера (третий этап)

После доступа к **обоим** аккаунтам и инвентаризации таблиц: перенос Package Engine, тарифов конфигуратора, бронирований, статусов, идентификаторов, SMS/push, KYC и остальных нужных модулей. Требуются отдельные скрипты **сверки количества строк, Foreign Keys, прав, тестовых бронирований и планом отката**. Секреты старого аккаунта не будут автоматически скопированы. Данные отелей исключаются: их новый поставщик/отдельное API остаётся вне новой авиационной D1.

## Проверки, которые проведены без доступа к продакшн

- `node --test Backend/FlightHubWorker/tests/*.test.mjs` — схема идентичности, ограничения и соответствие AeroDataBox;
- `python -m unittest discover -s Backend/AirlineMonitors/tests` — parser tests;
- `swiftc -frontend -parse` — Swift синтаксис новых/изменённых файлов;
- `sqlite3` — SQL схема создаёт 5 таблиц.

Не выполнялись: реальный сайт/UI трёх авиакомпаний, действующие ключи и данные D1, Xcode/TestFlight на macOS, продакшн миграция.
