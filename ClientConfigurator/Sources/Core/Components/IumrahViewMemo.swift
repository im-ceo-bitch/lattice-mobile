import Foundation

/// Retains only the current derived snapshot. Owned by a view's @State, never
/// observable: computing a snapshot cannot trigger another SwiftUI update.
/// All accesses are on the UI thread; no supplier data or selection is mutated.
final class IumrahViewMemo<Key: Equatable, Value> {
    private var entry: (Key, Value)?
    func value(for key: Key, build: () -> Value) -> Value {
        if let entry, entry.0 == key { return entry.1 }
        let result = build()
        entry = (key, result)
        return result
    }
}
