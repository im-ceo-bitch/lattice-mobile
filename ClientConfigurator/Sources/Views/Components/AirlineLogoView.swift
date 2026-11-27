import SwiftUI
import UIKit

/// Airline mark used by verified flight results and curated direct-flight cards.
/// Known carriers with unreliable public logo endpoints can provide a local asset;
/// every other airline keeps the existing Google Flights image + code fallback.
struct AirlineLogoView: View {
    let airlineCode: String?
    var size: CGFloat = 38
    @State private var remoteLogo: UIImage?
    @State private var loadedURL: URL?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .fill(Color.white)

            if let localAssetName {
                Image(localAssetName)
                    .resizable()
                    .scaledToFit()
                    .padding(size * 0.08)
            } else if let remoteLogo, loadedURL == logoURL {
                Image(uiImage: remoteLogo)
                    .resizable()
                    .scaledToFit()
                    .padding(size * 0.14)
            } else {
                fallback
            }
        }
        .frame(width: size, height: size)
        .overlay {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.7)
        }
        .accessibilityHidden(true)
        .task(id: logoURL) {
            guard localAssetName == nil, let url = logoURL else { return }
            if loadedURL == url, remoteLogo != nil { return }
            let image = await HotelImageCache.shared.image(for: url, maximumPixelDimension: 160)
            guard !Task.isCancelled else { return }
            loadedURL = url; remoteLogo = image
        }
    }

    private var verifiedCode: String? {
        guard let airlineCode else { return nil }
        let code = airlineCode.uppercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard code.range(of: "^[A-Z0-9]{2}$", options: .regularExpression) != nil else { return nil }
        return code
    }

    private var localAssetName: String? {
        switch verifiedCode {
        case "C6": return "ConfiguratorCentrumAirLogo"
        default: return nil
        }
    }

    private var logoURL: URL? {
        guard let verifiedCode else { return nil }
        return URL(string: "https://www.gstatic.com/flights/airline_logos/70px/\(verifiedCode).png")
    }

    private var fallback: some View {
        Group {
            if let verifiedCode {
                Text(verifiedCode)
                    .font(.system(size: size * 0.28, weight: .bold, design: .rounded))
                    .foregroundStyle(.primary)
                    .minimumScaleFactor(0.7)
            } else {
                Image(systemName: "airplane")
                    .font(.system(size: size * 0.30, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
        }
    }
}
