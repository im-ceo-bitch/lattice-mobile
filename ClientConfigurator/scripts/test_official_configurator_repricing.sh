#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
# Compile the real rate, transfer and policy models without requiring SwiftUI/iOS SDK.
python3 - "$tmp" <<'PY'
import sys
from pathlib import Path
p=Path(sys.argv[1]); s=Path('Sources/Models/LocalJourneySelection.swift').read_text(); meals=s[s.index('struct HotelMealChoices:'):]; (p/'support.swift').write_text('import Foundation\nenum JourneyScope { case makkahOnly, makkahAndMadinah }\n'+meals)
PY
cat > "$tmp/main.swift" <<'SWIFT'
import Foundation
func check(_ ok: Bool, _ label: String) { precondition(ok,label); print("PASS: " + label) }
func rate(_ id: String, _ room: String, _ name: String, _ price: Double, _ refund: Bool = true, _ board: String = "Room only", _ currency: String = "USD") -> NuiteeRoomRate {
    .init(offerId: id, roomId: room, roomName: name, mealPlan: board, price: price, currency: currency, refundable: refund, cancellationTag: refund ? "free" : "nonref", cancellationDescription: "", cancellationDeadlines: [], chargeOnArrival: [])
}
let old = rate("old", "r1", "Double Room", 100)
let replacement = rate("new", "r2", "Family Room", 160)
let renamed = rate("fresh", "changed-id", " double   room ", 140)
check((1...9).map(ConfiguratorRepricingPolicy.minimumRooms) == [1,1,1,1,1,2,2,2,2], "room count threshold 1–5 / 6–9")
check(ConfiguratorRepricingPolicy.roomsAfterPartyChange(existing: 2, oldAdults: 6, adults: 5) == 1, "auto-added room removed when party decreases")
check(ConfiguratorRepricingPolicy.roomsAfterPartyChange(existing: 2, oldAdults: 4, adults: 3) == 2, "manual extra room retained")
check(ConfiguratorRepricingPolicy.roomsAfterPartyChange(existing: 1, oldAdults: 4, adults: 4) == 1, "children do not trigger adult room threshold")
check(ConfiguratorRepricingPolicy.replacementVehicle(.malibu, travelers: 4) == .carnival, "2 → 4 upgrades capacity")
check(ConfiguratorRepricingPolicy.replacementVehicle(.carnival, travelers: 6) == .carnival, "6 fits existing Carnival")
check(ConfiguratorRepricingPolicy.replacementVehicle(.yukon, travelers: 7) == .carnival, "Yukon → Carnival at 7")
check(ConfiguratorRepricingPolicy.replacementVehicle(.carnival, travelers: 8) == nil, "no invented capacity")
check(NuiteeRoomRate.repricedSelection(previous: old, rates: [replacement, renamed], allowAlternative: true)?.offerId == "fresh", "same room name survives provider ID rotation")
check(NuiteeRoomRate.repricedSelection(previous: old, rates: [replacement, rate("exact", "r1", "Double Room", 220)], allowAlternative: true)?.offerId == "exact", "original category preferred to cheaper replacement")
check(NuiteeRoomRate.repricedSelection(previous: old, rates: [replacement], allowAlternative: true)?.offerId == "new", "compatible real alternative")
check(NuiteeRoomRate.repricedSelection(previous: old, rates: [replacement], allowAlternative: false) == nil, "alternative not silently applied outside review")
check(NuiteeRoomRate.repricedSelection(previous: old, rates: [rate("bad", "r1", "Double Room", 99, false), rate("board", "r1", "Double Room", 100, true, "BB"), rate("zero", "r1", "Double Room", 0), rate("eur", "r1", "Double Room", 90, true, "Room only", "EUR")], allowAlternative: true) == nil, "reject wrong board/refund/currency and invalid price")
check(ConfiguratorRepricingPolicy.isDavletbek(["Давлетбек Абдуллаев"]) && ConfiguratorRepricingPolicy.isDavletbek(["davlatbek-guide"]) && !ConfiguratorRepricingPolicy.isDavletbek(["Other Davlet"]), "guide matching aliases and no partial names")
SWIFT
swiftc Sources/Models/NuiteeHotelModels.swift Sources/Models/TransferModels.swift Sources/Models/ConfiguratorRepricingPolicy.swift "$tmp/support.swift" "$tmp/main.swift" -o "$tmp/test"
"$tmp/test"
python3 - <<'PY'
from pathlib import Path
s=Path('Sources/Views/Package/FinalPackageView.swift').read_text(); j=Path('Sources/State/JourneyStore.swift').read_text(); h=Path('Sources/Views/Hotels/NuiteeJourneyHotelsView.swift').read_text(); t=Path('Sources/Views/Package/TransferSelectionView.swift').read_text(); g=Path('Sources/Views/Guides/OfficialJourneyGuideStep.swift').read_text(); r=Path('Sources/Models/LocalJourneySelection.swift').read_text()
checks={
 'both transfer routes lead to guide stage': 'OfficialJourneyGuideStep(familyFlow: familyFlow)' in t and 'OfficialJourneyGuideStep(familyFlow: familyFlow)' in h,
 'guide available only; stable backend ID': '$0.guideAvailable == true' in g and 'memberID: guide.id' in g and 'matching.count == 1' in g,
 'explicit guide choice not overridden': 'else if !explicitlySelected' in g,
 'guide stage opens review': 'FinalPackageView(familyFlow: familyFlow)' in g,
 'rate refresh task does not self-restart': '.task(id: quoteTaskTrigger)' in s and 'local-review:' in s,
 'older async results cannot commit': 'tripSummaryRevision == revision' in r and 'quoteGeneration == generation' in s,
 'parent screens do not reprice downstream': '!showTransfer, !showFinalAfterHotels' in h and '!showFinalPackage, !showHotelsAfterTransfer' in t,
 'alternate room blocks booking until accepted': 'if !journey.tripSummaryRoomAlternatives.isEmpty { return false }' in s and 'journey.tripSummaryRoomAlternatives = []' in s,
 'expired anchor retry is bounded': 'NUITEE_SELECTED_RATE_EXPIRED' in j and 'markLocalRoomsForReprice()' in j,
 'new room per city built for party': 'for index in 0..<next.rooms' in j and 'for city in ["makkah", "madinah"]' in j,
 'backend quote and fee reconciliation still required': 'price.reconciles(with: quote.totalPackagePrice)' in s and 'await journey.buildConfiguratorQuote' in s,
}
for label,ok in checks.items(): print(('PASS: ' if ok else 'FAIL: ')+label)
assert all(checks.values())
PY
