import SwiftUI
import UIKit

struct HotelPriceMonitoringView: View {
    @Binding var hotels: [HotelListItem]

    @State private var accessStatus: BusinessChatGPTHotelAccessStatusResponse?
    @State private var changingAccess = false
    @State private var copyingJSONCity: String?

    @State private var pastedJSON = ""
    @State private var importedDocument: BusinessHotelPriceUpdateDocument?
    @State private var preview: BusinessHotelPricePreview?
    @State private var selectedHotelIDs = Set<String>()
    @State private var previewing = false
    @State private var applying = false
    @State private var notice: String?
    @State private var errorMessage: String?
    @State private var scrollToTopRequest = 0
    @FocusState private var jsonEditorFocused: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    Color.clear.frame(height: 0).id("hotel-sync-top")
                    introCard
                    accessCard
                    cityJSONExportCard
                    resultImportCard

                    if let preview {
                        previewSummary(preview)
                        resultControls(preview)
                        ForEach(preview.items) { item in
                            resultRow(item)
                        }
                    }

                    if let notice {
                        Label(notice, systemImage: "checkmark.circle.fill")
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(.green)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.green.opacity(0.08), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }

                    if let errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(.red)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.red.opacity(0.07), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                }
                .businessAdaptiveDetailWidth()
                .padding(.vertical, 14)
            }
            .contentMargins(.horizontal, 18, for: .scrollContent)
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .background(BusinessDesign.background)
            .onChange(of: scrollToTopRequest) { _ in
                withAnimation(.easeOut(duration: 0.24)) {
                    proxy.scrollTo("hotel-sync-top", anchor: .top)
                }
            }
            .navigationTitle("Hotel Sync")
            .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Готово") { jsonEditorFocused = false }
                        .fontWeight(.semibold)
                }
            }
            .task { await loadAccessState() }
        }
    }

    private var introCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 17, style: .continuous)
                        .fill(BusinessDesign.primaryControl)
                        .frame(width: 52, height: 52)
                    Image(systemName: "sparkles.rectangle.stack.fill")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(BusinessDesign.onPrimaryControl)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("ChatGPT · живая база отелей")
                        .font(.title2.bold())
                    Text("Iumrah Business HOTELS_DB → ChatGPT → JSON цен → подтверждение")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

            Text("Без snapshot, без дат доступа, без временных ссылок и без срока действия. ChatGPT читает все отели. Для Primary Hotels найденная цена применяется только после Вашего подтверждения и сохраняется как ручной override — автоматический мониторинг Primary по-прежнему отключён.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                stepPill("1", "Открыть доступ")
                stepPill("2", "ChatGPT читает DB")
                stepPill("3", "Получить JSON")
                stepPill("4", "Обновить цены")
            }
        }
        .padding(16)
        .businessCard(radius: 28)
    }

    private func stepPill(_ number: String, _ title: String) -> some View {
        HStack(spacing: 6) {
            Text(number)
                .font(.caption2.bold())
                .frame(width: 20, height: 20)
                .background(BusinessDesign.primaryControl, in: Circle())
                .foregroundStyle(BusinessDesign.onPrimaryControl)
            Text(title).font(.caption.weight(.semibold))
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .background(BusinessDesign.secondarySurface, in: Capsule())
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var accessCard: some View {
        let enabled = accessStatus?.enabled == true
        let makkah = accessStatus?.makkahCount ?? hotels.filter { canonicalCity($0.city) == "Makkah" }.count
        let madinah = accessStatus?.madinahCount ?? hotels.filter { canonicalCity($0.city) == "Madinah" }.count
        let total = accessStatus?.hotelCount ?? (makkah + madinah)
        let primary = accessStatus?.primaryHotelCount ?? 0

        return VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(enabled ? Color.green.opacity(0.12) : BusinessDesign.secondarySurface)
                        .frame(width: 52, height: 52)
                    Image(systemName: enabled ? "lock.open.fill" : "lock.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(enabled ? .green : .secondary)
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(enabled ? "Доступ ChatGPT открыт" : "Доступ ChatGPT закрыт")
                        .font(.headline)
                    Text("ChatGPT: \(total) · Makkah \(makkah) · Madinah \(madinah) · Primary: \(primary)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Circle()
                    .fill(enabled ? Color.green : Color.secondary.opacity(0.35))
                    .frame(width: 10, height: 10)
            }

            HStack(spacing: 8) {
                Label("Live HOTELS_DB", systemImage: "cylinder.split.1x2.fill")
                Text("·")
                Text("без snapshot")
                Text("·")
                Text("без TTL")
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            Text(enabled
                 ? "ChatGPT может читать все отели, nightly USD, provider и source URL. Primary Hotels тоже входят в JSON, но их цена записывается только как подтверждённый Вами ручной override."
                 : "Откройте доступ один раз. Он останется открытым постоянно, пока Вы сами не нажмёте «Закрыть доступ»."
            )
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)

            Button {
                Task { await changeAccess(to: !enabled) }
            } label: {
                HStack(spacing: 9) {
                    if changingAccess {
                        ProgressView().tint(enabled ? Color.primary : BusinessDesign.onPrimaryControl)
                    } else {
                        Image(systemName: enabled ? "lock.fill" : "lock.open.fill")
                    }
                    Text(changingAccess ? "Обновляем…" : (enabled ? "Закрыть доступ ChatGPT" : "Открыть доступ ChatGPT"))
                        .fontWeight(.semibold)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .frame(height: 52)
                .foregroundStyle(enabled ? Color.primary : BusinessDesign.onPrimaryControl)
                .background(enabled ? BusinessDesign.secondarySurface : BusinessDesign.primaryControl, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(changingAccess || applying || previewing)

            if enabled {
                Label("Доступ постоянный до ручного отключения", systemImage: "infinity")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.green)
            }
        }
        .padding(16)
        .businessCard(radius: 28)
    }

    private var resultImportCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Новые цены от ChatGPT")
                    .font(.title2.bold())
                Text("Вставьте JSON schema iumrah.hotel-price-update.v3")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ZStack(alignment: .topLeading) {
                TextEditor(text: $pastedJSON)
                    .focused($jsonEditorFocused)
                    .font(.system(.caption, design: .monospaced))
                    .frame(minHeight: 180)
                    .padding(10)
                    .scrollContentBackground(.hidden)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))

                if pastedJSON.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("{\n  \"schema\": \"iumrah.hotel-price-update.v3\",\n  \"hotels\": [\n    {\"hotel_id\": \"...\", \"new_nightly_usd\": 150}\n  ]\n}")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.tertiary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 18)
                        .allowsHitTesting(false)
                }
            }

            HStack(spacing: 10) {
                Text(pastedJSON.isEmpty ? "Вставьте ответ ChatGPT" : "\(pastedJSON.utf8.count) bytes")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                Spacer()
                if jsonEditorFocused {
                    Button { jsonEditorFocused = false } label: {
                        Label("Скрыть клавиатуру", systemImage: "keyboard.chevron.compact.down")
                            .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.plain)
                }
                if !pastedJSON.isEmpty {
                    Button("Очистить") {
                        pastedJSON = ""
                        importedDocument = nil
                        preview = nil
                        selectedHotelIDs.removeAll()
                    }
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                }
            }

            Button {
                jsonEditorFocused = false
                Task { await parseAndPreview() }
            } label: {
                HStack {
                    if previewing { ProgressView() }
                    Label("Прочитать JSON", systemImage: "doc.text.magnifyingglass")
                        .font(.headline)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .frame(height: 50)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.primary)
            .disabled(previewing || applying || pastedJSON.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Text("Прямой режим: для записи достаточно hotel_id и цены. provider, source URL, confidence, old_nightly_usd и статус проверки не блокируют обновление. Если new_nightly_usd пустой, можно использовать observed_nightly_amount в USD или SAR (SAR автоматически делится на 3.75). Для Primary Hotels выбранная цена сохраняется как ручной override.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .businessCard(radius: 28)
    }

    private var cityJSONExportCard: some View {
        let makkah = accessStatus?.makkahCount ?? hotels.filter { canonicalCity($0.city) == "Makkah" }.count
        let madinah = accessStatus?.madinahCount ?? hotels.filter { canonicalCity($0.city) == "Madinah" }.count

        return VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("JSON отелей по городам")
                    .font(.title2.bold())
                Text("Отдельная живая выгрузка из HOTELS_DB для мониторинга цен и новых отелей.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text("В JSON входят hotel_id, название, город, звёзды, текущая nightly USD, provider, source URL и служебные данные цены, включая Primary Hotels. Текущий доступ ChatGPT эта функция не открывает, не закрывает и не меняет.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 10) {
                cityJSONButton(city: "Makkah", title: "Makkah", count: makkah)
                cityJSONButton(city: "Madinah", title: "Madinah", count: madinah)
            }

            Label("Каждое копирование перечитывает живую базу — новые обычные отели автоматически попадут в следующий JSON.", systemImage: "arrow.triangle.2.circlepath")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .businessCard(radius: 28)
    }

    private func cityJSONButton(city: String, title: String, count: Int) -> some View {
        let isCopying = copyingJSONCity == city
        return Button {
            Task { await copyLiveJSON(city: city) }
        } label: {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 7) {
                    if isCopying {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "doc.on.doc.fill")
                    }
                    Text("Скопировать \(title)")
                        .font(.subheadline.weight(.semibold))
                    Spacer(minLength: 0)
                }
                Text("\(count) отелей · JSON")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 13)
            .frame(maxWidth: .infinity, minHeight: 62, alignment: .leading)
            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .disabled(copyingJSONCity != nil || changingAccess || applying || previewing)
    }

    private func previewSummary(_ preview: BusinessHotelPricePreview) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Предпросмотр").font(.title2.bold())
                    Text("Готовность цен к прямой записи")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(preview.total)").font(.headline.monospacedDigit())
            }
            HStack(spacing: 8) {
                summaryPill("Готово", preview.changed, .green)
                summaryPill("Без изменений", preview.unchanged, .secondary)
                summaryPill("Без цены", preview.invalid, .orange)
            }
        }
        .padding(16)
        .businessCard(radius: 26)
    }

    private func summaryPill(_ title: String, _ count: Int, _ color: Color) -> some View {
        HStack(spacing: 5) {
            Text("\(count)").font(.caption.bold().monospacedDigit())
            Text(title).font(.caption2.weight(.medium))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .background(color.opacity(0.08), in: Capsule())
    }

    private func resultControls(_ preview: BusinessHotelPricePreview) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Button("Все изменения") {
                    selectedHotelIDs = Set(preview.items.filter(\.selectable).map(\.hotelID))
                }
                .buttonStyle(.bordered)
                Button("Снять выбор") { selectedHotelIDs.removeAll() }
                    .buttonStyle(.bordered)
                Spacer()
                Text("\(selectedHotelIDs.count) выбрано")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            Button {
                Task { await applySelected() }
            } label: {
                HStack {
                    if applying { ProgressView().tint(BusinessDesign.onPrimaryControl) }
                    Text(applying ? "Обновляем…" : "Обновить выбранные цены")
                        .fontWeight(.semibold)
                    Spacer()
                    Image(systemName: "checkmark.circle.fill")
                }
                .padding(.horizontal, 16)
                .frame(height: 52)
                .foregroundStyle(BusinessDesign.onPrimaryControl)
                .background(BusinessDesign.primaryControl, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(selectedHotelIDs.isEmpty || applying || previewing)
        }
        .padding(15)
        .businessCard(radius: 24)
    }

    private func resultRow(_ item: BusinessHotelPricePreviewItem) -> some View {
        let selected = selectedHotelIDs.contains(item.hotelID)
        return Button {
            guard item.selectable else { return }
            if selected { selectedHotelIDs.remove(item.hotelID) }
            else { selectedHotelIDs.insert(item.hotelID) }
        } label: {
            VStack(alignment: .leading, spacing: 11) {
                HStack(alignment: .top, spacing: 11) {
                    Image(systemName: selected ? "checkmark.circle.fill" : (item.selectable ? "circle" : "minus.circle"))
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(selected ? .green : .secondary)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.hotelName)
                            .font(.headline)
                            .multilineTextAlignment(.leading)
                        Text("\(item.city) · \(item.hotelID)")
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    statusBadge(item)
                }

                if let new = item.newNightlyUSD, item.reviewStatus == "ready" {
                    HStack(spacing: 8) {
                        if let old = item.oldNightlyUSD {
                            Text(Self.usd(old)).foregroundStyle(.secondary)
                            Image(systemName: "arrow.right").font(.caption.bold()).foregroundStyle(.tertiary)
                        }
                        Text(Self.usd(new)).fontWeight(.bold)
                        if let percent = item.deltaPercent {
                            Text(String(format: "%+.1f%%", percent))
                                .font(.caption.bold().monospacedDigit())
                                .foregroundStyle(percent > 0 ? .orange : .green)
                        }
                    }
                    .font(.subheadline.monospacedDigit())
                }

                if let observed = item.observedNightlyAmount, let currency = item.observedCurrency, currency.uppercased() != "USD" {
                    Text("Источник: \(formatMoney(observed, currency: currency))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let issue = item.issue {
                    Text(issueText(issue))
                        .font(.caption)
                        .foregroundStyle(item.reviewStatus == "unverified" ? .orange : .red)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 21, style: .continuous))
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .disabled(!item.selectable)
    }

    private func statusBadge(_ item: BusinessHotelPricePreviewItem) -> some View {
        let value: (String, Color) = {
            switch item.reviewStatus {
            case "ready": return ("Готово", .green)
            case "unchanged": return ("Без изменений", .secondary)
            case "applied": return ("Обновлено", .green)
            default: return ("Нет цены", .orange)
            }
        }()
        return Text(value.0)
            .font(.caption2.bold())
            .foregroundStyle(value.1)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(value.1.opacity(0.08), in: Capsule())
    }

    @MainActor
    private func loadAccessState() async {
        do {
            accessStatus = try await APIClient.shared.chatGPTHotelAccessStatus()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func changeAccess(to enabled: Bool) async {
        changingAccess = true
        notice = nil
        errorMessage = nil
        defer { changingAccess = false }
        do {
            accessStatus = try await APIClient.shared.setChatGPTHotelAccess(enabled: enabled)
            notice = enabled
                ? "Доступ ChatGPT открыт. Он останется активным, пока Вы не закроете его вручную."
                : "Доступ ChatGPT закрыт."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func copyLiveJSON(city: String) async {
        copyingJSONCity = city
        notice = nil
        errorMessage = nil
        defer { copyingJSONCity = nil }
        do {
            let json = try await APIClient.shared.chatGPTHotelLiveJSON(city: city)
            UIPasteboard.general.string = json
            let count = city == "Makkah"
                ? (accessStatus?.makkahCount ?? hotels.filter { canonicalCity($0.city) == "Makkah" }.count)
                : (accessStatus?.madinahCount ?? hotels.filter { canonicalCity($0.city) == "Madinah" }.count)
            notice = "\(city) JSON скопирован: \(count) отелей, текущие цены и источники."
        } catch {
            errorMessage = "Не удалось скопировать \(city) JSON: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func parseAndPreview() async {
        jsonEditorFocused = false
        previewing = true
        notice = nil
        errorMessage = nil
        defer { previewing = false }
        do {
            let json = extractJSONObject(from: pastedJSON)
            guard let data = json.data(using: .utf8) else { throw APIError.server("INVALID_JSON") }
            let document = try JSONDecoder().decode(BusinessHotelPriceUpdateDocument.self, from: data)
            async let hotelRequest = APIClient.shared.hotels()
            async let primaryIDsRequest = livePrimaryHotelIDs()
            let freshHotels = try await hotelRequest
            let primaryIDs = try await primaryIDsRequest
            hotels = freshHotels
            let resolved = try await APIClient.shared.previewHotelChatGPTUpdate(document, currentHotels: freshHotels, primaryHotelIDs: primaryIDs)
            importedDocument = document
            preview = resolved
            selectedHotelIDs = Set(resolved.items.filter(\.selectable).map(\.hotelID))
            notice = resolved.changed == 0 ? "JSON прочитан. Новых цен для записи нет." : "JSON прочитан. Готово к записи цен: \(resolved.changed)."
        } catch {
            importedDocument = nil
            preview = nil
            selectedHotelIDs.removeAll()
            errorMessage = "Не удалось проверить JSON: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func applySelected() async {
        guard let document = importedDocument, !selectedHotelIDs.isEmpty else { return }
        applying = true
        notice = nil
        errorMessage = nil
        defer { applying = false }
        do {
            async let hotelRequest = APIClient.shared.hotels()
            async let primaryIDsRequest = livePrimaryHotelIDs()
            let freshHotels = try await hotelRequest
            let primaryIDs = try await primaryIDsRequest
            hotels = freshHotels
            let freshPreview = try await APIClient.shared.previewHotelChatGPTUpdate(document, currentHotels: freshHotels, primaryHotelIDs: primaryIDs)
            let allowed = Set(freshPreview.items.filter(\.selectable).map(\.hotelID))
            let finalSelection = selectedHotelIDs.intersection(allowed)
            guard !finalSelection.isEmpty else { throw APIError.server("CHATGPT_HOTEL_SELECTION_NO_LONGER_VALID") }

            let response = try await APIClient.shared.applyHotelChatGPTUpdate(document, selectedHotelIDs: finalSelection)
            hotels = try await APIClient.shared.hotels()
            if response.appliedCount > 0 {
                notice = "Обновлено цен: \(response.appliedCount). База уже перечитана с новыми значениями."
            }
            if response.rejectedCount > 0 {
                let first = response.rejected.first?.error ?? "CHATGPT_HOTEL_REJECTED"
                errorMessage = "Не применено: \(response.rejectedCount). \(issueText(first))"
            }
            selectedHotelIDs.removeAll()
            preview = nil
            importedDocument = nil
            pastedJSON = ""
            await Task.yield()
            scrollToTopRequest &+= 1
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func livePrimaryHotelIDs() async throws -> Set<String> {
        async let makkah = APIClient.shared.primaryHotels(city: "Makkah")
        async let madinah = APIClient.shared.primaryHotels(city: "Madinah")
        let (makkahAssignments, madinahAssignments) = try await (makkah, madinah)
        return Set((makkahAssignments + madinahAssignments).map { $0.hotel.id })
    }

    private func canonicalCity(_ value: String) -> String? {
        let raw = value.lowercased().replacingOccurrences(of: "-", with: " ").replacingOccurrences(of: "_", with: " ")
        if raw.contains("makkah") || raw.contains("mecca") || raw.contains("مكة") { return "Makkah" }
        if raw.contains("madinah") || raw.contains("medina") || raw.contains("المدينة") { return "Madinah" }
        return nil
    }

    private func extractJSONObject(from text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let first = trimmed.firstIndex(of: "{"), let last = trimmed.lastIndex(of: "}"), first <= last {
            return String(trimmed[first...last])
        }
        return trimmed
    }

    private func issueText(_ issue: String) -> String {
        switch issue {
        case "NO_USABLE_PRICE": return "В JSON нет пригодной цены: укажите new_nightly_usd либо observed_nightly_amount в USD/SAR."
        case "PRICE_ALREADY_CHANGED", "CHATGPT_HOTEL_PRICE_ALREADY_CHANGED": return "Цена в базе уже изменилась после проверки. Возьмите свежую old_nightly_usd и повторите только этот отель."
        case "PROPERTY_CHANGED", "CHATGPT_HOTEL_PROPERTY_MISMATCH": return "Источник ведёт на другой hotel/property."
        case "CHECKED_SOURCE_NOT_VERIFIED", "CHATGPT_HOTEL_SOURCE_NOT_VERIFIED": return "Не подтверждён точный provider/property этого отеля."
        case "LOW_CONFIDENCE": return "Недостаточная уверенность проверки."
        case "PRICE_NOT_VERIFIED": return "Цена не подтверждена источником."
        case "INVALID_NEW_PRICE", "CHATGPT_HOTEL_INVALID_NEW_PRICE": return "Новая цена некорректна."
        case "HOTEL_NOT_FOUND": return "Отель больше не найден в текущей базе."
        case "CITY_MISMATCH": return "Город отеля не совпадает с живой базой."
        case "PRIMARY_HOTEL_MANUAL_PRICE_ONLY": return "Primary Hotel использует ручную цену. Повторите применение JSON — выбранное значение будет сохранено как manual override."
        default: return issue.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private func formatMoney(_ value: Double, currency: String) -> String {
        if currency.uppercased() == "USD" { return Self.usd(value) }
        return "\(String(format: "%.2f", value)) \(currency.uppercased())"
    }

    private static func usd(_ value: Double) -> String {
        "$" + String(format: value.rounded() == value ? "%.0f" : "%.2f", value)
    }
}
