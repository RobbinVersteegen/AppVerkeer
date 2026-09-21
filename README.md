# AppVerkeer

AppVerkeer is een browser-based navigation prototype using Leaflet, OpenStreetMap geocoding, and OSRM routing.

## Run locally

Serve this folder over `http://localhost` so browser geolocation works. For example, use any static file server on port 8000 and open `http://localhost:8000`.

## Gratis routebeelden

De knop `360° Straatbeeld` gebruikt de openbare KartaView API. Daarvoor is geen betaalde API-key nodig. KartaView heeft niet overal dekking; bij ontbrekende beelden toont AppVerkeer `Geen gratis routebeeld beschikbaar` en blijft normale navigatie beschikbaar.

## Data boundaries

- Map tiles: OpenStreetMap
- Geocoding: Nominatim with Photon fallback
- Routing and turn instructions: OSRM
- Live traffic: currently unavailable and never simulated
- GPS: browser Geolocation API
- Routebeelden: KartaView wanneer er gratis dekking beschikbaar is
