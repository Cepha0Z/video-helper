import Foundation
import AVFoundation
import CoreVideo

// Use Apple's native media reader as a compatibility check, in addition to
// FFmpeg. A file being decodable by FFmpeg does not establish QuickTime support.
@main struct VerifyApplePlayback {
    static func main() async {
        var failed = false
        for filename in CommandLine.arguments.dropFirst() {
            do {
                let asset = AVURLAsset(url: URL(fileURLWithPath: filename))
                let playable = try await asset.load(.isPlayable)
                let duration = try await asset.load(.duration).seconds
                guard playable, duration.isFinite, duration > 0 else {
                    throw NSError(domain: "Playback", code: 1, userInfo: [NSLocalizedDescriptionKey: "Apple reports the asset is not playable"])
                }
                let tracks = try await asset.loadTracks(withMediaType: .video)
                guard let track = tracks.first else { throw NSError(domain: "Playback", code: 2) }
                for seconds in [0.0, duration / 2, max(0, duration - 2)] {
                    let reader = try AVAssetReader(asset: asset)
                    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
                        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
                    ])
                    output.alwaysCopiesSampleData = false
                    reader.add(output)
                    reader.timeRange = CMTimeRange(start: CMTime(seconds: seconds, preferredTimescale: 60000), duration: CMTime(seconds: 1, preferredTimescale: 60000))
                    guard reader.startReading() else { throw reader.error ?? NSError(domain: "Playback", code: 3) }
                    var frames = 0
                    while let sample = output.copyNextSampleBuffer() {
                        if CMSampleBufferGetImageBuffer(sample) != nil { frames += 1 }
                    }
                    guard frames > 0, reader.status != .failed else {
                        throw reader.error ?? NSError(domain: "Playback", code: 4, userInfo: [NSLocalizedDescriptionKey: "No native video frames decoded at \(seconds)s"])
                    }
                    print("Apple decoded \(frames) frames at \(String(format: "%.2f", seconds))s")
                }
                print("PASS: \(URL(fileURLWithPath: filename).lastPathComponent), \(duration)s")
            } catch {
                failed = true
                fputs("FAIL: \(filename): \(error)\n", stderr)
            }
        }
        if failed { exit(1) }
    }
}
