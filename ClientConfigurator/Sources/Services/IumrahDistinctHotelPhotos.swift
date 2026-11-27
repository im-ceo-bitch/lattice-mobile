import Foundation
import UIKit
import CoreGraphics

/// Select only actual distinct photos, including identical pixels under different CDN URLs.
actor IumrahDistinctHotelPhotos {
    static let shared = IumrahDistinctHotelPhotos()
    private struct Entry { let values: [String]; let date: Date }
    private var cache: [String: Entry] = [:]
    private var pending: [String: Task<[String], Never>] = [:]

    func select(_ input: [String], limit: Int = 3) async -> [String] {
        let candidates = Array(IumrahHotelPhotoIdentity.unique(input).prefix(15))
        let key = String(limit) + "|" + candidates.joined(separator: "|")
        if let entry = cache[key], Date().timeIntervalSince(entry.date) < 1800 { return entry.values }
        if let task = pending[key] { return await task.value }
        let task = Task<[String], Never> {
            var result: [String] = []
            var fingerprints: [[UInt8]] = []
            for raw in candidates {
                guard let url = AppConfig.absoluteURL(raw),
                      let image = await HotelImageCache.shared.image(for: url, maximumPixelDimension: 512),
                      let signature = Self.signature(image) else { continue }
                if fingerprints.contains(where: { IumrahHotelPhotoSignature.similar($0, signature) }) { continue }
                fingerprints.append(signature)
                result.append(raw)
                if result.count >= limit { break }
            }
            return result
        }
        pending[key] = task
        let result = await task.value
        pending[key] = nil
        if !result.isEmpty {
            if cache.count >= 160 { cache.removeAll() }
            cache[key] = Entry(values: result, date: Date())
        }
        return result
    }

    private static func signature(_ image: UIImage) -> [UInt8]? {
        guard let cg = image.cgImage else { return nil }
        let side = 16
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        let valid = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: side, height: side,
                bitsPerComponent: 8, bytesPerRow: side * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.interpolationQuality = .medium
            context.draw(cg, in: CGRect(x: 0, y: 0, width: side, height: side))
            return true
        }
        return valid ? pixels : nil
    }

}
