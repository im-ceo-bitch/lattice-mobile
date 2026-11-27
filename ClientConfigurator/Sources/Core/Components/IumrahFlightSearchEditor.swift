import SwiftUI

/// Edits a copy: opening or dismissing the card never invalidates a selection.
struct IumrahFlightSearchEditor: View {
    @EnvironmentObject private var journey: JourneyStore
    @State private var draft = TripDraft()
    var lockParty = false
    var onApply: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            AirportSelectorButton(airport: $draft.originAirport, fallbackCode: $draft.origin, cornerRadius: 0, monochrome: true, compact: true)
            DatePicker("Вылет", selection: $draft.departureDate, in: Date()..., displayedComponents: .date)
            DatePicker("Обратно", selection: $draft.returnDate, in: draft.departureDate..., displayedComponents: .date)
            if !lockParty {
            Stepper("Взрослые: \(draft.adults)", value: $draft.adults, in: 1...9)
            Stepper("Дети: \(draft.children)", value: $draft.children, in: 0...8)
            Stepper("Младенцы: \(draft.infants)", value: $draft.infants, in: 0...draft.adults)
            }
            Picker("Класс", selection: Binding(get: { draft.effectiveFlightFilters.cabinClass }, set: {
                var filters = draft.effectiveFlightFilters
                filters.cabinClass = $0
                draft.flightFilters = filters
            })) {
                Text("Эконом").tag(FlightCabinClass.economy)
                Text("Премиум-эконом").tag(FlightCabinClass.premiumEconomy)
                Text("Бизнес").tag(FlightCabinClass.business)
                Text("Первый").tag(FlightCabinClass.first)
            }.pickerStyle(.menu).tint(.primary)
            Button("Обновить поиск") {
                journey.resetAfterTripChange()
                journey.clearStagedUmrahFlights()
                draft.saudiArrivalDate = nil
                journey.trip = draft
                onApply()
            }
            .buttonStyle(IumrahPrimaryButtonStyle())
            .disabled(draft.returnDate <= draft.departureDate || draft.travelerCount > 9)
        }
        .font(.subheadline)
        .onAppear { draft = journey.trip }
    }
}
