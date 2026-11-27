import CryptoKit
import Foundation
import ImageIO
import SwiftUI
import UIKit

/// Hotel photography is cached by URL, independently of flight/hotel pricing.
/// Always decode thumbnails rather than full-resolution original photos: a single
/// hotel image may expand from a few MB on disk to tens of MB in process memory.
actor HotelImageCache {
    static let shared = HotelImageCache()

    private let memory: NSCache<NSURL, UIImage>
    private let fileManager: FileManager
    private let directory: URL
    private let maximumCompressedBytes = 16 * 1024 * 1024
    private struct Flight {
        let id: UUID
        let task: Task<UIImage?, Never>
        var consumers: Set<UUID>
    }
    private var inFlight: [String: Flight] = [:]
    private var activeLoads = 0
    private var loadWaiters: [CheckedContinuation<Void, Never>] = []
    private let maxConcurrentLoads = 4
    private var lastDiskTrim = Date.distantPast
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.httpMaximumConnectionsPerHost = 4
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 35
        configuration.urlCache = nil // Compressed bytes already have a dedicated disk cache.
        return URLSession(configuration: configuration)
    }()
    private var failures: [String: Date] = [:]

    private init() {
        // Build the cache and filesystem dependencies as locals first. Calling
        // actor-isolated properties from an actor's nonisolated initializer is
        // rejected in Swift 6 language mode.
        let fileManager = FileManager.default
        let memory = NSCache<NSURL, UIImage>()
        let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        let directory = caches.appendingPathComponent("iumrah-hotel-images-v1", isDirectory: true)
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        memory.countLimit = 80
        memory.totalCostLimit = 48 * 1024 * 1024
        self.fileManager = fileManager
        self.memory = memory
        self.directory = directory
    }

    func purgeMemory() { memory.removeAllObjects() }

    func setMemoryLimit(_ bytes: Int) {
        if bytes < memory.totalCostLimit { memory.removeAllObjects() }
        memory.totalCostLimit = bytes
    }

    func image(for url: URL, maximumPixelDimension: Int = 960) async -> UIImage? {
        guard !Task.isCancelled else { return nil }
        let dimension = max(128, min(1600, maximumPixelDimension))
        let requestKey = "\(dimension)|\(url.absoluteString)"
        // A URL fragment is only a memory-cache identity, never sent to the server.
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.fragment = "iumrah-thumbnail-\(dimension)"
        let key = (components?.url ?? url) as NSURL
        if let cached = memory.object(forKey: key) { return cached }
        let consumer = UUID()
        let flight: Flight
        if var existing = inFlight[requestKey] {
            existing.consumers.insert(consumer)
            inFlight[requestKey] = existing
            flight = existing
        } else {
            if let until = failures[requestKey], until > Date() { return nil }
            let id = UUID()
            let task = Task { await self.boundedLoad(url: url, key: key, dimension: dimension) }
            flight = Flight(id: id, task: task, consumers: [consumer])
            inFlight[requestKey] = flight
        }
        return await withTaskCancellationHandler {
            let result = await flight.task.value
            if !Task.isCancelled { finish(requestKey, id: flight.id, result: result) }
            else { releaseConsumer(requestKey, id: flight.id, consumer: consumer) }
            return Task.isCancelled ? nil : result
        } onCancel: {
            Task { await self.releaseConsumer(requestKey, id: flight.id, consumer: consumer) }
        }
    }

    private func releaseConsumer(_ key: String, id: UUID, consumer: UUID) {
        guard var flight = inFlight[key], flight.id == id else { return }
        flight.consumers.remove(consumer)
        if flight.consumers.isEmpty {
            inFlight[key] = nil
            flight.task.cancel()
        } else { inFlight[key] = flight }
    }

    private func finish(_ key: String, id: UUID, result: UIImage?) {
        guard inFlight[key]?.id == id else { return }
        inFlight[key] = nil
        if result == nil {
            if failures.count >= 128 {
                failures = failures.filter { $0.value > Date() }
                if failures.count >= 128 { failures.removeAll() }
            }
            failures[key] = Date().addingTimeInterval(20)
        } else { failures[key] = nil }
    }

    private func boundedLoad(url: URL, key: NSURL, dimension: Int) async -> UIImage? {
        guard !Task.isCancelled else { return nil }
        if activeLoads >= maxConcurrentLoads {
            await withCheckedContinuation { loadWaiters.append($0) }
        } else { activeLoads += 1 }
        // Ownership of a slot is passed directly to the next waiter.
        defer {
            if loadWaiters.isEmpty { activeLoads -= 1 }
            else { loadWaiters.removeFirst().resume() }
        }
        guard !Task.isCancelled else { return nil }
        if let cached = memory.object(forKey: key) { return cached }
        return await load(url: url, key: key, dimension: dimension)
    }

    private func load(url: URL, key: NSURL, dimension: Int) async -> UIImage? {
        let trace = IumrahPerformanceTrace.begin("Image load")
        defer { IumrahPerformanceTrace.end("Image load", trace) }

        let diskURL = fileURL(for: url)
        if let attributes = try? fileManager.attributesOfItem(atPath: diskURL.path),
           let size = attributes[.size] as? NSNumber,
           size.intValue > maximumCompressedBytes {
            try? fileManager.removeItem(at: diskURL)
        } else if let data = try? Data(contentsOf: diskURL),
                  let decoded = downsample(data, dimension: dimension) {
            store(decoded, for: key)
            return decoded
        }

        do {
            let request = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 20)
            let (data, response) = try await session.data(for: request)
            guard !Task.isCancelled,
                  let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode),
                  data.count <= maximumCompressedBytes,
                  let decoded = downsample(data, dimension: dimension) else { return nil }

            // Preserve compressed data on disk, but never hold the full-sized
            // decoded bitmap in NSCache or SwiftUI views.
            try? data.write(to: diskURL, options: .atomic)
            trimDiskIfNeeded()
            store(decoded, for: key)
            return decoded
        } catch {
            return nil
        }
    }

    /// Only a few visible covers should be prefetched. Detail-gallery images
    /// remain on-demand; prefetching an entire global catalogue caused OOM risk.
    func prefetch(urls: [URL]) async {
        var seen = Set<URL>()
        let prioritized = urls.filter { seen.insert($0).inserted }.prefix(12)
        for url in prioritized {
            guard !Task.isCancelled else { return }
            _ = await image(for: url, maximumPixelDimension: 512)
        }
    }

    private func downsample(_ data: Data, dimension: Int) -> UIImage? {
        guard data.count <= maximumCompressedBytes,
              let source = CGImageSourceCreateWithData(data as CFData,
                   [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: dimension,
            kCGImageSourceShouldCacheImmediately: true
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }
        return UIImage(cgImage: image)
    }

    private func store(_ image: UIImage, for key: NSURL) {
        let cost = (image.cgImage?.bytesPerRow ?? 0) * (image.cgImage?.height ?? 0)
        memory.setObject(image, forKey: key, cost: cost)
    }

    private func trimDiskIfNeeded() {
        let now = Date()
        guard now.timeIntervalSince(lastDiskTrim) >= 60 else { return }
        lastDiskTrim = now
        let keys: Set<URLResourceKey> = [.fileSizeKey, .contentModificationDateKey]
        guard let files = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(keys)) else { return }
        let entries = files.filter { $0.pathExtension == "img" }.compactMap { url -> (URL, Int, Date)? in
            guard let values = try? url.resourceValues(forKeys: keys), let size = values.fileSize else { return nil }
            return (url, size, values.contentModificationDate ?? .distantPast)
        }
        var total = entries.reduce(0) { $0 + $1.1 }
        guard total > 128 * 1024 * 1024 else { return }
        for (url, size, _) in entries.sorted(by: { $0.2 < $1.2 }) {
            if total <= 96 * 1024 * 1024 { break }
            if (try? fileManager.removeItem(at: url)) != nil { total -= size }
        }
    }

    private func fileURL(for url: URL) -> URL {
        let digest = SHA256.hash(data: Data(url.absoluteString.utf8))
        let name = digest.map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(name).appendingPathExtension("img")
    }
}

struct HotelCachedImage: View {
    enum ContentMode { case fill, fit }

    let rawURL: String?
    var contentMode: ContentMode = .fill
    var placeholderSystemName: String = "building.2.fill"
    var thumbnailPixelDimension: Int? = nil

    @State private var image: UIImage?
    @State private var displayedKey: String?
    private var dimension: Int { thumbnailPixelDimension ?? (contentMode == .fit ? 1600 : 960) }
    private var imageKey: String { "\(dimension)|\(rawURL ?? "")" }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                if let image, displayedKey == imageKey {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: contentMode == .fill ? .fill : .fit)
                        .frame(width: proxy.size.width, height: proxy.size.height)
                } else {
                    Color.iumrahRaisedBackground
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .overlay {
                            Image(systemName: placeholderSystemName)
                                .font(.system(size: 25, weight: .semibold))
                                .foregroundStyle(.secondary)
                        }
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipped()
        }
        .clipped()
        .task(id: imageKey) {
            let requestKey = imageKey
            guard let url = AppConfig.absoluteURL(rawURL) else {
                image = nil
                return
            }
            if displayedKey == requestKey, image != nil { return }
            let loaded = await HotelImageCache.shared.image(for: url, maximumPixelDimension: dimension)
            guard !Task.isCancelled else { return }
            displayedKey = requestKey
            image = loaded
        }
        .onDisappear { image = nil; displayedKey = nil }
    }
}
