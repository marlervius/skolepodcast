import Foundation

struct APIError: LocalizedError {
    let message: String
    var status: Int = 0
    var errorDescription: String? { message }
}

/// Henter fagrom fra Lytterom-serveren. Elevdelen trenger ingen innlogging.
enum API {
    private struct CoursesResponse: Decodable { let courses: [Course] }
    private struct CourseResponse: Decodable { let course: Course }
    private struct ErrorBody: Decodable { let error: String }

    static func courses(codes: [String]) async throws -> [Course] {
        let list = codes.prefix(50).joined(separator: ",")
        let response: CoursesResponse = try await get([URLQueryItem(name: "codes", value: list)])
        return response.courses
    }

    /// Henter ett fagrom. Med `full` følger kapitler og episoder med. Kaster APIError med status 404 hvis koden ikke finnes.
    static func course(code: String, full: Bool) async throws -> Course {
        var query = [URLQueryItem(name: "code", value: code)]
        if full { query.append(URLQueryItem(name: "full", value: "1")) }
        let response: CourseResponse = try await get(query)
        let course = response.course
        // Servere som ikke kjenner full=1 svarer med bare sammendraget. Da hentes hele faget med id-en.
        if full && course.topics.isEmpty && course.topicCount > 0 {
            let byId: CourseResponse = try await get([], path: "api/courses/\(course.id)")
            return byId.course
        }
        return course
    }

    private static func get<T: Decodable>(_ query: [URLQueryItem], path: String = "api/courses") async throws -> T {
        var components = URLComponents(url: AppConfig.baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        components.queryItems = query.isEmpty ? nil : query
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw APIError(message: "Kunne ikke kontakte Lytterom. Sjekk nettforbindelsen.")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error ?? "Noe gikk galt. Prøv igjen litt senere."
            throw APIError(message: message, status: status)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError(message: "Fikk et uventet svar fra Lytterom. Prøv igjen litt senere.", status: status)
        }
    }
}
