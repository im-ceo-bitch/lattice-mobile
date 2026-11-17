import SwiftUI
import UIKit

private enum ESIMCenterSegment: String, CaseIterable, Identifiable {
    case plans
    case inventory

    var id: String { rawValue }
    var title: String { self == .plans ? "Тарифы" : "Купленные" }
}

private struct ESIMCountry: Identifiable, Hashable {
    let code: String
    let name: String
    var id: String { code }

    var flag: String {
        code.uppercased().unicodeScalars.compactMap { scalar in
            UnicodeScalar(127397 + Int(scalar.value)).map(String.init)
        }.joined()
    }

    static let supported: [ESIMCountry] = [
        .init(code: "SA", name: "Saudi Arabia"),
        .init(code: "AE", name: "UAE"),
        .init(code: "QA", name: "Qatar"),
        .init(code: "TR", name: "Türkiye"),
        .init(code: "UZ", name: "Uzbekistan"),
        .init(code: "KZ", name: "Kazakhstan"),
        .init(code: "KG", name: "Kyrgyzstan"),
        .init(code: "TJ", name: "Tajikistan"),
        .init(code: "ID", name: "Indonesia"),
        .init(code: "MY", name: "Malaysia"),
        .init(code: "PK", name: "Pakistan"),
        .init(code: "BD", name: "Bangladesh"),
        .init(code: "IN", name: "India"),
        .init(code: "EG", name: "Egypt"),
        .init(code: "JO", name: "Jordan")
    ]
}

struct ESIMCenterView: View {
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @Environment(\.businessUsesPersistentSidebar) private var usesPersistentSidebar
    @Environment(\.businessAdaptiveLayout) private var layout

    @State private var segment: ESIMCenterSegment = .plans
    @State private var country = ESIMCountry.supported[0]
    @State private var balance: ESIMAccessBalance?
    @State private var packages: [ESIMAccessPackage] = []
    @State private var inventory: [ESIMAccessInventoryProfile] = []
    @State private var loading = true
    @State private var refreshing = false
    @State private var errorMessage: String?
    @State private var purchaseTarget: ESIMAccessPackage?
    @State private var assignmentTarget: ESIMAccessInventoryProfile?

    private var sortedPackages: [ESIMAccessPackage] {
        packages.sorted {
            if abs($0.volumeBytes - $1.volumeBytes) > 1 { return $0.volumeBytes < $1.volumeBytes }
            if $0.duration != $1.duration { return $0.duration < $1.duration }
            return $0.priceUSD < $1.priceUSD
        }
    }

    private var sortedInventory: [ESIMAccessInventoryProfile] {
        inventory.sorted {
            if $0.isAssigned != $1.isAssigned { return !$0.isAssigned }
            return $0.createdAt > $1.createdAt
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                hero
                balanceCard
                segmentControl

                if let errorMessage {
                    errorCard(errorMessage)
                }

                switch segment {
                case .plans:
                    planSection
                case .inventory:
                    inventorySection
                }
            }
            .businessAdaptiveReadableWidth()
            .padding(.horizontal, 18)
            .padding(.top, 10)
            .padding(.bottom, 36)
        }
        .background(BusinessDesign.background.ignoresSafeArea())
        .navigationTitle("eSIM")
        .navigationBarTitleDisplayMode(.inline)
        .businessNavigationSurface()
        .toolbar {
            if !usesPersistentSidebar {
                ToolbarItem(placement: .topBarLeading) { Button("Закрыть") { dismiss() }.foregroundStyle(BusinessDesign.headerInk) }
            }
            ToolbarItem(placement: .principal) {
                BusinessBrandLogo(width: 116, foreground: BusinessDesign.headerInk)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await reloadAll(force: true) }
                } label: {
                    if refreshing { ProgressView().controlSize(.small) }
                    else { Image(systemName: "arrow.clockwise") }
                }
                .disabled(refreshing)
                .accessibilityLabel("Обновить eSIM")
            }
        }
        .task { await reloadAll(force: false) }
        .refreshable { await reloadAll(force: true) }
        .sheet(item: $purchaseTarget) { plan in
            ESIMPurchaseSheet(plan: plan, startingBalance: balance) {
                Task { await reloadAll(force: true) }
            }
        }
        .sheet(item: $assignmentTarget) { profile in
            NavigationStack {
                ESIMAssignmentSheet(profile: profile) {
                    Task { await reloadAll(force: true) }
                }
            }
        }
    }

    private var hero: some View {
        HStack(spacing: 15) {
            ZStack {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(BusinessDesign.secondarySurface)
                    .frame(width: 68, height: 68)
                Image(systemName: "simcard.2.fill")
                    .font(.system(size: 27, weight: .semibold))
            }
            .businessGlass(in: RoundedRectangle(cornerRadius: 22, style: .continuous))

            VStack(alignment: .leading, spacing: 5) {
                Text("iumrah eSIM Center")
                    .font(.title2.bold())
                Text("Покупка eSIM Access под Вашим контролем — затем Вы сами назначаете профиль конкретной поездке.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(18)
        .businessCard(radius: 30)
    }

    private var balanceCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Баланс eSIM Access")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                    if let balance {
                        Text(balance.amountUSD, format: .currency(code: balance.currencyCode))
                            .font(.system(size: 34, weight: .bold, design: .rounded))
                    } else if loading {
                        ProgressView()
                    } else {
                        Text("—")
                            .font(.largeTitle.bold())
                    }
                }
                Spacer()
                Image(systemName: "creditcard.and.123")
                    .font(.title2.weight(.semibold))
                    .frame(width: 48, height: 48)
                    .businessGlass(in: Circle())
            }

            Text("Покупки через API списываются с баланса eSIM Access. Visa не хранится в iumrah Business: карту и Auto-Recharge безопаснее привязать в кабинете eSIM Access через Stripe.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                if let url = URL(string: "https://console.esimaccess.com") { openURL(url) }
            } label: {
                Label("Пополнить баланс", systemImage: "arrow.up.right.square")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
            }
            .buttonStyle(.plain)
            .businessGlass(in: Capsule())
        }
        .padding(18)
        .businessCard(radius: 28)
    }

    private var segmentControl: some View {
        HStack(spacing: 6) {
            ForEach(ESIMCenterSegment.allCases) { item in
                Button {
                    withAnimation(.snappy(duration: 0.22)) { segment = item }
                } label: {
                    Text(item.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(segment == item ? BusinessDesign.onPrimaryControl : BusinessDesign.ink)
                        .frame(maxWidth: .infinity)
                        .frame(height: 42)
                        .background(segment == item ? BusinessDesign.primaryControl : Color.clear, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(BusinessDesign.secondarySurface, in: Capsule())
    }

    @ViewBuilder private var planSection: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text("Тарифы")
                    .font(.title3.bold())
                Text("Актуальные fixed-data тарифы и цены приходят напрямую из eSIM Access API")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Menu {
                ForEach(ESIMCountry.supported) { item in
                    Button("\(item.flag)  \(item.name)") {
                        country = item
                        Task { await loadPackages() }
                    }
                }
            } label: {
                HStack(spacing: 7) {
                    Text(country.flag)
                    Text(country.code)
                        .fontWeight(.semibold)
                    Image(systemName: "chevron.down")
                        .font(.caption.bold())
                }
                .padding(.horizontal, 13)
                .frame(height: 40)
                .businessGlass(in: Capsule())
            }
        }
        .padding(.top, 2)

        if loading && packages.isEmpty {
            ProgressView("Получаем тарифы…")
                .frame(maxWidth: .infinity)
                .padding(.vertical, 36)
        } else if sortedPackages.isEmpty {
            ContentUnavailableView("Тарифов нет", systemImage: "simcard", description: Text("Для выбранной страны eSIM Access не вернул доступных пакетов."))
                .padding(.vertical, 20)
        } else if layout.supportsDenseDashboard {
            LazyVGrid(columns: layout.cardGridColumns, spacing: 14) {
                ForEach(sortedPackages) { plan in
                    ESIMPlanCard(plan: plan, balance: balance) {
                        purchaseTarget = plan
                    }
                }
            }
        } else {
            ForEach(sortedPackages) { plan in
                ESIMPlanCard(plan: plan, balance: balance) {
                    purchaseTarget = plan
                }
            }
        }
    }

    @ViewBuilder private var inventorySection: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text("Купленные eSIM")
                    .font(.title3.bold())
                Text("Профиль не появится у паломника, пока Вы сами не назначите его поездке")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }

        if loading && inventory.isEmpty {
            ProgressView("Загружаем eSIM…")
                .frame(maxWidth: .infinity)
                .padding(.vertical, 36)
        } else if sortedInventory.isEmpty {
            ContentUnavailableView("Покупок пока нет", systemImage: "simcard.2", description: Text("Купите тариф во вкладке «Тарифы». Профиль сохранится здесь до назначения поездке."))
                .padding(.vertical, 20)
        } else if layout.supportsDenseDashboard {
            LazyVGrid(columns: layout.cardGridColumns, spacing: 14) {
                ForEach(sortedInventory) { profile in
                    ESIMInventoryCard(profile: profile) {
                        assignmentTarget = profile
                    } onRefresh: {
                        Task { await refresh(profile) }
                    }
                }
            }
        } else {
            ForEach(sortedInventory) { profile in
                ESIMInventoryCard(profile: profile) {
                    assignmentTarget = profile
                } onRefresh: {
                    Task { await refresh(profile) }
                }
            }
        }
    }

    private func errorCard(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(message)
                .font(.footnote)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .foregroundStyle(.red)
        .padding(14)
        .background(Color.red.opacity(0.06), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    @MainActor private func reloadAll(force: Bool) async {
        if force { refreshing = true } else if balance == nil && packages.isEmpty && inventory.isEmpty { loading = true }
        defer {
            loading = false
            refreshing = false
        }
        errorMessage = nil

        // Keep the three eSIM Access requests independent. Previously `async let`
        // made the whole screen fail with `cancelled` when only one endpoint
        // returned an error; tariffs should remain usable even if balance or
        // inventory is temporarily unavailable.
        let balanceTask = Task { try await APIClient.shared.esimAccessBalance() }
        let packagesTask = Task { try await APIClient.shared.esimAccessPackages(countryCode: country.code) }
        let inventoryTask = Task { try await APIClient.shared.esimAccessInventory() }

        var errors: [String] = []
        do { balance = try await balanceTask.value }
        catch { errors.append(esimErrorText(error, area: "Баланс")) }

        do { packages = try await packagesTask.value }
        catch { errors.append(esimErrorText(error, area: "Тарифы")) }

        do { inventory = try await inventoryTask.value }
        catch { errors.append(esimErrorText(error, area: "Профили")) }

        if !errors.isEmpty { errorMessage = errors.joined(separator: " · ") }
    }

    private func esimErrorText(_ error: Error, area: String) -> String {
        if error is CancellationError { return "\(area): запрос был прерван — повторите обновление" }
        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        return "\(area): \(message.isEmpty ? "временно недоступно" : message)"
    }

    @MainActor private func loadPackages() async {
        refreshing = true
        defer { refreshing = false }
        errorMessage = nil
        do { packages = try await APIClient.shared.esimAccessPackages(countryCode: country.code) }
        catch { errorMessage = error.localizedDescription }
    }

    @MainActor private func refresh(_ profile: ESIMAccessInventoryProfile) async {
        refreshing = true
        defer { refreshing = false }
        errorMessage = nil
        do {
            let updated = try await APIClient.shared.refreshESIMAccessInventory(id: profile.id)
            if let index = inventory.firstIndex(where: { $0.id == updated.id }) { inventory[index] = updated }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct ESIMPlanCard: View {
    let plan: ESIMAccessPackage
    let balance: ESIMAccessBalance?
    let onBuy: () -> Void

    private var affordable: Bool { (balance?.amountUSD ?? .greatestFiniteMagnitude) + 0.0001 >= plan.priceUSD }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(BusinessDesign.secondarySurface)
                        .frame(width: 54, height: 54)
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .font(.system(size: 20, weight: .semibold))
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(plan.name)
                        .font(.headline)
                        .lineLimit(2)
                    HStack(spacing: 8) {
                        Text(plan.dataLabel)
                        Text("·")
                        Text(plan.durationLabel)
                        if !plan.speed.isEmpty {
                            Text("·")
                            Text(plan.speed)
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                Spacer(minLength: 6)
                Text(plan.priceUSD, format: .currency(code: plan.currencyCode))
                    .font(.title3.bold())
            }

            if !plan.networkNames.isEmpty {
                Text(plan.networkNames.prefix(3).joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack {
                if plan.supportsTopUp {
                    Label("Top Up", systemImage: "plus.circle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button(action: onBuy) {
                    Text(affordable ? "Купить eSIM" : "Недостаточно средств")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 18)
                        .frame(height: 42)
                }
                .buttonStyle(.borderedProminent)
                .tint(BusinessDesign.primaryControl)
                .disabled(!affordable)
            }
        }
        .padding(16)
        .businessCard(radius: 24)
    }
}

private struct ESIMInventoryCard: View {
    let profile: ESIMAccessInventoryProfile
    let onAssign: () -> Void
    let onRefresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(profile.packageName)
                        .font(.headline)
                    Text(profile.displayStatus)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(profile.priceUSD, format: .currency(code: profile.currencyCode))
                    .font(.headline)
            }

            if let iccid = profile.iccid, !iccid.isEmpty {
                copyRow(title: "ICCID", value: iccid)
            } else {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("eSIM Access выпускает профиль…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if let orderNo = profile.orderNo, !orderNo.isEmpty {
                copyRow(title: "Order", value: orderNo)
            }

            if profile.isAssigned, let bookingID = profile.assignedBookingID {
                Label("Назначена бронированию \(bookingID)", systemImage: "checkmark.seal.fill")
                    .font(.caption.weight(.semibold))
            } else {
                HStack(spacing: 9) {
                    if profile.isProvisioned {
                        Button(action: onAssign) {
                            Label("Назначить поездке", systemImage: "person.crop.circle.badge.checkmark")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(BusinessDesign.primaryControl)
                    }
                    Button(action: onRefresh) {
                        Image(systemName: "arrow.clockwise")
                            .frame(width: 40, height: 40)
                    }
                    .buttonStyle(.plain)
                    .businessGlass(in: Circle())
                }
            }
        }
        .padding(16)
        .businessCard(radius: 24)
    }

    private func copyRow(title: String, value: String) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.caption.monospaced())
                    .lineLimit(1)
            }
            Spacer()
            Button {
                UIPasteboard.general.string = value
            } label: {
                Image(systemName: "doc.on.doc")
                    .font(.caption.weight(.semibold))
            }
            .buttonStyle(.plain)
        }
    }
}

private struct ESIMPurchaseSheet: View {
    let plan: ESIMAccessPackage
    let startingBalance: ESIMAccessBalance?
    let onChanged: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var buying = false
    @State private var refreshing = false
    @State private var errorMessage: String?
    @State private var result: ESIMAccessInventoryProfile?
    @State private var currentBalance: ESIMAccessBalance?
    @State private var requestID = UUID().uuidString
    @State private var assignmentTarget: ESIMAccessInventoryProfile?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    if let result {
                        purchasedContent(result)
                    } else {
                        confirmationContent
                    }
                }
                .padding(18)
                .padding(.bottom, 20)
            }
            .background(BusinessDesign.background.ignoresSafeArea())
            .navigationTitle(result == nil ? "Подтверждение" : "eSIM куплена")
            .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }.foregroundStyle(BusinessDesign.headerInk)
                }
            }
        }
        .presentationDetents([.large])
        .onAppear { currentBalance = startingBalance }
        .sheet(item: $assignmentTarget) { profile in
            NavigationStack {
                ESIMAssignmentSheet(profile: profile) {
                    onChanged()
                    dismiss()
                }
            }
        }
        .alert("Не удалось купить eSIM", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var confirmationContent: some View {
        VStack(spacing: 18) {
            VStack(spacing: 10) {
                Image(systemName: "simcard.fill")
                    .font(.system(size: 30, weight: .semibold))
                    .frame(width: 68, height: 68)
                    .businessGlass(in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                Text(plan.name)
                    .font(.title2.bold())
                    .multilineTextAlignment(.center)
                Text("\(plan.dataLabel) · \(plan.durationLabel)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(20)
            .businessCard(radius: 28)

            VStack(spacing: 13) {
                moneyRow("Стоимость", amount: plan.priceUSD)
                if let currentBalance {
                    moneyRow("Баланс до покупки", amount: currentBalance.amountUSD)
                    Divider()
                    moneyRow("После покупки", amount: max(0, currentBalance.amountUSD - plan.priceUSD), emphasized: true)
                }
            }
            .padding(18)
            .businessCard(radius: 24)

            Label("Деньги будут списаны с предоплаченного баланса eSIM Access. Карта Visa не передаётся в приложение и не отправляется через iumrah API.", systemImage: "lock.shield.fill")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(15)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))

            Button {
                Task { await buy() }
            } label: {
                if buying {
                    ProgressView().tint(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                } else {
                    Text("Купить eSIM · \(plan.priceUSD, format: .currency(code: plan.currencyCode))")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(BusinessDesign.primaryControl)
            .disabled(buying)
        }
    }

    @ViewBuilder private func purchasedContent(_ profile: ESIMAccessInventoryProfile) -> some View {
        VStack(spacing: 18) {
            VStack(spacing: 10) {
                Image(systemName: profile.isProvisioned ? "checkmark.circle.fill" : "clock.badge.checkmark.fill")
                    .font(.system(size: 44, weight: .semibold))
                Text(profile.isProvisioned ? "eSIM готова" : "Заказ принят")
                    .font(.title2.bold())
                Text(profile.isProvisioned ? "Профиль получен от eSIM Access. Теперь Вы решаете, какой поездке его передать." : "eSIM Access ещё выпускает профиль. Обычно это занимает несколько секунд.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(20)
            .frame(maxWidth: .infinity)
            .businessCard(radius: 28)

            if let qr = profile.qrCodeURL, let url = URL(string: qr) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().interpolation(.none).scaledToFit()
                    case .failure:
                        Image(systemName: "qrcode").font(.system(size: 80))
                    default:
                        ProgressView()
                    }
                }
                .frame(width: 190, height: 190)
                .padding(14)
                .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(BusinessDesign.line))
            }

            VStack(spacing: 0) {
                detailRow("Тариф", value: profile.packageName)
                detailRow("Order", value: profile.orderNo ?? "—")
                detailRow("ICCID", value: profile.iccid ?? "Ожидаем…")
                if let smdp = profile.smdpAddress, !smdp.isEmpty { detailRow("SM-DP+", value: smdp) }
                if let code = profile.activationCode, !code.isEmpty { detailRow("Activation Code", value: code) }
            }
            .padding(.horizontal, 16)
            .businessCard(radius: 24)

            if profile.isProvisioned {
                Button {
                    assignmentTarget = profile
                } label: {
                    Label("Назначить поездке", systemImage: "person.crop.circle.badge.checkmark")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                }
                .buttonStyle(.borderedProminent)
                .tint(BusinessDesign.primaryControl)
            } else {
                Button {
                    Task { await refreshProfile(profile) }
                } label: {
                    if refreshing { ProgressView().frame(maxWidth: .infinity).frame(height: 48) }
                    else { Label("Получить данные eSIM", systemImage: "arrow.clockwise").frame(maxWidth: .infinity).frame(height: 48) }
                }
                .buttonStyle(.plain)
                .businessGlass(in: Capsule())
                .disabled(refreshing)
            }
        }
    }

    private func moneyRow(_ title: String, amount: Double, emphasized: Bool = false) -> some View {
        HStack {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            Text(amount, format: .currency(code: plan.currencyCode))
                .fontWeight(emphasized ? .bold : .semibold)
        }
        .font(.subheadline)
    }

    private func detailRow(_ title: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 92, alignment: .leading)
            Text(value)
                .font(.caption.monospaced())
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            Button { UIPasteboard.general.string = value } label: {
                Image(systemName: "doc.on.doc")
                    .font(.caption)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 12)
    }

    @MainActor private func buy() async {
        buying = true
        defer { buying = false }
        errorMessage = nil
        do {
            let response = try await APIClient.shared.purchaseESIMAccess(packageCode: plan.packageCode, clientRequestID: requestID, expectedPriceRaw: plan.priceRaw)
            result = response.profile
            currentBalance = response.balance ?? currentBalance
            onChanged()
            if !response.profile.isProvisioned {
                await autoPoll(response.profile)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor private func autoPoll(_ initial: ESIMAccessInventoryProfile) async {
        var current = initial
        for _ in 0..<5 where !current.isProvisioned {
            try? await Task.sleep(for: .seconds(2))
            do {
                current = try await APIClient.shared.refreshESIMAccessInventory(id: current.id)
                result = current
                if current.isProvisioned { onChanged(); break }
            } catch {
                // The inventory row is already safe. Manual refresh remains available.
            }
        }
    }

    @MainActor private func refreshProfile(_ profile: ESIMAccessInventoryProfile) async {
        refreshing = true
        defer { refreshing = false }
        do {
            let updated = try await APIClient.shared.refreshESIMAccessInventory(id: profile.id)
            result = updated
            onChanged()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct ESIMAssignmentSheet: View {
    let profile: ESIMAccessInventoryProfile
    let onAssigned: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var bookings: [BookingSummary] = []
    @State private var selectedBookingID: String?
    @State private var travelerPosition = 1
    @State private var loading = true
    @State private var assigning = false
    @State private var errorMessage: String?
    @State private var search = ""

    private var selectedBooking: BookingSummary? {
        bookings.first { $0.id == selectedBookingID }
    }

    private var filteredBookings: [BookingSummary] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let base = bookings.filter { $0.status != .cancelled }
        guard !query.isEmpty else { return base }
        return base.filter { booking in
            [booking.id, booking.bookingDisplayNumber ?? "", booking.clientName ?? "", booking.pilgrimID ?? ""]
                .joined(separator: " ")
                .lowercased()
                .contains(query)
        }
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 5) {
                    Text(profile.packageName).font(.headline)
                    Text(profile.iccid ?? "").font(.caption.monospaced()).foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            } header: {
                Text("Купленная eSIM")
            }

            Section("Бронирование") {
                ForEach(filteredBookings) { booking in
                    Button {
                        selectedBookingID = booking.id
                        travelerPosition = min(max(1, travelerPosition), max(1, booking.travelerCount))
                    } label: {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(((booking.clientName ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : booking.clientName) ?? booking.bookingDisplayNumber ?? booking.id)
                                    .font(.body.weight(.semibold))
                                Text("#\(booking.bookingDisplayNumber ?? booking.id) · \(booking.travelerCount) паломник(а)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if selectedBookingID == booking.id {
                                Image(systemName: "checkmark.circle.fill")
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                }
            }

            if let booking = selectedBooking, booking.travelerCount > 1 {
                Section("Кому выдать") {
                    Picker("Паломник", selection: $travelerPosition) {
                        ForEach(1...booking.travelerCount, id: \.self) { position in
                            Text("Паломник №\(position)").tag(position)
                        }
                    }
                }
            }

            Section {
                Button {
                    Task { await assign() }
                } label: {
                    if assigning {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Label("Передать eSIM в поездку", systemImage: "checkmark.shield.fill")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                    }
                }
                .disabled(selectedBookingID == nil || assigning)
            } footer: {
                Text("Только после этого профиль будет связан с бронированием. Данные активации и остаток трафика затем можно безопасно отдать клиентскому приложению.")
            }
        }
        .navigationTitle("Назначить eSIM")
        .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
        .searchable(text: $search, prompt: "Бронь или паломник")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() }.foregroundStyle(BusinessDesign.headerInk) }
        }
        .task { await loadBookings() }
        .alert("Не удалось назначить eSIM", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    @MainActor private func loadBookings() async {
        loading = true
        defer { loading = false }
        do { bookings = try await APIClient.shared.bookings() }
        catch { errorMessage = error.localizedDescription }
    }

    @MainActor private func assign() async {
        guard let bookingID = selectedBookingID else { return }
        assigning = true
        defer { assigning = false }
        do {
            let travelerCount = selectedBooking?.travelerCount ?? 1
            _ = try await APIClient.shared.assignESIMAccessInventory(id: profile.id, bookingID: bookingID, travelerPosition: travelerCount > 1 ? travelerPosition : 1)
            onAssigned()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
