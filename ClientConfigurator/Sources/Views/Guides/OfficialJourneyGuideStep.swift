import SwiftUI

/// The official flow uses the same public directory and booking preference as review.
/// A preferred guide is not an operational reservation.
struct OfficialJourneyGuideStep: View {
    @EnvironmentObject private var journey: JourneyStore
    @EnvironmentObject private var settings: AppSettingsStore
    var familyFlow = false
    @State private var showReview = false
    @State private var explicitlySelected = false
    @State private var profilesLoaded = false
    private func t(_ ru: String, _ en: String, _ uz: String, _ cy: String) -> String {
        IumrahFlightCopy.text(settings.language, ru, en, uz, cy)
    }
    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 18) {
                IumrahJourneyHeader(showsNotifications: true) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(t("Гид и команда iumrah", "Guide and iumrah team", "Gid va iumrah jamoasi", "Гид ва iumrah жамоаси"))
                            .font(.system(.title2, design: .rounded, weight: .bold))
                        Text(t("Персональное сопровождение вашей семьи", "Personal accompaniment for your family", "Oilangiz uchun shaxsiy hamrohlik", "Оилангиз учун шахсий ҳамроҳлик"))
                            .font(.subheadline).foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
                        .background(Color.iumrahCardBackground, in: RoundedRectangle(cornerRadius: 24))
                }
                IumrahGuideCatalog(trip: journey.trip, preference: journey.trip.guidePreference,
                    priceText: nil, includeTeam: true, onProfilesLoaded: { guides in
                        profilesLoaded = true
                        // Do not override an explicit choice; invalidate a stale preference if unavailable.
                        if let current = journey.trip.guidePreference {
                            if !guides.contains(where: { $0.id == current.memberID && $0.guideAvailable == true }) {
                                select(nil)
                            }
                        } else if !explicitlySelected {
                            let available = guides.filter { $0.guideAvailable == true }
                            let matching = available.filter { ConfiguratorRepricingPolicy.isDavletbek([$0.firstName, $0.displayName, $0.publicSlug]) }
                            if matching.count == 1, let guide = matching.first {
                                select(.init(memberID: guide.id, displayName: guide.displayName))
                            }
                        }
                    }, onSelect: { preference in
                        explicitlySelected = true
                        select(preference)
                    }).padding(.horizontal, IumrahDesign.pagePadding)
            }.padding(.bottom, 24)
        }
        .background(Color.iumrahPageBackground)
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                Text(journey.trip.guidePreference?.displayName ?? t("Подбор от iumrah", "Selected by iumrah", "iumrah tanlovi", "iumrah танлови"))
                    .font(.subheadline.weight(.semibold))
                Button(t("Перейти к итоговой странице", "Continue to trip summary", "Safar yakuniga o‘tish", "Сафар якунига ўтиш")) {
                    showReview = true
                }.buttonStyle(IumrahPrimaryButtonStyle())
                    .disabled(!profilesLoaded && !explicitlySelected)
            }.padding(.horizontal, IumrahDesign.pagePadding).padding(.vertical, 10).background(.regularMaterial)
        }
        .navigationDestination(isPresented: $showReview) { FinalPackageView(familyFlow: familyFlow) }
    }
    private func select(_ preference: IumrahGuidePreference?) {
        guard journey.trip.guidePreference != preference else { return }
        journey.trip.guidePreference = preference
        journey.invalidateTripSummaryQuote()
    }
}
