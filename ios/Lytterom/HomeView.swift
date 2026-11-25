import SwiftUI

struct HomeView: View {
    @Environment(Library.self) private var library
    @Environment(Player.self) private var player
    let openCourse: (String) -> Void

    @State private var code = ""
    @State private var adding = false
    @State private var message: Message?
    @State private var showScanner = false
    @FocusState private var codeFocused: Bool

    private struct Message: Equatable {
        var isError: Bool
        var text: String
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                hero
                if let last = continueSelection {
                    ContinueCard(selection: last)
                }
                myCourses
                footer
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Mine fag")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) { BrandMark() }
        }
        .refreshable {
            await library.refresh()
            await syncLast()
        }
        .task {
            await library.refresh()
            await syncLast()
        }
        .sheet(isPresented: $showScanner) {
            ScannerSheet { scanned in
                showScanner = false
                handleScan(scanned)
            }
        }
    }

    // MARK: Deler

    private var hero: some View {
        VStack(alignment: .leading, spacing: 16) {
            Eyebrow(text: "Pensum på øret")
            Text("Lytt til fagene dine – på bussen, på trening eller hjemme.")
                .font(Theme.serif(.title))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)

            Card {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Klassekode fra læreren")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    HStack(spacing: 10) {
                        TextField("F.eks. HIST-VG3", text: $code)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .submitLabel(.go)
                            .focused($codeFocused)
                            .onSubmit(add)
                            .font(.body.weight(.medium))
                            .padding(.horizontal, 14)
                            .frame(height: 50)
                            .background(Theme.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.line))
                            .onChange(of: code) { _, value in
                                let upper = String(value.uppercased().prefix(32))
                                if upper != value { code = upper }
                            }
                        Button(action: add) {
                            HStack(spacing: 6) {
                                if adding { ProgressView().tint(.white) } else { Image(systemName: "arrow.right") }
                                Text("Legg til")
                            }
                            .font(.body.weight(.semibold))
                            .padding(.horizontal, 16)
                            .frame(height: 50)
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(adding || ClassCode.normalize(code).isEmpty)
                    }

                    if ScannerSheet.isSupported {
                        Button {
                            codeFocused = false
                            showScanner = true
                        } label: {
                            Label("Skann QR-koden fra læreren", systemImage: "qrcode.viewfinder")
                                .font(.subheadline.weight(.semibold))
                        }
                    } else {
                        Label("Har læreren vist en QR-kode? Skann den med kameraet.", systemImage: "qrcode")
                            .font(.footnote)
                            .foregroundStyle(Theme.muted)
                    }

                    if let message {
                        Text(message.text)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(message.isError ? Theme.danger : Theme.ok)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                }
                .padding(16)
            }
        }
    }

    private var myCourses: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("Mine fag")
                    .font(Theme.serif(.title2))
                    .foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if !library.courses.isEmpty {
                    Text("\(library.courses.count) fag")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
            }

            if let error = library.loadError, !library.codes.isEmpty {
                Label(library.courses.isEmpty ? error : "Viser lagrede fag. \(error)", systemImage: "wifi.exclamationmark")
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
            }

            if !library.courses.isEmpty {
                ForEach(library.courses) { course in
                    CourseCard(course: course) { library.remove(code: course.code) }
                }
            } else if library.isLoading && !library.codes.isEmpty {
                ForEach(0..<min(3, library.codes.count), id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Theme.surface2)
                        .frame(height: 120)
                }
                .accessibilityLabel("Henter fagene dine")
            } else if library.codes.isEmpty || library.loadError == nil {
                emptyState
            } else {
                Button("Prøv igjen") { Task { await library.refresh() } }
                    .font(.subheadline.weight(.semibold))
            }
        }
    }

    private var emptyState: some View {
        Card {
            VStack(spacing: 10) {
                Image(systemName: "iphone")
                    .font(.system(size: 30, weight: .light))
                    .foregroundStyle(Theme.muted)
                Text("Ingen fag ennå")
                    .font(Theme.serif(.title3))
                    .foregroundStyle(Theme.ink)
                Text("Skriv inn klassekoden fra læreren din over, eller prøv eksempelfaget.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
                Button {
                    Task { await lookup(AppConfig.exampleCode, open: false) }
                } label: {
                    Text("Prøv eksempelfaget \(AppConfig.exampleCode)")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 16)
                        .frame(height: 44)
                }
                .buttonStyle(.bordered)
                .disabled(adding)
                .padding(.top, 4)
            }
            .frame(maxWidth: .infinity)
            .padding(24)
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Lytterom lagrer ingenting om deg. Fagene og fremgangen din ligger bare på denne enheten.")
                .font(.footnote)
                .foregroundStyle(Theme.muted)
            Link("Er du lærer? Lærerstudio åpnes på nett →", destination: AppConfig.baseURL.appending(path: "studio"))
                .font(.footnote.weight(.semibold))
            Link("Personvern", destination: AppConfig.privacyURL)
                .font(.footnote.weight(.semibold))
        }
        .padding(.top, 8)
    }

    // MARK: Logikk

    /// «Fortsett der du slapp» vises bare for fag eleven fortsatt følger.
    private var continueSelection: Selection? {
        guard let last = library.lastPlayed, library.isFollowing(last.course.code) else { return nil }
        return last
    }

    private func syncLast() async {
        guard let last = continueSelection else { return }
        do {
            let fresh = try await API.course(code: last.course.normalizedCode, full: true)
            library.cache(fresh)
            library.syncCourse(id: last.course.id, fresh: fresh)
        } catch let error as APIError where error.status == 404 {
            library.syncCourse(id: last.course.id, fresh: nil)
        } catch {
            // Uten nett beholdes kortet som det er.
        }
    }

    private func add() {
        let value = code
        Task { await lookup(value, open: false) }
    }

    private func lookup(_ value: String, open: Bool) async {
        guard !ClassCode.normalize(value).isEmpty, !adding else { return }
        adding = true
        message = nil
        defer { adding = false }
        do {
            let course = try await library.add(code: value)
            code = ""
            codeFocused = false
            message = Message(isError: false, text: "\(course.title) er lagt til i Mine fag.")
            if open { openCourse(course.normalizedCode) }
        } catch {
            message = Message(isError: true, text: error.localizedDescription)
        }
    }

    private func handleScan(_ raw: String) {
        guard let scanned = ClassCode.code(fromScan: raw) else {
            message = Message(isError: true, text: "QR-koden er ikke en klassekode fra Lytterom.")
            return
        }
        Task { await lookup(scanned, open: true) }
    }
}

struct BrandMark: View {
    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "dot.radiowaves.left.and.right")
                .font(.footnote.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 26, height: 26)
                .background(Theme.terracotta, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            Text("Lytterom")
                .font(Theme.serif(.headline))
                .foregroundStyle(Theme.ink)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Lytterom")
    }
}

struct CourseCard: View {
    let course: Course
    let remove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            NavigationLink(value: CourseRoute(code: course.normalizedCode)) {
                Card {
                    HStack(spacing: 0) {
                        Rectangle().fill(course.accent).frame(width: 5)
                        VStack(alignment: .leading, spacing: 6) {
                            Eyebrow(text: course.subtitle, color: course.accent)
                            Text(course.title)
                                .font(Theme.serif(.title3))
                                .foregroundStyle(Theme.ink)
                                .multilineTextAlignment(.leading)
                            if !course.teacherName.isEmpty {
                                Text(course.teacherName)
                                    .font(.subheadline)
                                    .foregroundStyle(Theme.muted)
                            }
                            HStack {
                                Label("\(course.episodeCount) \(course.episodeCount == 1 ? "episode" : "episoder")", systemImage: "headphones")
                                    .font(.footnote.weight(.medium))
                                Spacer()
                                Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                            }
                            .foregroundStyle(Theme.muted)
                            .padding(.top, 4)
                        }
                        .padding(16)
                        .padding(.trailing, 24)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
            }
            .buttonStyle(.plain)
            .contextMenu {
                Button(role: .destructive, action: remove) {
                    Label("Fjern fra Mine fag", systemImage: "minus.circle")
                }
            }

            Button(action: remove) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Fjern \(course.title) fra Mine fag")
        }
    }
}

struct ContinueCard: View {
    @Environment(Library.self) private var library
    @Environment(Player.self) private var player
    let selection: Selection

    var body: some View {
        let progress = library.progress[selection.episode.id]
        let length = selection.episode.durationSeconds
        let fraction = length > 0 && progress?.completed != true ? min(1, (progress?.position ?? 0) / length) : 0
        let playing = player.episode?.id == selection.episode.id && player.isPlaying

        Button {
            player.play(selection.episode, in: selection.course)
        } label: {
            Card {
                HStack(spacing: 14) {
                    Image(systemName: playing ? "pause.fill" : "play.fill")
                        .font(.title2)
                        .foregroundStyle(.white)
                        .frame(width: 60, height: 60)
                        .background(selection.course.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(progress?.completed == true ? "Hør igjen" : "Fortsett der du slapp")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(selection.course.accent)
                        Text(selection.episode.title)
                            .font(.headline)
                            .foregroundStyle(Theme.ink)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Text(selection.course.title)
                            .font(.subheadline)
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                        if fraction > 0 {
                            ProgressBar(fraction: fraction, color: selection.course.accent, height: 4)
                                .padding(.top, 4)
                        }
                    }
                }
                .padding(14)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(playing ? "Pause" : "Fortsett"): \(selection.episode.title), \(selection.course.title)")
    }
}
