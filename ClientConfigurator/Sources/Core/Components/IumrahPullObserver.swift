import SwiftUI
import UIKit

/// Reads actual rubber-band displacement instead of mixing safe-area and
/// GeometryReader coordinate spaces. Does not replace SwiftUI's scroll delegate.
struct IumrahPullObserver: UIViewRepresentable {
    var onChange: (CGFloat, Bool) -> Void
    final class Marker: UIView {
        var callback: (CGFloat, Bool) -> Void = { _, _ in }
        weak var scroll: UIScrollView?
        var observation: NSKeyValueObservation?
        var maximum: CGFloat = 0
        override func didMoveToWindow() { super.didMoveToWindow(); connect() }
        override func didMoveToSuperview() { super.didMoveToSuperview(); connect() }
        func connect() {
            var parent = superview
            while let view = parent {
                if let candidate = view as? UIScrollView {
                    guard scroll !== candidate else { return }
                    disconnect()
                    scroll = candidate
                    candidate.bounces = true
                    candidate.alwaysBounceVertical = true
                    candidate.panGestureRecognizer.addTarget(self, action: #selector(panChanged))
                    observation = candidate.observe(\.contentOffset, options: [.initial, .new]) { [weak self] _, _ in
                        DispatchQueue.main.async { self?.publish() }
                    }
                    return
                }
                parent = view.superview
            }
        }
        func disconnect() {
            if let scroll { scroll.panGestureRecognizer.removeTarget(self, action: #selector(panChanged)) }
            observation?.invalidate(); observation = nil; scroll = nil
        }
        func publish() {
            guard let scroll else { return }
            let pull = max(0, -(scroll.contentOffset.y + scroll.adjustedContentInset.top))
            if scroll.isDragging { maximum = max(maximum, pull) }
            callback(pull, false)
        }
        @objc func panChanged(_ gesture: UIPanGestureRecognizer) {
            switch gesture.state {
            case .began: maximum = 0
            case .ended:
                let released = maximum; maximum = 0
                DispatchQueue.main.async { [weak self] in self?.callback(released, true) }
            case .cancelled, .failed: maximum = 0
            default: break
            }
        }
    }
    func makeUIView(context: Context) -> Marker {
        let marker = Marker(); marker.isUserInteractionEnabled = false
        marker.callback = onChange
        return marker
    }
    func updateUIView(_ view: Marker, context: Context) {
        view.callback = onChange
        view.connect()
    }
    static func dismantleUIView(_ view: Marker, coordinator: ()) { view.disconnect() }
}
private struct IumrahPullHandlerKey: EnvironmentKey {
    static let defaultValue: (CGFloat, Bool) -> Void = { _, _ in }
}
extension EnvironmentValues {
    var iumrahPullHandler: (CGFloat, Bool) -> Void {
        get { self[IumrahPullHandlerKey.self] }
        set { self[IumrahPullHandlerKey.self] = newValue }
    }
}
