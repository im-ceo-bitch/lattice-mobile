import SwiftUI
import UIKit

struct BookingSecurityAdminCard: View {
    let bookingID: String
    let security: BusinessSecuritySubmission?
    let onChanged: () -> Void

    @State private var passportImage: UIImage?
    @State private var loadingImage = false
    @State private var reviewNote = ""
    @State private var workingAction: String?
    @State private var errorMessage: String?
    @State private var showPassport = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header

            if let security {
                statusSummary(security)
                identityDetails(security)
                passportPreview(security)

                if security.isPendingReview {
                    reviewControls(security)
                } else if security.isConfirmed {
                    confirmedFooter(security)
                } else if security.needsCorrection {
                    correctionFooter(security)
                }
            } else {
                emptyState
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(18)
        .businessCard(radius: 28)
        .task(id: security?.passportMediaURL) {
            await loadPassportIfNeeded()
        }
        .fullScreenCover(isPresented: $showPassport) {
            PassportSecurityPreview(image: passportImage)
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 18, weight: .semibold))
                .frame(width: 44, height: 44)
                .businessGlass(in: RoundedRectangle(cornerRadius: 16, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text("iUmrah Security")
                    .font(.title3.bold())
                Text("Security Confirmation · KYC")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private func statusSummary(_ value: BusinessSecuritySubmission) -> some View {
        HStack(spacing: 10) {
            Circle()
                .fill(statusColor(value.status))
                .frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 2) {
                Text(statusTitle(value.status))
                    .font(.subheadline.weight(.bold))
                if let submitted = value.submittedAt, !submitted.isEmpty {
                    Text("Отправлено: \(compactDate(submitted))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding(13)
        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func identityDetails(_ value: BusinessSecuritySubmission) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Паспортный профиль")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            detailRow("Имя", value.firstName.isEmpty ? "—" : value.firstName)
            detailRow("Фамилия", value.lastName.isEmpty ? "—" : value.lastName)
            detailRow("Номер паспорта", value.passportNumber.isEmpty ? maskedPassport(value.passportLast4) : value.passportNumber)

            if let duplicate = value.duplicateBookingID, !duplicate.isEmpty {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "exclamationmark.shield.fill")
                        .foregroundStyle(.orange)
                    Text("Этот паспорт уже подтверждался в бронировании \(duplicate). Проверьте, что данные действительно принадлежат владельцу текущей поездки.")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(12)
                .background(Color.orange.opacity(0.07), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
    }

    private func passportPreview(_ value: BusinessSecuritySubmission) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Фото паспорта")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if value.hasPassportPhoto {
                    Label("Прикреплено", systemImage: "checkmark.circle.fill")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.green)
                }
            }

            Button {
                if passportImage != nil { showPassport = true }
            } label: {
                Group {
                    if let passportImage {
                        Image(uiImage: passportImage)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: .infinity)
                            .frame(height: 190)
                            .background(BusinessDesign.secondarySurface)
                    } else if loadingImage {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .frame(height: 150)
                    } else {
                        VStack(spacing: 9) {
                            Image(systemName: value.hasPassportPhoto ? "photo.badge.exclamationmark" : "photo.badge.plus")
                                .font(.system(size: 28, weight: .semibold))
                            Text(value.hasPassportPhoto ? "Не удалось загрузить фото" : "Фото ещё не прикреплено")
                                .font(.subheadline.weight(.semibold))
                        }
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 150)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(Color.primary.opacity(0.07), lineWidth: 1)
                }
            }
            .buttonStyle(.plain)
            .disabled(passportImage == nil)
        }
    }

    private func reviewControls(_ value: BusinessSecuritySubmission) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Ручная проверка")
                .font(.headline)

            TextField("Комментарий паломнику (необязательно)", text: $reviewNote, axis: .vertical)
                .lineLimit(2...4)
                .padding(12)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 17, style: .continuous))

            BusinessGlassGroup(spacing: 10) {
                VStack(spacing: 10) {
                    Button {
                        Task { await review(action: "approve") }
                    } label: {
                        HStack {
                            if workingAction == "approve" { ProgressView().controlSize(.small) }
                            else { Image(systemName: "checkmark.shield.fill") }
                            Text("Подтвердить KYC")
                            Spacer()
                            Image(systemName: "checkmark")
                        }
                        .font(.subheadline.weight(.bold))
                        .padding(.horizontal, 16)
                        .frame(height: 52)
                        .businessGlass(in: RoundedRectangle(cornerRadius: 19, style: .continuous), interactive: true)
                    }
                    .buttonStyle(.plain)
                    .disabled(workingAction != nil || !value.hasPassportPhoto)

                    HStack(spacing: 10) {
                        Button {
                            Task { await review(action: "needs_resubmission") }
                        } label: {
                            Label("Исправить", systemImage: "arrow.triangle.2.circlepath")
                                .font(.caption.weight(.bold))
                                .frame(maxWidth: .infinity)
                                .frame(height: 46)
                                .businessGlass(in: RoundedRectangle(cornerRadius: 17, style: .continuous), interactive: true)
                        }
                        .buttonStyle(.plain)
                        .disabled(workingAction != nil)

                        Button {
                            Task { await review(action: "reject") }
                        } label: {
                            Label("Отклонить", systemImage: "xmark.shield.fill")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.red)
                                .frame(maxWidth: .infinity)
                                .frame(height: 46)
                                .businessGlass(in: RoundedRectangle(cornerRadius: 17, style: .continuous), interactive: true)
                        }
                        .buttonStyle(.plain)
                        .disabled(workingAction != nil)
                    }
                }
            }
        }
    }

    private func confirmedFooter(_ value: BusinessSecuritySubmission) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "checkmark.seal.fill")
                .foregroundStyle(.green)
            VStack(alignment: .leading, spacing: 2) {
                Text("Личность подтверждена вручную")
                    .font(.subheadline.weight(.bold))
                if let reviewer = value.reviewedBy, !reviewer.isEmpty {
                    Text("Проверил: \(reviewer)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
    }

    private func correctionFooter(_ value: BusinessSecuritySubmission) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Label(statusTitle(value.status), systemImage: "arrow.triangle.2.circlepath")
                .font(.subheadline.weight(.bold))
            if !value.reviewNote.isEmpty {
                Text(value.reviewNote)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var emptyState: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "hourglass")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 4) {
                Text("KYC ещё не отправлен")
                    .font(.subheadline.weight(.bold))
                Text("После перехода поездки в статус «Оплата и данные паломников» клиент сможет отправить паспортный профиль на ручную проверку.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func detailRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text(title)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.subheadline.weight(.semibold))
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
    }

    @MainActor
    private func loadPassportIfNeeded() async {
        passportImage = nil
        guard let path = security?.passportMediaURL, !path.isEmpty else { return }
        loadingImage = true
        defer { loadingImage = false }
        do {
            let data = try await APIClient.shared.privateMedia(path: path)
            passportImage = UIImage(data: data)
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch let error as URLError where error.code == .cancelled {
            return
        } catch {
            errorMessage = "Не удалось безопасно загрузить фото паспорта."
        }
    }

    @MainActor
    private func review(action: String) async {
        guard workingAction == nil else { return }
        workingAction = action
        defer { workingAction = nil }
        do {
            _ = try await APIClient.shared.reviewBookingSecurity(bookingID: bookingID, action: action, note: reviewNote)
            reviewNote = ""
            errorMessage = nil
            onChanged()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func statusTitle(_ status: String) -> String {
        switch status {
        case "draft": return "Профиль не отправлен"
        case "submitted": return "Ожидает ручной проверки"
        case "under_review": return "На ручной проверке"
        case "confirmed": return "Подтверждено"
        case "rejected": return "Отклонено"
        case "needs_resubmission": return "Нужно исправить данные"
        default: return status
        }
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "confirmed": return .green
        case "rejected": return .red
        case "needs_resubmission": return .orange
        case "submitted", "under_review": return BusinessDesign.securityBlue
        default: return .secondary
        }
    }

    private func maskedPassport(_ last4: String) -> String {
        last4.isEmpty ? "—" : "•••••• \(last4)"
    }

    private func compactDate(_ value: String) -> String {
        let parser = ISO8601DateFormatter()
        guard let date = parser.date(from: value) else { return value }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

private struct PassportSecurityPreview: View {
    @Environment(\.dismiss) private var dismiss
    let image: UIImage?

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            GeometryReader { proxy in
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .scaleEffect(scale)
                        .offset(offset)
                        .contentShape(Rectangle())
                        .gesture(
                            MagnificationGesture()
                                .onChanged { value in
                                    scale = min(5, max(1, lastScale * value))
                                }
                                .onEnded { _ in
                                    lastScale = scale
                                    if scale <= 1.01 {
                                        withAnimation(.spring(response: 0.28, dampingFraction: 0.88)) {
                                            scale = 1
                                            lastScale = 1
                                            offset = .zero
                                            lastOffset = .zero
                                        }
                                    }
                                }
                        )
                        .simultaneousGesture(
                            DragGesture()
                                .onChanged { value in
                                    guard scale > 1 else { return }
                                    offset = CGSize(
                                        width: lastOffset.width + value.translation.width,
                                        height: lastOffset.height + value.translation.height
                                    )
                                }
                                .onEnded { _ in
                                    lastOffset = offset
                                }
                        )
                        .onTapGesture(count: 2) {
                            withAnimation(.spring(response: 0.30, dampingFraction: 0.86)) {
                                if scale > 1 {
                                    scale = 1
                                    lastScale = 1
                                    offset = .zero
                                    lastOffset = .zero
                                } else {
                                    scale = 2
                                    lastScale = 2
                                }
                            }
                        }
                } else {
                    ContentUnavailableView("Фото недоступно", systemImage: "photo")
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack(spacing: 12) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 46, height: 46)
                        .businessGlass(in: Circle(), interactive: true)
                }
                .buttonStyle(.plain)

                Text("Фото паспорта")
                    .font(.headline)
                    .foregroundStyle(.white)

                Spacer()

                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 46, height: 46)
                        .businessGlass(in: Circle(), interactive: true)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(Color.black.opacity(0.96))
        }
        .statusBarHidden(false)
    }
}
