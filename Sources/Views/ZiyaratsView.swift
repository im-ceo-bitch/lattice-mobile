import SwiftUI
import PhotosUI
import MapKit
import UIKit

struct ZiyaratsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.businessUsesPersistentSidebar) private var usesPersistentSidebar
    @Environment(\.businessAdaptiveLayout) private var layout
    @State private var routes: [BusinessZiyaratRoute] = []
    @State private var selectedCity = "Madinah"
    @State private var search = ""
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var editingPlace: BusinessZiyaratPlace?
    @State private var isCreating = false

    private var places: [BusinessZiyaratPlace] {
        routes.flatMap(\.places)
            .filter { selectedCity == "All" || $0.city == selectedCity }
            .filter { place in
                guard !search.isEmpty else { return true }
                if place.titleArabic.localizedCaseInsensitiveContains(search) { return true }
                return BusinessZiyaratContentLanguage.allCases.contains {
                    place.translation(for: $0).title.localizedCaseInsensitiveContains(search)
                }
            }
            .sorted { $0.routeOrder < $1.routeOrder }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                hero
                controls
                if isLoading { ProgressView().padding(.top, 60) }
                else if places.isEmpty { emptyState }
                else { placeList }
            }
            .businessAdaptiveReadableWidth()
            .padding(.horizontal, 18)
            .padding(.top, 12)
            .padding(.bottom, 36)
        }
        .background(BusinessDesign.background)
        .navigationTitle("Зияраты")
        .navigationBarTitleDisplayMode(.inline)
        .businessNavigationSurface()
        .toolbar {
            if !usesPersistentSidebar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }.foregroundStyle(BusinessDesign.headerInk)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { isCreating = true } label: { Image(systemName: "plus") }.foregroundStyle(BusinessDesign.headerInk)
            }
        }
        .searchable(text: $search, prompt: "Найти место")
        .task { await reload() }
        .refreshable { await reload() }
        .sheet(isPresented: $isCreating) {
            NavigationStack { ZiyaratEditorView(place: nil, initialCity: selectedCity == "All" ? "Madinah" : selectedCity) { Task { await reload() } } }
        }
        .sheet(item: $editingPlace) { place in
            NavigationStack { ZiyaratEditorView(place: place, initialCity: place.city) { Task { await reload() } } }
        }
        .alert("Не удалось загрузить Ziyarats", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("iumrah Ziyarats")
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .tracking(-0.8)
                    Text("Единая база маршрутов, точных геоточек и галерей для клиентского приложения.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Image(systemName: "map.fill")
                    .font(.system(size: 23, weight: .semibold))
                    .frame(width: 50, height: 50)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
            }
            HStack(spacing: 16) {
                metric("\(routes.reduce(0) { $0 + $1.stopCount })", "мест")
                metric("3", "города")
                metric("∞", "фото без лимита")
            }
        }
        .padding(18)
        .businessCard(radius: 28)
    }

    private var controls: some View {
        Picker("Город", selection: $selectedCity) {
            Text("Все").tag("All")
            Text("Медина").tag("Madinah")
            Text("Мекка").tag("Makkah")
            Text("Джидда").tag("Jeddah")
        }
        .pickerStyle(.segmented)
    }

    @ViewBuilder private var placeList: some View {
        if layout.supportsDenseDashboard {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 420, maximum: 600), spacing: 12)], spacing: 12) {
                ForEach(places) { place in
                    Button { editingPlace = place } label: { placeRow(place) }
                        .buttonStyle(.plain)
                }
            }
        } else {
            LazyVStack(spacing: 12) {
                ForEach(places) { place in
                    Button { editingPlace = place } label: { placeRow(place) }
                        .buttonStyle(.plain)
                }
            }
        }
    }

    private func placeRow(_ place: BusinessZiyaratPlace) -> some View {
        HStack(spacing: 13) {
            ZiyaratAdminImage(path: place.images.first?.url)
                .frame(width: 96, height: 86)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Text("\(place.routeOrder)")
                        .font(.caption.bold())
                        .frame(width: 25, height: 25)
                        .background(BusinessDesign.ink, in: Circle())
                        .foregroundStyle(BusinessDesign.onAccent)
                    Text(place.translation(for: .russian).title.isEmpty ? place.title : place.translation(for: .russian).title).font(.headline).lineLimit(1)
                }
                if !place.titleArabic.isEmpty { Text(place.titleArabic).font(.caption).foregroundStyle(.secondary) }
                HStack(spacing: 9) {
                    Label(categoryTitle(place.category), systemImage: categorySymbol(place.category))
                    Label("\(place.durationMinutes) мин", systemImage: "clock")
                }
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                Text(place.status == "published" ? "Опубликовано" : "Черновик")
                    .font(.caption2.bold())
                    .foregroundStyle(place.status == "published" ? .green : .orange)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.tertiary)
        }
        .padding(12)
        .businessCard(radius: 24)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "map").font(.system(size: 34)).foregroundStyle(.secondary)
            Text("Пока нет мест").font(.headline)
            Text("Добавьте точку, укажите точные координаты и загрузите нужное количество фотографий.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("Добавить место") { isCreating = true }
                .buttonStyle(.borderedProminent).tint(BusinessDesign.primaryControl)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 56)
    }

    private func metric(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title3.bold()).monospacedDigit()
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func categoryTitle(_ raw: String) -> String { BusinessZiyaratCategory(rawValue: raw)?.title ?? "Место" }
    private func categorySymbol(_ raw: String) -> String { BusinessZiyaratCategory(rawValue: raw)?.symbol ?? "mappin" }

    @MainActor private func reload() async {
        isLoading = routes.isEmpty
        defer { isLoading = false }
        do { routes = try await APIClient.shared.ziyarats(); errorMessage = nil }
        catch { errorMessage = error.localizedDescription }
    }
}

private struct ZiyaratEditorView: View {
    @Environment(\.dismiss) private var dismiss
    let place: BusinessZiyaratPlace?
    let initialCity: String
    let onSaved: () -> Void

    @State private var city: String
    @State private var titleArabic: String
    @State private var category: BusinessZiyaratCategory
    @State private var selectedContentLanguage: BusinessZiyaratContentLanguage = .russian
    @State private var localizedContent: [BusinessZiyaratContentLanguage: ZiyaratLocalizedDraft]
    @State private var visitType: BusinessZiyaratVisitType
    @State private var durationMinutes: Int
    @State private var latitudeText: String
    @State private var longitudeText: String
    @State private var address: String
    @State private var mapLabel: String
    @State private var routeOrder: Int
    @State private var isPublished: Bool
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var pendingPhotos: [Data] = []
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var deleting = false
    @State private var removedImageIDs: Set<String> = []
    @State private var camera: MapCameraPosition

    init(place: BusinessZiyaratPlace?, initialCity: String, onSaved: @escaping () -> Void) {
        self.place = place
        self.initialCity = initialCity
        self.onSaved = onSaved
        let lat = place?.latitude ?? 24.4672
        let lon = place?.longitude ?? 39.6111
        _city = State(initialValue: place?.city ?? initialCity)
        _titleArabic = State(initialValue: place?.titleArabic ?? "")
        _category = State(initialValue: BusinessZiyaratCategory(rawValue: place?.category ?? "historical") ?? .historical)
        var drafts: [BusinessZiyaratContentLanguage: ZiyaratLocalizedDraft] = [:]
        for language in BusinessZiyaratContentLanguage.allCases {
            let translation = place?.translation(for: language) ?? .empty
            drafts[language] = ZiyaratLocalizedDraft(
                title: translation.title,
                shortDescription: translation.shortDescription,
                longDescription: translation.longDescription,
                factsText: translation.interestingFacts.joined(separator: "\n"),
                visitNotes: translation.visitNotes
            )
        }
        _localizedContent = State(initialValue: drafts)
        _visitType = State(initialValue: BusinessZiyaratVisitType(rawValue: place?.visitType ?? "stop") ?? .stop)
        _durationMinutes = State(initialValue: place?.durationMinutes ?? 30)
        _latitudeText = State(initialValue: String(format: "%.6f", lat))
        _longitudeText = State(initialValue: String(format: "%.6f", lon))
        _address = State(initialValue: place?.address ?? "")
        _mapLabel = State(initialValue: place?.mapLabel ?? "")
        _routeOrder = State(initialValue: place?.routeOrder ?? 1)
        _isPublished = State(initialValue: place?.status == "published")
        _camera = State(initialValue: .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: lat, longitude: lon), span: MKCoordinateSpan(latitudeDelta: 0.025, longitudeDelta: 0.025))))
    }

    private var existingImages: [BusinessZiyaratImage] { (place?.images ?? []).filter { !removedImageIDs.contains($0.id) } }
    private var totalImages: Int { existingImages.count + pendingPhotos.count }
    private var coordinate: CLLocationCoordinate2D? {
        guard let lat = Double(latitudeText.replacingOccurrences(of: ",", with: ".")), let lon = Double(longitudeText.replacingOccurrences(of: ",", with: ".")), (-90...90).contains(lat), (-180...180).contains(lon) else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                identityCard
                exactPointCard
                galleryCard
                contentCard
                visitCard
                publishCard
                if place != nil { deleteCard }
            }
            .padding(18)
            .padding(.bottom, 26)
        }
        .background(BusinessDesign.background)
        .navigationTitle(place == nil ? "Новое место" : "Изменить место")
        .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { Button("Закрыть") { dismiss() }.foregroundStyle(BusinessDesign.headerInk) }
            ToolbarItem(placement: .topBarTrailing) {
                Button(saving ? "Сохраняю…" : "Сохранить") { Task { await save() } }.disabled(saving || canonicalTitle.isEmpty || coordinate == nil)
            }
        }
        .onChange(of: photoItems) { _, items in Task { await loadPending(items) } }
        .onChange(of: city) { _, newCity in
            guard place == nil else { return }
            let point = defaultCoordinate(for: newCity)
            latitudeText = String(format: "%.6f", point.latitude)
            longitudeText = String(format: "%.6f", point.longitude)
            withAnimation(.snappy(duration: 0.3)) {
                camera = .region(MKCoordinateRegion(center: point, span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)))
            }
        }
        .alert("Ошибка", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private var identityCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            cardTitle("Основное", "mappin.and.ellipse")
            Picker("Город", selection: $city) { Text("Медина").tag("Madinah"); Text("Мекка").tag("Makkah"); Text("Джидда").tag("Jeddah") }.pickerStyle(.segmented)
            field("Название на арабском", text: $titleArabic, prompt: "مسجد قباء")
            Text("Название для клиента заполняется ниже отдельно на каждом из 4 языков.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Picker("Категория", selection: $category) { ForEach(BusinessZiyaratCategory.allCases) { Text($0.title).tag($0) } }
            Stepper("Порядок в маршруте: \(routeOrder)", value: $routeOrder, in: 1...99)
        }.padding(17).businessCard(radius: 28)
    }

    private var exactPointCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            cardTitle("Точная точка", "scope")
            Text("Метка строится только по сохранённым latitude / longitude. Название места не используется для поиска, поэтому MapKit не подменит её случайной точкой.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            MapReader { proxy in
                Map(position: $camera) {
                    if let coordinate { Annotation("", coordinate: coordinate) { exactPin } }
                }
                .mapStyle(.standard(elevation: .realistic))
                .onTapGesture { position in
                    guard let value = proxy.convert(position, from: .local) else { return }
                    latitudeText = String(format: "%.6f", value.latitude)
                    longitudeText = String(format: "%.6f", value.longitude)
                }
            }
            .frame(height: 250)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            HStack(spacing: 10) { field("Latitude", text: $latitudeText, prompt: "24.439170"); field("Longitude", text: $longitudeText, prompt: "39.617220") }
            field("Адрес", text: $address, prompt: "Al Hijrah Rd, Madinah")
            field("Подпись точки", text: $mapLabel, prompt: "Главная точка посещения")
        }.padding(17).businessCard(radius: 28)
    }

    private var galleryCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack { cardTitle("Галерея", "photo.on.rectangle.angled"); Spacer(); Text("\(totalImages) фото").font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
            Text("Перед отправкой iPhone сохраняет HD-разрешение до 2048 px и оптимизирует JPEG. Cloudflare дополнительно хранит эффективную WebP-версию без заметной потери экранного качества.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if totalImages > 0 {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 10) {
                        ForEach(existingImages) { image in
                            ZStack(alignment: .topTrailing) {
                                ZiyaratAdminImage(path: image.url).frame(width: 132, height: 110).clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                                Button { removedImageIDs.insert(image.id) } label: {
                                    Image(systemName: "xmark")
                                        .font(.caption.bold())
                                        .frame(width: 28, height: 28)
                                        .businessGlass(in: Circle(), interactive: true)
                                }
                                .padding(7)
                            }
                        }
                        ForEach(Array(pendingPhotos.enumerated()), id: \.offset) { _, data in
                            if let image = UIImage(data: data) { Image(uiImage: image).resizable().scaledToFill().frame(width: 132, height: 110).clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous)) }
                        }
                    }
                }
            }
            PhotosPicker(selection: $photoItems, maxSelectionCount: nil, matching: .images) {
                Label("Добавить фотографии", systemImage: "plus.circle.fill")
                    .font(.headline).frame(maxWidth: .infinity).frame(height: 50).background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }.padding(17).businessCard(radius: 28)
    }

    private var contentCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                cardTitle("Информация", "text.alignleft")
                Spacer()
                Text(selectedContentLanguage.title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            Picker("Язык контента", selection: $selectedContentLanguage) {
                ForEach(BusinessZiyaratContentLanguage.allCases) { language in
                    Text(language.shortTitle).tag(language)
                }
            }
            .pickerStyle(.segmented)

            Text("Все поля ниже сохраняются в базе отдельно для RU, UZ, ЎЗ и EN. Клиентское приложение автоматически показывает версию выбранного пользователем языка.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            field("Название", text: localizedBinding(\.title), prompt: titlePrompt)
            textArea("Короткое описание", text: localizedBinding(\.shortDescription), minHeight: 86)
            textArea("Подробное описание", text: localizedBinding(\.longDescription), minHeight: 160)
            textArea("Что интересно здесь", text: localizedBinding(\.factsText), minHeight: 126)
            Text("Каждая новая строка в поле «Что интересно здесь» станет отдельным фактом на выбранном языке.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }.padding(17).businessCard(radius: 28)
    }

    private var visitCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            cardTitle("Посещение", "figure.walk")
            Picker("Тип", selection: $visitType) { ForEach(BusinessZiyaratVisitType.allCases) { Text($0.title).tag($0) } }.pickerStyle(.segmented)
            Stepper("Обычно \(durationMinutes) минут", value: $durationMinutes, in: 5...180, step: 5)
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Заметки для посещения").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Spacer()
                    Text(selectedContentLanguage.shortTitle).font(.caption2.bold()).foregroundStyle(.secondary)
                }
                TextEditor(text: localizedBinding(\.visitNotes))
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 90)
                    .padding(10)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }.padding(17).businessCard(radius: 28)
    }

    private var publishCard: some View {
        Toggle(isOn: $isPublished) {
            VStack(alignment: .leading, spacing: 3) { Text("Опубликовано").font(.headline); Text("После публикации точка сразу доступна клиентскому iumrah.").font(.caption).foregroundStyle(.secondary) }
        }.padding(17).businessCard(radius: 24)
    }

    private var deleteCard: some View {
        Button(role: .destructive) { Task { await deletePlace() } } label: {
            HStack { if deleting { ProgressView() }; Label("Удалить место", systemImage: "trash"); Spacer() }.font(.headline).padding(17)
        }.buttonStyle(.plain).businessCard(radius: 24).disabled(deleting)
    }

    private var exactPin: some View {
        ZStack { Circle().fill(Color.white).frame(width: 42, height: 42).shadow(radius: 7); Circle().fill(Color.black).frame(width: 34, height: 34); Image(systemName: "mappin.circle.fill").foregroundStyle(.white).font(.system(size: 18, weight: .bold)) }
    }

    private func defaultCoordinate(for city: String) -> CLLocationCoordinate2D {
        switch city {
        case "Makkah": return CLLocationCoordinate2D(latitude: 21.4225, longitude: 39.8262)
        case "Jeddah": return CLLocationCoordinate2D(latitude: 21.5433, longitude: 39.1728)
        default: return CLLocationCoordinate2D(latitude: 24.4672, longitude: 39.6111)
        }
    }

    private func cardTitle(_ title: String, _ icon: String) -> some View { Label(title, systemImage: icon).font(.title3.bold()) }
    private func field(_ label: String, text: Binding<String>, prompt: String) -> some View {
        VStack(alignment: .leading, spacing: 6) { Text(label).font(.caption.weight(.semibold)).foregroundStyle(.secondary); TextField(prompt, text: text).textFieldStyle(.plain).padding(.horizontal, 13).frame(height: 48).background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 15, style: .continuous)) }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    private func textArea(_ label: String, text: Binding<String>, minHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 6) { Text(label).font(.caption.weight(.semibold)).foregroundStyle(.secondary); TextEditor(text: text).scrollContentBackground(.hidden).frame(minHeight: minHeight).padding(10).background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous)) }
    }

    @MainActor private func loadPending(_ items: [PhotosPickerItem]) async {
        var loaded: [Data] = []
        for item in items { if let data = try? await item.loadTransferable(type: Data.self) { loaded.append(data) } }
        pendingPhotos = loaded
    }

    private var titlePrompt: String {
        switch selectedContentLanguage {
        case .russian: return "Мечеть Куба"
        case .uzbek: return "Qubo masjidi"
        case .uzbekCyrillic: return "Қубо масжиди"
        case .english: return "Quba Mosque"
        }
    }

    private var canonicalTitle: String {
        let candidates: [BusinessZiyaratContentLanguage] = [.english, .russian, .uzbek, .uzbekCyrillic]
        for language in candidates {
            let value = localizedContent[language]?.title.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !value.isEmpty { return value }
        }
        return ""
    }

    private var translationPayloads: [String: BusinessZiyaratTranslation] {
        Dictionary(uniqueKeysWithValues: BusinessZiyaratContentLanguage.allCases.map { language in
            let draft = localizedContent[language] ?? .empty
            let facts = draft.factsText
                .split(whereSeparator: \.isNewline)
                .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            return (language.rawValue, BusinessZiyaratTranslation(
                title: draft.title.trimmingCharacters(in: .whitespacesAndNewlines),
                shortDescription: draft.shortDescription.trimmingCharacters(in: .whitespacesAndNewlines),
                longDescription: draft.longDescription.trimmingCharacters(in: .whitespacesAndNewlines),
                interestingFacts: Array(facts.prefix(8)),
                visitNotes: draft.visitNotes.trimmingCharacters(in: .whitespacesAndNewlines)
            ))
        })
    }

    private func localizedBinding(_ keyPath: WritableKeyPath<ZiyaratLocalizedDraft, String>) -> Binding<String> {
        Binding(
            get: { localizedContent[selectedContentLanguage]?[keyPath: keyPath] ?? "" },
            set: { newValue in
                var draft = localizedContent[selectedContentLanguage] ?? .empty
                draft[keyPath: keyPath] = newValue
                localizedContent[selectedContentLanguage] = draft
            }
        )
    }

    @MainActor private func save() async {
        guard let coordinate else { errorMessage = "Укажите корректные координаты."; return }
        saving = true; defer { saving = false }
        let translations = translationPayloads
        let canonical = translations[BusinessZiyaratContentLanguage.english.rawValue]
            ?? translations[BusinessZiyaratContentLanguage.russian.rawValue]
            ?? translations[BusinessZiyaratContentLanguage.uzbek.rawValue]
            ?? translations[BusinessZiyaratContentLanguage.uzbekCyrillic.rawValue]
            ?? .empty
        let payload = BusinessZiyaratPlacePayload(
            city: city,
            title: canonical.title,
            titleArabic: titleArabic,
            category: category.rawValue,
            shortDescription: canonical.shortDescription,
            longDescription: canonical.longDescription,
            interestingFacts: canonical.interestingFacts,
            visitNotes: canonical.visitNotes,
            visitType: visitType.rawValue,
            durationMinutes: durationMinutes,
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            address: address,
            mapLabel: mapLabel,
            routeOrder: routeOrder,
            status: isPublished ? "published" : "draft",
            translations: translations
        )
        do {
            let saved = place == nil ? try await APIClient.shared.createZiyarat(payload) : try await APIClient.shared.updateZiyarat(id: place!.id, payload: payload)
            for imageID in removedImageIDs { try await APIClient.shared.deleteZiyaratImage(placeID: saved.id, imageID: imageID) }
            let start = max(0, existingImages.count)
            for (index, data) in pendingPhotos.enumerated() { try await APIClient.shared.uploadZiyaratImage(placeID: saved.id, imageData: data, position: start + index) }
            onSaved(); dismiss()
        } catch { errorMessage = error.localizedDescription }
    }

    @MainActor private func deletePlace() async {
        guard let place else { return }
        deleting = true; defer { deleting = false }
        do { try await APIClient.shared.deleteZiyarat(id: place.id); onSaved(); dismiss() }
        catch { errorMessage = error.localizedDescription }
    }
}

private struct ZiyaratLocalizedDraft {
    var title: String = ""
    var shortDescription: String = ""
    var longDescription: String = ""
    var factsText: String = ""
    var visitNotes: String = ""

    static let empty = ZiyaratLocalizedDraft()
}

private struct ZiyaratAdminImage: View {
    let path: String?
    @State private var image: UIImage?
    var body: some View {
        ZStack {
            Rectangle().fill(BusinessDesign.secondarySurface)
            if let image { Image(uiImage: image).resizable().scaledToFill() }
            else { Image(systemName: "photo").foregroundStyle(.secondary) }
        }
        .clipped()
        .task(id: path) {
            guard let path, let url = AppConfig.absoluteURL(path) else { return }
            do {
                let (data, response) = try await APIClient.shared.perform(from: url)
                try await APIClient.shared.validate(response, data: data)
                image = UIImage(data: data)
            } catch { image = nil }
        }
    }
}
