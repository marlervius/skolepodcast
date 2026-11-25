import SwiftUI

@main
struct LytteromApp: App {
    @State private var library: Library
    @State private var player: Player
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let library = Library()
        _library = State(initialValue: library)
        _player = State(initialValue: Player(library: library))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(library)
                .environment(player)
                .tint(Theme.terracotta)
                .onChange(of: scenePhase) { _, phase in
                    if phase != .active { library.flushProgress() }
                }
        }
    }
}

struct RootView: View {
    @Environment(Player.self) private var player
    @State private var path: [CourseRoute] = []

    var body: some View {
        @Bindable var player = player
        NavigationStack(path: $path) {
            HomeView { code in path = [CourseRoute(code: code)] }
                .navigationDestination(for: CourseRoute.self) { route in
                    CourseScreen(code: route.code)
                }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if player.episode != nil { MiniPlayer() }
        }
        .sheet(isPresented: $player.expanded) {
            PlayerSheet()
        }
        // Lenker til et fagrom (lytterom://fag/KODE, og nettadressen når den er koblet til appen) åpner faget.
        .onOpenURL { url in
            if let code = ClassCode.code(from: url) {
                player.expanded = false
                path = [CourseRoute(code: code)]
            }
        }
    }
}
