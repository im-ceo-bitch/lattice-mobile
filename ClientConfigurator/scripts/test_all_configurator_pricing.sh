#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
python3 - "$tmp" <<'PY'
from pathlib import Path
import sys
out=Path(sys.argv[1]); r=Path('Sources')
manual=(r/'State/IumrahManualJourneyStore.swift').read_text().replace('import SwiftUI','')
(out/'manual.swift').write_text(manual)
local=(r/'Models/LocalJourneySelection.swift').read_text()
# Compile the real local selection models, readiness/fingerprint, booking payload and meal helpers.
(out/'local.swift').write_text(local[:local.index('    var bookingHotel: HotelSummary')]+ '}\n'+local[local.index('struct HotelMealChoices:'):])
discovery=(r/'Services/AviasalesFlightDiscoveryService.swift').read_text(); discovery=discovery[discovery.index('struct FlightDiscoveryOffer:'):discovery.index('struct FlightDiscoveryCalendarDay:')]
leg=(r/'Models/IumrahPremiumFlightLeg.swift').read_text(); leg=leg[leg.index('    static func instant('):leg.index('    var effectiveDuration:')]
(out/'support.swift').write_text('''import Foundation
@propertyWrapper struct Published<Value> { var wrappedValue: Value }
protocol ObservableObject {}
enum AppSettingsStore { enum Language { case russian } }
enum L10n { static func text(_ key: String,_ language: AppSettingsStore.Language) -> String { key } }
struct FlightDiscoveryVerifiedSegment: Codable, Hashable {}
'''+discovery+'\nstruct IumrahPremiumFlightLeg {\n'+leg+'''\n}
struct BookingNuiteeRoomSelection: Codable, Hashable {
 let id: String; let city: String; let hotelId: String; let offerId: String; let roomId: String
 let checkin: String; let checkout: String; let adults: Int; let children: [Int]; var meals: HotelMealChoices?; var mealBundleRequested: Bool?
}
@MainActor final class JourneyStore {
 var trip = TripDraft(); var tripSummaryChildAges: [Int] = []; var usesLocalJourney = false
 var localJourneyRooms: [String: LocalJourneyRoom] = [:]; var localJourneyFlights: [LocalJourneyFlight] = []
 var packageFlightPath: PackageFlightPath = .publishedDirect; var mixedFlightIdentity: String?
 var selectedPublishedCompleteID: String?; var selectedPublishedOutboundID: String?; var selectedPublishedReturnID: String?
 var stagedAviasalesOffers: [StagedUmrahFlightKind: FlightDiscoveryOffer] = [:]
 var selectedOutbound: FlightOffer?; var selectedInbound: FlightOffer?
 var tripSummaryApprovalHeaders: [String:String] = [:]; var cachedLocalBookingInputKey: String?
 var selectedTransferVehicle: TransferVehicleKind?; var haramainTrainSelected = false; var haramainAdultTickets = 0; var haramainChildTickets = 0; var haramainFareClass: HaramainFareClass = .economy
 var quote: PackageQuote?; var hasFinalGeneratorQuote: Bool { false }
 func stageUmrahFlight(_ flight: StagedUmrahFlight) {}
 func stageAviasalesOffer(_ flight: FlightDiscoveryOffer, kind: StagedUmrahFlightKind) { stagedAviasalesOffers[kind] = flight; packageFlightPath = .aviasalesSelected }
 func chooseTransferVehicle(_ vehicle: TransferVehicleKind) { selectedTransferVehicle = vehicle }
 func setHaramainFareClass(_ value: HaramainFareClass) { haramainFareClass = value }
 func setHaramainAdultTickets(_ value: Int) { haramainAdultTickets = value }
 func setHaramainTrainSelected(_ value: Bool) { haramainTrainSelected = value }
 func confirmTransferSelection() {}
}
''')
# Linux stubs are only for framework/transport dependencies. Pricing models are real source.
PY
cat > "$tmp/test.swift" <<'SWIFT'
import Foundation
@main struct Test {
 @MainActor static func main() {
  var count = 0
  func check(_ ok: Bool, _ label: String) { precondition(ok,label); count += 1; print("PASS: " + label) }
  let cal = Calendar.current
  let start = cal.startOfDay(for: cal.date(byAdding:.day,value:14,to:Date())!)
  let end = cal.date(byAdding:.day,value:7,to:start)!
  let formatter = DateFormatter(); formatter.locale = Locale(identifier:"en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
  let startKey = formatter.string(from:start), endKey = formatter.string(from:end)
  let manual = IumrahManualJourneyStore(); manual.plannedDeparture = start; manual.plannedReturn = end
  manual.routeConfigured = true
  func flight(_ id: String, _ from: String, _ to: String, _ day: String) -> LocalJourneyFlight {
   var f = LocalJourneyFlight(id:id,origin:from,destination:to,airline:"HY",flightNumber:"HY 123",airlineCode:"HY",durationMinutes:180,stops:0,departureAt:day+"T08:00:00Z",arrivalAt:day+"T11:00:00Z",displayedPrice:100)
   f.publishedID = id; f.publishedCabin = "economy"; return f
  }
  check(manual.select(flight("a","TAS","JED",startKey)), "manual outbound")
  check(manual.select(flight("b","MED","TAS",endKey)), "manual inbound")
  let rate = NuiteeRoomRate(offerId:"offer",roomId:"room",roomName:"Double",mealPlan:"Room only",price:100,currency:"USD",refundable:true,cancellationTag:"free",cancellationDescription:"",cancellationDeadlines:[],chargeOnArrival:[])
  for city in manual.cities {
   let win = manual.expectedWindow(city)!
   let hotel = NuiteeHotel(id:city,name:city,city:city,address:nil,stars:3,rating:nil,reviewCount:nil,coverImageURL:nil,previewImages:nil,latitude:nil,longitude:nil,minimumRate:nil)
   check(manual.select(.init(id:city+":0",city:city,hotel:hotel,rate:rate,checkin:win.checkIn,checkout:win.checkOut,adults:2,childrenAges:[])), "select hotel "+city)
  }
  manual.transfer = .malibu; manual.haramainSelected = true; manual.haramainAdultTickets = 2
  let initial = manual.revisionKey
  check(manual.complete && manual.makeQuoteJourney()?.localRoomsComplete == true,"2 adults: all rooms ready")
  for adults in [4,5,6,2] {
   manual.adults = adults
   let rooms = manual.projectedRooms(), expected = adults == 6 ? 2 : 1
   check(manual.roomCount == expected && rooms.count == expected*2,"\(adults) adults: room count in both cities")
   check(manual.cities.allSatisfy{ city in rooms.values.filter{$0.city == city}.reduce(0){$0+$1.adults} == adults },"\(adults) adults: exact allocation")
   check(manual.makeQuoteJourney() != nil,"\(adults) adults: complete selection makes a quote draft")
   check(rooms.values.allSatisfy{ ($0.requiresRateRefresh == true) == (adults != 2) },"\(adults) adults: stale rate not treated as current")
  }
  check(manual.transfer == .carnival,"manual automatically upgrades undersized vehicle")
  check(manual.haramainAdultTickets == 2,"whole-party train follows party size")
  check(manual.revisionKey != initial,"revision reflects vehicle change")
  let journey = manual.makeQuoteJourney()!
  let key = journey.localBookingInputKey; journey.cachedLocalBookingInputKey = nil; journey.selectedPublishedReturnID = "other"
  check(key != journey.localBookingInputKey,"flight identity changes quote fingerprint")
  journey.cachedLocalBookingInputKey = nil; journey.trip.children = 1
  check(!journey.localRoomsComplete,"missing child ages rejected")
  manual.adults = 6
  let pending = Array(manual.projectedRooms().values)
  check(manual.estimateRequest(refreshedRooms:pending) == nil,"manual rejects stale estimate input")
  let refreshed = pending.map { room in var copy = room; copy.requiresRateRefresh = false; return copy }
  let req = manual.estimateRequest(refreshedRooms:refreshed)!
  check(req.roomCount == 2 && req.rooms.count == 4,"manual wire request includes multi-room count")
  for adults in 1...9 { let n = ConfiguratorRepricingPolicy.minimumRooms(adults); check((0..<n).map{ConfiguratorRepricingPolicy.adultsInRoom(adults,rooms:n,index:$0)}.reduce(0,+) == adults,"allocation sum \(adults)") }
  print("\(count) executable checks passed")
 }
}
SWIFT
swiftc "$tmp/support.swift" "$tmp/local.swift" "$tmp/manual.swift" "$tmp/test.swift" Sources/Models/{TripModels,AirportModels,NuiteeHotelModels,TransferModels,ConfiguratorRepricingPolicy,IumrahManualEstimate,FlightModels}.swift Sources/FlightEngine/{FlightSearchRequest,FlightReferenceCatalog}.swift Sources/Core/TripStayPlanner.swift -o "$tmp/test"
"$tmp/test"
