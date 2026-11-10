# iumrah Backend — единый Cloudflare Worker

**Техническое имя:** `iumrah-backend`. **Репозиторий:** тот же iumrah Business. **Новых backend-репозиториев нет.**

Объединён **входной серверный процесс**: `Backend/IumrahBackend/src/index.js` вызывает существующие `HotelsWorker` и `FlightHubWorker` как программные модули. Их бизнес-логика НЕ копируется и НЕ переписывается. Будущие сервисы добавлять сюда по модульной архитектуре, а не создавать отдельный Worker на каждый API.

## Уже покрытые серверные маршруты

- `GET /__iumrah/health` — проверка *наличия bindings*, не здоровья базы данных и не выполнения миграций.
- `/api/admin/hotels*`, `/api/catalog/hotels*`, `/api/admin/ziyarats*`, `/api/catalog/ziyarats*`, `/flights-feed/*` — существующий отельный модуль, включая аналитику/Gemini.
- `/api/flight-hub/v1/*` и исторические `/v1/*`, `/health` — существующий Flight Hub (боты, цены, расписание).
- OAuth well-known для имеющейся интеграции отелей.

`/api/bookings`, `/api/auth/staff/session` и другие API сайта **НЕ включены в этот ZIP**: их исходный код находится за пределами предоставленного репозитория. Сейчас unified Worker использует их существующие URL и BOOKINGS_DB binding. Не направлять весь `iumrah.app/api/*` на новый Worker: это нарушило бы работу системы бронирований и авторизации.

## Раздельные данные, один сервер

- `HOTELS_DB` — существующая D1 отелей, чатов, событий iumrah Intelligence.
- `BOOKINGS_DB` — **существующая** D1 бронирований (имя может отличаться, задайте `BOOKINGS_DB_NAME`).
- `FLIGHTS_DB` — существующая D1 рейсов из `iumrah-flight-hub`.
- `HOTELS_MEDIA` — существующий R2 bucket отелей.
- `AI`, `BROWSER`, `IMAGES`, `HOTEL_IMPORT_WORKFLOW` — нужные имеющемуся отельному модулю bindings. Новая Cloudflare Workflow называется `iumrah-backend-hotel-import` (уникальное имя, чтобы не конфликтовать с уже работающей Workflow `iumrah-hotel-import`). Старый Worker должен завершить ранее начатые импорты до отключения.

D1/R2 привязываются к Worker внутри Cloudflare account. **Нельзя одновременно подключить D1 из двух разных аккаунтов**, указав их UUID. Если отели и рейсы физически размещены в разных аккаунтах, сначала нужен безопасный перенос/репликация (с backup и проверкой записей), а не переименование или создание пустых баз. `preflight` остановит операцию при отсутствии ресурсов.

## Этап A — однократная подготовка в GitHub (без новых D1 Secrets)

1. Установить ZIP `iumrah-business-update.zip` через имеющийся распаковщик. Он защищает `.github/workflows/`, поэтому файл `INSTALL_UNIFIED_BACKEND/deploy-iumrah-backend.yml` нужно один раз добавить вручную как `.github/workflows/deploy-iumrah-backend.yml`.
2. **Никаких `IUMRAH_*_DB_ID` GitHub Secrets создавать не нужно.** Новый `scripts/discover-bindings.mjs` получает ID уже существующих D1 через Cloudflare API, проверяет схему таблиц, находит существующий R2 bucket и передаёт имена/ID в workflow через `$GITHUB_ENV`. Он ничего не создаёт и не переписывает.
3. Workflow использует **уже имеющиеся** `NEW_CLOUDFLARE_ACCOUNT_ID` / `NEW_CLOUDFLARE_API_TOKEN` или `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`, а для Gemini — ранее установленный `GEMINI_API_KEY`. Секреты Flight Hub копируются только если уже имеются.
4. По умолчанию скрипт обнаруживает `iumrah-hotels` (или `iumrah-core` **при наличии таблицы hotels**), `iumrah-web-db`/`iumrah-core` (с таблицей bookings), `iumrah-flights` и `iumrah-hotels-media`/`iumrah-operations-media`.
5. Если в аккаунте две подходящие базы либо схема существенно отличается, автоматический деплой **останавливается**. Для выбора неоднозначного существующего имени можно указать обычную GitHub Variable `IUMRAH_BOOKINGS_DB_NAME` / `IUMRAH_HOTELS_DB_NAME`, не Secret. Не создавать новый D1 ради прохождения проверки.

**Известное ограничение миграции:** согласно `Backend/CloudflareMigration/README.md`, в целевой `iumrah-core` может не быть гостиничной таблицы `hotels`, потому что каталог отелей переводился на внешний API. В таком случае интеграция старого HotelsWorker без переработки невозможна, и автоматический процесс намеренно не выполнит публикацию. Это не проблема отсутствующих ID или Secrets.

## Этап B — безопасная проверка

1. GitHub Actions → **Deploy unified iumrah Backend (manual)** → **Run workflow** → action `validate`.
2. Ожидаемый результат: `preflight` подтверждает все 3 существующие D1 и R2 **в одном аккаунте**, потом сухая сборка `dry-run`. При несовпадении аккаунтов/ID процесс остановится и ничего не изменит.
3. Если `validate` зелёный, запуск action `stage` создаст **только новый** `iumrah-backend` в workers.dev без production-маршрутов и без cron. Не меняйте URL клиентов и ботов на этом этапе.
4. В Cloudflare → Workers & Pages → `iumrah-backend` найдите реальный `workers.dev` URL и проверьте:
   - `/__iumrah/health` → `ok: true` и четыре bindings;
   - `/api/flight-hub/v1/public/status` → проверка существующего каталога;
   - `/api/catalog/hotels` → сверка результатов со старым каталогом;
   - `/api/admin/hotels/intelligence` → только с существующей авторизацией superadmin;
   - Gemini в Business → генерация отчёта только после применения аналитической миграции.
5. **Не удалять** `iumrah-flight-hub` или прежние отельные Workers. API `workers.dev` старого Worker не переименовывается магически; обращающиеся к нему боты продолжат работать на старом адресе.

## Этап C — будущий production cutover (отдельное подтверждение)

- Сначала установить источник активных авторизационных и booking API, проверить одинаковые данные отелей/рейсов и нужные секреты.
- Если `0044_business_intelligence.sql` ещё не применена на действующей HOTELS_DB, выполнить именно эту *аддитивную* миграцию после резервного копирования, а не полный прогон всех старых миграций. Некоторые старые hotel-миграции включают намеренные удаления данных; **НЕ запускать** пакетное `wrangler d1 migrations apply` без аудита истории миграций.
- Для включения маршрутов задают `IUMRAH_ENABLE_ROUTE_CUTOVER=1` и реальный `CLOUDFLARE_ZONE_ID`; для cron — `IUMRAH_ENABLE_SCHEDULED_JOBS=1`. **Текущий workflow жёстко фиксирует оба флага в 0**, чтобы случайно не перевести production. Подключение production-маршрутов требует отдельного проверенного изменения workflow и rollback-плана.
- После cutover обновить URL ботов/клиентов на единый backend, проверить работу, только потом выводить старые Workers из эксплуатации и отключать повторные cron. Не удалять базы/R2.

## Особенности Gemini

Gemini используется только серверно, получает **агрегированную** аналитику без паспортных, контактных и платёжных данных. Расписание ежедневного отчёта `0 3 * * *` (08:00 Ташкент) и очистки рейсов `15 1 * * *` (06:15 Ташкент) уже поддерживается единым роутером, но в staging отключено. Автоматические отчёты начнут запускаться после контролируемого production cutover и включения cron.

## Локальные проверки

```bash
cd Backend/IumrahBackend
npm install --no-audit --no-fund
npm install --prefix ../HotelsWorker --no-audit --no-fund
npm run check
# Для локального запуска доступны `npm run discover` (read-only) и переменные Cloudflare account/token. GitHub workflow автоматически переносит обнаруженные ID между шагами.
npm run preflight   # только чтение Cloudflare ресурсов
npm run render      # без деплоя
npm run dry-run     # собирает Worker без публикации
```

`wrangler.generated.jsonc`, node_modules и токены не включены в Git. Деплой и миграции не запускались из этой рабочей среды (нет полномочий Cloudflare и подтверждённых D1 идентификаторов).
