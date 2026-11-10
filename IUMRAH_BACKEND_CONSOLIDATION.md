# iumrah Backend — объединение Flight Hub и серверных модулей

Cloudflare: `iumrah-backend` — единый Worker. Отдельные D1 `iumrah-flights`, `iumrah-hotels`, `iumrah-core` остаются. Репозиторий backend не нужен.

## Изменения
- Business получает авиакаталог только с `https://iumrah-backend.helloiumrah.workers.dev` через `Resources/EndpointConfig.json` (адрес основан на субдомене ранее опубликованного Flight Hub; проверьте в Cloudflare после деплоя).
- Старые сохранённые в iPhone адреса Flight Hub не используются.
- Боты находят новый Worker автоматически через Cloudflare API и передают существующие авторизационные ключи.
- В едином Worker работают отельный модуль, авиационный модуль, Gemini Intelligence и два cron-триггера.
- Для Gemini добавляется только идемпотентная миграция `0044_business_intelligence.sql` на уже существующую D1.

## Установка
1. Загрузите `iumrah-business-update.zip` в корень репозитория Business. Дождитесь `Apply iumrah Business ZIP update` (он пропускает `.github/workflows/`).
2. Один раз замените `.github/workflows/deploy-iumrah-backend.yml` отдельным файлом `deploy-iumrah-backend.yml`. В GitHub Actions будет одна кнопка `Deploy iumrah backend` без параметров. По расписанию тот же workflow выполняет ботов.
3. Запустите `Deploy iumrah backend`. В логе шаг `Verify published backend and real flight catalog` должен вывести адрес и число рейсов. Если он не прошёл, не удаляйте старый Worker.
4. Соберите новую Business iOS-версию (TestFlight), чтобы она подключалась к новому Worker. Клиентский iOS-репозиторий ещё не предоставлен, поэтому его обращения пока НЕ перенесены.
5. **Отключите старые GitHub workflows** `Provision new Cloudflare Flight Hub` и `iumrah — Airline fare monitors`, если они по-прежнему включены в GitHub. Иначе старые задачи могут повторно создать Worker или дублировать проверки цен. Удалять сам исходный модуль `Backend/FlightHubWorker` из репозитория нельзя: его код теперь импортируется единым Worker.
6. **Только после** проверки новой версии Business, iOS-клиента и работающих ботов: Cloudflare → Workers & Pages → `iumrah-flight-hub` → Settings → Delete. Не удаляйте D1 `iumrah-flights`! Она теперь используется `iumrah-backend`.

## Важные ограничения
- Предыдущий деплой GitHub был успешен, но это не подтверждает правильную работу всех API: новый workflow проверяет реальный `/v1/public/status` и `/v1/public/flights` через `workers.dev`.
- Старый Worker автоматически не удаляется: старые опубликованные версии iOS всё ещё могут обращаться к его URL. Удаление раньше переключения нарушит их работу.
- Отдельные `/api/bookings` и `/api/auth/staff/session` сайта пока не входят в один Worker, поскольку их исходный код отсутствует в текущем репозитории. Нельзя перехватывать весь `iumrah.app/api/*`.
- Для переноса остальных клиентов нужно обновить соответствующие репозитории/конфиги.
- Не добавляются новые GitHub Secrets и не создаются новые Cloudflare Worker/D1/R2.
