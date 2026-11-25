import AVFoundation
import MediaPlayer
import Observation
import UIKit

/// Avspilleren. Én AVPlayer brukes for både lyd og video, så lyden fortsetter med skjermen låst
/// og styres fra låseskjermen, Kontrollsenteret og hodetelefonene.
@MainActor @Observable
final class Player {
    static let rates: [Float] = [0.75, 1, 1.25, 1.5, 2]
    static let sleepOptions = [0, 10, 20, 30]
    private static let speedKey = "lytterom.speed"
    /// Fremgangen lagres og vises med dette mellomrommet under avspilling.
    private static let saveInterval: TimeInterval = 5

    @ObservationIgnored let library: Library
    @ObservationIgnored let avPlayer = AVPlayer()

    private(set) var episode: Episode?
    private(set) var course: Course?
    private(set) var isPlaying = false
    private(set) var position: Double = 0
    private(set) var duration: Double = 0
    private(set) var speed: Float = 1
    private(set) var sleepMinutes = 0
    var expanded = false
    var error: String?

    @ObservationIgnored private var statusObservation: NSKeyValueObservation?
    @ObservationIgnored private var controlObservation: NSKeyValueObservation?
    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var sleepTask: Task<Void, Never>?
    @ObservationIgnored private var lastSave = Date.distantPast
    @ObservationIgnored private var pendingSeek: Double?
    @ObservationIgnored private var isScrubbing = false
    @ObservationIgnored private var artworkCache: [String: MPMediaItemArtwork] = [:]

    init(library: Library) {
        self.library = library
        let saved = UserDefaults.standard.float(forKey: Self.speedKey)
        speed = Self.rates.contains(saved) ? saved : 1
        avPlayer.defaultRate = speed
        avPlayer.allowsExternalPlayback = true

        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)

        timeObserver = avPlayer.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] time in
            MainActor.assumeIsolated { self?.tick(time.seconds) }
        }
        controlObservation = avPlayer.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            let playing = player.timeControlStatus != .paused
            Task { @MainActor in self?.playingChanged(playing) }
        }
        NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: nil, queue: .main) { [weak self] note in
            let item = note.object as? AVPlayerItem
            MainActor.assumeIsolated { self?.itemEnded(item) }
        }
        setUpRemoteCommands()
    }

    // MARK: Rekkefølge

    /// Forrige og neste lyd- eller videoepisode i faget. Innebygde videoer hoppes over, siden de spilles i sin egen spiller.
    var previousEpisode: Episode? {
        guard let order = course?.orderedEpisodes, let index = order.firstIndex(where: { $0.id == episode?.id }) else { return nil }
        return order[..<index].reversed().first { $0.isPlayable }
    }

    var nextEpisode: Episode? {
        guard let order = course?.orderedEpisodes, let index = order.firstIndex(where: { $0.id == episode?.id }) else { return nil }
        return order[(index + 1)...].first { $0.isPlayable }
    }

    // MARK: Styring

    /// Spiller av episoden, eller pauser den hvis den allerede er valgt.
    func play(_ next: Episode, in nextCourse: Course) {
        if episode?.id == next.id {
            if next.mediaType == .embed { expanded = true } else { togglePlay() }
            return
        }
        select(next, in: nextCourse, autoplay: true)
        expanded = next.mediaType != .audio
    }

    /// Bytter episode i samme fag uten å åpne eller lukke fullskjermspilleren.
    func goTo(_ target: Episode?) {
        guard let target, let course else { return }
        select(target, in: course, autoplay: true)
    }

    func togglePlay() {
        guard let episode else { return }
        if episode.mediaType == .embed { expanded = true; return }
        if isPlaying { avPlayer.pause() } else { startPlayback() }
    }

    func skip(_ seconds: Double) {
        seek(to: position + seconds)
    }

    func seek(to seconds: Double) {
        let upper = duration > 0 ? duration : .greatestFiniteMagnitude
        let target = max(0, min(upper, seconds))
        position = target
        if pendingSeek != nil { pendingSeek = target; return }
        avPlayer.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        updateNowPlaying()
    }

    /// Mens eleven drar i tidslinjen vises posisjonen uten å spole hele tiden.
    func scrub(to seconds: Double) {
        position = seconds
    }

    func setScrubbing(_ scrubbing: Bool) {
        isScrubbing = scrubbing
        if !scrubbing { seek(to: position) }
    }

    func setSpeed(_ rate: Float) {
        speed = rate
        avPlayer.defaultRate = rate
        if isPlaying { avPlayer.rate = rate }
        UserDefaults.standard.set(rate, forKey: Self.speedKey)
        updateNowPlaying()
    }

    func setSleepTimer(minutes: Int) {
        sleepTask?.cancel()
        sleepMinutes = minutes
        guard minutes > 0 else { return }
        sleepTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Double(minutes) * 60))
            guard !Task.isCancelled, let self else { return }
            self.avPlayer.pause()
            self.sleepMinutes = 0
        }
    }

    func toggleCompleted() {
        guard let episode else { return }
        library.toggleCompleted(episode.id)
    }

    /// Holder fag og episode i takt med det læreren har endret.
    func refresh(course fresh: Course) {
        guard let course, course.id == fresh.id else { return }
        self.course = fresh
        if let id = episode?.id, let updated = fresh.orderedEpisodes.first(where: { $0.id == id }) {
            episode = updated
        }
    }

    // MARK: Internt

    private func select(_ next: Episode, in nextCourse: Course, autoplay: Bool) {
        saveCurrentPosition()
        episode = next
        course = nextCourse
        error = nil
        library.remember(Selection(episode: next, course: nextCourse))

        let stored = library.currentProgress(next.id)
        let resume = stored?.completed == true ? 0 : (stored?.position ?? 0)
        position = resume
        duration = next.durationSeconds
        statusObservation = nil

        guard next.isPlayable else {
            avPlayer.replaceCurrentItem(with: nil)
            updateNowPlaying()
            return
        }
        // Eksempelfaget bruker adresser som /demo/fil.wav, som hører til nettstedet.
        guard let url = URL(string: next.mediaUrl, relativeTo: AppConfig.baseURL)?.absoluteURL else {
            avPlayer.replaceCurrentItem(with: nil)
            error = "Mediefilen kunne ikke spilles av."
            return
        }
        let item = AVPlayerItem(url: url)
        pendingSeek = resume > 1 ? resume : nil
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            Task { @MainActor in self?.itemStatusChanged(item) }
        }
        avPlayer.replaceCurrentItem(with: item)
        if autoplay { startPlayback() }
        updateNowPlaying()
    }

    private func startPlayback() {
        try? AVAudioSession.sharedInstance().setActive(true)
        avPlayer.play()
    }

    private func itemStatusChanged(_ item: AVPlayerItem) {
        guard item === avPlayer.currentItem else { return }
        switch item.status {
        case .readyToPlay:
            let length = item.duration.seconds
            if length.isFinite, length > 0 { duration = length }
            if let target = pendingSeek {
                pendingSeek = nil
                let clamped = duration > 1 ? min(target, duration - 1) : target
                avPlayer.seek(to: CMTime(seconds: clamped, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
            }
            updateNowPlaying()
        case .failed:
            error = "Mediefilen kunne ikke spilles av. Kontroller tilkoblingen og prøv igjen."
        default:
            break
        }
    }

    private func tick(_ seconds: Double) {
        // Før den lagrede posisjonen er hentet frem skal ikke starten av filen overskrive fremgangen.
        guard let episode, episode.isPlayable, pendingSeek == nil, !isScrubbing, seconds.isFinite else { return }
        position = seconds
        if let length = avPlayer.currentItem?.duration.seconds, length.isFinite, length > 0, length != duration {
            duration = length
        }
        guard isPlaying else { return }
        let completed = library.currentProgress(episode.id)?.completed ?? false
        let publish = Date().timeIntervalSince(lastSave) > Self.saveInterval
        if publish { lastSave = Date() }
        library.setProgress(episode.id, position: seconds, completed: completed, publish: publish)
    }

    private func playingChanged(_ playing: Bool) {
        guard playing != isPlaying else { return }
        isPlaying = playing
        if playing { error = nil } else { saveCurrentPosition() }
        updateNowPlaying()
    }

    private func saveCurrentPosition() {
        guard let episode, episode.isPlayable, pendingSeek == nil else { return }
        let completed = library.currentProgress(episode.id)?.completed ?? false
        library.setProgress(episode.id, position: position, completed: completed)
        lastSave = Date()
    }

    /// Fortsetter automatisk med neste episode i faget, og stopper etter den siste.
    private func itemEnded(_ item: AVPlayerItem?) {
        guard let item, item === avPlayer.currentItem, let episode else { return }
        library.setProgress(episode.id, position: 0, completed: true)
        if let next = nextEpisode, let course {
            pendingSeek = nil
            self.episode = nil // Hindrer at sluttposisjonen lagres på episoden som nettopp ble fullført.
            select(next, in: course, autoplay: true)
        } else {
            position = 0
            avPlayer.seek(to: .zero)
            updateNowPlaying()
        }
    }

    // MARK: Låseskjerm

    private func setUpRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.startPlayback() }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.avPlayer.pause() }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.togglePlay() }
            return .success
        }
        center.skipForwardCommand.preferredIntervals = [15]
        center.skipForwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skip(15) }
            return .success
        }
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skip(-15) }
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let time = event.positionTime
            Task { @MainActor in self?.seek(to: time) }
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.goTo(self.nextEpisode)
            }
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.goTo(self.previousEpisode)
            }
            return .success
        }
    }

    private func updateNowPlaying() {
        let info = MPNowPlayingInfoCenter.default()
        let commands = MPRemoteCommandCenter.shared()
        guard let episode, let course, episode.isPlayable else {
            info.nowPlayingInfo = nil
            commands.nextTrackCommand.isEnabled = false
            commands.previousTrackCommand.isEnabled = false
            return
        }
        // Knappene vises bare på låseskjermen når det finnes en episode å gå til.
        commands.nextTrackCommand.isEnabled = nextEpisode != nil
        commands.previousTrackCommand.isEnabled = previousEpisode != nil
        info.nowPlayingInfo = [
            MPMediaItemPropertyTitle: episode.title,
            MPMediaItemPropertyArtist: course.teacherName.isEmpty ? "Lytterom" : course.teacherName,
            MPMediaItemPropertyAlbumTitle: course.title,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? Double(speed) : 0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: Double(speed),
            MPNowPlayingInfoPropertyMediaType: (episode.mediaType == .video ? MPNowPlayingInfoMediaType.video : .audio).rawValue,
            MPMediaItemPropertyArtwork: artwork(for: course),
        ]
    }

    private func artwork(for course: Course) -> MPMediaItemArtwork {
        let key = "\(course.id)-\(course.accentColor)"
        if let cached = artworkCache[key] { return cached }
        let size = CGSize(width: 600, height: 600)
        let image = UIGraphicsImageRenderer(size: size).image { context in
            UIColor(course.accent).setFill()
            context.fill(CGRect(origin: .zero, size: size))
            let config = UIImage.SymbolConfiguration(pointSize: 220, weight: .light)
            if let symbol = UIImage(systemName: "headphones", withConfiguration: config)?.withTintColor(.white, renderingMode: .alwaysOriginal) {
                symbol.draw(at: CGPoint(x: (size.width - symbol.size.width) / 2, y: (size.height - symbol.size.height) / 2))
            }
        }
        let artwork = Self.makeArtwork(image)
        artworkCache[key] = artwork
        return artwork
    }

    /// Bildet hentes av systemet fra en annen tråd, så det lages utenfor hovedaktøren.
    nonisolated private static func makeArtwork(_ image: UIImage) -> MPMediaItemArtwork {
        MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    }
}
