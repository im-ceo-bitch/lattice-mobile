import SwiftUI
import UIKit

/// Chat-only styling for iumrah Business.
/// iOS 26 uses Apple's native Liquid Glass APIs. Older iOS versions keep a
/// restrained material fallback without changing any chat/network behavior.
struct BusinessChatGlassContainer<Content: View>: View {
    let spacing: CGFloat?
    let content: () -> Content

    init(spacing: CGFloat? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.spacing = spacing
        self.content = content
    }

    @ViewBuilder
    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) {
                content()
            }
        } else {
            content()
        }
    }
}

private struct BusinessChatGlassButtonModifier: ViewModifier {
    let prominent: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            if prominent {
                content.buttonStyle(.glassProminent)
            } else {
                content.buttonStyle(.glass)
            }
        } else {
            content.buttonStyle(BusinessChatLegacyGlassButtonStyle(prominent: prominent))
        }
    }
}

private struct BusinessChatGlassSurfaceModifier<S: Shape>: ViewModifier {
    let shape: S
    let interactive: Bool
    let tint: Color?

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            let glass = Glass.regular
                .interactive(interactive)
                .tint(tint)
            content.glassEffect(glass, in: shape)
        } else {
            content
                .background(.ultraThinMaterial, in: shape)
                .overlay {
                    shape.stroke(Color.white.opacity(0.20), lineWidth: 0.65)
                }
        }
    }
}

private struct BusinessChatLegacyGlassButtonStyle: ButtonStyle {
    let prominent: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background {
                if prominent {
                    Capsule().fill(Color.accentColor.opacity(0.94))
                } else {
                    Capsule().fill(.ultraThinMaterial)
                }
            }
            .overlay {
                Capsule().stroke(Color.white.opacity(prominent ? 0.12 : 0.24), lineWidth: 0.65)
            }
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .opacity(configuration.isPressed ? 0.86 : 1)
            .animation(.spring(response: 0.22, dampingFraction: 0.80), value: configuration.isPressed)
    }
}

extension View {
    func businessChatGlassButton(prominent: Bool = false) -> some View {
        modifier(BusinessChatGlassButtonModifier(prominent: prominent))
    }

    func businessChatGlassSurface<S: Shape>(
        in shape: S,
        interactive: Bool = false,
        tint: Color? = nil
    ) -> some View {
        modifier(BusinessChatGlassSurfaceModifier(shape: shape, interactive: interactive, tint: tint))
    }
}

struct BusinessChatMessageBubbleShape: Shape {
    let isMine: Bool
    let groupStart: Bool
    let groupEnd: Bool

    func path(in rect: CGRect) -> Path {
        let tailWidth: CGFloat = groupEnd ? 7 : 0
        let large: CGFloat = 19.5
        let tight: CGFloat = 6

        let bodyRect = CGRect(
            x: isMine ? rect.minX : rect.minX + tailWidth,
            y: rect.minY,
            width: max(1, rect.width - tailWidth),
            height: rect.height
        )

        let rounded: UnevenRoundedRectangle
        if isMine {
            rounded = UnevenRoundedRectangle(
                topLeadingRadius: large,
                bottomLeadingRadius: large,
                bottomTrailingRadius: groupEnd ? tight : large,
                topTrailingRadius: groupStart ? large : tight,
                style: .continuous
            )
        } else {
            rounded = UnevenRoundedRectangle(
                topLeadingRadius: groupStart ? large : tight,
                bottomLeadingRadius: groupEnd ? tight : large,
                bottomTrailingRadius: large,
                topTrailingRadius: large,
                style: .continuous
            )
        }

        var path = rounded.path(in: bodyRect)
        guard groupEnd else { return path }

        var tail = Path()
        if isMine {
            let edge = bodyRect.maxX
            tail.move(to: CGPoint(x: edge - 2, y: bodyRect.maxY - 14))
            tail.addCurve(
                to: CGPoint(x: rect.maxX, y: rect.maxY - 1.5),
                control1: CGPoint(x: edge + 0.5, y: bodyRect.maxY - 7),
                control2: CGPoint(x: rect.maxX - 1.5, y: rect.maxY - 3)
            )
            tail.addCurve(
                to: CGPoint(x: edge - 5, y: bodyRect.maxY - 4),
                control1: CGPoint(x: rect.maxX - 3, y: rect.maxY - 0.5),
                control2: CGPoint(x: edge - 1, y: rect.maxY - 1)
            )
            tail.closeSubpath()
        } else {
            let edge = bodyRect.minX
            tail.move(to: CGPoint(x: edge + 2, y: bodyRect.maxY - 14))
            tail.addCurve(
                to: CGPoint(x: rect.minX, y: rect.maxY - 1.5),
                control1: CGPoint(x: edge - 0.5, y: bodyRect.maxY - 7),
                control2: CGPoint(x: rect.minX + 1.5, y: rect.maxY - 3)
            )
            tail.addCurve(
                to: CGPoint(x: edge + 5, y: bodyRect.maxY - 4),
                control1: CGPoint(x: rect.minX + 3, y: rect.maxY - 0.5),
                control2: CGPoint(x: edge + 1, y: rect.maxY - 1)
            )
            tail.closeSubpath()
        }
        path.addPath(tail)
        return path
    }
}

struct BusinessChatMessageRow: View {
    @Environment(\.colorScheme) private var colorScheme

    let message: BusinessChatMessage
    let pilgrimName: String
    let groupStart: Bool
    let groupEnd: Bool
    let timestampText: String

    private var isMine: Bool { message.isStaff }

    var body: some View {
        HStack(alignment: .bottom, spacing: 7) {
            if isMine { Spacer(minLength: 58) }

            if !isMine {
                if groupEnd {
                    ZStack {
                        Circle().fill(Color(uiColor: .systemGray5))
                        Text(initials)
                            .font(.system(size: 10.5, weight: .bold, design: .rounded))
                            .foregroundStyle(.primary)
                    }
                    .frame(width: 28, height: 28)
                    .overlay { Circle().stroke(Color.primary.opacity(0.08), lineWidth: 0.6) }
                    .transition(.scale(scale: 0.82).combined(with: .opacity))
                } else {
                    Color.clear.frame(width: 28, height: 1)
                }
            }

            bubbleSurface
                .contextMenu {
                    if !message.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Button {
                            UIPasteboard.general.string = message.body
                        } label: {
                            Label("Копировать", systemImage: "doc.on.doc")
                        }

                        ShareLink(item: message.body) {
                            Label("Поделиться", systemImage: "square.and.arrow.up")
                        }
                    }
                } preview: {
                    bubbleSurface
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(10)
                }

            if !isMine { Spacer(minLength: 58) }
        }
        .padding(.top, groupStart ? 5 : 0)
    }

    private var bubbleSurface: some View {
        let shape = BusinessChatMessageBubbleShape(isMine: isMine, groupStart: groupStart, groupEnd: groupEnd)

        return bubbleContent
            .padding(.leading, leadingPadding)
            .padding(.trailing, trailingPadding)
            .padding(.top, verticalPadding)
            .padding(.bottom, metadataBottomPadding)
            .background {
                if isMine {
                    shape.fill(outgoingColor)
                } else {
                    shape.fill(Color(uiColor: .systemGray5))
                }
            }
            .overlay {
                if !isMine {
                    shape.stroke(Color.primary.opacity(colorScheme == .dark ? 0.055 : 0.035), lineWidth: 0.55)
                }
            }
            .shadow(color: Color.black.opacity(colorScheme == .dark ? 0.08 : 0.020), radius: 1.25, y: 1)
            .contentShape(shape)
            .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var bubbleContent: some View {
        // Keep the message content-sized. Timestamps live inside every bubble,
        // so the conversation reads naturally without the old swipe-to-reveal gesture.
        VStack(alignment: .trailing, spacing: 5) {
            VStack(alignment: .leading, spacing: 6) {
                if message.isImage, let path = message.attachmentURL {
                    BusinessPrivateImage(path: path, contentMode: .fit, chatAttachment: true) {
                        Color.primary.opacity(0.045)
                            .overlay(Image(systemName: "photo").foregroundStyle(.secondary))
                            .frame(width: 220, height: 150)
                    }
                    .frame(maxWidth: 258)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                let trimmed = message.body.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    Text(message.body)
                        .font(.body)
                        .foregroundStyle(isMine ? Color.white : Color.primary)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
            }

            HStack(spacing: 4) {
                Text(timestampText)
                    .font(.system(size: 10.5, weight: .medium, design: .rounded))
                    .monospacedDigit()

                if isMine {
                    Image(systemName: "checkmark")
                        .font(.system(size: 9.5, weight: .bold))
                        .accessibilityLabel("Отправлено")
                }
            }
            .foregroundStyle(metadataColor)
        }
    }

    private var initials: String {
        let value = pilgrimName.trimmingCharacters(in: .whitespacesAndNewlines)
        let result = value.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
        return result.isEmpty ? "I" : result
    }

    private var leadingPadding: CGFloat {
        let imageOnly = message.isImage && message.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if imageOnly { return groupEnd && !isMine ? 7 : 4 }
        return groupEnd && !isMine ? 16 : 12
    }

    private var trailingPadding: CGFloat {
        let imageOnly = message.isImage && message.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if imageOnly { return groupEnd && isMine ? 7 : 4 }
        return groupEnd && isMine ? 16 : 12
    }

    private var verticalPadding: CGFloat {
        message.isImage && message.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 4 : 8
    }

    private var metadataBottomPadding: CGFloat {
        message.isImage && message.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 5 : 6
    }

    private var metadataColor: Color {
        isMine ? .white.opacity(0.72) : .secondary
    }

    private var outgoingColor: Color {
        BusinessDesign.primaryControl
    }
}
