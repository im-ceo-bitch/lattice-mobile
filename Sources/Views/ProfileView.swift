import SwiftUI
import UIKit
import PhotosUI

struct ProfileView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.businessUsesPersistentSidebar) private var usesPersistentSidebar
    @State private var member: BusinessTeamMember?
    @State private var pendingPhotoData: Data?
    @State private var loading = true
    @State private var saving = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let member {
                TeamMemberForm(member: binding(for: member), pendingPhotoData: $pendingPhotoData, ownerMode: true)
            } else if loading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView("Профиль недоступен", systemImage: "person.crop.circle.badge.exclamationmark", description: Text(errorMessage ?? "Попробуйте обновить."))
            }
        }
        .background(BusinessDesign.background)
        .navigationTitle("Мой профиль")
        .navigationBarTitleDisplayMode(.inline)
        .businessNavigationSurface()
        .toolbar {
            if !usesPersistentSidebar {
                ToolbarItem(placement: .topBarLeading) { Button("Закрыть") { dismiss() }.foregroundStyle(BusinessDesign.headerInk) }
            }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { BusinessNotificationSoundView() } label: { Image(systemName: "speaker.wave.2") }
                    .accessibilityLabel("Звук уведомлений")
            }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { BusinessSecuritySettingsView() } label: {
                    Image(systemName: "lock.shield.fill")
                }
                .accessibilityLabel("Безопасность приложения")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(saving ? "Сохраняю…" : "Сохранить") { Task { await save() } }
                    .fontWeight(.semibold)
                    .disabled(member == nil || saving)
            }
        }
        .task { await load() }
    }

    private func binding(for value: BusinessTeamMember) -> Binding<BusinessTeamMember> {
        Binding(get: { member ?? value }, set: { member = $0 })
    }

    @MainActor private func load() async {
        do { member = try await APIClient.shared.businessProfile(); errorMessage = nil }
        catch { errorMessage = error.localizedDescription }
        loading = false
    }

    @MainActor private func save() async {
        guard let member else { return }
        saving = true
        do {
            var saved = try await APIClient.shared.saveBusinessProfile(member)
            if let pendingPhotoData {
                saved = try await APIClient.shared.uploadBusinessTeamPhoto(memberID: saved.id, imageData: pendingPhotoData)
                self.pendingPhotoData = nil
            }
            self.member = saved
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
        saving = false
    }
}

struct TeamMemberForm: View {
    @Environment(\.businessAdaptiveLayout) private var layout
    @Binding var member: BusinessTeamMember
    @Binding var pendingPhotoData: Data?
    var ownerMode = false
    @State private var selectedPhoto: PhotosPickerItem?

    var body: some View {
        ScrollView {
            Group {
                if layout.supportsDenseDashboard {
                    HStack(alignment: .top, spacing: 16) {
                        identityCard
                            .frame(maxWidth: .infinity, alignment: .top)
                        VStack(spacing: 16) {
                            contactsCard
                            publicCard
                        }
                        .frame(maxWidth: .infinity, alignment: .top)
                    }
                } else {
                    VStack(spacing: 16) {
                        identityCard
                        contactsCard
                        publicCard
                    }
                }
            }
            .businessAdaptiveFormWidth()
            .padding(18)
        }
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: selectedPhoto) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    await MainActor.run { pendingPhotoData = data }
                }
            }
        }
    }

    private var identityCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionTitle("Основное", icon: "person.text.rectangle")
            photoEditor
            field("Имя", text: $member.firstName)
            field("Фамилия", text: $member.lastName)
            if !ownerMode {
                Picker("Роль", selection: $member.roleKind) {
                    Text("Гид").tag("guide")
                    Text("Менеджер").tag("manager")
                    Text("Операции").tag("operations")
                }
                .pickerStyle(.segmented)
            }
            field("Должность", text: $member.roleTitle)
            if !ownerMode && member.roleKind == "guide" {
                Stepper("Стаж: " + (member.experienceYears.map { "\($0) лет" } ?? "не указан"), value: Binding(get: { member.experienceYears ?? 0 }, set: { member.experienceYears = $0 == 0 ? nil : $0 }), in: 0...80)
                field("Языки (через запятую)", text: Binding(get: { (member.languages ?? []).joined(separator: ", ") }, set: { member.languages = $0.components(separatedBy: ",") }))
                field("Видео-знакомство (HTTPS MP4/HLS)", text: Binding(get: { member.introVideoURL ?? "" }, set: { member.introVideoURL = $0.isEmpty ? nil : $0 }))
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                Text("Публикуются только заполненные поля. Используйте реальное видео гида и его согласие на публикацию.").font(.caption).foregroundStyle(.secondary)
            }
            if !ownerMode && member.roleKind == "guide" {
                Toggle("Главный гид", isOn: Binding(get: { member.isHeadGuide ?? false }, set: { member.isHeadGuide = $0 }))
                Picker("Доступность", selection: Binding(get: { member.guideAvailability ?? "available" }, set: { member.guideAvailability = $0 })) {
                    Text("Доступен для заявок").tag("available")
                    Text("Занят").tag("busy")
                    Text("Временно недоступен").tag("unavailable")
                }
            }
            VStack(alignment: .leading, spacing: 10) {
                sectionTitle("Описание сотрудника · 3 языка", icon: "text.bubble")
                if !member.bio.isEmpty {
                    Text("Исходное описание сохранено. Скопируйте его в нужное языковое поле и добавьте переводы.").font(.caption).foregroundStyle(.secondary)
                    descriptionField("Исходное описание", text: $member.bio)
                }
                descriptionField("Русский · RU", text: Binding(get: { member.bioRU ?? "" }, set: { member.bioRU = $0 }))
                descriptionField("O‘zbekcha · UZ (lotin)", text: Binding(get: { member.bioUZ ?? "" }, set: { member.bioUZ = $0 }))
                descriptionField("Ўзбекча · UZ (кирилл)", text: Binding(get: { member.bioUZCyrl ?? "" }, set: { member.bioUZCyrl = $0 }))
                if ownerMode {
                    Button("Вставить черновик основателя в пустые поля") {
                        if (member.bioRU ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { member.bioRU = "Я создал iumrah, чтобы каждая семья могла самостоятельно организовать индивидуальную умру, получая персональное сопровождение. Вместе с нашей командой я помогаю сделать путешествие понятным и прозрачным, чтобы вы могли уделить больше времени поклонению и своим близким. Через iumrah Care вы можете обратиться за консультацией и задать вопросы." }
                        if (member.bioUZ ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { member.bioUZ = "Men iumrah platformasini har bir oila shaxsiy hamrohlik bilan individual umrasini mustaqil tashkil eta olishi uchun yaratdim. Jamoamiz bilan safaringizni tushunarli va shaffof qilishga yordam beramiz, toki ibodat va yaqinlaringizga ko‘proq vaqt ajrata olishingiz mumkin bo‘lsin. Maslahat va savollar uchun iumrah Care orqali murojaat qilishingiz mumkin." }
                        if (member.bioUZCyrl ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { member.bioUZCyrl = "Мен iumrah платформасини ҳар бир оила шахсий ҳамроҳлик билан индивидуал умрасини мустақил ташкил эта олиши учун яратдим. Жамоамиз билан сафарингизни тушунарли ва шаффоф қилишга ёрдам берамиз, токи ибодат ва яқинларингизга кўпроқ вақт ажрата олишингиз мумкин бўлсин. Маслаҳат ва саволлар учун iumrah Care орқали мурожаат қилишингиз мумкин." }
                    }.font(.subheadline.weight(.semibold))
                }
                Text("До заполнения перевода клиент видит исходное описание. Каждый перевод сохраняется отдельно.").font(.caption).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 8) {
                sectionTitle("Публичные роли", icon: "person.2")
                Text("Роли на витрине команды не изменяют системные права доступа.").font(.caption).foregroundStyle(.secondary)
                ForEach(["founder", "admin", "guide", "support", "manager", "transfer", "operations"], id: \.self) { role in
                    if role != "founder" || ownerMode {
                        Toggle(publicRoleTitle(role), isOn: Binding(get: { currentRoles.contains(role) }, set: { enabled in
                            var roles = currentRoles
                            if enabled { if !roles.contains(role) { roles.append(role) } } else { roles.removeAll { $0 == role } }
                            member.publicRoles = roles
                        })).disabled(ownerMode && role == "founder")
                    }
                }
            }
        }
        .padding(17).businessCard(radius: 26)
    }

    private var currentRoles: [String] { member.publicRoles ?? (ownerMode ? ["founder", "admin"] : [member.roleKind]) }
    private func publicRoleTitle(_ role: String) -> String {
        switch role { case "founder": return "Основатель"; case "admin": return "Администратор"; case "guide": return "Гид"; case "support": return "Поддержка"; case "manager": return "Менеджер путешествий"; case "transfer": return "Координатор трансфера"; default: return "Операции" }
    }
    private func descriptionField(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack { Text(title).font(.subheadline.weight(.semibold)); Spacer(); Text("\(text.wrappedValue.count)/1800").font(.caption2).foregroundStyle(.secondary) }
            TextField("Описание", text: text, axis: .vertical)
                .lineLimit(4...10).padding(12)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16))
                .onChange(of: text.wrappedValue) { _, value in if value.count > 1800 { text.wrappedValue = String(value.prefix(1800)) } }
        }
    }

    private var photoEditor: some View {
        HStack(spacing: 14) {
            avatar
                .frame(width: 76, height: 76)
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 8) {
                Text("Фотография сотрудника").font(.subheadline.weight(.semibold))
                PhotosPicker(selection: $selectedPhoto, matching: .images) {
                    Label(pendingPhotoData == nil && member.photoURL == nil ? "Добавить фото" : "Изменить фото", systemImage: "photo")
                        .font(.subheadline.weight(.semibold))
                }
                if pendingPhotoData != nil {
                    Text("Фото загрузится после сохранения.").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
    }

    @ViewBuilder private var avatar: some View {
        if let pendingPhotoData, let image = UIImage(data: pendingPhotoData) {
            Image(uiImage: image).resizable().scaledToFill()
        } else if let path = member.photoURL, !path.isEmpty {
            BusinessPrivateImage(path: path) {
                avatarPlaceholder
            }
        } else {
            avatarPlaceholder
        }
    }

    private var avatarPlaceholder: some View {
        ZStack {
            Circle().fill(BusinessDesign.secondarySurface)
            Image(systemName: "person.crop.circle.fill").font(.system(size: 38)).foregroundStyle(.secondary)
        }
    }

    private var contactsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionTitle("Контакты", icon: "phone")
            field("Телефон · Узбекистан", text: $member.phoneUZ, keyboard: .phonePad)
            field("Телефон · Саудовская Аравия", text: $member.phoneSA, keyboard: .phonePad)
            field("Telegram", text: $member.telegram)
            field("WhatsApp", text: $member.whatsapp)
            field("Instagram", text: $member.instagram)
        }
        .padding(17).businessCard(radius: 26)
    }

    private var publicCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionTitle("Публичный профиль", icon: "globe")
            field("Slug", text: $member.publicSlug)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Toggle("Показывать в клиентском iumrah", isOn: $member.publicVisible)
            if !ownerMode { Toggle("Активный сотрудник", isOn: $member.active) }
            Text("Публичный профиль доступен клиентскому приложению через iumrah Cloud API.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(17).businessCard(radius: 26)
    }

    private func field(_ title: String, text: Binding<String>, keyboard: UIKeyboardType = .default) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            TextField(title, text: text)
                .keyboardType(keyboard)
                .padding(.horizontal, 12)
                .frame(height: 46)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        }
    }

    private func sectionTitle(_ title: String, icon: String) -> some View {
        Label(title, systemImage: icon).font(.title3.bold())
    }
}
