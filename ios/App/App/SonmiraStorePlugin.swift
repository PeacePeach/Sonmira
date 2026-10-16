import Foundation
import Capacitor
import StoreKit
import Security

/// StoreKit 2 for Sonmira's web app (src/app/billing/native-store.js).
///
/// Every transaction is handed to the app with Apple's signed JWS; the app
/// sends it to the server, which verifies and records it, and only then asks
/// for `finish`. An unfinished transaction is delivered again on the next
/// launch, so a purchase is never lost between payment and grant.
@objc(SonmiraStorePlugin)
public class SonmiraStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SonmiraStorePlugin"
    public let jsName = "SonmiraStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "accountId", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentSubscription", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "history", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manageSubscriptions", returnType: CAPPluginReturnPromise),
    ]

    private var updates: Task<Void, Never>?
    private var loaded: [String: Product] = [:]
    private var unfinished: [String: Transaction] = [:]

    override public func load() {
        // Ask to Buy approvals, renewals, refunds, purchases made on another
        // device: listened to from launch, as Apple requires.
        updates = Task.detached { [weak self] in
            for await result in Transaction.updates { await self?.deliver(result) }
        }
        // Paid but not yet recorded by the server (a crash, no connection).
        Task { [weak self] in
            for await result in Transaction.unfinished { await self?.deliver(result) }
        }
    }

    deinit { updates?.cancel() }

    @MainActor private func deliver(_ result: VerificationResult<Transaction>) {
        // Only Apple-verified transactions are passed on; the server checks
        // the signature again before anything is granted.
        guard case .verified(let transaction) = result else { return }
        unfinished[String(transaction.id)] = transaction
        notifyListeners("transaction", data: payload(result, transaction), retainUntilConsumed: true)
    }

    private func payload(_ result: VerificationResult<Transaction>, _ t: Transaction) -> [String: Any] {
        var out: [String: Any] = [
            "id": String(t.id),
            "originalId": String(t.originalID),
            "productId": t.productID,
            "jws": result.jwsRepresentation,
            "revoked": t.revocationDate != nil,
        ]
        if let expires = t.expirationDate { out["expiresAt"] = Self.ms(expires) }
        return out
    }

    private static func ms(_ date: Date) -> Double { (date.timeIntervalSince1970 * 1000).rounded() }

    // MARK: - Account id

    /// A random id kept in iCloud Keychain, so it survives reinstalls and
    /// follows the person to their other devices. It is StoreKit's
    /// appAccountToken and the server ledger's key; it identifies no one.
    @objc func accountId(_ call: CAPPluginCall) {
        call.resolve(["id": AccountKeychain.id()])
    }

    // MARK: - Products and purchases

    @objc func products(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        Task { @MainActor in
            do {
                let list = try await Product.products(for: ids)
                for p in list { self.loaded[p.id] = p }
                call.resolve(["products": list.map { ["id": $0.id, "displayPrice": $0.displayPrice] }])
            } catch {
                self.reject(call, error)
            }
        }
    }

    @MainActor private func product(_ id: String) async throws -> Product? {
        if let p = loaded[id] { return p }
        for p in try await Product.products(for: [id]) { loaded[p.id] = p }
        return loaded[id]
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let id = call.getString("productId") else { return call.reject("productId is required", "failed") }
        let token = call.getString("appAccountToken").flatMap { UUID(uuidString: $0) }
        Task { @MainActor in
            guard AppStore.canMakePayments else { return call.reject("Purchases are turned off on this device.", "notAllowed") }
            do {
                guard let product = try await self.product(id) else { return call.reject("This item isn't available.", "failed") }
                var options: Set<Product.PurchaseOption> = []
                if let token { options.insert(.appAccountToken(token)) }
                let result: Product.PurchaseResult
                if #available(iOS 17.0, *), let scene = self.bridge?.viewController?.view.window?.windowScene {
                    result = try await product.purchase(confirmIn: scene, options: options)
                } else {
                    result = try await product.purchase(options: options)
                }
                switch result {
                case .success(let verification):
                    guard case .verified(let transaction) = verification else {
                        return call.reject("The purchase couldn't be verified.", "failed")
                    }
                    self.unfinished[String(transaction.id)] = transaction
                    call.resolve(["status": "success", "transaction": self.payload(verification, transaction)])
                case .pending:
                    call.resolve(["status": "pending"])
                case .userCancelled:
                    call.resolve(["status": "userCancelled"])
                @unknown default:
                    call.resolve(["status": "userCancelled"])
                }
            } catch {
                self.reject(call, error)
            }
        }
    }

    /// Called by the app once the server has recorded the transaction.
    @objc func finish(_ call: CAPPluginCall) {
        guard let id = call.getString("transactionId") else { return call.reject("transactionId is required", "failed") }
        Task { @MainActor in
            if let transaction = self.unfinished.removeValue(forKey: id) {
                await transaction.finish()
            } else {
                for await result in Transaction.unfinished {
                    if case .verified(let transaction) = result, String(transaction.id) == id { await transaction.finish() }
                }
            }
            call.resolve()
        }
    }

    // MARK: - Daily Ritual

    /// The latest Daily Ritual transaction, even an expired one (so the app
    /// can say when it ended), with whether it will renew.
    @objc func currentSubscription(_ call: CAPPluginCall) {
        guard let id = call.getString("productId") else { return call.reject("productId is required", "failed") }
        Task { @MainActor in
            guard let latest = await Transaction.latest(for: id), case .verified(let transaction) = latest else {
                return call.resolve([:])
            }
            var out = self.payload(latest, transaction)
            out["willRenew"] = false
            if let product = try? await self.product(id), let statuses = try? await product.subscription?.status {
                for status in statuses {
                    guard case .verified(let renewal) = status.renewalInfo, renewal.originalTransactionID == transaction.originalID else { continue }
                    out["willRenew"] = renewal.willAutoRenew
                    out["renewalJws"] = status.renewalInfo.jwsRepresentation
                }
            }
            call.resolve(out)
        }
    }

    @objc func manageSubscriptions(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let scene = self.bridge?.viewController?.view.window?.windowScene else { return call.reject("No window", "failed") }
            do {
                try await AppStore.showManageSubscriptions(in: scene)
                call.resolve()
            } catch {
                self.reject(call, error)
            }
        }
    }

    // MARK: - Restore Purchases

    @objc func sync(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                try await AppStore.sync()
                call.resolve()
            } catch {
                self.reject(call, error)
            }
        }
    }

    /// Every verified transaction for this Apple ID. Finished consumables are
    /// included on iOS 18+ (SKIncludeConsumableInAppPurchaseHistory).
    @objc func history(_ call: CAPPluginCall) {
        Task { @MainActor in
            var list: [String] = []
            for await result in Transaction.all {
                if case .verified = result { list.append(result.jwsRepresentation) }
            }
            call.resolve(["transactions": list])
        }
    }

    // MARK: - Errors

    /// Error codes the app knows: network, notAllowed, userCancelled, failed.
    private func reject(_ call: CAPPluginCall, _ error: Error) {
        var code = "failed"
        if let e = error as? StoreKitError {
            switch e {
            case .networkError: code = "network"
            case .userCancelled: code = "userCancelled"
            case .notAvailableInStorefront: code = "notAllowed"
            default: code = "failed"
            }
        } else if let e = error as? Product.PurchaseError, case .purchaseNotAllowed = e {
            code = "notAllowed"
        } else if (error as NSError).domain == NSURLErrorDomain {
            code = "network"
        }
        call.reject(error.localizedDescription, code, error)
    }
}

/// The account id in the Keychain, synchronized through iCloud Keychain.
enum AccountKeychain {
    private static let service = "app.sonmira.account"
    private static let account = "id"

    static func id() -> String {
        if let existing = read() { return existing }
        let fresh = UUID().uuidString.lowercased()
        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kCFBooleanTrue as Any,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            kSecValueData as String: Data(fresh.utf8),
        ]
        let status = SecItemAdd(add as CFDictionary, nil)
        // Another launch got there first: use theirs.
        if status == errSecDuplicateItem, let existing = read() { return existing }
        return fresh
    }

    private static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data, let value = String(data: data, encoding: .utf8), !value.isEmpty else { return nil }
        return value
    }
}
