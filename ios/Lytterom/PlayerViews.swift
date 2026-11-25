import AVKit
import SwiftUI
import WebKit

struct MiniPlayer: View {
    @Environment(Player.self) private var player

    var body: some View {
        if let episode = player.episode, let course = player.course {
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Button {
                        player.expanded = true
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: episode.mediaType == .audio ? "headphones" : "play.rectangle.fill")
                                .foregroundStyle(.white)
                                .frame(width: 42, height: 42)
                                .background(course.accent, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(episode.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                                Text(course.title).font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Åpne avspiller: \(episode.title)")

                    if episode.isPlayable {
                        Button(action: player.togglePlay) {
                            Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                                .font(.title3)
                                .foregroundStyle(Theme.ink)
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(player.isPlaying ? "Pause" : "Spill av")
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)

                ProgressBar(fraction: player.duration > 0 ? player.position / player.duration : 0, color: course.accent, height: 3)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 6)
            }
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.line.opacity(0.6)))
            .shadow(color: .black.opacity(0.12), radius: 16, y: 6)
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
        }
    }
}

struct PlayerSheet: View {
    @Environment(Player.self) private var player
    @Environment(Library.self) private var library
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if let episode = player.episode, let course = player.course {
            ScrollView {
                VStack(spacing: 22) {
                    HStack {
                        Text("SPILLER NÅ").font(.caption.weight(.bold)).tracking(1.2).foregroundStyle(Theme.muted)
                        Spacer()
                        Button { dismiss() } label: {
                            Image(systemName: "chevron.down").font(.headline).frame(width: 44, height: 44)
                        }
                        .foregroundStyle(Theme.ink)
                        .accessibilityLabel("Lukk fullskjermspiller")
                    }

                    media(episode, course)

                    VStack(spacing: 6) {
                        Text(course.title).font(.subheadline.weight(.semibold)).foregroundStyle(course.accent)
                        Text(episode.title)
                            .font(Theme.serif(.title2))
                            .foregroundStyle(Theme.ink)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                        if !course.teacherName.isEmpty {
                            Text(course.teacherName).font(.subheadline).foregroundStyle(Theme.muted)
                        }
                    }

                    if episode.isPlayable {
                        timeline(course)
                        controls(course)
                        Text(player.nextEpisode.map { "Neste: \($0.title)" } ?? "Dette er siste episode i faget.")
                            .font(.footnote)
                            .foregroundStyle(Theme.muted)
                            .multilineTextAlignment(.center)
                        settings
                    } else {
                        Text("Bruk videospillerens egne kontroller for avspilling og hastighet.")
                            .font(.footnote)
                            .foregroundStyle(Theme.muted)
                            .multilineTextAlignment(.center)
                    }

                    let done = library.progress[episode.id]?.completed == true
                    Button {
                        player.toggleCompleted()
                    } label: {
                        Label(done ? "Markert som fullført" : "Marker som fullført", systemImage: done ? "checkmark.circle.fill" : "checkmark.circle")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 46)
                    }
                    .buttonStyle(.bordered)
                    .tint(done ? Theme.ok : Theme.ink)

                    if let error = player.error {
                        Text(error).font(.footnote.weight(.medium)).foregroundStyle(Theme.danger).multilineTextAlignment(.center)
                    }

                    let notes = episode.studyNotes.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !notes.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Nøkkelpunkter").font(Theme.serif(.title3)).foregroundStyle(Theme.ink)
                            Text(notes).font(.body).foregroundStyle(Theme.ink).textSelection(.enabled)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
            }
            .background(Theme.background.ignoresSafeArea())
            .presentationDragIndicator(.visible)
        }
    }

    @ViewBuilder
    private func media(_ episode: Episode, _ course: Course) -> some View {
        switch episode.mediaType {
        case .embed:
            Group {
                if let url = EmbedPlayerView.safeURL(episode.embedUrl.isEmpty ? episode.mediaUrl : episode.embedUrl) {
                    EmbedPlayerView(url: url)
                } else {
                    Text("Videolenken er ugyldig eller støttes ikke.").font(.footnote).foregroundStyle(.white)
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(16 / 9, contentMode: .fit)
            .background(.black)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        case .video:
            VideoPlayer(player: player.avPlayer)
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        case .audio:
            VStack(spacing: 18) {
                Image(systemName: "headphones").font(.system(size: 76, weight: .ultraLight))
                Text("LYTTEROM / \(course.subject.uppercased())").font(.caption.weight(.bold)).tracking(1.2)
            }
            .foregroundStyle(.white)
            .frame(width: 260, height: 260)
            .background(course.accent, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .shadow(color: course.accent.opacity(0.35), radius: 24, y: 12)
            .accessibilityHidden(true)
        }
    }

    private func timeline(_ course: Course) -> some View {
        VStack(spacing: 4) {
            Slider(
                value: Binding(get: { min(player.position, max(player.duration, 0)) }, set: { player.scrub(to: $0) }),
                in: 0...max(player.duration, 1),
                onEditingChanged: { player.setScrubbing($0) }
            )
            .tint(course.accent)
            .accessibilityLabel("Avspillingsposisjon")
            .accessibilityValue("\(Format.time(player.position)) av \(Format.time(player.duration))")
            HStack {
                Text(Format.time(player.position))
                Spacer()
                Text("-\(Format.time(max(0, player.duration - player.position)))")
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(Theme.muted)
        }
    }

    private func controls(_ course: Course) -> some View {
        let previous = player.previousEpisode
        let next = player.nextEpisode
        return HStack {
            controlButton("backward.end.fill", label: previous.map { "Forrige episode: \($0.title)" } ?? "Ingen forrige episode", disabled: previous == nil) {
                player.goTo(previous)
            }
            Spacer()
            controlButton("gobackward.15", label: "Spol 15 sekunder tilbake") { player.skip(-15) }
            Spacer()
            Button(action: player.togglePlay) {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(.white)
                    .frame(width: 76, height: 76)
                    .background(course.accent, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(player.isPlaying ? "Pause" : "Spill av")
            Spacer()
            controlButton("goforward.15", label: "Spol 15 sekunder frem") { player.skip(15) }
            Spacer()
            controlButton("forward.end.fill", label: next.map { "Neste episode: \($0.title)" } ?? "Ingen neste episode", disabled: next == nil) {
                player.goTo(next)
            }
        }
    }

    private func controlButton(_ symbol: String, label: String, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.title2).frame(width: 48, height: 48)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.ink)
        .opacity(disabled ? 0.3 : 1)
        .disabled(disabled)
        .accessibilityLabel(label)
    }

    private var settings: some View {
        HStack(spacing: 12) {
            Menu {
                Picker("Hastighet", selection: Binding(get: { player.speed }, set: { player.setSpeed($0) })) {
                    ForEach(Player.rates, id: \.self) { rate in Text(Format.rate(rate)).tag(rate) }
                }
            } label: {
                settingLabel("speedometer", "Hastighet \(Format.rate(player.speed))")
            }
            .accessibilityLabel("Avspillingshastighet \(Format.rate(player.speed))")

            Menu {
                Picker("Søvntimer", selection: Binding(get: { player.sleepMinutes }, set: { player.setSleepTimer(minutes: $0) })) {
                    ForEach(Player.sleepOptions, id: \.self) { minutes in
                        Text(minutes == 0 ? "Av" : "\(minutes) min").tag(minutes)
                    }
                }
            } label: {
                settingLabel("moon.zzz", player.sleepMinutes == 0 ? "Søvntimer" : "Stopper om \(player.sleepMinutes) min")
            }
            .accessibilityLabel(player.sleepMinutes == 0 ? "Søvntimer av" : "Søvntimer \(player.sleepMinutes) minutter")
        }
    }

    private func settingLabel(_ symbol: String, _ text: String) -> some View {
        Label(text, systemImage: symbol)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.ink)
            .frame(maxWidth: .infinity)
            .frame(height: 42)
            .background(Theme.surface, in: Capsule())
            .overlay(Capsule().stroke(Theme.line))
    }
}

/// YouTube- og Vimeo-videoer spilles i sin egen spiller. Siden lastes med Lytterom som opphav,
/// fordi YouTube nekter å spille av innebygde videoer uten en avsender.
struct EmbedPlayerView: UIViewRepresentable {
    let url: URL

    static func safeURL(_ text: String) -> URL? {
        guard let url = URL(string: text), url.scheme == "https", let host = url.host()?.lowercased() else { return nil }
        let allowed = ["www.youtube-nocookie.com", "youtube-nocookie.com", "player.vimeo.com"]
        return allowed.contains(host) ? url : nil
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.isScrollEnabled = false
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.loaded != url else { return }
        context.coordinator.loaded = url
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let items = components?.queryItems ?? []
        components?.queryItems = items + [URLQueryItem(name: "playsinline", value: "1")]
        let source = (components?.url ?? url).absoluteString.replacingOccurrences(of: "\"", with: "%22")
        let html = """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style></head>
        <body><iframe src="\(source)" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>
        """
        view.loadHTMLString(html, baseURL: AppConfig.baseURL)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var loaded: URL?
    }
}
