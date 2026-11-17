import SwiftUI

struct EmployeesView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.businessUsesPersistentSidebar) private var usesPersistentSidebar
    @State private var members: [BusinessTeamMember] = []
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var showAdd = false

    var body: some View {
        List {
            if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            ForEach(members) { member in
                NavigationLink {
                    TeamMemberEditorView(member: member) { updated in
                        if let index = members.firstIndex(where: { $0.id == updated.id }) { members[index] = updated }
                    }
                } label: {
                    HStack(spacing: 13) {
                        employeeAvatar(member)
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                Text(member.displayName).font(.headline)
                                if showsVerifiedBadge(member) {
                                    Image(systemName: "checkmark.seal.fill")
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(Color.blue)
                                        .accessibilityLabel("Подтверждённый профиль")
                                }
                            }
                            Text(employeeRoleLine(member))
                                .font(.caption).foregroundStyle(.secondary)
                            if !member.instagram.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                Text("@" + member.instagram.trimmingCharacters(in: CharacterSet(charactersIn: " @")))
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(Color.blue)
                            }
                            HStack(spacing: 6) {
                                Circle().fill(member.active ? Color.green : Color.gray).frame(width: 7, height: 7)
                                Text(member.publicVisible ? "Публичный" : "Скрытый")
                            }
                            .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .swipeActions {
                    if !member.isOwner {
                        Button(role: .destructive) { Task { await delete(member) } } label: { Label("Удалить", systemImage: "trash") }
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(BusinessDesign.background)
        .navigationTitle("Сотрудники")
        .navigationBarTitleDisplayMode(.inline)
        .businessNavigationSurface()
        .toolbar {
            if !usesPersistentSidebar {
                ToolbarItem(placement: .topBarLeading) { Button("Закрыть") { dismiss() }.foregroundStyle(BusinessDesign.headerInk) }
            }
            ToolbarItem(placement: .topBarTrailing) { Button { showAdd = true } label: { Image(systemName: "plus") }.foregroundStyle(BusinessDesign.headerInk) }
        }
        .sheet(isPresented: $showAdd) {
            NavigationStack {
                TeamMemberEditorView(member: .emptyGuide, creating: true) { created in
                    members.append(created)
                    showAdd = false
                }
            }
        }
        .overlay { if loading { ProgressView() } }
        .task { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder private func employeeAvatar(_ member: BusinessTeamMember) -> some View {
        if let path = member.photoURL, !path.isEmpty {
            BusinessPrivateImage(path: path) {
                avatarPlaceholder(member)
            }
            .frame(width: 50, height: 50)
            .clipped()
            .clipShape(Circle())
        } else {
            avatarPlaceholder(member).frame(width: 50, height: 50).clipShape(Circle())
        }
    }

    private func avatarPlaceholder(_ member: BusinessTeamMember) -> some View {
        Circle()
            .fill(BusinessDesign.secondarySurface)
            .overlay(Text(initials(member)).font(.headline))
    }

    @MainActor private func load() async {
        loading = true
        do { members = try await APIClient.shared.businessTeam(); errorMessage = nil }
        catch { errorMessage = error.localizedDescription }
        loading = false
    }

    @MainActor private func delete(_ member: BusinessTeamMember) async {
        do { try await APIClient.shared.deleteBusinessTeamMember(id: member.id); members.removeAll { $0.id == member.id } }
        catch { errorMessage = error.localizedDescription }
    }

    private func initials(_ member: BusinessTeamMember) -> String {
        let value = [member.firstName, member.lastName].filter { !$0.isEmpty }.prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
        return value.isEmpty ? "i" : value
    }

    private func showsVerifiedBadge(_ member: BusinessTeamMember) -> Bool {
        member.isOwner || member.roleKind.lowercased() == "guide"
    }

    private func employeeRoleLine(_ member: BusinessTeamMember) -> String {
        if member.isOwner { return "Founder · iumrah" }
        if member.roleKind.lowercased() == "guide" { return "Главный гид iumrah · стаж 4 года" }
        return member.roleTitle.isEmpty ? roleTitle(member.roleKind) : member.roleTitle
    }

    private func roleTitle(_ value: String) -> String {
        switch value { case "owner": return "Владелец"; case "manager": return "Менеджер"; case "operations": return "Операции"; default: return "Гид" }
    }
}

struct TeamMemberEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @State var member: BusinessTeamMember
    var creating = false
    let onSaved: (BusinessTeamMember) -> Void
    @State private var pendingPhotoData: Data?
    @State private var saving = false
    @State private var errorMessage: String?

    var body: some View {
        TeamMemberForm(member: $member, pendingPhotoData: $pendingPhotoData, ownerMode: member.isOwner)
            .navigationTitle(creating ? "Новый сотрудник" : "Сотрудник")
            .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
            .toolbar {
                if creating { ToolbarItem(placement: .topBarLeading) { Button("Отмена") { dismiss() }.foregroundStyle(BusinessDesign.headerInk) } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(saving ? "Сохраняю…" : "Сохранить") { Task { await save() } }
                        .fontWeight(.semibold).disabled(saving)
                }
            }
            .alert("Не удалось сохранить", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK") { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
    }

    @MainActor private func save() async {
        saving = true
        do {
            var saved = creating ? try await APIClient.shared.createBusinessTeamMember(member) : try await APIClient.shared.updateBusinessTeamMember(member)
            if let pendingPhotoData {
                saved = try await APIClient.shared.uploadBusinessTeamPhoto(memberID: saved.id, imageData: pendingPhotoData)
                self.pendingPhotoData = nil
            }
            member = saved
            onSaved(saved)
            if creating { dismiss() }
        } catch { errorMessage = error.localizedDescription }
        saving = false
    }
}
