# iumrah V21 — Backend Final Cutover / Release Candidate

Этот накопительный патч **заменяет предыдущий V21 ZIP**. Он включает все изменения первой части V21 и дополнительные исправления. Клиентский патч ставится отдельно в kepler-ios-main. Существующие .github/workflows и Signing не менялись. Единственный рабочий deploy — Business → Deploy iumrah backend.

## 1. Развернуть сервер

1. Загрузить `iumrah-business-update-v21-release-candidate.zip` в корень Business, дождаться применения ZIP. Запустить существующий Deploy iumrah backend. До подтверждения миграции финальный шаг может намеренно завершиться CORE_CUTOVER_PENDING. Не считать это подтверждением релиза.
2. Проверить `https://iumrah-backend.helloiumrah.workers.dev/api/services/health` (`release: v21-rc`) и `/__iumrah/cutover` (`schemaReady: true`, `coreCutoverEnabled: false` до миграции). Если привязка/схема отсутствует, не продолжать. Использовать действительные существующие D1/R2 и секреты; не создавать пустые базы вместо источников.
3. Не запускать старый iOS workflow Deploy iumrah backend (full) / deploy-package-engine. Это не источник актуального backend. Отключить его в GitHub вручную, не изменяя YAML. После успешного production cutover старые файлы PackageEngine можно удалить существующим `scripts/remove-legacy-configurator.sh` (dry-run, затем review/--apply; ZIP-распаковщик не удаляет файлы). Не удалять старый Cloudflare Worker или данные до завершения сверки и периода наблюдения.

## 2. Единая миграция D1/R2

`Backend/CoreMigration/release_cutover.py` объединяет этапы в одну защищённую команду. Она сама читает привязки указанных старых Workers и текущего `iumrah-backend`, экспортирует 4 D1, вычисляет additive merge, при явном разрешении применяет изменения, делает новые экспорты, проверяет сохранность исходных строк и SHA-256 объектов. Исходные данные и существующие целевые строки не перезаписываются. При несовместимости, конфликте или нераспознанной таблице работа прекращается. Отдельный legacy Telegram bot database (`anonymous-chat-db`, если он использовался) нужно проверить по фактическим старым ресурсам; эта миграция не переносит произвольные сторонние таблицы.

В доверенной среде (Python 3.11+, Node 22+, актуальный Wrangler в PATH), из корня Business. Получить OLD/NEW_CLOUDFLARE_ACCOUNT_ID и OLD/NEW_CLOUDFLARE_API_TOKEN из существующего защищённого хранилища; не отправлять их в чат, не добавлять в Git. Точные старые имена Workers/привязок проверить в Cloudflare. Для выгрузок использовать отдельный зашифрованный диск, не папку проекта. **D1 export может временно блокировать запросы**, поэтому даже план запускать в согласованное окно.

План (не применяет SQL):

```bash
python3 Backend/CoreMigration/release_cutover.py \
  --old-operations-worker OLD_WORKER_NAME \
  --old-bookings-worker OLD_BOOKING_WORKER_NAME \
  --old-operations-binding HOTELS_DB --old-bookings-binding DB \
  --old-media-binding HOTELS_MEDIA --old-passports-binding PASSPORTS \
  --private-dir /private/iumrah-cutover-plan --mode plan
```

Имена `OLD_WORKER_NAME`, `OLD_BOOKING_WORKER_NAME` и binding names — placeholders, **не предполагаемые реальные ресурсы**. Сверить исключённые/отсутствующие таблицы, историю аккаунтов, Gift Cards, данные Telegram, D1/R2. Если привязки старого Worker не соответствуют указанным, указать правильные. Старые/новые writers (включая cron/ботов) должны быть остановлены; окно и rollback подтверждает оператор. Не использовать `--reviewed-source-and-exclusions` без фактической сверки.

Повторить ту же команду с новым `--private-dir /private/iumrah-cutover-apply`, заменив `--mode plan` на:

```bash
--mode apply --old-and-new-writes-frozen --reviewed-source-and-exclusions
```

По умолчанию R2 проверяется, но не изменяется. Если не все документы уже перенесены, добавить `--copy-missing-r2` и предоставить в защищённом окружении OLD_R2_ACCESS_KEY_ID, OLD_R2_SECRET_ACCESS_KEY, NEW_R2_ACCESS_KEY_ID, NEW_R2_SECRET_ACCESS_KEY. Установить актуальный `boto3` с поддержкой S3 PutObject IfNoneMatch (например `python3 -m pip install 'boto3>=1.36'`). Запись строго условная `If-None-Match: *`; существующие файлы не заменяются, содержимое и доступные HTTP-метаданные сверяются. Если не удаётся прочитать исходный объект, остановиться. Скрипт не меняет публичность bucket; она проверяется отдельно.

После сверки будет сохранён `verified-report.json` с `operator_attestation`. Можно активировать вручную по предыдущему V21 runbook. Для автоматизации активации в той же команде добавить `--activate` **только** при согласованном cutover, реальных провайдерах и выделенных тестовых учётных записях (см. ниже). Скрипт проверит публичные API, актуальные bindings, конфигурацию провайдеров, установит два флага через bulk secrets и запустит live smoke. При ошибке после включения Core не возобновлять старые writes и не удалять старые данные: необходима сверка новых записей перед rollback. Даже успешная автоматическая активация не означает разрешение App Store.

## 3. Реальные проверки

Из `Backend/IumrahBackend`: `npm run release:smoke -- --public-only` — проверка публичных сервисов и непустого flight catalog. Полный `npm run release:smoke` требует существующий выделенный тестовый аккаунт и бронирование, перенесённые из старой системы (не реквизиты клиента):

- `SMOKE_DEDICATED_TEST_ACCOUNT=1`
- `SMOKE_TEST_IDENTIFIER`, `SMOKE_TEST_PASSWORD`, `SMOKE_EXPECTED_IUMRAH_ID`
- `SMOKE_BOOKING_ID`, `SMOKE_BOOKING_TOKEN`
- `SMOKE_STAFF_LOGIN`, `SMOKE_STAFF_PASSWORD`

Вводить только через защищённое окружение. Smoke выполняет login/logout тестового аккаунта и staff, проверяет идентификатор, сеансы, Wallet, Gift Cards, историю, существующую бронь, Telegram status и доступ Business, а также отказ неавторизованному запросу. Не отправляет OTP и не создаёт реальных бронирований, не меняет клиентские платежи. Логи не содержат пароли, токены и содержимое ответов. Существующий Telegram bot остаётся server-side адаптером для старого link/status; iOS использует только unified backend. Для OIDC outbox добавлены retries по существующему cron после cutover. Нужны действительные `TELEGRAM_BOT_ORIGIN` (или `IUMRAH_TELEGRAM_BOT_WORKER_URL`), `TELEGRAM_LOGIN_CLIENT_ID`, `IUMRAH_TELEGRAM_BOT_TOKEN`, `IUMRAH_TELEGRAM_RETRY_SECRET` и bridge secret, если старый bot его требует. Доставку и старые подписки проверять отдельно. Не переключать webhook вслепую.

Обязательно завершить в TestFlight: новый тестовый quote → commit → появление в Business → статусы → тестовый чек/паспорт и закрытый доступ R2 → уведомления; Apple/Google, email/SMS OTP, восстановление, eSIM, Telegram и APNs на реальном устройстве. Проверить Gift Card и начисления без списания с реальных пользователей, Care, чаты, private media. После этих тестов, проверок на iPhone 11/13 mini и подтверждения состояния сервера — App Store. Android/Web исходники не приложены к этому циклу, их parity не подтверждена.

## 4. Изменения клиента

Загрузить `iumrah-beta-update-v21-release-candidate.zip` в iOS kepler-ios-main после серверного деплоя. В iOS нет новых прямых вызовов Supabase/Aladhan/MET/CBU; API `iumrah-backend` обслуживает все эти запросы. Advisor сохраняет исходные проверенные тексты и записи, доступ к живому каталогу выполняется сервером с RLS-публичным ключом (его можно заменить переменной `UMRAH_ADVISOR_SUPABASE_ANON_KEY`). На клиенте сохраняется офлайн-каталог, TTS fallback и проверка аудио URL. Изменения UI/UX не включены.

## 5. Границы текущего результата

Локальные тесты и Swift parser не являются фактическим Cloudflare deploy, Xcode build, TestFlight или проверкой production account/booking. Отсутствие доступа к Cloudflare/GitHub и реальным данным — блокер фактической активации, а не причина отключить защиту. Секреты и данные не должны быть присланы сюда. Отдельный старый bot и его таблицы требуют подтверждения происхождения и состояния. Старый runbook `IUMRAH_V21_FINAL_CUTOVER_RU.md` описывает ручные шаги и первую часть; этот RC дополняет и заменяет его инструкции по оставшимся API и миграции.
