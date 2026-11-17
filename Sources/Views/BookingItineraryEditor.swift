import Foundation
import SwiftUI

struct BusinessBookingItineraryEditor: View {
    let bookingID: String
    let startDate: String
    let endDate: String
    var executionEnabled = false

    @State private var items: [BookingItineraryItem] = []
    @State private var selectedDay: String?
    @State private var loading = true
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var draft: ItineraryDraft?

    private var days: [String] {
        let range = Self.dayRange(from: startDate, through: endDate)
        if !range.isEmpty { return range }
        return Array(Set(items.map(\.dateLocal))).sorted()
    }

    private var effectiveDay: String? {
        if let selectedDay, days.contains(selectedDay) { return selectedDay }
        return days.first
    }

    private var selectedItems: [BookingItineraryItem] {
        guard let day = effectiveDay else { return [] }
        return items.filter { $0.dateLocal == day }.sorted { lhs, rhs in
            if lhs.sortOrder != rhs.sortOrder { return lhs.sortOrder < rhs.sortOrder }
            return lhs.createdAt < rhs.createdAt
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Расписание поездки")
                        .font(.title2.bold())
                    Text("Паломник увидит эти события по дням в iumrah.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if saving { ProgressView().controlSize(.small) }
                Button {
                    addEvent()
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 16, weight: .bold))
                        .frame(width: 40, height: 40)
                        .background(BusinessDesign.secondarySurface, in: Circle())
                }
                .buttonStyle(.plain)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 9) {
                    ForEach(days, id: \.self) { day in
                        dayChip(day)
                    }
                }
                .padding(.horizontal, 1)
            }

            if loading && items.isEmpty {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Загружаем расписание…").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 100)
            } else if selectedItems.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "calendar.badge.plus")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                    Text("На этот день событий пока нет.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button("Добавить событие") { addEvent() }
                        .font(.subheadline.bold())
                }
                .frame(maxWidth: .infinity, minHeight: 120)
            } else {
                VStack(spacing: 10) {
                    ForEach(Array(selectedItems.enumerated()), id: \.element.id) { index, item in
                        eventCard(item, index: index, total: selectedItems.count)
                    }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(18)
        .businessCard(radius: 28)
        .task(id: bookingID) { await load() }
        .sheet(item: $draft) { value in
            ItineraryEventEditorSheet(
                draft: value,
                startDate: startDate,
                endDate: endDate,
                onSave: { updated in
                    draft = nil
                    apply(updated)
                },
                onCancel: { draft = nil }
            )
        }
    }

    private func dayChip(_ day: String) -> some View {
        let selected = effectiveDay == day
        return Button {
            selectedDay = day
        } label: {
            VStack(spacing: 3) {
                Text(Self.dayNumber(day))
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .monospacedDigit()
                Text(Self.weekday(day))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(selected ? BusinessDesign.onPrimaryControl.opacity(0.76) : Color.secondary)
            }
            .foregroundStyle(selected ? BusinessDesign.onPrimaryControl : Color.primary)
            .frame(width: 58, height: 64)
            .background(selected ? BusinessDesign.primaryControl : BusinessDesign.secondarySurface)
            .clipShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func eventCard(_ item: BookingItineraryItem, index: Int, total: Int) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: item.icon.isEmpty ? "calendar" : item.icon)
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 40, height: 40)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

            Button {
                draft = ItineraryDraft(item: item)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title)
                        .font(.subheadline.bold())
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                    if let time = item.timeLocal, !time.isEmpty { Text([time, item.endTimeLocal ?? ""].filter { !$0.isEmpty }.joined(separator: " – ")).font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
                    if executionEnabled { Text(BookingServiceOperation.executionTitle(item.executionState ?? "planned")).font(.caption.weight(.medium)).foregroundStyle(.blue) }
                    if !item.subtitle.isEmpty {
                        Text(item.subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.leading)
                    }
                    if !item.location.isEmpty {
                        Label(item.location, systemImage: "mappin")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)

            VStack(spacing: 5) {
                if executionEnabled {
                    Menu {
                        ForEach(["planned","in_progress","completed","delayed","rescheduled"], id: \.self) { state in
                            Button(BookingServiceOperation.executionTitle(state)) { Task { await changeExecution(item, state: state) } }
                        }
                    } label: { Image(systemName: "checklist").frame(width: 30, height: 28) }.disabled(saving)
                }
                Button { move(item, offset: -1) } label: {
                    Image(systemName: "chevron.up")
                        .frame(width: 30, height: 28)
                }
                .buttonStyle(.plain)
                .disabled(index == 0 || saving)
                .opacity(index == 0 ? 0.25 : 1)

                Button { move(item, offset: 1) } label: {
                    Image(systemName: "chevron.down")
                        .frame(width: 30, height: 28)
                }
                .buttonStyle(.plain)
                .disabled(index == total - 1 || saving)
                .opacity(index == total - 1 ? 0.25 : 1)

                Button(role: .destructive) { delete(item) } label: {
                    Image(systemName: "trash")
                        .font(.caption)
                        .frame(width: 30, height: 28)
                }
                .buttonStyle(.plain)
                .disabled(saving)
            }
            .font(.caption.bold())
        }
        .padding(13)
        .background(BusinessDesign.secondarySurface.opacity(0.72))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func addEvent() {
        let day = effectiveDay ?? startDate
        draft = ItineraryDraft(newOn: day)
    }

    private func apply(_ value: ItineraryDraft) {
        if let originalID = value.originalID, let index = items.firstIndex(where: { $0.id == originalID }) {
            items[index].dateLocal = value.dateLocal
            items[index].title = value.title
            items[index].subtitle = value.subtitle
            items[index].location = value.location
            items[index].icon = value.icon
            items[index].notes = value.notes
            items[index].timeLocal = value.timeLocal
            items[index].endTimeLocal = value.endTimeLocal
        } else {
            let now = ISO8601DateFormatter().string(from: Date())
            items.append(BookingItineraryItem(
                id: "local-\(UUID().uuidString)",
                bookingID: bookingID,
                dateLocal: value.dateLocal,
                sortOrder: items.filter { $0.dateLocal == value.dateLocal }.count,
                title: value.title,
                subtitle: value.subtitle,
                icon: value.icon,
                location: value.location,
                notes: value.notes,
                createdAt: now,
                updatedAt: now,
                timeLocal: value.timeLocal, endTimeLocal: value.endTimeLocal
            ))
        }
        selectedDay = value.dateLocal
        normalizeSortOrders()
        Task { await persist() }
    }

    private func delete(_ item: BookingItineraryItem) {
        items.removeAll { $0.id == item.id }
        normalizeSortOrders()
        Task { await persist() }
    }

    private func move(_ item: BookingItineraryItem, offset: Int) {
        guard let day = effectiveDay else { return }
        var dayItems = items.filter { $0.dateLocal == day }.sorted { $0.sortOrder < $1.sortOrder }
        guard let currentIndex = dayItems.firstIndex(where: { $0.id == item.id }) else { return }
        let target = currentIndex + offset
        guard dayItems.indices.contains(target) else { return }
        dayItems.swapAt(currentIndex, target)
        let order = Dictionary(uniqueKeysWithValues: dayItems.enumerated().map { ($0.element.id, $0.offset) })
        for index in items.indices where items[index].dateLocal == day {
            items[index].sortOrder = order[items[index].id] ?? items[index].sortOrder
        }
        Task { await persist() }
    }

    private func normalizeSortOrders() {
        for day in Set(items.map(\.dateLocal)) {
            let sorted = items.filter { $0.dateLocal == day }.sorted {
                if $0.sortOrder != $1.sortOrder { return $0.sortOrder < $1.sortOrder }
                return $0.createdAt < $1.createdAt
            }
            let order = Dictionary(uniqueKeysWithValues: sorted.enumerated().map { ($0.element.id, $0.offset) })
            for index in items.indices where items[index].dateLocal == day {
                items[index].sortOrder = order[items[index].id] ?? items[index].sortOrder
            }
        }
    }

    @MainActor
    private func load() async {
        loading = true
        defer { loading = false }
        do {
            items = try await APIClient.shared.bookingItinerary(bookingID: bookingID)
            normalizeSortOrders()
            if selectedDay == nil { selectedDay = days.first }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor private func changeExecution(_ item: BookingItineraryItem, state: String) async {
        guard !saving else { return }; saving = true; defer { saving = false }
        do { items = try await APIClient.shared.setItineraryExecution(bookingID: bookingID, itemID: item.id, state: state); errorMessage = nil; NotificationCenter.default.post(name: Notification.Name("iumrah.business.bookingOperationsChanged"), object: bookingID) }
        catch { errorMessage = error.localizedDescription }
    }

    @MainActor
    private func persist() async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        do {
            normalizeSortOrders()
            items = try await APIClient.shared.saveBookingItinerary(bookingID: bookingID, items: items)
            errorMessage = nil
            NotificationCenter.default.post(name: Notification.Name("iumrah.business.bookingOperationsChanged"), object: bookingID)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private static func dayRange(from start: String, through end: String) -> [String] {
        guard let startDate = parser.date(from: start), let endDate = parser.date(from: end), startDate <= endDate else { return [] }
        var result: [String] = []
        var cursor = startDate
        let calendar = Calendar(identifier: .gregorian)
        while cursor <= endDate && result.count < 40 {
            result.append(parser.string(from: cursor))
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return result
    }

    private static func dayNumber(_ day: String) -> String {
        guard let date = parser.date(from: day) else { return day }
        let formatter = DateFormatter()
        formatter.dateFormat = "dd"
        return formatter.string(from: date)
    }

    private static func weekday(_ day: String) -> String {
        guard let date = parser.date(from: day) else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.dateFormat = "EE"
        return formatter.string(from: date).replacingOccurrences(of: ".", with: "")
    }

    private static let parser: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

private struct ItineraryDraft: Identifiable {
    let id = UUID()
    let originalID: String?
    var dateLocal: String
    var title: String
    var subtitle: String
    var icon: String
    var location: String
    var notes: String
    var timeLocal: String
    var endTimeLocal: String

    init(item: BookingItineraryItem) {
        originalID = item.id
        dateLocal = item.dateLocal
        title = item.title
        subtitle = item.subtitle
        icon = item.icon
        location = item.location
        notes = item.notes
        timeLocal = item.timeLocal ?? ""
        endTimeLocal = item.endTimeLocal ?? ""
    }

    init(newOn day: String) {
        originalID = nil
        dateLocal = day
        title = ""
        subtitle = ""
        icon = "calendar"
        location = ""
        notes = ""
        timeLocal = ""; endTimeLocal = ""
    }
}

private struct ItineraryEventEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var value: ItineraryDraft

    let startDate: String
    let endDate: String
    let onSave: (ItineraryDraft) -> Void
    let onCancel: () -> Void

    init(draft: ItineraryDraft, startDate: String, endDate: String, onSave: @escaping (ItineraryDraft) -> Void, onCancel: @escaping () -> Void) {
        _value = State(initialValue: draft)
        self.startDate = startDate
        self.endDate = endDate
        self.onSave = onSave
        self.onCancel = onCancel
    }

    private var validTimes: Bool {
        func valid(_ time: String) -> Bool { time.isEmpty || time.range(of: "^([01][0-9]|2[0-3]):[0-5][0-9]$", options: .regularExpression) != nil }
        return valid(value.timeLocal) && valid(value.endTimeLocal) && (value.endTimeLocal.isEmpty || (!value.timeLocal.isEmpty && value.endTimeLocal >= value.timeLocal))
    }
    private var dateBinding: Binding<Date> {
        Binding(
            get: { Self.parser.date(from: value.dateLocal) ?? Self.parser.date(from: startDate) ?? Date() },
            set: { value.dateLocal = Self.parser.string(from: $0) }
        )
    }

    private var dateRange: ClosedRange<Date> {
        let start = Self.parser.date(from: startDate) ?? Date()
        let end = Self.parser.date(from: endDate) ?? start
        return min(start, end)...max(start, end)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    DatePicker("Дата", selection: dateBinding, in: dateRange, displayedComponents: .date)
                        .datePickerStyle(.compact)
                        .padding(14)
                        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))

                    labeledField("Начало · местное время (ЧЧ:ММ)", text: $value.timeLocal, placeholder: "10:00")
                    labeledField("Окончание · местное время (необязательно)", text: $value.endTimeLocal, placeholder: "12:00")
                    labeledField("Название", text: $value.title, placeholder: "Например: Зиярат в мечети Пророка")
                    labeledField("Подзаголовок", text: $value.subtitle, placeholder: "Короткое пояснение")
                    labeledField("Место", text: $value.location, placeholder: "Madinah / Masjid an-Nabawi")

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Иконка").font(.caption.bold()).foregroundStyle(.secondary)
                        Picker("Иконка", selection: $value.icon) {
                            Label("Календарь", systemImage: "calendar").tag("calendar")
                            Label("Самолёт", systemImage: "airplane").tag("airplane")
                            Label("Прилёт", systemImage: "airplane.arrival").tag("airplane.arrival")
                            Label("Вылет", systemImage: "airplane.departure").tag("airplane.departure")
                            Label("Отель", systemImage: "building.2.fill").tag("building.2.fill")
                            Label("Трансфер", systemImage: "car.side.fill").tag("car.side.fill")
                            Label("Умра", systemImage: "moon.stars.fill").tag("moon.stars.fill")
                            Label("Зиярат", systemImage: "mappin.and.ellipse").tag("mappin.and.ellipse")
                        }
                        .pickerStyle(.menu)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Заметка").font(.caption.bold()).foregroundStyle(.secondary)
                        TextField("Дополнительные детали", text: $value.notes, axis: .vertical)
                            .lineLimit(3...6)
                            .padding(12)
                            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                }
                .padding(18)
            }
            .navigationTitle(value.originalID == nil ? "Новое событие" : "Событие")
            .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { onCancel(); dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { onSave(value); dismiss() }
                        .fontWeight(.semibold)
                        .disabled(value.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !validTimes)
                }
            }
        }
    }

    private func labeledField(_ title: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.caption.bold()).foregroundStyle(.secondary)
            TextField(placeholder, text: text, axis: .vertical)
                .lineLimit(1...3)
                .padding(12)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
    }

    private static let parser: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}
