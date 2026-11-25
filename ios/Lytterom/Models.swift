import Foundation
import SwiftUI

enum AppConfig {
    /// Nettstedet der lærerne publiserer. Appen henter fag og episoder herfra.
    static let baseURL = URL(string: "https://skolepodcast.vercel.app")!
    /// Adressen elever og lærere kan skrive til for å rapportere innhold. Apple krever en slik kontaktmulighet.
    /// Tom streng skjuler menyvalget «Rapporter innhold».
    static let supportEmail = "marius.lervik@gmail.com"
    static let exampleCode = "HIST-VG3"
    static let privacyURL = baseURL.appending(path: "personvern")

    static func courseWebURL(code: String) -> URL {
        baseURL.appending(path: "fag").appending(path: code)
    }
}

enum MediaType: String, Codable {
    case audio, video, embed
}

struct Episode: Codable, Identifiable, Hashable {
    var id: String
    var topicId: String
    var courseId: String
    var title: String
    var description: String
    var studyNotes: String
    var mediaType: MediaType
    var mediaUrl: String
    var embedUrl: String
    var durationSeconds: Double
    var sortOrder: Int

    enum CodingKeys: String, CodingKey {
        case id, title, description
        case topicId = "topic_id", courseId = "course_id", studyNotes = "study_notes"
        case mediaType = "media_type", mediaUrl = "media_url", embedUrl = "embed_url"
        case durationSeconds = "duration_seconds", sortOrder = "sort_order"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        topicId = c.string(.topicId)
        courseId = c.string(.courseId)
        title = c.string(.title)
        description = c.string(.description)
        studyNotes = c.string(.studyNotes)
        mediaType = (try? c.decode(MediaType.self, forKey: .mediaType)) ?? .audio
        mediaUrl = c.string(.mediaUrl)
        embedUrl = c.string(.embedUrl)
        durationSeconds = c.double(.durationSeconds)
        sortOrder = c.int(.sortOrder)
    }

    var isPlayable: Bool { mediaType != .embed }
    var kindLabel: String { mediaType == .audio ? "Podcast" : "Video" }
    var kindIcon: String { mediaType == .audio ? "headphones" : "play.rectangle" }
}

struct Topic: Codable, Identifiable, Hashable {
    var id: String
    var courseId: String
    var title: String
    var description: String
    var sortOrder: Int
    var episodes: [Episode]

    enum CodingKeys: String, CodingKey {
        case id, title, description, episodes
        case courseId = "course_id", sortOrder = "sort_order"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        courseId = c.string(.courseId)
        title = c.string(.title)
        description = c.string(.description)
        sortOrder = c.int(.sortOrder)
        episodes = (try? c.decodeIfPresent([Episode].self, forKey: .episodes)) ?? []
    }
}

/// Et fagrom. Listen over fag gir bare sammendraget; `topics` er tom til hele faget er hentet.
struct Course: Codable, Identifiable, Hashable {
    var id: String
    var teacherName: String
    var title: String
    var subject: String
    var classLabel: String
    var description: String
    var code: String
    var accentColor: String
    var episodeCount: Int
    var topicCount: Int
    var topics: [Topic]

    enum CodingKeys: String, CodingKey {
        case id, title, subject, description, code, topics
        case teacherName = "teacher_name", classLabel = "class_label", accentColor = "accent_color"
        case episodeCount = "episode_count", topicCount = "topic_count"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        teacherName = c.string(.teacherName)
        title = c.string(.title)
        subject = c.string(.subject)
        classLabel = c.string(.classLabel)
        description = c.string(.description)
        code = c.string(.code)
        accentColor = c.string(.accentColor)
        episodeCount = c.int(.episodeCount)
        topicCount = c.int(.topicCount)
        topics = (try? c.decodeIfPresent([Topic].self, forKey: .topics)) ?? []
    }

    var accent: Color { Color(hex: accentColor) }
    var subtitle: String { classLabel.isEmpty ? subject : "\(subject) · \(classLabel)" }
    var normalizedCode: String { ClassCode.normalize(code) }

    var sortedTopics: [Topic] {
        topics.sorted { $0.sortOrder < $1.sortOrder }
    }

    /// Alle episodene i faget i rekkefølge: kapitlene etter sort_order, deretter episodene i hvert kapittel.
    var orderedEpisodes: [Episode] {
        sortedTopics.flatMap { $0.episodes.sorted { $0.sortOrder < $1.sortOrder } }
    }

    var summary: Course {
        var copy = self
        copy.topics = []
        return copy
    }
}

struct EpisodeProgress: Codable, Equatable {
    var position: Double
    var completed: Bool
}

struct Selection: Codable, Equatable {
    var episode: Episode
    var course: Course
}

struct CourseRoute: Hashable {
    let code: String
}

private extension KeyedDecodingContainer {
    func string(_ key: Key) -> String {
        (try? decodeIfPresent(String.self, forKey: key)) ?? ""
    }

    func double(_ key: Key) -> Double {
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return value }
        if let text = try? decodeIfPresent(String.self, forKey: key), let value = Double(text) { return value }
        return 0
    }

    func int(_ key: Key) -> Int {
        let value = double(key)
        return value.isFinite ? Int(value) : 0
    }
}

enum ClassCode {
    /// Samme regel som nettsiden: store bokstaver, bindestrek i stedet for mellomrom.
    static func normalize(_ input: String) -> String {
        var value = input.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        value = value.replacingOccurrences(of: "[\\s_]+", with: "-", options: .regularExpression)
        value = value.replacingOccurrences(of: "[^A-Z0-9ÆØÅ-]", with: "", options: .regularExpression)
        value = value.replacingOccurrences(of: "-+", with: "-", options: .regularExpression)
        value = value.replacingOccurrences(of: "^-|-$", with: "", options: .regularExpression)
        return String(value.prefix(32))
    }

    /// Finner klassekoden i en lenke (https://…/fag/KODE eller lytterom://fag/KODE).
    static func code(from url: URL) -> String? {
        var parts = url.pathComponents.filter { $0 != "/" }
        if url.scheme == "lytterom", let host = url.host() { parts.insert(host, at: 0) }
        guard let index = parts.firstIndex(of: "fag"), index + 1 < parts.count else { return nil }
        let code = normalize(parts[index + 1].removingPercentEncoding ?? parts[index + 1])
        return code.isEmpty ? nil : code
    }

    /// Tolker innholdet i en skannet QR-kode: en lenke til et fagrom, eller selve klassekoden.
    static func code(fromScan raw: String) -> String? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: text), url.scheme != nil {
            return code(from: url)
        }
        guard !text.contains("/"), text.count <= 40 else { return nil }
        let code = normalize(text)
        return code.count >= 3 ? code : nil
    }
}

enum Format {
    /// «12 min», «1 t 5 min» – samme som nettsiden.
    static func duration(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "" }
        let total = Int(seconds.rounded())
        let minutes = Int((Double(total) / 60).rounded())
        if total < 60 { return "\(total) sek" }
        if minutes < 60 { return "\(minutes) min" }
        return "\(minutes / 60) t \(minutes % 60) min"
    }

    /// «4:05» eller «1:02:03».
    static func time(_ value: Double) -> String {
        guard value.isFinite, value > 0 else { return "0:00" }
        let seconds = Int(value)
        let hours = seconds / 3600
        if hours > 0 { return String(format: "%d:%02d:%02d", hours, (seconds / 60) % 60, seconds % 60) }
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    static func rate(_ rate: Float) -> String {
        let text = rate == rate.rounded() ? String(Int(rate)) : String(format: "%g", rate).replacingOccurrences(of: ".", with: ",")
        return "\(text)×"
    }
}
