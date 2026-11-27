import SwiftUI
import UIKit
private struct IumrahPullHandlerKey: EnvironmentKey {
    static let defaultValue: (CGFloat, Bool) -> Void = { _, _ in }
}
extension EnvironmentValues {
    var iumrahPullHandler: (CGFloat, Bool) -> Void {
        get { self[IumrahPullHandlerKey.self] }
        set { self[IumrahPullHandlerKey.self] = newValue }
    }
}
