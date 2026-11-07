# iumrah Root — миграция на новый App Store Connect

## Почему прошлый build падал

В старом GitHub-репозитории `project.yml` всё ещё был `com.iumrah.business`.
Новый iOS workflow останавливал сборку на проверке идентификатора, до Xcode.
Новое значение: `com.iumrah.root` (Team `HVT4U96286`).

## Быстрый путь для существующего репозитория: ZIP для бота

1. Загрузите **iumrah-business-root-migration-20261107.zip** в корень репозитория через GitHub Code → Add file → Upload files. НЕ распаковывайте его вручную на GitHub.
2. Дождитесь выполнения существующего workflow **Apply iumrah Business ZIP update**. Он распакует изменения и удалит ZIP автоматически.
3. Откройте `project.yml` в репозитории; найдите `PRODUCT_BUNDLE_IDENTIFIER: com.iumrah.root`. Если там всё ещё `.business`, не запускайте iOS build.
4. GitHub Actions → **iumrah Root — iOS TestFlight (new Team)** → Run workflow → `upload_to_testflight=false`.
5. После компиляции — только тогда `upload_to_testflight=true`. Для signed build должны быть настроены secrets: `APPLE_TEAM_ID`, `APPLE_ID_EMAIL`, `APPLE_APP_SPECIFIC_PASSWORD`, `IOS_SIGNING_KEY_PASSWORD`, `ROOT_DISTRIBUTION_KEY_B64`, `ROOT_IOS_PROFILE_B64`.

**Важно:** старый `apply-zip.yml` намеренно **не обновляет `.github/workflows`** и **не удаляет** ранее tracked Signing-файлы/архивы. Основной root workflow уже должен присутствовать (по последнему screenshot он есть). Полная чистая копия проекта в `iumrah-root-full-clean-20261107.zip` **содержит** исправленные workflows и не содержит старых signing файлов. Для очистки существующего GitHub требуется коммит удаления старых файлов (не выполняйте `rm -rf Signing` вслепую, если там есть ваши новые локальные файлы).

## Проверка локально

`python3 scripts/verify_root_identity.py` — статические проверки.

Нельзя подтвердить реальную Xcode компиляцию/подпись без macOS runner Xcode 26 и корректного приватного ключа. Скачанный Provisioning Profile подтверждён как `HVT4U96286.com.iumrah.root`, APNs `production`, действителен до 2027-11-07.

## Примечания

Клиент остаётся подключён к `https://iumrah.app` до переноса Cloudflare. Нельзя считать, что новая Cloudflare база/новые APNs keys уже настроены. В полном архиве deployment workflow заблокирован переменной `ROOT_CLOUDFLARE_MIGRATION_READY=true` до отдельной миграции.
`com.iumrah.root` — новое приложение, локальные Keychain-данные со старого bundle ID не переедут.
