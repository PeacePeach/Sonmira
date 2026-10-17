import UIKit
import Capacitor

/// Capacitor's web view, with Sonmira's own native plugins registered.
class SonmiraBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SonmiraStorePlugin())
    }
}
