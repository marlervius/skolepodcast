import Foundation
import Observation

/// Elevens fag og fremgang. Alt lagres bare på enheten, som på nettsiden.
@MainActor @Observable
final class Library {
    private enum Key {
        static let codes = "lytterom.followedCodes"
        static let courses = "lytterom.courseSummaries"
        static let fullCourses = "lytterom.fullCourses"
        static let progress = "lytterom.progress"
        static let lastPlayed = "lytterom.lastPlayed"
    }

    private(set) var codes: [String]
    private(set) var courses: [Course]
    private(set) var isLoading = false
    private(set) var loadError: String?
    /// Fremgangen som vises i appen. Oppdateres med noen sekunders mellomrom under avspilling.
    private(set) var progress: [String: EpisodeProgress]
    private(set) var lastPlayed: Selection?

    @ObservationIgnored private var liveProgress: [String: EpisodeProgress]
    @ObservationIgnored private var fullCourses: [String: Course]

    init() {
        codes = Self.read([String].self, Key.codes) ?? []
        courses = Self.read([Course].self, Key.courses) ?? []
        fullCourses = Self.read([String: Course].self, Key.fullCourses) ?? [:]
        let saved = Self.read([String: EpisodeProgress].self, Key.progress) ?? [:]
        progress = saved
        liveProgress = saved
        lastPlayed = Self.read(Selection.self, Key.lastPlayed)
    }

    // MARK: Fag

    func isFollowing(_ code: String) -> Bool {
        codes.contains(ClassCode.normalize(code))
    }

    func refresh() async {
        guard !codes.isEmpty else {
            courses = []
            loadError = nil
            write(courses, Key.courses)
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let fresh = try await API.courses(codes: codes)
            // Eleven kan ha fjernet et fag mens listen ble hentet.
            let order = codes
            courses = fresh
                .filter { order.contains($0.normalizedCode) }
                .sorted { (order.firstIndex(of: $0.normalizedCode) ?? .max) < (order.firstIndex(of: $1.normalizedCode) ?? .max) }
            loadError = nil
            write(courses, Key.courses)
        } catch {
            loadError = "Kunne ikke hente fagene dine. Sjekk nettforbindelsen."
        }
    }

    /// Slår opp klassekoden og legger faget øverst i Mine fag.
    @discardableResult
    func add(code input: String) async throws -> Course {
        let code = ClassCode.normalize(input)
        guard !code.isEmpty else { throw APIError(message: "Skriv inn en klassekode.") }
        let course = try await API.course(code: code, full: false)
        let normalized = course.normalizedCode
        codes = [normalized] + codes.filter { $0 != normalized }
        courses = [course.summary] + courses.filter { $0.id != course.id }
        saveCourses()
        return course
    }

    /// Eleven som åpner en delt lenke eller QR-kode får faget i Mine fag.
    func ensureFollowed(_ course: Course) {
        let normalized = course.normalizedCode
        if let index = courses.firstIndex(where: { $0.id == course.id }) {
            courses[index] = course.summary
        } else {
            courses.append(course.summary)
        }
        if !codes.contains(normalized) { codes.append(normalized) }
        saveCourses()
    }

    func remove(code: String) {
        let normalized = ClassCode.normalize(code)
        codes.removeAll { $0 == normalized }
        courses.removeAll { $0.normalizedCode == normalized }
        fullCourses[normalized] = nil
        saveCourses()
        write(fullCourses, Key.fullCourses)
    }

    /// Siste hentede versjon av hele faget, så det kan vises uten nett.
    func cachedCourse(code: String) -> Course? {
        fullCourses[ClassCode.normalize(code)]
    }

    func cache(_ course: Course) {
        fullCourses[course.normalizedCode] = course
        write(fullCourses, Key.fullCourses)
    }

    private func saveCourses() {
        write(codes, Key.codes)
        write(courses, Key.courses)
    }

    // MARK: Fremgang

    /// Den ferskeste fremgangen, også den som ikke er vist ennå.
    func currentProgress(_ id: String) -> EpisodeProgress? {
        liveProgress[id]
    }

    /// `publish: false` oppdaterer bare minnet; brukes under avspilling så appen ikke tegnes på nytt hele tiden.
    func setProgress(_ id: String, position: Double, completed: Bool, publish: Bool = true) {
        liveProgress[id] = EpisodeProgress(position: position, completed: completed)
        if publish { flushProgress() }
    }

    func toggleCompleted(_ id: String) {
        let old = liveProgress[id] ?? EpisodeProgress(position: 0, completed: false)
        setProgress(id, position: old.position, completed: !old.completed)
    }

    func flushProgress() {
        if progress != liveProgress { progress = liveProgress }
        write(liveProgress, Key.progress)
    }

    // MARK: Sist spilt

    func remember(_ selection: Selection?) {
        lastPlayed = selection
        write(selection, Key.lastPlayed)
    }

    /// Oppdaterer «Fortsett der du slapp» med ferske data, eller fjerner kortet hvis faget eller episoden er borte.
    func syncCourse(id courseId: String, fresh: Course?) {
        guard let last = lastPlayed, last.course.id == courseId else { return }
        let episode = fresh?.orderedEpisodes.first { $0.id == last.episode.id }
        if let fresh, let episode {
            let next = Selection(episode: episode, course: fresh)
            if next != last { remember(next) }
        } else {
            remember(nil)
        }
    }

    // MARK: Lagring

    private static func read<T: Decodable>(_ type: T.Type, _ key: String) -> T? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private func write<T: Encodable>(_ value: T?, _ key: String) {
        if let value, let data = try? JSONEncoder().encode(value) {
            UserDefaults.standard.set(data, forKey: key)
        } else {
            UserDefaults.standard.removeObject(forKey: key)
        }
    }
}
