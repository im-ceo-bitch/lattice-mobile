import SwiftUI
import UIKit

/// Only the drawer shell owns transient motion. Chat data, focus and scrolling
/// are not recreated, scaled or moved into a different navigation hierarchy.
struct KelvinDrawerShell<Sidebar: View, Content: View>: View {
    let isOpen: Bool
    let onRequest: (Bool) -> Void
    let sidebar: Sidebar
    let content: Content
    let gestureEnabled: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var progress: CGFloat = 0
    @State private var start: CGFloat?
    @State private var target = false
    @State private var settling = false
    @State private var motionID = UUID()
    @State private var presentation = KelvinDrawerPresentation()
    @GestureState private var legacyActive = false
    @State private var legacyRejected = false

    var body: some View {
        GeometryReader { geometry in
            let width = KelvinDrawerPhysics.width(for: geometry.size.width)
            let engaged = isOpen || settling || start != nil || progress > 0
            let surface = ZStack(alignment: .leading) {
                sidebar
                    .frame(width: width, height: geometry.size.height)
                    .allowsHitTesting(isOpen && !settling && start == nil)
                    .accessibilityHidden(!isOpen || settling)
                content
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .overlay {
                        Color.clear.contentShape(Rectangle())
                            .onTapGesture { request(false, width: width) }
                            .allowsHitTesting(engaged)
                            .accessibilityHidden(true)
                    }
                    .modifier(KelvinDrawerTransform(progress: progress, width: width, presentation: presentation))
                    .accessibilityHidden(isOpen)
            }
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .leading)
            .contentShape(Rectangle())
            .coordinateSpace(name: "kelvin-drawer-root")
            .background(Color(uiColor: .systemBackground).ignoresSafeArea(.container))

            if #available(iOS 18.0, *) {
                surface.gesture(KelvinHorizontalPan(enabled: gestureEnabled, canBegin: { dx in
                    engaged || dx > 0
                }, onBegin: { begin(width: width) }, onChange: { dx in change(dx, width: width) }, onEnd: { velocity, cancelled in end(velocity: velocity, cancelled: cancelled, width: width) }))
            } else {
                surface.simultaneousGesture(legacyGesture(width: width), including: gestureEnabled ? .all : .none)
            }
        }
        .onChange(of: isOpen, initial: true) { _, open in
            if open != target { settle(open, velocity: 0, width: presentation.width) }
        }
        .onChange(of: gestureEnabled) { _, enabled in
            if !enabled && start != nil { end(velocity: 0, cancelled: true, width: presentation.width) }
        }
        .onChange(of: legacyActive) { _, active in
            if !active {
                legacyRejected = false
                if start != nil { end(velocity: 0, cancelled: true, width: presentation.width) }
            }
        }
    }

    private func begin(width: CGFloat) {
        let current = settling ? (presentation.progress ?? progress) : progress
        motionID = UUID()
        presentation.progress = current
        var tx = Transaction(); tx.disablesAnimations = true
        withTransaction(tx) {
            settling = false
            start = current
            progress = current
        }
    }
    private func change(_ dx: CGFloat, width: CGFloat) {
        guard let start else { return }
        var tx = Transaction(); tx.disablesAnimations = true
        let next = KelvinDrawerPhysics.progress(start: start, translation: dx, width: width)
        presentation.progress = next
        withTransaction(tx) { progress = next }
    }
    private func end(velocity: CGFloat, cancelled: Bool, width: CGFloat) {
        guard start != nil else { return }
        let open = cancelled ? isOpen : KelvinDrawerPhysics.destination(progress: progress, velocity: velocity, width: width)
        settle(open, velocity: cancelled ? 0 : velocity, width: width)
        if open != isOpen { onRequest(open) }
    }
    private func request(_ open: Bool, width: CGFloat) {
        settle(open, velocity: 0, width: width)
        if open != isOpen { onRequest(open) }
    }
    private func settle(_ open: Bool, velocity: CGFloat, width: CGFloat) {
        let current = settling ? (presentation.progress ?? progress) : progress
        let destination: CGFloat = open ? 1 : 0
        let id = UUID(); motionID = id
        target = open; start = nil
        if reduceMotion || abs(current - destination) < 0.001 {
            var tx = Transaction(); tx.disablesAnimations = true
            presentation.progress = destination
            withTransaction(tx) { progress = destination; settling = false }
            return
        }
        // When interrupted, retarget from the current rendered position, not
        // the old destination. UIKit velocity is normalized to spring travel.
        var tx = Transaction(); tx.disablesAnimations = true
        presentation.progress = current
        withTransaction(tx) { progress = current; settling = true }
        let animation = Animation.interpolatingSpring(mass: 1, stiffness: 340, damping: 34,
            initialVelocity: KelvinDrawerPhysics.initialVelocity(progress: current, target: destination, velocity: velocity, width: width))
        withAnimation(animation, completionCriteria: .removed) { progress = destination } completion: {
            if motionID == id { presentation.progress = destination; settling = false }
        }
    }
    private func legacyGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 12, coordinateSpace: .named("kelvin-drawer-root"))
            .updating($legacyActive) { _, active, _ in active = true }
            .onChanged { value in
                if start == nil {
                    guard !legacyRejected else { return }
                    let dx = value.translation.width, dy = value.translation.height
                    guard KelvinDrawerPhysics.horizontal(x: dx, y: dy), isOpen || settling || dx > 0 else { legacyRejected = true; return }
                    begin(width: width)
                }
                change(value.translation.width, width: width)
            }
            .onEnded { value in
                let velocity = (value.predictedEndTranslation.width - value.translation.width) / 0.16
                end(velocity: velocity, cancelled: false, width: width)
            }
    }
}

/// Non-observable presentation sample; no publication or view invalidation per frame.
private final class KelvinDrawerPresentation {
    var progress: CGFloat?
    var width: CGFloat = 1
}

private struct KelvinDrawerTransform: AnimatableModifier {
    var progress: CGFloat
    let width: CGFloat
    let presentation: KelvinDrawerPresentation
    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue; presentation.progress = KelvinDrawerPhysics.clamp(newValue); presentation.width = width }
    }
    func body(content: Content) -> some View {
        let fraction = KelvinDrawerPhysics.clamp(progress)
        // The rounded background extends to the physical screen; no clip on
        // text, keyboard, safe areas, or scroll content.
        content
            .background {
                RoundedRectangle(cornerRadius: 30 * fraction, style: .continuous)
                    .fill(Color(uiColor: .systemBackground))
                    .ignoresSafeArea(.container)
                    .shadow(color: .black.opacity(0.12 * fraction), radius: 18 * fraction, x: -4 * fraction)
            }
            .overlay { Color.black.opacity(0.045 * fraction).allowsHitTesting(false) }
            .offset(x: width * fraction)
            .onAppear { presentation.width = width }
            .onChange(of: width) { _, value in presentation.width = value }
    }
}

@available(iOS 18.0, *)
private struct KelvinHorizontalPan: UIGestureRecognizerRepresentable {
    let enabled: Bool
    let canBegin: (CGFloat) -> Bool
    let onBegin: () -> Void
    let onChange: (CGFloat) -> Void
    let onEnd: (CGFloat, Bool) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }
    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.maximumNumberOfTouches = 1
        pan.delegate = context.coordinator
        context.coordinator.canBegin = canBegin
        pan.isEnabled = enabled
        return pan
    }
    func updateUIGestureRecognizer(_ recognizer: UIPanGestureRecognizer, context: Context) {
        context.coordinator.canBegin = canBegin
        if recognizer.isEnabled != enabled { recognizer.isEnabled = enabled }
    }
    func handleUIGestureRecognizerAction(_ recognizer: UIPanGestureRecognizer, context: Context) {
        // Window coordinates don't move with the translated chat surface.
        let coordinateView = recognizer.view?.window
        switch recognizer.state {
        case .began: onBegin(); onChange(recognizer.translation(in: coordinateView).x)
        case .changed: onChange(recognizer.translation(in: coordinateView).x)
        case .ended: onChange(recognizer.translation(in: coordinateView).x); onEnd(recognizer.velocity(in: coordinateView).x, false)
        case .cancelled, .failed: onEnd(0, true)
        default: break
        }
    }
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var canBegin: (CGFloat) -> Bool = { _ in false }
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return false }
            let v = pan.velocity(in: pan.view?.window)
            return KelvinDrawerPhysics.horizontal(x: v.x, y: v.y) && canBegin(v.x)
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            // Keep native text editing/selection gestures and UIControls intact.
            var view = touch.view
            while let current = view {
                if let text = current as? UITextView, text.isEditable || text.isFirstResponder { return false }
                if current is UITextField || current is UIControl { return false }
                if current === gestureRecognizer.view { break }
                view = current.superview
            }
            return true
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            // Vertical scroll must retain its recognizer; our pan rejects it.
            otherGestureRecognizer is UIPanGestureRecognizer && otherGestureRecognizer.view is UIScrollView
        }
    }
}
