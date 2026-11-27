import Foundation

/// Distance between same-size RGBA thumbnails, ignoring the alpha channel.
enum IumrahHotelPhotoSignature {
    static func similar(_ a: [UInt8], _ b: [UInt8]) -> Bool {
        guard a.count == b.count, a.count >= 4, a.count % 4 == 0 else { return false }
        var delta = 0
        for i in a.indices where i % 4 != 3 { delta += abs(Int(a[i]) - Int(b[i])) }
        return Double(delta) / Double(a.count * 3 / 4) <= 8.0
    }
}
