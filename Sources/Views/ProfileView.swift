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
        .toolbar {
            if !usesPersistentSidebar {
                ToolbarItem(placement: .topBarLeading) { Button("Закрыть") { dismiss() } }
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
            VStack(alignment: .leading, spacing: 7) {
                Text("Описание").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                TextField("Коротко о себе", text: $member.bio, axis: .vertical)
                    .lineLimit(4...8)
                    .padding(12)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
        .padding(17).businessCard(radius: 26)
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
