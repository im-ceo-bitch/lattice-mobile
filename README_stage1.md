# iumrah Business — iOS

Native SwiftUI admin application for iumrah operations and the on-device Hotel Importer.

## Hotels Cloud architecture

The hotel catalog is centralized and is **not stored only on the iPhone**.

- D1 master database: `iumrah-hotels`
- R2 master media bucket: `iumrah-hotels-media`
- Cloudflare Worker: `iumrah-hotels-api`
- Admin API: `https://iumrah.app/api/admin/hotels`
- Public catalog API: `https://iumrah.app/api/catalog/hotels`

The iPhone importer extracts and reviews hotel data locally, then saves approved metadata to D1 and approved images to R2. The future iumrah consumer app / package generator reads published hotels from the public catalog API and performs live rate/availability checks separately.

Existing iumrah staff authentication remains the source of truth. The hotel Worker validates the existing `iumrah.app` staff session before allowing admin writes.

## Current scope

- Existing `https://iumrah.app` staff login/session.
- Existing booking and chat APIs.
- Native Hotel Importer using Booking, Expedia and Agoda in `WKWebView`.
- Human review for hotel metadata and images.
- Central D1/R2 hotel persistence through the dedicated Hotels Cloud Worker.

## Generate Xcode project

```bash
brew install xcodegen
xcodegen generate
open iumrahBusiness.xcodeproj
```

## Bundle ID

`com.iumrah.business`

## Deploy Hotels Cloud

See `Backend/HotelsWorker/README.md`.

The deployment workflow creates the D1 database and R2 bucket if they do not already exist, applies migrations, deploys the Worker routes, and verifies the public health endpoint.

## New independent Flight Hub (stage 1)

See `UMRAH_FLIGHT_HUB_STAGE1.md`. This deployment is deliberately separate from the legacy HotelsWorker and does not touch hotel D1.
