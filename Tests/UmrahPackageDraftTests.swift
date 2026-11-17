// Run with: python3 Tests/run_umrah_draft_tests.py (macOS with Swift).
func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    precondition(condition(), message)
}
func date(_ raw: String) -> Date { UmrahPackageDraft.date(raw)! }
func flight(_ id: String, _ from: String, _ to: String, _ depart: String, _ arrive: String) -> UmrahPackageDraft.Flight {
    .init(id: id, source: "test", legs: [.init(airline: "Test", flightNumber: id, airlineCode: "HY", origin: from, destination: to, departureAt: depart, arrivalAt: arrive, durationMinutes: 0, stops: 0, cabinClass: "economy")])
}
var draft = UmrahPackageDraft()
expect(draft.total == nil, "Empty proposal must not display a confirmed total")
expect(draft.issue(at: 0) != nil, "Two flights required")
draft.outbound = flight("out", "TAS", "JED", "2099-11-20T15:00:00Z", "2099-11-20T19:00:00Z")
draft.inbound = flight("in", "MED", "TAS", "2099-11-27T20:00:00Z", "2099-11-28T00:00:00Z")
draft.flightPrice = "500,50"
expect(draft.issue(at: 0) == nil, "Valid open-jaw route")
draft.makkah.id = "makkah"; draft.makkah.name = "Makkah Hotel"; draft.makkah.room = "Twin"
draft.makkah.checkIn = date("2099-11-19T21:00:00Z"); draft.makkah.checkOut = date("2099-11-23T21:00:00Z"); draft.makkah.price = "400"
draft.medina.id = "medina"; draft.medina.name = "Medina Hotel"; draft.medina.room = "Twin"
draft.medina.checkIn = draft.makkah.checkOut; draft.medina.checkOut = date("2099-11-26T21:00:00Z"); draft.medina.price = "300"
expect(draft.issue(at: 1) == nil, "All nights covered in Saudi timezone")
expect(draft.makkah.nights == 4 && draft.medina.nights == 3, "Local nights")
expect(draft.total == 2001, "Fare per person, hotels and transfer per group")
let encoded = try JSONEncoder().encode(draft)
let decoded = try JSONDecoder().decode(UmrahPackageDraft.self, from: encoded)
expect(decoded == draft, "Draft round trip")
draft.medina.checkIn = date("2099-11-24T21:00:00Z")
expect(draft.issue(at: 1) != nil, "Missing night blocked")
draft.medina.checkIn = date("2099-11-22T21:00:00Z")
expect(draft.issue(at: 1) != nil, "Overlapping hotel nights blocked")
draft.includeMedina = false; draft.makkah.checkOut = draft.medina.checkOut
expect(draft.issue(at: 1) == nil, "Makkah-only stay")
expect(draft.total == 1701, "Disabled Medina excluded from total")
draft.ziyaratMedina = true; draft.ziyaratPrice = "80"
expect(draft.total == 1701, "Hidden Medina ziyarat excluded")
draft.ziyaratMakkah = true
expect(draft.total == 1781, "Ziyarat included once for group")
draft.travelers = 4; draft.vehicle = "Chevrolet Malibu"; draft.pickup = draft.arrival!
expect(draft.issue(at: 2) != nil, "Malibu capacity enforced")
draft.vehicle = "Kia Carnival"
expect(draft.issue(at: 2) == nil, "Carnival capacity")
draft.pickup = draft.arrival!.addingTimeInterval(-60)
expect(draft.issue(at: 2) != nil, "Pickup cannot precede flight arrival")
for invalid in ["-1", "nan", "inf", "", "oops"] {
    expect(UmrahPackageDraft.amount(invalid) == nil, "Invalid money blocked: \(invalid)")
}
print("Umrah draft behavioral checks passed")

var v2 = UmrahPackageDraft()
expect(v2.firstIncompleteBuilderStage == 1, "Empty builder stops at flights")
v2.flightFares = ["out": 350, "back": 350]; v2.selectedFareKeys = ["out":"a", "back":"a"]; v2.selectedFareKinds = ["out":"round_trip", "back":"round_trip"]
expect(v2.suggestedFlightPrice == 350, "Round trip counted once")
v2.selectedFareKeys = ["out":"a", "back":"b"]
expect(v2.suggestedFlightPrice == nil, "Different round trips must not be summed")
v2.selectedFareKinds = ["out":"one_way", "back":"one_way"]
expect(v2.suggestedFlightPrice == 700, "Independent one-way tariffs can be summed")
v2.flightPrice = "500"; v2.makkah.price = "1100"; v2.medina.price = "500"; v2.transferPrice = "400"; v2.visaPrice = "200"; v2.guidePrice = "100"; v2.discount = "800"
expect(v2.costSubtotal == 3300 && v2.saleTotal == 2500, "Group discount is applied once")
v2.discount = "3300"; expect(v2.saleTotal == nil, "Nonpositive price blocked")
v2.discount = "800"; v2.builderStage = 4; v2.builderFlightPhase = 2; v2.builderHotelPhase = 1
let v2Decoded = try JSONDecoder().decode(UmrahPackageDraft.self, from: JSONEncoder().encode(v2))
expect(v2Decoded == v2, "Stage and substage preserved")
var legacyV2 = try JSONSerialization.jsonObject(with: JSONEncoder().encode(v2)) as! [String:Any]
for key in ["builderStage","builderFlightPhase","builderHotelPhase","builderOrigin","builderFinishAsOffer","discount"] { legacyV2.removeValue(forKey: key) }
let legacyDraft = try JSONDecoder().decode(UmrahPackageDraft.self, from: JSONSerialization.data(withJSONObject: legacyV2))
expect(legacyDraft.builderStage == nil && legacyDraft.saleTotal == 3300, "Historical drafts compatible")
print("Configurator 2 draft checks passed")

// UI preview must never show a catalog-only fare or an incomplete package as a final quote.
var previewDraft = UmrahPackageDraft()
expect(BusinessConfiguratorPricePreview(draft: previewDraft, stage: 0).amount == nil, "No initial price from default transfer")
previewDraft.outbound = flight("out", "TAS", "JED", "2099-11-20T15:00:00Z", "2099-11-20T19:00:00Z")
previewDraft.inbound = flight("in", "MED", "TAS", "2099-11-27T20:00:00Z", "2099-11-28T00:00:00Z")
previewDraft.flightFares = ["out": 350, "back": 350]; previewDraft.selectedFareKeys = ["out":"a", "back":"a"]; previewDraft.selectedFareKinds = ["out":"round_trip", "back":"round_trip"]
expect(BusinessConfiguratorPricePreview(draft: previewDraft, stage: 1).amount == nil, "Suggested price not confirmed")
previewDraft.flightPrice = "500,50"
let partialFlight = BusinessConfiguratorPricePreview(draft: previewDraft, stage: 1)
expect(partialFlight.amount == 1001 && !partialFlight.isComplete, "Confirmed fare for two, not final")
previewDraft.makkah = decoded.makkah; previewDraft.medina = decoded.medina
previewDraft.medina.price = ""
let partialStay = BusinessConfiguratorPricePreview(draft: previewDraft, stage: 2)
expect(partialStay.amount == 1401 && !partialStay.isComplete, "One selected hotel, no default service costs")
previewDraft.medina = decoded.medina
previewDraft.pickup = previewDraft.arrival!
previewDraft.commission = "10"; previewDraft.discount = "100"
let finalPreview = BusinessConfiguratorPricePreview(draft: previewDraft, stage: 4)
expect(finalPreview.isComplete && finalPreview.amount == previewDraft.saleTotal && finalPreview.amount == 2101.1, "Final includes canonical commission and discount")
previewDraft.discount = "99999"
expect(!BusinessConfiguratorPricePreview(draft: previewDraft, stage: 4).isComplete, "Invalid discount cannot display final")
previewDraft.flightPrice = ""; previewDraft.makkah.price = ""; previewDraft.medina.price = ""
expect(BusinessConfiguratorPricePreview(draft: previewDraft, stage: 1).amount == nil, "Invalidated prices removed from preview")
print("Configurator design price preview checks passed")
