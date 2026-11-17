import SwiftUI

@MainActor
final class HotelBatchImportItem: ObservableObject, Identifiable {
    enum State: Equatable {
        case waiting
        case importing
        case ready
        case failed(String)
    }

    let id = UUID()
    let sourceURL: String
    let coordinator = HotelImportCoordinator()
    @Published var state: State = .waiting

    init(sourceURL: String) {
        self.sourceURL = sourceURL
    }
}

@MainActor
final class HotelBatchImportQueue: ObservableObject {
    @Published var items: [HotelBatchImportItem]
    @Published var activeIndex: Int?

    init(urls: [String]) {
        items = urls.prefix(4).map { HotelBatchImportItem(sourceURL: $0) }
    }

    var activeItem: HotelBatchImportItem? {
        guard let activeIndex, items.indices.contains(activeIndex) else { return nil }
        return items[activeIndex]
    }

    func start() {
        guard activeIndex == nil else { return }
        startItem(at: 0)
    }

    private func startItem(at index: Int) {
        guard items.indices.contains(index) else {
            activeIndex = nil
            return
        }

        let item = items[index]
        activeIndex = index
        item.state = .importing
        item.coordinator.onCompleted = { [weak self, weak item] _ in
            guard let self, let item else { return }
            item.state = .ready
            item.coordinator.onCompleted = nil
            item.coordinator.onFailed = nil
            self.startItem(at: index + 1)
        }
        item.coordinator.onFailed = { [weak self, weak item] message in
            guard let self, let item else { return }
            item.state = .failed(message)
            item.coordinator.onCompleted = nil
            item.coordinator.onFailed = nil
            self.startItem(at: index + 1)
        }
        item.coordinator.start(sourceURL: item.sourceURL)
    }
}

struct HotelBatchImportView: View {
    @StateObject private var queue: HotelBatchImportQueue
    @Environment(\.dismiss) private var dismiss

    init(sourceURLs: [String]) {
        _queue = StateObject(wrappedValue: HotelBatchImportQueue(urls: sourceURLs))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                BusinessDesign.background.ignoresSafeArea()

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        VStack(alignment: .leading, spacing: 7) {
                            Text("Hotel Importer")
                                .font(.system(size: 34, weight: .bold, design: .rounded))
                                .tracking(-1.2)
                            Text("Карточки читаются строго по очереди. Готовый отель можно спокойно проверять, пока следующий уже загружается.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.bottom, 4)

                        ForEach(Array(queue.items.enumerated()), id: \.element.id) { index, item in
                            HotelBatchImportCard(number: index + 1, item: item)
                        }
                    }
                    .padding(.vertical, 16)
                }
                .contentMargins(.horizontal, 18, for: .scrollContent)
                .scrollIndicators(.hidden)

                if let item = queue.activeItem {
                    ImportWebView(webView: item.coordinator.webView)
                        .opacity(item.coordinator.showSource ? 1 : 0.001)
                        .allowsHitTesting(item.coordinator.showSource)
                        .ignoresSafeArea(edges: .bottom)

                    if item.coordinator.showSource {
                        VStack {
                            Spacer()
                            HStack(spacing: 12) {
                                Button {
                                    item.coordinator.reloadSource()
                                } label: {
                                    Image(systemName: "arrow.clockwise")
                                        .font(.headline)
                                        .frame(width: 50, height: 50)
                                        .background(.ultraThinMaterial, in: Circle())
                                }
                                .buttonStyle(.plain)

                                Button("Проверка пройдена — продолжить") {
                                    item.coordinator.continueAfterVerification()
                                }
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                                .frame(height: 50)
                                .background(BusinessDesign.primaryControl, in: Capsule())
                                .foregroundStyle(BusinessDesign.onPrimaryControl)
                            }
                            .padding(16)
                            .background(.ultraThinMaterial)
                        }
                    }
                }
            }
            .navigationTitle(queue.activeItem?.coordinator.showSource == true ? (queue.activeItem?.coordinator.currentProvider?.rawValue ?? "Источник") : "Импорт отелей")
            .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }.foregroundStyle(BusinessDesign.headerInk)
                }
            }
            .onAppear { queue.start() }
        }
    }
}

private struct HotelBatchImportCard: View {
    let number: Int
    @ObservedObject var item: HotelBatchImportItem
    @ObservedObject private var coordinator: HotelImportCoordinator

    init(number: Int, item: HotelBatchImportItem) {
        self.number = number
        self.item = item
        _coordinator = ObservedObject(wrappedValue: item.coordinator)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 10) {
                Text(String(format: "%02d", number))
                    .font(.caption.monospacedDigit().bold())
                    .foregroundStyle(.secondary)
                Text(providerLabel)
                    .font(.caption.bold())
                Spacer()
                stateBadge
            }

            if let draft = coordinator.draft {
                HStack(alignment: .top, spacing: 13) {
                    cover(draft)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(draft.name)
                            .font(.headline)
                            .fixedSize(horizontal: false, vertical: true)
                        Text([draft.city, draft.stars.map { "\($0)★" }, draft.rating.map { $0.formatted(.number.precision(.fractionLength(1))) }].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("\(draft.selectedImages.count) фото · \(draft.rooms.count) номеров · \(draft.nearby.count) мест рядом")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }

                NavigationLink {
                    HotelReviewView(coordinator: coordinator)
                } label: {
                    Text("Проверить все данные и добавить")
                        .font(.subheadline.bold())
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(BusinessDesign.primaryControl)
            } else {
                VStack(alignment: .leading, spacing: 9) {
                    Text(coordinator.status)
                        .font(.subheadline.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    if case .importing = item.state {
                        ProgressView(value: coordinator.progress)
                            .tint(BusinessDesign.ink)
                    }
                    if let failure = coordinator.failureMessage {
                        Text(failure)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

            Text(item.sourceURL)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .lineLimit(2)
        }
        .padding(15)
        .businessCard(radius: 26)
    }

    private var providerLabel: String {
        coordinator.currentProvider?.rawValue ?? "Ожидает"
    }

    @ViewBuilder private var stateBadge: some View {
        switch item.state {
        case .waiting:
            Label("Очередь", systemImage: "clock")
                .foregroundStyle(.secondary)
        case .importing:
            Label("Читаем", systemImage: "arrow.down.circle")
                .foregroundStyle(.primary)
        case .ready:
            Label("Готово", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .failed:
            Label("Не добавлен", systemImage: "exclamationmark.circle.fill")
                .foregroundStyle(.orange)
        }
    }

    @ViewBuilder private func cover(_ draft: HotelDraft) -> some View {
        if let candidate = draft.images.first(where: { $0.isCover && $0.selected }), let url = URL(string: candidate.url) {
            AsyncImage(url: url) { phase in
                if let image = phase.image { image.resizable().scaledToFill() }
                else { BusinessDesign.secondarySurface.overlay(ProgressView()) }
            }
            .frame(width: 92, height: 92)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        } else {
            BusinessDesign.secondarySurface
                .overlay(Image(systemName: "building.2").foregroundStyle(.secondary))
                .frame(width: 92, height: 92)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
    }
}
