import SwiftUI

/// Read-only progress from the server's operational status, never a staged local edit.
struct BusinessBookingProgress: View {
    let status: TripStatus
    private let stages: [TripStatus] = [.availabilityCheck, .paymentPending, .bookingConfirmed, .readyToTravel, .inTrip, .completed]
    var body: some View {
        if status != .cancelled, let current = stages.firstIndex(of: status) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    ForEach(stages.indices, id: \.self) { index in
                        Capsule().fill(index <= current ? BusinessDesign.ink : BusinessDesign.line)
                            .frame(height: 5)
                    }
                }
                Text("Этап \(current + 1) из \(stages.count)")
                    .font(.caption.weight(.medium)).foregroundStyle(BusinessDesign.muted)
            }.accessibilityElement(children: .combine)
        }
    }
}
