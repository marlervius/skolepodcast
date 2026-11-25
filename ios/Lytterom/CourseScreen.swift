import SwiftUI

struct CourseScreen: View {
    @Environment(Library.self) private var library
    @Environment(Player.self) private var player
    @Environment(\.openURL) private var openURL
    let code: String

    @State private var course: Course?
    @State private var notFound = false
    @State private var offline = false
    @State private var query = ""
    @State private var filter: Filter = .all
    @State private var openNotes: String?

    enum Filter: String, CaseIterable, Identifiable {
        case all = "Alle", audio = "Podcast", video = "Video", unheard = "Ikke lyttet"
        var id: String { rawValue }
    }

    var body: some View {
        Group {
            if let course {
                content(course)
            } else if notFound {
                ContentUnavailableView {
                    Label("Fant ikke fagrommet", systemImage: "questionmark.folder")
                } description: {
                    Text("Klassekoden finnes ikke, eller læreren har slettet fagrommet. Sjekk at koden er skrevet riktig.")
                }
            } else if offline {
                ContentUnavailableView {
                    Label("Ingen nettforbindelse", systemImage: "wifi.slash")
                } description: {
                    Text("Kunne ikke hente faget. Sjekk nettforbindelsen og prøv igjen.")
                } actions: {
                    Button("Prøv igjen") { Task { await load() } }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(course?.title ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let course {
                ToolbarItem(placement: .topBarTrailing) { menu(course) }
            }
        }
        .task { await load() }
    }

    private func load() async {
        if course == nil, let cached = library.cachedCourse(code: code), !cached.topics.isEmpty { course = cached }
        do {
            let fresh = try await API.course(code: code, full: true)
            course = fresh
            notFound = false
            offline = false
            library.ensureFollowed(fresh)
            library.cache(fresh)
            library.syncCourse(id: fresh.id, fresh: fresh)
            player.refresh(course: fresh)
        } catch let error as APIError where error.status == 404 {
            if let course { library.syncCourse(id: course.id, fresh: nil) }
            course = nil
            notFound = true
        } catch {
            offline = true
        }
    }

    private func menu(_ course: Course) -> some View {
        Menu {
            ShareLink(item: AppConfig.courseWebURL(code: course.normalizedCode)) {
                Label("Del faget", systemImage: "square.and.arrow.up")
            }
            if library.isFollowing(course.code) {
                Button(role: .destructive) {
                    library.remove(code: course.code)
                } label: {
                    Label("Fjern fra Mine fag", systemImage: "minus.circle")
                }
            } else {
                Button {
                    library.ensureFollowed(course)
                } label: {
                    Label("Legg til i Mine fag", systemImage: "plus.circle")
                }
            }
            if !AppConfig.supportEmail.isEmpty {
                Button {
                    report(course)
                } label: {
                    Label("Rapporter innhold", systemImage: "flag")
                }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel("Flere valg")
    }

    private func report(_ course: Course) {
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = AppConfig.supportEmail
        components.queryItems = [
            URLQueryItem(name: "subject", value: "Rapport om innhold i \(course.title) (\(course.normalizedCode))"),
            URLQueryItem(name: "body", value: "Beskriv hva som er galt, og hvilken episode det gjelder:\n\n"),
        ]
        if let url = components.url { openURL(url) }
    }

    // MARK: Innhold

    private func content(_ course: Course) -> some View {
        let all = course.orderedEpisodes
        let completed = all.filter { library.progress[$0.id]?.completed == true }.count
        let topics = visibleTopics(course)
        let anyResults = topics.contains { !$0.episodes.isEmpty }

        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow(text: course.subtitle, color: course.accent)
                    Text(course.title)
                        .font(Theme.serif(.largeTitle))
                        .foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if !course.teacherName.isEmpty {
                        Text(course.teacherName).font(.subheadline.weight(.medium)).foregroundStyle(Theme.muted)
                    }
                    if !course.description.isEmpty {
                        Text(course.description).font(.body).foregroundStyle(Theme.ink).padding(.top, 4)
                    }
                    if !all.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            ProgressBar(fraction: Double(completed) / Double(all.count), color: course.accent)
                            Text("\(completed) av \(all.count) episoder fullført")
                                .font(.footnote)
                                .foregroundStyle(Theme.muted)
                        }
                        .padding(.top, 8)
                        .accessibilityElement(children: .combine)
                    }
                    if offline {
                        Label("Viser lagret versjon. Sjekk nettforbindelsen.", systemImage: "wifi.slash")
                            .font(.footnote)
                            .foregroundStyle(Theme.muted)
                            .padding(.top, 4)
                    }
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Filter.allCases) { item in
                            Button(item.rawValue) { filter = item }
                                .font(.subheadline.weight(.semibold))
                                .padding(.horizontal, 14)
                                .frame(height: 36)
                                .foregroundStyle(filter == item ? Color.white : Theme.ink)
                                .background(filter == item ? course.accent : Theme.surface, in: Capsule())
                                .overlay(Capsule().stroke(filter == item ? Color.clear : Theme.line))
                                .accessibilityAddTraits(filter == item ? .isSelected : [])
                        }
                    }
                }
                .scrollClipDisabled()

                if !anyResults && (!query.isEmpty || filter != .all) {
                    Text("Ingen episoder passer med søket eller filteret.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }

                ForEach(topics) { topic in
                    let index = (course.sortedTopics.firstIndex { $0.id == topic.id } ?? 0) + 1
                    VStack(alignment: .leading, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Eyebrow(text: "Kapittel \(index)", color: Theme.muted)
                            Text(topic.title)
                                .font(Theme.serif(.title2))
                                .foregroundStyle(Theme.ink)
                                .accessibilityAddTraits(.isHeader)
                            if !topic.description.isEmpty {
                                Text(topic.description).font(.subheadline).foregroundStyle(Theme.muted)
                            }
                        }
                        if topic.episodes.isEmpty {
                            Text("Ingen episoder i dette kapittelet ennå.")
                                .font(.subheadline)
                                .foregroundStyle(Theme.muted)
                        } else {
                            ForEach(topic.episodes) { episode in
                                EpisodeRow(
                                    episode: episode,
                                    course: course,
                                    notesOpen: openNotes == episode.id,
                                    toggleNotes: {
                                        withAnimation(.snappy) { openNotes = openNotes == episode.id ? nil : episode.id }
                                    }
                                )
                            }
                        }
                    }
                }

                if course.topics.isEmpty {
                    Text("Læreren har ikke publisert noe her ennå.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Søk i episoder og nøkkelpunkter")
        .refreshable { await load() }
    }

    private func visibleTopics(_ course: Course) -> [Topic] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return course.sortedTopics.compactMap { topic in
            let topicMatch = !needle.isEmpty && "\(topic.title) \(topic.description)".lowercased().contains(needle)
            var copy = topic
            copy.episodes = topic.episodes.sorted { $0.sortOrder < $1.sortOrder }.filter { episode in
                switch filter {
                case .audio where episode.mediaType != .audio: return false
                case .video where episode.mediaType == .audio: return false
                case .unheard where library.progress[episode.id]?.completed == true: return false
                default: break
                }
                if needle.isEmpty || topicMatch { return true }
                return "\(episode.title) \(episode.description) \(episode.studyNotes)".lowercased().contains(needle)
            }
            let keep = !copy.episodes.isEmpty || (needle.isEmpty && filter == .all)
            return keep ? copy : nil
        }
    }
}

struct EpisodeRow: View {
    @Environment(Library.self) private var library
    @Environment(Player.self) private var player
    let episode: Episode
    let course: Course
    let notesOpen: Bool
    let toggleNotes: () -> Void

    var body: some View {
        let state = library.progress[episode.id]
        let done = state?.completed == true
        let position = state?.position ?? 0
        let fraction = !done && position > 0 && episode.durationSeconds > 0 ? min(1, position / episode.durationSeconds) : 0
        let active = player.episode?.id == episode.id
        let playing = active && player.isPlaying
        let duration = Format.duration(episode.durationSeconds)
        let remaining = fraction > 0.02 ? Format.duration(episode.durationSeconds - position) : ""

        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 14) {
                    Button {
                        player.play(episode, in: course)
                    } label: {
                        Image(systemName: playing ? "pause.fill" : "play.fill")
                            .font(.body)
                            .foregroundStyle(.white)
                            .frame(width: 46, height: 46)
                            .background(course.accent, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(playing ? "Pause \(episode.title)" : "Spill av \(episode.title)")

                    VStack(alignment: .leading, spacing: 5) {
                        Text(episode.title)
                            .font(.headline)
                            .foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 5) {
                            Image(systemName: episode.kindIcon)
                            Text(episode.kindLabel)
                            if !duration.isEmpty {
                                Text("·")
                                Text(remaining.isEmpty ? duration : "\(remaining) igjen")
                            }
                            if done {
                                Text("·")
                                Label("Fullført", systemImage: "checkmark").foregroundStyle(Theme.ok)
                            }
                        }
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Theme.muted)
                        if !episode.description.isEmpty {
                            Text(episode.description)
                                .font(.subheadline)
                                .foregroundStyle(Theme.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if fraction > 0 {
                            ProgressBar(fraction: fraction, color: course.accent, height: 4).padding(.top, 4)
                        }
                    }
                }

                HStack(spacing: 18) {
                    if !episode.studyNotes.isEmpty {
                        Button(action: toggleNotes) {
                            HStack(spacing: 4) {
                                Text("Nøkkelpunkter")
                                Image(systemName: "chevron.down").rotationEffect(.degrees(notesOpen ? 180 : 0))
                            }
                        }
                        .accessibilityValue(notesOpen ? "Åpen" : "Lukket")
                    }
                    Button {
                        library.toggleCompleted(episode.id)
                    } label: {
                        Label(done ? "Ferdig lyttet" : "Marker som ferdig", systemImage: "checkmark")
                    }
                    .foregroundStyle(done ? Theme.ok : Theme.muted)
                    .accessibilityAddTraits(done ? .isSelected : [])
                }
                .font(.footnote.weight(.semibold))
                .buttonStyle(.plain)
                .foregroundStyle(Theme.muted)

                if notesOpen {
                    Text(episode.studyNotes)
                        .font(.subheadline)
                        .foregroundStyle(Theme.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .textSelection(.enabled)
                }
            }
            .padding(14)
        }
        .overlay {
            if active {
                RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(course.accent, lineWidth: 2)
            }
        }
        .opacity(done && !active ? 0.8 : 1)
    }
}
