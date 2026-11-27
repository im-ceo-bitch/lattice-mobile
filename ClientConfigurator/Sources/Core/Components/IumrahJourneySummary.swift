import SwiftUI

/// A single disclosure surface for the selected journey, never a new quote.
struct IumrahJourneyDisclosureCard<Details: View>: View {
    let title: String
    let total: String
    let subtitle: String
    let priceCaption: String
    let details: Details
    @State private var expanded = false
    @Environment(\.iumrahSearchPullActive) private var pulling

    init(title: String, total: String, subtitle: String, priceCaption: String,
         @ViewBuilder details: () -> Details) {
        self.title = title
        self.total = total
        self.subtitle = subtitle
        self.priceCaption = priceCaption
        self.details = details()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.22)) { expanded.toggle() }
                IumrahHaptics.selection()
            } label: {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(title).font(.headline)
                        Spacer(minLength: 8)
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                            .font(.caption.weight(.semibold))
                    }
                    HStack(alignment: .firstTextBaseline) {
                        Text(total).font(.title2.bold()).monospacedDigit()
                        Spacer(minLength: 8)
                        Text(priceCaption).font(.caption).foregroundStyle(.secondary)
                    }
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(Color.iumrahInk)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(expanded ? Text("Expanded") : Text("Collapsed"))
            if expanded {
                Divider().padding(.vertical, 7)
                details
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(IumrahAnimatedSearchBorder(animate: false))
        .onChange(of: pulling) { _, active in if active { expanded = false } }
    }
}

/// Route order derives from the selected arrival and departure airports.
/// The same itinerary is shown on the transfer and final review pages.
struct IumrahTransferRouteDetails: View {
    @EnvironmentObject private var journey: JourneyStore
    @EnvironmentObject private var settings: AppSettingsStore

    private var includesMadinah: Bool { journey.trip.scope == .makkahAndMadinah }
    private var madinahFirst: Bool { includesMadinah && journey.trip.arrivalAirport == .madinah }
    private var firstHotel: String { madinahFirst ? madinahHotel : makkahHotel }
    private var lastHotel: String { includesMadinah && !madinahFirst ? madinahHotel : makkahHotel }
    private var makkahHotel: String { journey.localJourneyRooms["makkah:0"]?.hotel.name ?? journey.selectedHotel?.name ?? city(false) }
    private var madinahHotel: String { journey.localJourneyRooms["madinah:0"]?.hotel.name ?? journey.selectedMadinahHotel?.name ?? city(true) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            row("airplane.arrival", journey.trip.outboundDestinationCode + " → " + firstHotel)
            row("mappin.and.ellipse", ziyarat(madinahFirst))
            if includesMadinah {
                if journey.haramainTrainSelected {
                    row("car", firstHotel + " → " + station(madinahFirst))
                    row("tram", "Haramain · " + city(madinahFirst) + " → " + city(!madinahFirst))
                    row("car", station(!madinahFirst) + " → " + lastHotel)
                } else {
                    row("car.side", firstHotel + " → " + lastHotel)
                }
                row("mappin.and.ellipse", ziyarat(!madinahFirst))
            }
            row("airplane.departure", lastHotel + " → " + journey.trip.returnOriginCode)
        }
    }

    private func row(_ icon: String, _ title: String) -> some View {
        Label {
            Text(title).font(.subheadline).fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: icon).foregroundStyle(Color.iumrahJourneyGreen).frame(width: 24)
        }
    }
    private func city(_ madinah: Bool) -> String {
        L10n.city(madinah ? "Madinah" : "Makkah", settings.language)
    }
    private func station(_ madinah: Bool) -> String {
        tr("Вокзал", "Station", "Vokzal", "Вокзал") + " · " + city(madinah)
    }
    private func ziyarat(_ madinah: Bool) -> String {
        tr("Отель → зияраты → отель", "Hotel → ziyarat → hotel", "Mehmonxona → ziyorat → mehmonxona", "Меҳмонхона → зиёрат → меҳмонхона") + " · " + city(madinah)
    }
    private func tr(_ ru: String, _ en: String, _ uz: String, _ cy: String) -> String {
        switch settings.language {
        case .russian: return ru
        case .uzbek: return uz
        case .uzbekCyrillic: return cy
        default: return en
        }
    }
}
