# V25 — Email + Telegram / eSIM deferred

На основе V24. Существующий Core, D1, R2, ключи активации и workflow сохраняются. Старые данные из недоступного аккаунта не восстанавливаются.

## Перед деплоем
В Cloudflare → iumrah-backend → Settings → Variables and Secrets (тип Secret) добавить только `RESEND_API_KEY` и `IUMRAH_TELEGRAM_BOT_TOKEN`. Не раскрывать значения. Resend: домен отправителя `iumrah.app` должен быть подтверждён. Telegram: использовать выделенный бот iumrah. При первом авторизованном запросе на привязку webhook бота переключается на единый Worker; pending updates не сбрасываются. Старый бот-Worker не нужен. Telegram OAuth и eSIM не являются обязательными для релиза, но остаются доступными для последующей настройки.

## Установка
Загрузить один архив в Business, после распаковки запустить существующий Deploy iumrah backend. Клиентский ZIP и workflow менять не нужно. Новая таблица booking_telegram_links добавляется в существующую BOOKINGS_DB без удаления данных. Retry и webhook секреты выводятся из уже установленного IUMRAH_SESSION_SECRET с разделением назначения, отдельно их не создавать.

## Проверка
Серверный gate проверяет наличие конфигурации, а не фактическую доставку. После деплоя проверить email OTP, статусное письмо, создание тестовой брони, привязку Telegram, первый /start по защищённой ссылке и смену статуса через Business. Пользователь должен разрешить боту писать; один bot token не позволяет подписать произвольный Telegram username. Отдельный Telegram Login/OAuth не включается без соответствующего Client ID. eSIM не тестировалась и не заявляется готовой. При отсутствии eSIM ключей прежние клиентские экраны не удаляются.

Локальные проверки: TypeScript, Unified Backend, Flight Hub, Package Engine, CoreMigration. Реальные ключи, webhook Telegram и доставка Resend не проверены.
