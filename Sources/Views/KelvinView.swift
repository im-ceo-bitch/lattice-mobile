import SwiftUI
import UIKit
import AVFoundation
import Speech

@MainActor
final class KelvinSpeech: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published private(set) var recording = false
    @Published private(set) var speaking = false
    @Published private(set) var transcript = ""
    @Published private(set) var level: Double = 0
    @Published var error: String?
    private let synth = AVSpeechSynthesizer()
    private let engine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var recognition: SFSpeechRecognitionTask?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var tapped = false
    private var generation = UUID()
    override init() { super.init(); synth.delegate = self }
    func start() async {
        guard !recording else { return }
        let generation = UUID(); self.generation = generation
        error = nil
        let permission = await withCheckedContinuation { (c: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) } }
        guard generation == self.generation else { return }
        guard permission == .authorized else { error = "Разрешите распознавание речи в настройках."; return }
        let allowed = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in AVAudioSession.sharedInstance().requestRecordPermission { c.resume(returning: $0) } }
        guard generation == self.generation else { return }
        guard allowed else { error = "Разрешите доступ к микрофону."; return }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ru-RU")), recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
            error = "Русское распознавание на устройстве недоступно. Используйте диктовку клавиатуры или текст."; return
        }
        self.recognizer = recognizer
        synth.stopSpeaking(at: .immediate); speaking = false
        transcript = ""; level = 0
        let req = SFSpeechAudioBufferRecognitionRequest(); req.requiresOnDeviceRecognition = true; req.shouldReportPartialResults = true
        request = req
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.record, mode: .measurement); try audio.setActive(true)
            let input = engine.inputNode, format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw APIError.invalidResponse }
            input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
                req.append(buffer)
                guard let p = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
                let n = Int(buffer.frameLength); var sum: Float = 0
                for i in 0..<n { sum += p[i] * p[i] }
                let amplitude = min(1, Double(sqrt(sum / Float(n))) * 9)
                Task { @MainActor [weak self] in if self?.recording == true { self?.level = amplitude } }
            }
            tapped = true; engine.prepare(); try engine.start(); recording = true
            recognition = recognizer.recognitionTask(with: req) { [weak self] result, failure in
                let text = result?.bestTranscription.formattedString
                let final = result?.isFinal == true
                Task { @MainActor [weak self] in
                    guard let self, self.generation == generation else { return }
                    if let text { self.transcript = text }
                    if final || failure != nil { self.stopRecording(); if text == nil && self.transcript.isEmpty { self.error = "Не удалось распознать речь." } }
                }
            }
        } catch { stopRecording(); self.error = "Не удалось запустить микрофон." }
    }
    func stopRecording() {
        generation = UUID(); engine.stop()
        if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
        request?.endAudio(); recognition?.cancel(); recognition = nil; request = nil; recognizer = nil
        recording = false; level = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    func play(_ text: String) {
        stopRecording(); synth.stopSpeaking(at: .immediate)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        let speech = AVSpeechUtterance(string: text); speech.voice = AVSpeechSynthesisVoice(language: "ru-RU")
        speaking = true; synth.speak(speech)
    }
    func stop() { stopRecording(); synth.stopSpeaking(at: .immediate); speaking = false }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { Task { @MainActor [weak self] in self?.speaking = false } }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) { Task { @MainActor [weak self] in if self?.synth.isSpeaking == false { self?.speaking = false } } }
}

struct KelvinView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var speech = KelvinSpeech()
    @State private var history: KelvinHistory?
    @State private var draft = ""
    @State private var requestID = UUID().uuidString
    @State private var lastSubmittedText = ""
    @State private var submitting = false
    @State private var error: String?
    @State private var pairingToken: String?
    @State private var confirmPair = false
    @State private var showMemory = false
    @State private var showVoice = false
    @State private var confirmRevoke = false
    private var owner: Bool { auth.user?.role.lowercased() == "superadmin" }
    private var pending: Bool { history?.turns.contains { ["queued","running"].contains($0.status) } == true }
    private var state: KelvinVoiceState { speech.recording ? .listening : speech.speaking ? .speaking : pending ? .thinking : .idle }
    var body: some View {
        Group {
            if owner {
                VStack(spacing: 0) {
                    header
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 18) {
                                if history?.turns.isEmpty != false { intro }
                                ForEach(history?.turns ?? []) { turn in bubble(turn) }
                                Color.clear.frame(height: 1).id("bottom")
                            }.padding(16)
                        }
                        .onChange(of: history?.turns.last?.id, initial: true) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
                        .onChange(of: history?.turns.last?.status) { _, _ in withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
                    }
                    if let error = error ?? speech.error { Text(error).font(.caption).foregroundStyle(.orange).padding(8) }
                    composer
                }
                .background(Color(red: 8/255, green: 8/255, blue: 8/255))
                .preferredColorScheme(.dark)
                .task { while !Task.isCancelled && owner { await refresh(); try? await Task.sleep(for: .seconds(4)) } }
                .onChange(of: owner) { _, allowed in if !allowed { history = nil; pairingToken = nil; speech.stop() } }
                .onDisappear { speech.stop(); pairingToken = nil }
            } else { ContentUnavailableView("Kelvin", systemImage: "lock", description: Text("Только для владельца бизнеса.")) }
        }
        .navigationTitle("Kelvin")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if owner { ToolbarItem(placement: .topBarTrailing) { Menu {
                Button("Память", systemImage: "brain") { showMemory = true }
                Button("Подключить Mac", systemImage: "laptopcomputer") { confirmPair = true }
                Button("Отключить Mac", systemImage: "lock", role: .destructive) { confirmRevoke = true }
            } label: { Image(systemName: "ellipsis.circle") } } }
        }
        .confirmationDialog("Создать новый ключ? Старый Mac будет отключён.", isPresented: $confirmPair, titleVisibility: .visible) { Button("Создать ключ") { Task { await pair() } } }
        .confirmationDialog("Отключить Mac от общей истории?", isPresented: $confirmRevoke, titleVisibility: .visible) { Button("Отключить", role: .destructive) { Task { do { try await APIClient.shared.kelvinRevoke(); await refresh() } catch { self.error = error.localizedDescription } } } }
        .sheet(isPresented: Binding(get: { pairingToken != nil }, set: { if !$0 { pairingToken = nil } })) {
            VStack(alignment: .leading, spacing: 20) {
                Text("Подключение Mac").font(.title2.bold())
                Text("Скопируй ключ только на свой Mac. Не отправляй его в чат. На Mac запусти python-модуль shared_business согласно инструкции обновления.")
                if let token = pairingToken { Text(token).font(.system(.caption, design: .monospaced)).privacySensitive().textSelection(.enabled); Button("Скопировать ключ") { UIPasteboard.general.setItems([["public.utf8-plain-text":token]], options: [.localOnly:true,.expirationDate:Date().addingTimeInterval(120)]) }.buttonStyle(.borderedProminent) }
                Button("Готово") { pairingToken = nil }
            }.padding(24).presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showMemory) { NavigationStack { KelvinMemoryView() } }
        .sheet(isPresented: $showVoice) { voiceScreen }
    }
    private var header: some View {
        HStack { VStack(alignment: .leading, spacing: 4) { Text("kelvin.").font(.system(size: 34, weight: .semibold)); HStack(spacing: 6) { Circle().fill(history?.online == true && error == nil ? Color.green : Color.secondary).frame(width: 7,height: 7); Text(error != nil ? "Связь не подтверждена" : history == nil ? "Подключение…" : history?.online == true ? "MacBook на связи" : history?.paired == true ? "MacBook не отвечает" : "Подключи MacBook").font(.caption).foregroundStyle(.secondary) } }; Spacer(); Button { showVoice = true } label: { Image(systemName: "waveform").font(.title2).padding(14).background(.white.opacity(0.09),in: Circle()) }.accessibilityLabel("Голос Kelvin") }.padding(20)
    }
    private var intro: some View {
        VStack(spacing: 16) { KelvinVoiceOrb(state: state); Text("Чем займёмся сегодня?").font(.title2.bold()); Text("Единая история с Telegram. Бронирования, поддержка и аналитика бизнеса. Не отправляй сюда паспорта, пароли и платёжные данные.").font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center); Button("Что требует моего внимания?") { draft = "Какие три задачи сейчас важнее всего для iumrah?" }.buttonStyle(.bordered) }.frame(maxWidth: .infinity)
    }
    private func bubble(_ turn: KelvinTurn) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .trailing, spacing: 5) { Text(turn.source == "telegram" ? "Telegram" : turn.source == "briefing" ? "Утренний отчёт" : "iumrah Business").font(.caption2).foregroundStyle(.secondary); Text(turn.prompt).padding(13).background(.white.opacity(0.11), in: RoundedRectangle(cornerRadius: 18)).textSelection(.enabled) }.frame(maxWidth: .infinity, alignment: .trailing)
            if let answer = turn.answer {
                VStack(alignment: .leading, spacing: 10) { Label("Kelvin", systemImage: "waveform").font(.caption.weight(.semibold)); Text(answer).textSelection(.enabled); if turn.status == "done" { Button { speech.play(answer) } label: { Label("Прослушать", systemImage: "speaker.wave.2") }.font(.caption) } }.padding(14).frame(maxWidth: .infinity,alignment: .leading).background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 18))
            } else { Label(turn.status == "running" ? "Kelvin думает…" : "В очереди на MacBook", systemImage: "clock").font(.caption).foregroundStyle(.secondary) }
        }
    }
    private var composer: some View {
        HStack(alignment: .bottom, spacing: 12) {
            TextField("Спроси Kelvin…", text: $draft, axis: .vertical).lineLimit(1...5).padding(12)
            Button { showVoice = true } label: { Image(systemName: "mic").font(.title3) }.accessibilityLabel("Голосовой ввод")
            Button { Task { await send() } } label: { Image(systemName: "arrow.up.circle.fill").font(.system(size: 36)) }.disabled(submitting || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }.padding(12).background(.white.opacity(0.08),in: RoundedRectangle(cornerRadius: 25)).padding(12)
    }
    private var voiceScreen: some View {
        VStack(spacing: 16) {
            Text("kelvin.").font(.largeTitle.weight(.semibold))
            KelvinVoiceOrb(state: state, audioLevel: speech.recording ? speech.level : nil)
            Text(speech.recording ? "Я слушаю" : speech.speaking ? "Kelvin говорит" : pending ? "Kelvin думает" : "Голосовой режим").font(.title2)
            Text(speech.transcript.isEmpty ? "Нажми микрофон и говори. Затем проверь текст." : speech.transcript).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if let issue = speech.error { Text(issue).font(.caption).foregroundStyle(.orange) }
            HStack(spacing: 28) {
                Button { speech.stop() } label: { Image(systemName: "speaker.slash").font(.title2) }
                Button { if speech.recording { speech.stopRecording() } else { Task { await speech.start() } } } label: { Image(systemName: speech.recording ? "stop.fill" : "mic.fill").font(.system(size: 28)).frame(width: 68,height: 68).foregroundStyle(.black).background(.white,in: Circle()) }
                Button { speech.stop(); showVoice = false } label: { Image(systemName: "phone.down.fill").font(.title2) }
            }.padding()
            Button("Использовать текст") { draft = speech.transcript; speech.stop(); showVoice = false }.buttonStyle(.borderedProminent).disabled(speech.transcript.isEmpty)
            Text("Распознавание на устройстве. Это голосовые запросы, не прямой звонок.").font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Spacer()
        }.padding(24).frame(maxWidth: .infinity,maxHeight: .infinity).background(Color(red: 8/255,green: 8/255,blue: 8/255)).preferredColorScheme(.dark).onDisappear { speech.stop() }
    }
    private func refresh() async { do { let value = try await APIClient.shared.kelvinHistory(); if owner && !Task.isCancelled { history = value; error = nil } } catch is CancellationError {} catch { if owner && !Task.isCancelled { self.error = error.localizedDescription } } }
    private func pair() async { do { let token = try await APIClient.shared.kelvinPair(); if owner { pairingToken = token }; await refresh() } catch { self.error = error.localizedDescription } }
    private func send() async {
        guard owner,!submitting else { return }; let text = draft.trimmingCharacters(in: .whitespacesAndNewlines); guard !text.isEmpty else { return }
        if text != lastSubmittedText { requestID = UUID().uuidString; lastSubmittedText = text }
        submitting = true; defer { submitting = false }
        do { try await APIClient.shared.kelvinSend(id: requestID,text: text); if draft.trimmingCharacters(in: .whitespacesAndNewlines) == text { draft = "" }; requestID = UUID().uuidString; lastSubmittedText = ""; await refresh() } catch { self.error = error.localizedDescription }
    }
}

private struct KelvinMemoryView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var notes: [KelvinNote] = []
    @State private var text = ""
    @State private var error: String?
    var body: some View { List {
        Section("Общая память") { TextField("Что нужно запомнить?",text: $text,axis: .vertical); Button("Запомнить") { Task { do { try await APIClient.shared.kelvinRemember(id: UUID().uuidString,text: text); text = ""; await load() } catch { self.error = error.localizedDescription } } }.disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
        Section("Заметки") { ForEach(notes) { note in Text(note.content).swipeActions { Button("Удалить",role:.destructive) { Task { do { try await APIClient.shared.kelvinForget(id:note.id); await load() } catch { self.error = error.localizedDescription } } } } } }
        if let error { Text(error).foregroundStyle(.secondary) }
    }.navigationTitle("Память Kelvin").toolbar { ToolbarItem(placement:.confirmationAction) { Button("Готово") { dismiss() } } }.task { await load() } }
    private func load() async { do { notes = try await APIClient.shared.kelvinNotes() } catch { self.error = error.localizedDescription } }
}
