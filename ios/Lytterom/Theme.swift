import SwiftUI
import UIKit

/// Fargene fra nettsiden, med egne verdier for mørk modus.
enum Theme {
    static let background = Color(light: 0xF7F5F0, dark: 0x141311)
    static let surface = Color(light: 0xFFFFFF, dark: 0x1D1C19)
    static let surface2 = Color(light: 0xEFECE4, dark: 0x2A2824)
    static let ink = Color(light: 0x1A1917, dark: 0xEFEBE3)
    static let muted = Color(light: 0x6B675F, dark: 0xA39E94)
    static let line = Color(light: 0xE2DED4, dark: 0x34312C)
    static let ok = Color(light: 0x2E6A4F, dark: 0x6FB08F)
    static let danger = Color(light: 0xB33A2B, dark: 0xEC8B7C)
    static let terracotta = Color(hex: "#C0563B")

    static func serif(_ style: Font.TextStyle, weight: Font.Weight = .semibold) -> Font {
        .system(style, design: .serif, weight: weight)
    }
}

extension Color {
    init(hex: String) {
        let digits = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        if digits.count != 6 || !Scanner(string: digits).scanHexInt64(&value) { value = 0xC0563B }
        self.init(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }

    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            UIColor(rgb: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

extension UIColor {
    convenience init(rgb: UInt32) {
        self.init(red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255, blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var color: Color = Theme.terracotta

    func makeBody(configuration: Configuration) -> some View {
        StyledLabel(configuration: configuration, color: color)
    }

    private struct StyledLabel: View {
        let configuration: ButtonStyleConfiguration
        let color: Color
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .foregroundStyle(.white)
                .background(color.opacity(isEnabled ? 1 : 0.45), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .opacity(configuration.isPressed ? 0.8 : 1)
        }
    }
}

struct Card<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line, lineWidth: 1))
            .shadow(color: .black.opacity(0.06), radius: 10, y: 4)
    }
}

/// Tynn fremdriftslinje i fagets farge.
struct ProgressBar: View {
    var fraction: Double
    var color: Color
    var height: CGFloat = 6

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.surface2)
                Capsule().fill(color).frame(width: proxy.size.width * min(1, max(0, fraction)))
            }
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }
}

struct Eyebrow: View {
    let text: String
    var color: Color = Theme.terracotta

    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.bold))
            .tracking(1)
            .foregroundStyle(color)
    }
}
