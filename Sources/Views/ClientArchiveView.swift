import SwiftUI

struct ClientArchiveView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.businessAdaptiveLayout) private var layout
    @Environment(\.businessUsesPersistentSidebar) private var usesPersistentSidebar

    @State private var pilgrims: [PilgrimSummary] = []
    @State private var search = ""
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var selectedPilgrim: PilgrimSummary?
    @State private var loadGeneration = UUID()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if layout.supportsTwoPaneWorkspace {
                desktopWorkspace
            } else {
                compactList
            }
        }
        .background(BusinessDesign.background)
        .navigationTitle("Архив клиентов")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $search, prompt: "Имя, телефон или ID")
        .toolbar {
            if !usesPersistentSidebar {
                ToolbarItem(placement: .topBarLeading) { Button("Закрыть") { dismiss() } }
            }
        }
        .overlay { if loading { ProgressView() } }
        .task { await load() }
        .refreshable { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .iumrahBusinessBookingChanged)) { _ in
            Task { await load() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await load() } }
        }
        .onChange(of: search) { _, _ in
            guard layout.supportsTwoPaneWorkspace else { return }
            if let selectedPilgrim, !filtered.contains(where: { $0.id == selectedPilgrim.id }) {
                self.selectedPilgrim = filtered.first
            }
        }
    }

    private var compactList: some View {
        List {
            listContent(navigates: true)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private var desktopWorkspace: some View {
        HStack(spacing: 0) {
            List {
                listContent(navigates: false)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .frame(width: layout.listPaneWidth)

            Divider()

            Group {
                if let selectedPilgrim {
                    PilgrimDetailView(pilgrimID: selectedPilgrim.id)
                        .id(selectedPilgrim.id)
                } else {
                    ContentUnavailableView(
                        "Выберите клиента",
                        systemImage: "person.text.rectangle",
                        description: Text("История поездок и контакты откроются справа.")
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private func listContent(navigates: Bool) -> some View {
        if let errorMessage { Text(errorMessage).foregroundStyle(.red) }

        ForEach(filtered) { pilgrim in
            if navigates {
                NavigationLink { PilgrimDetailView(pilgrimID: pilgrim.id) } label: {
                    pilgrimRow(pilgrim)
                }
            } else {
                Button { selectedPilgrim = pilgrim } label: {
                    pilgrimRow(pilgrim)
                }
                .buttonStyle(.plain)
                .listRowBackground(
                    selectedPilgrim?.id == pilgrim.id
                        ? BusinessDesign.secondarySurface.opacity(0.72)
                        : Color.clear
                )
            }
        }
    }

    private func pilgrimRow(_ pilgrim: PilgrimSummary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(pilgrim.displayName).font(.headline)
                Spacer()
                Text(pilgrim.id).font(.caption2.monospaced()).foregroundStyle(.secondary)
            }
            HStack(spacing: 10) {
                Label("\(pilgrim.completedTrips ?? 0) завершено", systemImage: "checkmark.circle")
                if !pilgrim.phone.isEmpty { Label(pilgrim.phone, systemImage: "phone") }
            }
            .font(.caption).foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
        .padding(.vertical, 5)
    }

    private var filtered: [PilgrimSummary] {
        guard !search.isEmpty else { return pilgrims }
        let q = search.lowercased()
        return pilgrims.filter {
            $0.displayName.lowercased().contains(q)
            || $0.phone.lowercased().contains(q)
            || $0.email.lowercased().contains(q)
            || $0.id.lowercased().contains(q)
        }
    }

    @MainActor private func load() async {
        let generation = UUID()
        loadGeneration = generation
        if pilgrims.isEmpty { loading = true }
        defer { if loadGeneration == generation { loading = false } }
        do {
            let incoming = try await APIClient.shared.pilgrims(archiveOnly: true)
            guard !Task.isCancelled, loadGeneration == generation else { return }
            pilgrims = incoming
            errorMessage = nil
            if layout.supportsTwoPaneWorkspace {
                if let selectedPilgrim,
                   let refreshed = pilgrims.first(where: { $0.id == selectedPilgrim.id }) {
                    self.selectedPilgrim = refreshed
                } else {
                    selectedPilgrim = filtered.first
                }
            }
        } catch {
            guard !Task.isCancelled, loadGeneration == generation else { return }
            errorMessage = error.localizedDescription
        }
    }
}

private struct PilgrimDetailView: View {
    let pilgrimID: String
    @State private var detail: PilgrimDetailResponse?
    @State private var loading = true

    var body: some View {
        ScrollView {
            if let detail {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(detail.pilgrim.displayName).font(.largeTitle.bold())
                        Text(detail.pilgrim.id).font(.subheadline.monospaced()).foregroundStyle(.secondary)
                        if !detail.pilgrim.phone.isEmpty { Label(detail.pilgrim.phone, systemImage: "phone") }
                        if !detail.pilgrim.email.isEmpty { Label(detail.pilgrim.email, systemImage: "envelope") }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(18)
                    .businessCard(radius: 28)

                    Text("Поездки").font(.title2.bold())
                    ForEach(Array(detail.trips.enumerated()), id: \.element.tripID) { index, trip in
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Text("Поездка \(detail.trips.count - index)").font(.headline)
                                Spacer()
                                Text(trip.tripStatus.title).font(.caption.bold())
                            }
                            Text([trip.startDate, trip.endDate].compactMap { $0 }.joined(separator: " – "))
                                .font(.caption).foregroundStyle(.secondary)
                            if !trip.confirmationNumber.isEmpty {
                                Text("Подтверждение: \(trip.confirmationNumber)").font(.caption)
                            }
                        }
                        .padding(14)
                        .businessCard(radius: 22)
                    }
                }
                .businessAdaptiveDetailWidth()
                .padding(18)
            } else if loading {
                ProgressView().padding(.top, 60)
            }
        }
        .background(BusinessDesign.background)
        .navigationTitle(detail?.pilgrim.displayName ?? "Клиент")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            detail = try? await APIClient.shared.pilgrimDetail(id: pilgrimID)
            loading = false
        }
    }
}
