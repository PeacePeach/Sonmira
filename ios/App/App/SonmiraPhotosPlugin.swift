import Foundation
import Capacitor
import Photos
import AVFoundation

/// Save to Photos for Sonmira's share sheet (src/app/share/photos.js).
///
/// The web view can't write to the photo library, and a download lands in
/// Files, so the finished JPG or MP4 is handed over in base64 chunks, written
/// to a temporary file as it arrives, and added to Photos as it is: no
/// re-encoding, so the image keeps its quality and the video its audio.
/// Asks only for add-only access (NSPhotoLibraryAddUsageDescription).
@objc(SonmiraPhotosPlugin)
public class SonmiraPhotosPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SonmiraPhotosPlugin"
    public let jsName = "SonmiraPhotos"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "begin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "append", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discard", returnType: CAPPluginReturnPromise),
    ]

    private struct Pending { let url: URL; let handle: FileHandle; let kind: String }

    private static let extensions = ["image": ["jpg", "jpeg"], "video": ["mp4", "mov"]]
    private let queue = DispatchQueue(label: "app.sonmira.photos")
    private var pending: [String: Pending] = [:]

    private static var folder: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("sonmira-photos", isDirectory: true)
    }

    override public func load() {
        // Left over from a save the app didn't finish (killed mid-transfer).
        try? FileManager.default.removeItem(at: Self.folder)
    }

    /// { kind: "image"|"video", ext } → { id }
    @objc func begin(_ call: CAPPluginCall) {
        guard let kind = call.getString("kind"), let ext = call.getString("ext")?.lowercased(),
              Self.extensions[kind]?.contains(ext) == true else {
            call.reject("Only JPG images and MP4 videos can be saved.", "unsupported"); return
        }
        queue.async {
            do {
                try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
                let id = UUID().uuidString
                let url = Self.folder.appendingPathComponent("\(id).\(ext)")
                guard FileManager.default.createFile(atPath: url.path, contents: nil) else {
                    call.reject("The file couldn't be prepared.", "failed"); return
                }
                self.pending[id] = Pending(url: url, handle: try FileHandle(forWritingTo: url), kind: kind)
                call.resolve(["id": id])
            } catch {
                call.reject("The file couldn't be prepared.", "failed", error)
            }
        }
    }

    /// { id, data: base64 }
    @objc func append(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let b64 = call.getString("data"),
              let data = Data(base64Encoded: b64) else {
            call.reject("The file arrived damaged.", "failed"); return
        }
        queue.async {
            guard let p = self.pending[id] else { call.reject("No save in progress.", "failed"); return }
            do { try p.handle.write(contentsOf: data); call.resolve() } catch {
                self.drop(id)
                call.reject("The file couldn't be written.", "failed", error)
            }
        }
    }

    /// { id } → resolves once the file is in Photos. Rejects with code
    /// "denied" when Photos access is off, "failed" otherwise.
    @objc func finish(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("No save in progress.", "failed"); return }
        queue.async {
            guard let p = self.pending.removeValue(forKey: id) else { call.reject("No save in progress.", "failed"); return }
            try? p.handle.close()
            Self.authorize { granted in
                guard granted else {
                    try? FileManager.default.removeItem(at: p.url)
                    call.reject("Photos access is off for Sonmira.", "denied"); return
                }
                Self.add(p.url, kind: p.kind) { error in
                    if p.kind == "video", error != nil {
                        // Photos can refuse a recording's MP4 layout; the same
                        // tracks rewrapped (no re-encoding) usually go in.
                        Self.rewrap(p.url) { rewrapped in
                            guard let rewrapped else { Self.done(call, p.url, error); return }
                            Self.add(rewrapped, kind: "video") { error2 in
                                try? FileManager.default.removeItem(at: rewrapped)
                                Self.done(call, p.url, error2)
                            }
                        }
                        return
                    }
                    Self.done(call, p.url, error)
                }
            }
        }
    }

    /// { id } — drops a save the app gave up on.
    @objc func discard(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        queue.async { self.drop(id); call.resolve() }
    }

    private func drop(_ id: String) {
        guard let p = pending.removeValue(forKey: id) else { return }
        try? p.handle.close()
        try? FileManager.default.removeItem(at: p.url)
    }

    private static func done(_ call: CAPPluginCall, _ url: URL, _ error: Error?) {
        try? FileManager.default.removeItem(at: url)
        if let error { call.reject("Photos couldn't save the file.", "failed", error) } else { call.resolve() }
    }

    private static func authorize(_ done: @escaping (Bool) -> Void) {
        switch PHPhotoLibrary.authorizationStatus(for: .addOnly) {
        case .authorized, .limited: done(true)
        case .notDetermined:
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { s in done(s == .authorized || s == .limited) }
        default: done(false)
        }
    }

    private static func add(_ url: URL, kind: String, _ done: @escaping (Error?) -> Void) {
        PHPhotoLibrary.shared().performChanges({
            PHAssetCreationRequest.forAsset().addResource(with: kind == "video" ? .video : .photo, fileURL: url, options: nil)
        }) { ok, error in
            done(ok ? nil : (error ?? NSError(domain: "SonmiraPhotos", code: 1)))
        }
    }

    private static func rewrap(_ url: URL, _ done: @escaping (URL?) -> Void) {
        let out = folder.appendingPathComponent("\(UUID().uuidString).mp4")
        guard let session = AVAssetExportSession(asset: AVURLAsset(url: url), presetName: AVAssetExportPresetPassthrough) else {
            done(nil); return
        }
        session.outputURL = out
        session.outputFileType = .mp4
        session.exportAsynchronously { done(session.status == .completed ? out : nil) }
    }
}
