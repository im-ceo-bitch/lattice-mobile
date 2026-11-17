import Foundation

extension APIClient {
    func manualBookingInfo(id: String) async throws -> BusinessManualBookingInfo {
        let (data,response) = try await perform(from: AppConfig.apiBaseURL.appending(path: "/api/admin/bookings/\(id)/manual"))
        try validate(response,data:data)
        return try decoder.decode(BusinessManualBookingInfo.self,from:data)
    }
    func rotateManualShare(id: String) async throws -> String {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/bookings/\(id)/share")); request.httpMethod = "POST"
        let (data,response) = try await perform(request); try validate(response,data:data)
        struct Result: Decodable { let shareURL: String }
        return try decoder.decode(Result.self,from:data).shareURL
    }
    func createManualBooking(_ draft: UmrahPackageDraft) async throws -> BusinessManualBookingReceipt {
        let payload = try manualPackagePayload(draft)
        return try await offerRequest(path: draft.submissionMode == "booking" ? "/api/admin/offers" : "/api/admin/bookings", method: "POST", payload: payload)
    }
    func manualPackagePayload(_ draft: UmrahPackageDraft) throws -> [String: Any] {
        guard let outbound = draft.outbound, let inbound = draft.inbound,
              let first = outbound.legs.first, let last = outbound.legs.last, let back = inbound.legs.first, let end = inbound.legs.last,
              let arrival = draft.arrival, let departure = draft.departure, let total = draft.saleTotal else { throw APIError.server("INVALID_MANUAL_BOOKING") }
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"; formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(identifier: "Asia/Riyadh")
        func day(_ date: Date) -> String { formatter.string(from: date) }
        func amount(_ value: String?) -> Double { UmrahPackageDraft.amount(value ?? "0") ?? 0 }
        let flightID = outbound.id + ":" + inbound.id
        let plan = ["Economy":"economy", "Standard":"standard", "Comfort":"comfort", "Premium":"luxury"][draft.comfort] ?? "standard"
        let cost: [String: Double] = ["flight":amount(draft.flightPrice)*Double(draft.travelers),"makkah":amount(draft.makkah.price),"madinah":draft.includeMedina ? amount(draft.medina.price) : 0,"transfer":amount(draft.transferPrice),"ziyarat":draft.ziyaratMakkah || (draft.includeMedina && draft.ziyaratMedina) ? amount(draft.ziyaratPrice) : 0,"visa":amount(draft.visaPrice),"guide":amount(draft.guidePrice),"other":amount(draft.otherPrice),"commission":amount(draft.commission),"discount":amount(draft.discount)]
        let flight: [String: Any] = ["id":flightID,"airline": [first.airline, back.airline].reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }.joined(separator: " / "), "outboundOrigin":first.origin,"outboundDestination":last.destination,"outboundDate":day(UmrahPackageDraft.date(first.departureAt) ?? arrival),"returnOrigin":back.origin,"returnDestination":end.destination,"returnDate":day(departure),"outboundDepartureTime":first.departureAt,"outboundArrivalTime":last.arrivalAt,"returnDepartureTime":back.departureAt,"returnArrivalTime":end.arrivalAt,"outboundStops":max(0,outbound.legs.count-1),"returnStops":max(0,inbound.legs.count-1)]
        func hotel(_ stay: UmrahPackageDraft.Stay, city: String) -> [String: Any] { ["id":stay.id,"name":stay.name,"city":city,"stars":stay.stars ?? 3,"checkIn":day(stay.checkIn),"checkOut":day(stay.checkOut),"imageUrl":stay.imageURL ?? ""] }
        var services = ["flight","makkahHotel","transfer"]
        if draft.includeMedina { services.append("madinahHotel") }
        if draft.ziyaratMakkah { services.append("ziyaratMakkah") }
        if draft.includeMedina && draft.ziyaratMedina { services.append("ziyaratMadinah") }
        if amount(draft.visaPrice)>0 { services.append("visa") }; if amount(draft.guidePrice)>0 { services.append("accompaniment") }
        if draft.makkah.meals != "Без питания" || (draft.includeMedina && draft.medina.meals != "Без питания") { services.append("meals") }
        let medinaID: Any = draft.includeMedina ? draft.medina.id as Any : NSNull()
        let medinaHotel: Any = draft.includeMedina ? hotel(draft.medina, city: "madinah") as Any : NSNull()
        let nights = draft.makkah.nights + (draft.includeMedina ? draft.medina.nights : 0)
        let booking: [String: Any] = [
            "planId":plan,"totalUsd":total,"perPilgrimUsd":(total*100/Double(draft.travelers)).rounded()/100,
            "input":["from":first.origin,"originCode":first.origin,"arrivalAirportCode":last.destination,"startDate":day(arrival),"endDate":day(departure),"flexibleDays":0,"hotelPreference":String(min(5,max(1,draft.makkah.stars ?? 3))),"includeMadinah":draft.includeMedina,"travelers":["adults":draft.travelers,"children":0,"infants":0,"rooms":draft.makkah.rooms]],
            "route":["originCode":first.origin,"outboundDestination":last.destination,"returnOrigin":back.origin],
            "stay":["totalDays":nights+1,"totalNights":nights,"makkahCheckIn":day(draft.makkah.checkIn),"makkahCheckOut":day(draft.makkah.checkOut),"makkahNights":draft.makkah.nights,"madinahCheckIn":draft.includeMedina ? day(draft.medina.checkIn) as Any : NSNull(),"madinahCheckOut":draft.includeMedina ? day(draft.medina.checkOut) as Any : NSNull(),"madinahNights":draft.includeMedina ? draft.medina.nights : 0],
            "selection":["flightId":flightID,"makkahHotelId":draft.makkah.id,"madinahHotelId":medinaID],
            "selectionDetails":["pricingMode":"estimate","flight":flight,"makkahHotel":hotel(draft.makkah,city:"makkah"),"madinahHotel":medinaHotel],
            "customization":["accompaniment":amount(draft.guidePrice)>0,"guideMeetingPoint":"airport","ziyaratMakkah":draft.ziyaratMakkah,"ziyaratMadinah":draft.includeMedina && draft.ziyaratMedina,"meals":services.contains("meals"),"esim":false],
            "includedServices":services,"hotelNames":["makkah":draft.makkah.name,"madinah":draft.includeMedina ? draft.medina.name : ""],"flight":first.airline + " " + first.flightNumber + " / " + back.airline + " " + back.flightNumber,
            "pilgrimProfile":["firstName":draft.clientName,"lastName":draft.lastName ?? "","phone":draft.phone,"telegram":draft.telegram]
        ]
        func legs(_ flight: UmrahPackageDraft.Flight) -> [[String: String]] { flight.legs.map { ["airline":$0.airline,"number":$0.flightNumber,"origin":$0.origin,"destination":$0.destination,"departure":$0.departureAt,"arrival":$0.arrivalAt] } }
        func room(_ stay: UmrahPackageDraft.Stay) -> [String: Any] { ["room":stay.room,"rooms":stay.rooms,"meals":stay.meals] }
        let details: [String: Any] = ["outbound":legs(outbound),"inbound":legs(inbound),"makkah":room(draft.makkah),"madinah":draft.includeMedina ? room(draft.medina) as Any : NSNull(),"vehicle":draft.vehicle,"pickup":ISO8601DateFormatter().string(from:draft.pickup)]
        var editor = draft
        editor.clientName = ""; editor.lastName = nil; editor.phone = ""; editor.email = nil; editor.telegram = ""; editor.notes = ""; editor.sendEmail = nil
        editor.requestSecret = nil; editor.receipt = nil; editor.offerReceipt = nil; editor.submissionMode = nil
        editor.builderStage = nil; editor.builderFlightPhase = nil; editor.builderHotelPhase = nil; editor.builderFinishAsOffer = nil
        let editorDraft = String(decoding: try JSONEncoder().encode(editor), as: UTF8.self)
        var payload: [String: Any] = ["booking":booking,"manualDetails":details,"cost":cost,"requestSecret":draft.requestSecret ?? "","lang":draft.language ?? "ru","email":draft.email ?? "","sendEmail":draft.sendEmail ?? false,"hours":draft.offerHours ?? 24,"editorDraft":editorDraft]
        if let mode = draft.submissionMode { payload["mode"] = mode }
        return payload
    }
}
