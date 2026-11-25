import AVFoundation
import SwiftUI
import VisionKit

/// Skanner QR-koden læreren viser på tavla, og legger faget til.
struct ScannerSheet: View {
    static var isSupported: Bool { DataScannerViewController.isSupported }

    let onScan: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var access: Bool?

    var body: some View {
        NavigationStack {
            Group {
                switch access {
                case .none:
                    ProgressView()
                case .some(true) where DataScannerViewController.isAvailable:
                    QRScannerView(onScan: onScan)
                        .ignoresSafeArea()
                        .overlay(alignment: .bottom) {
                            Text("Hold kameraet mot QR-koden")
                                .font(.subheadline.weight(.semibold))
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)
                                .background(.regularMaterial, in: Capsule())
                                .padding(.bottom, 40)
                        }
                default:
                    ContentUnavailableView {
                        Label("Kameraet er ikke tilgjengelig", systemImage: "camera")
                    } description: {
                        Text("Gi Lytterom tilgang til kameraet i Innstillinger for å skanne QR-koden. Du kan også skrive inn klassekoden.")
                    } actions: {
                        if let settings = URL(string: UIApplication.openSettingsURLString) {
                            Link("Åpne Innstillinger", destination: settings)
                        }
                    }
                }
            }
            .navigationTitle("Skann QR-kode")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Avbryt") { dismiss() }
                }
            }
        }
        .task {
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized: access = true
            case .notDetermined: access = await AVCaptureDevice.requestAccess(for: .video)
            default: access = false
            }
        }
    }
}

private struct QRScannerView: UIViewControllerRepresentable {
    let onScan: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan) }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        if !scanner.isScanning { try? scanner.startScanning() }
    }

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onScan: (String) -> Void
        private var done = false

        init(onScan: @escaping (String) -> Void) {
            self.onScan = onScan
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            handle(addedItems)
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) {
            handle([item])
        }

        private func handle(_ items: [RecognizedItem]) {
            guard !done else { return }
            for item in items {
                if case .barcode(let barcode) = item, let value = barcode.payloadStringValue {
                    done = true
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    onScan(value)
                    return
                }
            }
        }
    }
}
