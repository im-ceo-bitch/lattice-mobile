# iumrah V22 — Clean Production Activation

Владелец сообщил: прежний Cloudflare недоступен, используется новый аккаунт с D1 `iumrah-hotels`, `iumrah-core`, `iumrah-flights`; R2 `iumrah-hotels-media`, `iumrah-passports` подключены; три новых security secrets добавлены. Это не подтверждение сохранности данных прежнего аккаунта. V22 не удаляет и не перезаписывает существующие данные и не имитирует миграцию.

## Запуск

1. Загрузить `iumrah-business-update-v22-clean-production.zip` в корень Business. Дождаться успешного распаковывания. Клиентский V21 RC уже установлен; его повторно загружать не надо. Workflow не менялся.
2. В согласованное окно (не добавлять записи вручную и не запускать сторонние writers в эти D1) запустить существующий `Deploy iumrah backend`. Не запускать старые iOS backend workflows.
3. `check-deployed.mjs` сам проверит новую конфигурацию Worker, три security secrets (включая декодирование 32-байтового quote key), идентичность текущего аккаунта и трёх D1, два приватных R2, схему, FK и количество строк в клиентских/операционных таблицах, включая ошибочно размещённые. Проверки не читают значения секретов и не выводят клиентские данные.
4. Если проверки успешны, CI с текущими правами через Wrangler сам установит `IUMRAH_CORE_CLEAN_ATTESTATION` и `IUMRAH_CORE_CUTOVER_READY`. Не устанавливать эти переменные вручную. Миграционная аттестация V21 не создаётся. Аттестация чистого запуска привязана к fingerprint аккаунта/ресурсов и не подтверждает данные старого аккаунта.
5. Проверить лог: `CORE_ACTIVATED_NEW_ACCOUNT`. Это означает разрешение Core API, а не App Store approval. При `CORE_PROVIDER_CONFIGURATION_PENDING` Core уже может быть включён; указанные провайдеры ещё требуют настройки. Не пытаться убрать ошибку из CI.
6. Если `CLEAN_LAUNCH_EXISTING_DATA_REVIEW_REQUIRED`, ничего не удалять. Это означает, что в одном из текущих D1 обнаружены клиентские/операционные записи; нужно сверить и при необходимости перенести между **текущими** базами до активации, а не искать недоступный старый аккаунт. `CLEAN_LAUNCH_R2_PUBLIC_OR_UNVERIFIED` — проверить оба вида публичного доступа R2; `CORE_SECURITY_CONFIGURATION_INVALID` — проверить формат новых ключей. `CLEAN_LAUNCH_GATE_SECRET_UPDATE_FAILED` — проверить права существующего токена Workers Scripts Edit. Прислать только лог, не значения ключей.

## После активации

`/__iumrah/cutover` должен вернуть `coreCutoverEnabled: true`, `schemaReady: true`, `cleanLaunchAttested: true`, `activationMode: new-account`; `migrationAttested` и `dataParityVerified` остаются false. Вызвать `npm run release:smoke -- --public-only` из `Backend/IumrahBackend`; полные проверки из V21 runbook теперь допускают clean attestation, но требуют выделенный тестовый аккаунт и новую тестовую бронь. Старый аккаунт Cloudflare для этого не нужен. До App Store проверить регистрацию/вход, расчёт → бронь → Business → статусы, закрытые документы R2, подарки, Wallet, Telegram, Email, SMS, Push, eSIM. Telegram bridge V21 по-прежнему требует действующего bot service; если старый bot недоступен, его нужно восстановить/заменить, а не указывать фиктивный URL. Отдельно проверять Android/Web после получения актуальных исходников. Тесты на устройстве и действующие API-провайдеры здесь не проверены.

## QA

Локальный полный `npm run check`: 71 unified + 39 Flight Hub + 90 package runtime + 20 CoreMigration = 220/220. В том числе TypeScript компиляция. Python тесты прошли с предупреждениями ResourceWarning в ранее существующих тестах. Никаких сетевых изменений Cloudflare в этой среде не выполнялось. Все изменения V21 RC включены; актуальные instructions — V22, V21 runbooks сохранены для legacy migration только. GitHub workflow и клиентский UI не изменены.
