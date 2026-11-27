# Kelvin — Final Core × Native Experience 2.1

## Основа и способ объединения
- Актуальный `lattice-mobile-main 6.zip` — источник истины для SwiftUI, ресурсов, настроек проекта и workflow.
- `kelvin-business-backend-block-07-merge-candidate.zip` — протокол 7, память, исследования, стратегическая аналитика, Care, восстановление.
- `jarvis-update-kelvin-block-02-07-cumulative.zip` — финальное ядро для Mac. Код не менялся при финальном объединении.
- Совмещён `Backend/HotelsWorker/src/kelvin.js`: добавлены маршруты протокола 7 без удаления owner-only `/speech`. `kelvin-voice.js` и обе маршрутизации `index.js`/`router.js` сохранены побайтово. `care.js` исходного Business 6 совпал с базовым Business 3; интеграция Care переносится без потери параллельных изменений.
- `APIClient+Kelvin.swift`: сохранена новая Gemini WAV-озвучка; добавлены точный запрос turn, типизированная память с версиями и архив insights.
- `KelvinView.swift`: сохранён основной native UI, голос, drawer, вложения, reveal, анимации. Добавлен пункт «Исследования и доклады», расширена существующая панель памяти (категории, редактирование, подтверждение, удаление, пагинация). Голосовой запрос извлекается по ID за пределами последних 60 записей; после await повторно проверяются аккаунт, активность, идентификатор запроса и отмена. Панели закрываются при утрате доступа или смене аккаунта.
- Не изменены splash, иконки, wordmark, KelvinBrand, KelvinVoiceOrb, KelvinVoicePreferences, навигация, project.yml, configurator, workflows. Хотфикс индексирования фото уже присутствует в исходнике Business 6 и не перезаписывается.
- В Business 6 deploy workflow уже передаёт `KELVIN_GEMINI_API_KEY`; `GEMINI_API_KEY` остаётся отдельно. Секреты не включены в патч. Модель Gemini 3.8 Flash TTS и 30 голосов сохранены; Google TTS только после согласия владельца, для iOS. Telegram-голос использует прежний Mac-транспорт, не синхронизирует выбор Gemini-голоса. Новый UI не получает поток токенов; анимация печати работает после готового ответа.

## Тесты данного объединения
- Исходный Business 6: 229/229 backend, 27/31 architecture.
- Объединённый Business: 269/269 backend (в т.ч. 5 существующих тестов TTS, 1 новый сценарий совместимости протокола 7 и TTS); 30/34 architecture. Четыре исходных неуспешных теста не менялись: test_chat_defaults_to_all_threads, test_all_explicit_navigation_titles_have_brand_surface, test_rail_and_price_preview, test_concierge_is_separate_and_safe. Все 10 Kelvin architecture tests проходят.
- Swift frontend parse всех Sources и ClientConfigurator/Sources: PASS (Linux, не typecheck/SDK compile).
- 156/156 Python-тестов финального ядра, повторно запущены на совпадающих с архивом файлах; ResourceWarning SQLite в тестах остаются. Сквозной тест реального loopback HTTP: PASS (Python ↔ JS, SQLite fixture, pairing, общая память, очереди, ответ по ID, архив, отзыв ключа).
- Реальный Google, Telegram, Claude, D1 и Xcode не запускались. В предыдущем блоке 2 upstream cron-теста не прошли из-за отсутствия croniter; установщик проверяет зависимость. Семантическая память, прямые DeepResearch/Operative, свободный клиентский диалог, токен-стриминг, автоматическое barge-in остаются незавершёнными. Реальная 72h приёмка и 40 аудиофраз RU/UZ предстоят.

## Развёртывание и приёмка
1. Сделать резервную копию production D1 (по существующей процедуре) и сверить HEAD с исходным Business 6. Загрузить только `iumrah-business-kelvin-final-native.zip` в корень lattice-mobile. Дождаться Apply iumrah Business ZIP update; не загружать предыдущие архивы. Убедиться в отсутствии других обновлений в корне.
2. В Actions запустить существующий Deploy iumrah backend, проверить результат; затем iOS Root TestFlight. Новый ключ не нужен, если существующий secret KELVIN_GEMINI_API_KEY задан; workflow в исходном архиве уже настроен. Полный Xcode archive — обязательный gate.
3. Загрузить только `jarvis-update-kelvin-final-core.zip` в корень Kelvin repo, дождаться распаковки. На Mac: `cd ~/Kelvin && git pull --ff-only && bash founder_jarvis/macos/install.sh`. В случае ошибки не продолжать, сохранить лог. При активной прежней привязке не генерировать новый токен. Если привязки нет — в меню Kelvin «Подключить MacBook», затем `bash founder_jarvis/macos/link-iumrah.sh` (ключ вводится локально).
4. Из корня Kelvin: `"$HOME/Library/Application Support/Kelvin/telegram-venv/bin/python" -m founder_jarvis.macos.doctor --live`. В приватном Telegram: /health, /autonomy status, /biz status. Проверить обычный вопрос, межканальную память, выбор голоса/preview, разговор/прерывание, отсутствие лишних уведомлений. Care до отдельного подтверждения оставить неактивным; Instagram и Facebook не подключать. Если потребуется остановить инициативные сообщения: /autonomy off.
5. После успешных тестов на телефоне и Mac — реальный soak 72 часа, 40 фраз RU/UZ и сверка бизнес-аналитики с D1. Только после приёмки считать production-ready.
