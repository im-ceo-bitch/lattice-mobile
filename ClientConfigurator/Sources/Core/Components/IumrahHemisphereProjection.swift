import Foundation

/// Orthographic projection of real geographic coordinates onto a unit sphere.
/// Independent of SwiftUI so the same projection can later place route overlays.
struct IumrahHemisphereProjection: Equatable {
    struct Vector {
        let x: Double
        let y: Double
        let z: Double

        init(x: Double, y: Double, z: Double) {
            self.x = x; self.y = y; self.z = z
        }

        init(latitude: Double, longitude: Double) {
            let lat = latitude * .pi / 180
            let lon = longitude * .pi / 180
            self.init(x: cos(lat) * cos(lon), y: cos(lat) * sin(lon), z: sin(lat))
        }

        func dot(_ other: Vector) -> Double {
            x * other.x + y * other.y + z * other.z
        }
    }

    struct Triangle {
        let a: Vector
        let b: Vector
        let c: Vector
    }

    struct Projected {
        let x: Double
        let y: Double
        let depth: Double

        var point: CGPoint { CGPoint(x: (x + 1) / 2, y: (1 - y) / 2) }

        func intersection(with other: Projected) -> Projected {
            // The endpoints straddle the horizon. Clip in camera space.
            let t = depth / (depth - other.depth)
            return .init(x: x + (other.x - x) * t,
                         y: y + (other.y - y) * t, depth: 0)
        }
    }

    let latitude: Double
    let longitude: Double
    private let forward: Vector
    private let east: Vector
    private let north: Vector

    static let arabia = Self(latitude: 25, longitude: 48)

    init(latitude: Double, longitude: Double) {
        let lat = latitude.isFinite ? max(-90, min(90, latitude)) : 25
        let lon = longitude.isFinite ? longitude.truncatingRemainder(dividingBy: 360) : 48
        self.latitude = lat
        self.longitude = lon
        let phi = lat * .pi / 180
        let lambda = lon * .pi / 180
        forward = Vector(latitude: lat, longitude: lon)
        east = Vector(x: -sin(lambda), y: cos(lambda), z: 0)
        north = Vector(x: -sin(phi) * cos(lambda), y: -sin(phi) * sin(lambda), z: cos(phi))
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.latitude == rhs.latitude && lhs.longitude == rhs.longitude
    }

    func project(_ v: Vector) -> Projected {
        .init(x: v.dot(east), y: v.dot(north), depth: v.dot(forward))
    }

    /// Normalized screen coordinates, nil on the back of the globe.
    func point(latitude: Double, longitude: Double) -> CGPoint? {
        guard latitude.isFinite, longitude.isFinite, abs(latitude) <= 90 else { return nil }
        let p = project(Vector(latitude: latitude, longitude: longitude))
        return p.depth >= -1e-12 ? p.point : nil
    }

    /// Clip land triangles at the visible hemisphere, including horizon-crossing
    /// coastlines. Normalize winding so a single nonzero fill has no holes at seams.
    func visiblePolygon(_ triangle: Triangle) -> [CGPoint] {
        let input = [project(triangle.a), project(triangle.b), project(triangle.c)]
        if input.allSatisfy({ $0.depth < 0 }) { return [] }
        var output: [Projected] = []
        var previous = input[2]
        for current in input {
            let inside = current.depth >= 0
            let previousInside = previous.depth >= 0
            if inside != previousInside { output.append(previous.intersection(with: current)) }
            if inside { output.append(current) }
            previous = current
        }
        guard output.count >= 3 else { return [] }
        let points = output.map(\.point)
        var area: CGFloat = 0
        for i in points.indices {
            let a = points[i], b = points[(i + 1) % points.count]
            area += a.x * b.y - b.x * a.y
        }
        if abs(area) < 1e-13 { return [] }
        return area > 0 ? points : Array(points.reversed())
    }
}
