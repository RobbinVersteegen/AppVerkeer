# AppVerkeer

AppVerkeer is een browser-based navigation prototype using Leaflet, OpenStreetMap geocoding, and OSRM routing.

## Run locally

Serve this folder over `http://localhost` so browser geolocation works. For example, use any static file server on port 8000 and open `http://localhost:8000`.

## Street View configuration

The normal map navigation works without Google credentials. The optional `360° Straatbeeld` mode requires an official Google Maps JavaScript API key with Maps JavaScript API and Street View enabled.

This static app expects a restricted browser key at runtime:

```html
<script>window.APPVERKEER_GOOGLE_MAPS_API_KEY = 'YOUR_RESTRICTED_KEY';</script>
```

Place that configuration before `app.js` in `index.html`. Restrict the key by HTTP referrer in Google Cloud and never use an unrestricted key. `.env.example` documents the equivalent variable name for a future Vite/server build.

Without the key, AppVerkeer displays `Street View is nog niet geconfigureerd.` and keeps normal navigation available.

## Data boundaries

- Map tiles: OpenStreetMap
- Geocoding: Nominatim with Photon fallback
- Routing and turn instructions: OSRM
- Live traffic: currently unavailable and never simulated
- GPS: browser Geolocation API
- Street View: official Google Maps JavaScript API when configured
