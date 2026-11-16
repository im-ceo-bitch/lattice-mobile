import Foundation
import CryptoKit
import SwiftUI
import UniformTypeIdentifiers

// A saved export is an immutable copy of the server's read-only JSON, not a
// list rebuilt from the (potentially filtered or truncated) SwiftUI screen.
struct PublishedFlightBackup {
    private struct Envelope: Decodable {
        struct Flight: Decodable { let id: String }
        let ok: Bool
        let type: String
        let version: Int
        let export_source: String
        let exported_at: String
        let snapshot_updated_at: String?
        let flight_count: Int
        let flights: [Flight]
    }

    let data: Data
    let source: String
    let exportedAt: String
    let snapshotUpdatedAt: String?
    let count: Int

    init(data: Data) throws {
        let envelope = try JSONDecoder().decode(Envelope.self, from: data)
        guard envelope.ok, envelope.type == "iumrah_business_published_flights",
              envelope.version == 1, envelope.flight_count > 0,
              envelope.flight_count == envelope.flights.count,
              Set(envelope.flights.map(\.id)).count == envelope.flight_count,
              envelope.flights.allSatisfy({ !$0.id.isEmpty }),
              ["canonical_database", "legacy_database", "saved_sync_snapshot"].contains(envelope.export_source) else {
            throw BackupError.invalid
        }
        self.data = data
        source = envelope.export_source
        exportedAt = envelope.exported_at
        snapshotUpdatedAt = envelope.snapshot_updated_at
        count = envelope.flight_count
    }

    var isCanonical: Bool { source == "canonical_database" }
    var sourceLabel: String {
        switch source {
        case "canonical_database": return "Основная база"
        case "legacy_database": return "Резервная база iumrah-core"
        default: return "Последний снимок синхронизации"
        }
    }
    var dataDate: String { snapshotUpdatedAt ?? exportedAt }
    var filename: String { "iumrah-published-flights-\(String(dataDate.prefix(10)))" }

    enum BackupError: LocalizedError {
        case invalid
        var errorDescription: String? { "Сервер не вернул непустой корректный JSON опубликованных рейсов." }
    }

    private static func cacheURL(owner: String) -> URL? {
        let login = owner.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !login.isEmpty, let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let key = SHA256.hash(data: Data(login.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent("PublishedFlights-\(key).json")
    }

    static func cached(owner: String) -> PublishedFlightBackup? {
        guard let url = cacheURL(owner: owner), let data = try? Data(contentsOf: url) else { return nil }
        return try? PublishedFlightBackup(data: data)
    }

    // An old sync or legacy fallback must not replace a previously saved full
    // authoritative export. Empty and malformed exports never reach this method.
    func save(owner: String) throws {
        guard let url = Self.cacheURL(owner: owner) else { throw BackupError.invalid }
        if let previous = Self.cached(owner: owner) {
            if previous.isCanonical && !isCanonical { return }
            if !isCanonical && previous.dataDate > dataDate { return }
        }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        var attributes = URLResourceValues()
        attributes.isExcludedFromBackup = true
        var file = url
        try file.setResourceValues(attributes)
    }
}

struct PublishedFlightsJSONDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    static var writableContentTypes: [UTType] { [.json] }
    let data: Data

    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else { throw PublishedFlightBackup.BackupError.invalid }
        self.data = data
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}
