import Foundation
let new = "iumrah-backend.helloiumrah.workers.dev", old = "iumrah.app"
func check(_ path: String, _ host: String) {
    let url = AppConfig.routedAPIURL(URL(string: "https://iumrah.app" + path)!)!
    precondition(url.host == host, "\(path): \(url)")
}
for path in ["/api/admin/hotels", "/api/admin/hotels/123", "/api/admin/hotels/intelligence", "/api/admin/package/flights/curated", "/api/admin/hotels/operations/flight-verify", "/v1/public/flights"] { check(path,new) }
for path in ["/api/auth/staff/login", "/api/admin/hotels/operations/bookings", "/api/admin/hotels/security/sessions/register", "/api/admin/hotels/chats", "/api/admin/bookings/123", "/api/admin/ziyarats", "/api/admin/hotels-malicious"] { check(path,old) }
precondition(AppConfig.routedAPIURL(URL(string:"https://evil.example/api/admin/hotels")!) == nil)
precondition(AppConfig.routedAPIURL(URL(string:"https://iumrah.app/api/admin/hotels/a%2Fb?token=x%2By")!)!.absoluteString.contains("a%2Fb?token=x%2By"))
print("Business routing smoke: PASS")
