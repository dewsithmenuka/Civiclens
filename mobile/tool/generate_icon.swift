import CoreGraphics
import Foundation
import ImageIO

let outputDirectory = CommandLine.arguments.dropFirst().first ?? "assets/branding"
try FileManager.default.createDirectory(
    atPath: outputDirectory,
    withIntermediateDirectories: true
)

let size = 1024
let colorSpace = CGColorSpaceCreateDeviceRGB()
let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue

func color(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: colorSpace, components: [red, green, blue, alpha])!
}

func drawPin(in context: CGContext) {
    let path = CGMutablePath()
    path.move(to: CGPoint(x: 512, y: 72))
    path.addCurve(to: CGPoint(x: 160, y: 430), control1: CGPoint(x: 250, y: 215), control2: CGPoint(x: 160, y: 300))
    path.addCurve(to: CGPoint(x: 512, y: 950), control1: CGPoint(x: 160, y: 600), control2: CGPoint(x: 365, y: 825))
    path.addCurve(to: CGPoint(x: 864, y: 430), control1: CGPoint(x: 659, y: 825), control2: CGPoint(x: 864, y: 600))
    path.addCurve(to: CGPoint(x: 512, y: 72), control1: CGPoint(x: 864, y: 300), control2: CGPoint(x: 774, y: 215))
    path.closeSubpath()
    context.addPath(path)
    context.setFillColor(color(0.16, 0.43, 0.36))
    context.fillPath()

    let roof = CGMutablePath()
    roof.move(to: CGPoint(x: 315, y: 550))
    roof.addLine(to: CGPoint(x: 512, y: 700))
    roof.addLine(to: CGPoint(x: 709, y: 550))
    roof.closeSubpath()
    context.addPath(roof)
    context.setFillColor(color(1, 1, 1))
    context.fillPath()

    context.setFillColor(color(1, 1, 1))
    context.fill(CGRect(x: 365, y: 335, width: 294, height: 215))

    context.setFillColor(color(0.16, 0.43, 0.36))
    for x in [410, 485, 560, 615] {
        context.fill(CGRect(x: x, y: 440, width: 30, height: 45))
    }
    context.fill(CGRect(x: 485, y: 335, width: 54, height: 82))
}

func writeImage(named name: String, background: Bool) throws {
    let context = CGContext(
        data: nil,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: bitmapInfo
    )!
    if background {
        context.setFillColor(color(0.97, 0.97, 0.95))
        context.fill(CGRect(x: 0, y: 0, width: size, height: size))
    }
    drawPin(in: context)
    let image = context.makeImage()!
    let url = URL(fileURLWithPath: outputDirectory).appendingPathComponent(name)
    let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw NSError(domain: "CivicLensIcon", code: 1)
    }
}

try writeImage(named: "civiclens-icon.png", background: true)
try writeImage(named: "civiclens-foreground.png", background: false)
