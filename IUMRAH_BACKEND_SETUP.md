# iumrah Backend · Единый Worker

Название Cloudflare Worker: `iumrah-backend` (в интерфейсе: iumrah Backend).
Общий репозиторий: iumrah Business. Два существующих серверных модуля HotelsWorker и FlightHubWorker подключены к одному Cloudflare Worker, сохраняя текущие маршруты.

**Следующий шаг:** после распаковки ZIP скопируйте `INSTALL_UNIFIED_BACKEND/deploy-iumrah-backend.yml` в `.github/workflows/deploy-iumrah-backend.yml` вручную. Распаковщик защищает `.github/workflows` от обновления из ZIP.

ПОЛНАЯ ИНСТРУКЦИЯ: `Backend/IumrahBackend/README_RU.md`.

GitHub Secrets: ID существующих D1 (автоматическое обнаружение, без GitHub Secrets), существующие Cloudflare credentials и `GEMINI_API_KEY`. Переменная GitHub `IUMRAH_BOOKINGS_DB_NAME` — фактическое имя production BOOKING D1.

Далее Actions → Deploy unified iumrah Backend (manual) → validate. Если зелёный — stage. Этап stage создаёт только `iumrah-backend` на workers.dev, НЕ переключает production маршруты и cron.

**Особенно важно:** По скриншоту в выбранном аккаунте не видно HotelsWorker. Программа остановится, если D1/R2 находятся в другом аккаунте; не создавать пустые новые базы взамен. Миграции D1 не выполняются автоматически. Не удалять существующий flight hub.

Cлужба бронирований `/api/bookings` и авторизация `/api/auth/staff/session` обслуживаются кодом вне присланного архива. Они остаются на своих текущих URL и не маршрутизируются на новый Worker; для полного переноса нужен их backend-код.

Готовый пакет накопительный: в нём также прежнее обновление iumrah Intelligence + Gemini для Business.


**Упрощение от 10.11.2026:** три GitHub Secrets `IUMRAH_*_DB_ID` больше не нужны. `Deploy unified iumrah Backend` находит базы автоматически по именам и таблицам через Cloudflare API. Используются существующие Cloudflare account/token и `GEMINI_API_KEY`. При несоответствии названий/схем публикация блокируется без создания новых ресурсов.
