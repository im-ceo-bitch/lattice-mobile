import SwiftUI

struct HotelCard: View {
    @EnvironmentObject private var settings: AppSettingsStore
    let hotel: HotelSummary
    var badge: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ZStack(alignment: .topLeading) {
                HotelCachedImage(rawURL: hotel.coverImageURL, thumbnailPixelDimension: 768)
                    .frame(maxWidth: .infinity)
                    .frame(height: 210)
                    .clipped()
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))

                if let badge {
                    Text(badge)
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 11)
                        .padding(.vertical, 7)
                        .iumrahGlass(in: Capsule())
                        .padding(12)
                }
            }

            VStack(alignment: .leading, spacing: 7) {
                Text(hotel.name)
                    .font(.title3.weight(.bold))
                    .lineLimit(2)

                HStack(spacing: 10) {
                    if let stars = hotel.stars {
                        HStack(spacing: 4) {
                            IumrahInlineIcon(systemName: "star.fill", role: .rating, size: 11)
                            Text("\(stars)★")
                        }
                    }
                    if let rating = hotel.rating {
                        HStack(spacing: 4) {
                            IumrahInlineIcon(systemName: "heart.fill", role: .care, size: 11)
                            Text(String(format: "%.1f", rating))
                        }
                    }
                    HStack(spacing: 4) {
                        IumrahInlineIcon(systemName: "mappin", role: .location, size: 10)
                        Text(L10n.city(hotel.city, settings.language))
                    }
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)

            }
        }
        .iumrahCard()
    }

    private var placeholder: some View {
        ZStack {
            Rectangle().fill(.quaternary)
            IumrahIconBadge(systemName: "building.2", role: .hotel, size: 56, symbolSize: 25, cornerRadius: 18)
        }
    }
}
