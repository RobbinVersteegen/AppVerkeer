const map = L.map('map', { zoomControl: false }).setView([52.0907, 5.1214], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
let currentLocation; let locationAccuracy; let userPosition; let previousPosition; let selectedDestination; let routeDestination; let routeData; let routeReady = false; let navigationActive = false; let locationWatchId; let appState = 'IDLE'; let navigationHeading;
const routePanel = document.getElementById('route-panel'); const toast = document.getElementById('toast'); const searchInput = document.getElementById('search-input'); const clearSearch = document.getElementById('clear-search'); let routeLine;
function showToast(message) { toast.textContent = message; toast.classList.add('is-visible'); window.setTimeout(() => toast.classList.remove('is-visible'), 2600); }
function setAppState(nextState) {
	appState = nextState;
	document.body.dataset.state = nextState;
	const driveLabel = document.getElementById('drive-mode-label');
	const driveTitle = document.getElementById('drive-mode-title');
	const driveCopy = document.getElementById('drive-mode-copy');
	if (nextState === 'NAVIGATING') { driveLabel.textContent = 'Rijmodus actief'; driveTitle.textContent = 'Je bent onderweg'; driveCopy.textContent = 'GPS volgt je positie tijdens deze rit.'; }
	else { driveLabel.textContent = 'Rijmodus'; driveTitle.textContent = 'Start een route om te rijden'; driveCopy.textContent = 'Plan eerst een bestemming. Tijdens navigatie volgen we je echte locatie.'; }
}
function resetRouteDisplay() {
	routeReady = false;
	routeDestination = null;
	routeData = null;
	document.getElementById('route-summary').hidden = true;
	document.getElementById('preview-route').hidden = true;
	document.getElementById('route-preview').hidden = true;
	document.getElementById('route-instructions').replaceChildren();
	if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
}
async function findPlace(query) {
	const cleanQuery = query.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
	const variants = [cleanQuery];
	const addressMatch = cleanQuery.match(/^(.+?\s+\d+[a-zA-Z]?)(?:,?\s+)(.+)$/);
	if (addressMatch) variants.push(`${addressMatch[1]}, ${addressMatch[2]}`, `${addressMatch[1]} ${addressMatch[2]}, Nederland`);
	for (const variant of [...new Set(variants)]) {
		const params = new URLSearchParams({ q: variant, format: 'jsonv2', limit: '1', countrycodes: 'nl', addressdetails: '1' });
		const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: 'application/json', 'Accept-Language': 'nl' } });
		if (!response.ok) throw new Error('De plaatszoeker is niet bereikbaar.');
		const results = await response.json();
		if (results.length) return { lat: Number(results[0].lat), lon: Number(results[0].lon), name: results[0].display_name };
	}
	const fuzzyResults = await searchPhotonPlaces(cleanQuery);
	if (fuzzyResults.length) return fuzzyResults[0];
	throw new Error(`Geen bestemming gevonden voor "${query}".`);
}

async function searchPlaces(query) {
	const cleanQuery = query.replace(/\s+/g, ' ').trim();
	if (cleanQuery.length < 3) return [];
	const params = new URLSearchParams({ q: cleanQuery, format: 'jsonv2', limit: '5', countrycodes: 'nl', addressdetails: '1' });
	const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: 'application/json', 'Accept-Language': 'nl' } });
	if (!response.ok) throw new Error('Zoeksuggesties zijn tijdelijk niet beschikbaar.');
	const places = (await response.json()).map(place => ({ lat: Number(place.lat), lon: Number(place.lon), name: place.display_name }));
	return places.length ? places : searchPhotonPlaces(cleanQuery);
}

async function searchPhotonPlaces(query) {
	const params = new URLSearchParams({ q: query, limit: '5', lang: 'nl' });
	const response = await fetch(`https://photon.komoot.io/api/?${params}`, { headers: { Accept: 'application/json' } });
	if (!response.ok) return [];
	const data = await response.json();
	return (data.features || []).map(place => {
		const properties = place.properties || {};
		const name = [properties.name, properties.street && properties.housenumber ? `${properties.street} ${properties.housenumber}` : properties.street, properties.city || properties.town || properties.village, properties.country].filter(Boolean).join(', ');
		return { lat: Number(place.geometry.coordinates[1]), lon: Number(place.geometry.coordinates[0]), name };
	});
}

function formatDistance(meters) { return meters >= 1000 ? `${(meters / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(meters)} m`; }
function formatDuration(seconds) { return Math.max(1, Math.round(seconds / 60)); }
function distanceBetween(first, second) {
	const earthRadius = 6371000;
	const latDelta = (second[0] - first[0]) * Math.PI / 180;
	const lonDelta = (second[1] - first[1]) * Math.PI / 180;
	const a = Math.sin(latDelta / 2) ** 2 + Math.cos(first[0] * Math.PI / 180) * Math.cos(second[0] * Math.PI / 180) * Math.sin(lonDelta / 2) ** 2;
	return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function bearingBetween(first, second) {
	const firstLat = first[0] * Math.PI / 180; const secondLat = second[0] * Math.PI / 180; const lonDelta = (second[1] - first[1]) * Math.PI / 180;
	return (Math.atan2(Math.sin(lonDelta) * Math.cos(secondLat), Math.cos(firstLat) * Math.sin(secondLat) - Math.sin(firstLat) * Math.cos(secondLat) * Math.cos(lonDelta)) * 180 / Math.PI + 360) % 360;
}
function navigationZoom(speed = 0) { return speed > 27 ? 15.8 : speed > 14 ? 16.3 : speed > 5 ? 16.8 : 17.3; }
function updateNavigationStats(position, gpsSpeed = 0) {
	if (!routeData || !routeDestination) return;
	const remaining = distanceBetween(position, [routeDestination.lat, routeDestination.lon]);
	const speed = Number.isFinite(gpsSpeed) && gpsSpeed > 2 ? gpsSpeed : routeData.distance / routeData.duration;
	const remainingSeconds = remaining / Math.max(speed, 1);
	document.getElementById('hud-distance').textContent = formatDistance(remaining);
	document.getElementById('hud-duration').textContent = formatDuration(remainingSeconds);
	const arrival = new Date(Date.now() + remainingSeconds * 1000);
	document.getElementById('hud-eta').textContent = arrival.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}
function setNavigationMarker(position, heading, navigating) {
	if (currentLocation) map.removeLayer(currentLocation);
	if (navigating) {
		const navigationIcon = L.divIcon({ className: 'navigation-cursor', html: '<span></span>', iconSize: [30, 30], iconAnchor: [15, 15] });
		currentLocation = L.marker(position, { icon: navigationIcon, interactive: false }).addTo(map);
		const element = currentLocation.getElement();
		if (element && Number.isFinite(heading)) element.style.setProperty('--cursor-heading', `${heading}deg`);
	} else currentLocation = L.circleMarker(position, { radius: 8, color: '#fff', weight: 4, fillColor: '#2487e8', fillOpacity: 1 }).addTo(map);
}
function updateNavigationCamera(position, heading, speed, initial = false) {
	const mapElement = map.getContainer();
	mapElement.classList.add('navigation-camera');
	if (Number.isFinite(heading)) { navigationHeading = heading; mapElement.style.setProperty('--nav-bearing', `${-heading}deg`); }
	mapElement.style.setProperty('--nav-zoom', navigationZoom(speed));
	const targetZoom = navigationZoom(speed);
	if (initial) { map.flyTo(position, targetZoom, { duration: 1.2, easeLinearity: .2 }); window.setTimeout(() => map.panBy([0, -70], { animate: true, duration: .4 }), 1100); }
	else { map.panTo(position, { animate: true, duration: .35 }); if (Math.abs(map.getZoom() - targetZoom) > .25) map.setZoom(targetZoom, { animate: true, duration: .5 }); }
}
function resetNavigationCamera() { const mapElement = map.getContainer(); mapElement.classList.remove('navigation-camera'); mapElement.style.removeProperty('--nav-bearing'); mapElement.style.removeProperty('--nav-zoom'); map.invalidateSize(); }
function setStreetViewMessage(title, detail) {
	const message = document.getElementById('streetview-message');
	message.replaceChildren();
	const heading = document.createElement('strong'); heading.textContent = title;
	const copy = document.createElement('span'); copy.textContent = detail;
	message.append(heading, copy); message.hidden = false;
}
function findKartaViewImage(value) {
	if (Array.isArray(value)) { for (const item of value) { const result = findKartaViewImage(item); if (result) return result; } }
	if (!value || typeof value !== 'object') return null;
	for (const key of ['lth_name', 'name', 'image', 'image_url', 'url']) {
		if (typeof value[key] === 'string' && /^https?:\/\//.test(value[key])) return value[key];
	}
	for (const child of Object.values(value)) { const result = findKartaViewImage(child); if (result) return result; }
	return null;
}
async function openStreetView() {
	document.body.dataset.view = 'STREETVIEW';
	document.getElementById('map-mode-button').classList.remove('is-active');
	document.getElementById('streetview-button').classList.add('is-active');
	document.getElementById('streetview-panel').hidden = false;
	document.getElementById('route-image').hidden = true;
	document.getElementById('route-image').removeAttribute('src');
	setStreetViewMessage('Gratis routebeeld laden...', 'KartaView-dekking wordt gecontroleerd.');
	try {
		const params = new URLSearchParams({ lat: userPosition[0], lng: userPosition[1], distance: '1000' });
		const response = await fetch(`https://api.openstreetcam.org/2.0/photo/?${params}`);
		if (!response.ok) throw new Error('Gratis routebeelden zijn tijdelijk niet bereikbaar.');
		const data = await response.json();
		const imageUrl = findKartaViewImage(data);
		if (!imageUrl) { setStreetViewMessage('Geen gratis routebeeld beschikbaar', 'KartaView heeft op dit gedeelte van de route momenteel geen beeld.'); return; }
		const image = document.getElementById('route-image');
		image.src = imageUrl;
		image.hidden = false;
		document.getElementById('streetview-message').hidden = true;
	} catch (error) { setStreetViewMessage('Gratis routebeeld niet beschikbaar', error.message); }
}
function closeStreetView() { document.getElementById('streetview-panel').hidden = true; document.getElementById('map-mode-button').classList.add('is-active'); document.getElementById('streetview-button').classList.remove('is-active'); document.body.dataset.view = 'MAP'; }
function instructionText(step) {
	const type = step.maneuver?.type;
	const modifier = step.maneuver?.modifier;
	const action = type === 'depart' ? 'Vertrek' : type === 'arrive' ? 'Bestemming bereikt' : type === 'roundabout' ? 'Neem de rotonde' : type === 'merge' ? 'Voeg in' : type === 'fork' ? 'Houd aan' : modifier?.includes('left') ? 'Sla linksaf' : modifier?.includes('right') ? 'Sla rechtsaf' : 'Ga rechtdoor';
	return `${action}${step.name ? ` richting ${step.name}` : ''}`;
}

function renderRouteSummary() {
	const summary = document.getElementById('route-summary');
	document.getElementById('route-summary-time').textContent = `${formatDuration(routeData.duration)} min`;
	document.getElementById('route-summary-distance').textContent = formatDistance(routeData.distance);
	summary.hidden = false;
	document.getElementById('preview-title').textContent = routeDestination ? `Naar ${routeDestination.name.split(',')[0]}` : 'Je route';
	const instructions = document.getElementById('route-instructions');
	instructions.replaceChildren();
	routeData.steps.slice(0, 6).forEach(step => {
		const item = document.createElement('li');
		item.innerHTML = `<strong>${instructionText(step)}</strong><small>${formatDistance(step.distance)}</small>`;
		instructions.appendChild(item);
	});
}

async function drawRoute(destination) {
	if (!userPosition) throw new Error('Je echte locatie is nog niet beschikbaar. Probeer het over een moment opnieuw.');
	const start = userPosition;
	const coordinates = `${start[1]},${start[0]};${destination.lon},${destination.lat}`;
	const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true`);
	if (!response.ok) throw new Error('De route kan nu niet worden opgehaald.');
	const data = await response.json();
	if (data.code !== 'Ok' || !data.routes.length) throw new Error('Er is geen autoroute gevonden.');
	if (routeLine) map.removeLayer(routeLine);
	routeLine = L.geoJSON(data.routes[0].geometry, { style: { color: '#2487e8', weight: 6, opacity: .9 } }).addTo(map);
	routeData = { distance: data.routes[0].distance, duration: data.routes[0].duration, steps: data.routes[0].legs.flatMap(leg => leg.steps) };
	routeDestination = destination;
	map.fitBounds(routeLine.getBounds(), { padding: [80, 80] });
	renderRouteSummary();
	return `${formatDistance(routeData.distance)} · ongeveer ${formatDuration(routeData.duration)} min`;
}

function startNavigation() {
	navigationActive = true;
	previousPosition = userPosition;
	setAppState('NAVIGATING');
	routePanel.classList.remove('is-open');
	document.getElementById('route-preview').hidden = true;
	document.getElementById('navigation-hud').hidden = false;
	document.getElementById('next-instruction').textContent = routeData?.steps[1] ? instructionText(routeData.steps[1]) : 'Volg de route';
	document.getElementById('hud-distance').textContent = formatDistance(routeData?.distance || 0);
	document.getElementById('hud-duration').textContent = formatDuration(routeData?.duration || 0);
	const arrival = new Date(Date.now() + (routeData?.duration || 0) * 1000);
	document.getElementById('hud-eta').textContent = arrival.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
	const initialHeading = Number.isFinite(navigationHeading) ? navigationHeading : bearingBetween(userPosition, [routeDestination.lat, routeDestination.lon]);
	setNavigationMarker(userPosition, initialHeading, true);
	updateNavigationCamera(userPosition, initialHeading, 0, true);
	updateNavigationStats(userPosition, 0);
	showToast(`Navigatie gestart naar ${routeDestination.name.split(',')[0]}`);
	if (locationWatchId || !navigator.geolocation) return;
	locationWatchId = navigator.geolocation.watchPosition(position => {
		const { latitude, longitude, accuracy, heading, speed } = position.coords;
		const nextPosition = [latitude, longitude];
		const calculatedHeading = Number.isFinite(heading) && heading >= 0 ? heading : previousPosition && distanceBetween(previousPosition, nextPosition) > 3 ? bearingBetween(previousPosition, nextPosition) : navigationHeading;
		userPosition = nextPosition;
		previousPosition = nextPosition;
		if (locationAccuracy) map.removeLayer(locationAccuracy);
		locationAccuracy = accuracy > 25 ? L.circle(userPosition, { radius: accuracy, color: '#2487e8', weight: 1, fillColor: '#2487e8', fillOpacity: .12 }).addTo(map) : null;
		setNavigationMarker(userPosition, calculatedHeading, true);
		updateNavigationCamera(userPosition, calculatedHeading, speed || 0);
		updateNavigationStats(userPosition, speed || 0);
	}, () => showToast('Live locatie tijdelijk niet beschikbaar.'), { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 });
}

function stopNavigation() {
	navigationActive = false;
	setAppState(routeReady ? 'ROUTE_READY' : 'IDLE');
	closeStreetView();
	document.getElementById('navigation-hud').hidden = true;
	if (locationWatchId) { navigator.geolocation.clearWatch(locationWatchId); locationWatchId = null; }
	resetNavigationCamera();
	setNavigationMarker(userPosition, null, false);
	document.body.dataset.view = 'MAP';
	showToast('Navigatie gestopt');
}

function updateLocation(position, shouldFlyTo = false) {
	const { latitude, longitude, accuracy } = position.coords;
	userPosition = [latitude, longitude];
	if (currentLocation) map.removeLayer(currentLocation);
	if (locationAccuracy) map.removeLayer(locationAccuracy);
	locationAccuracy = L.circle(userPosition, { radius: accuracy, color: '#2487e8', weight: 1, fillColor: '#2487e8', fillOpacity: .12 }).addTo(map);
	setNavigationMarker(userPosition, null, false);
	if (shouldFlyTo) map.flyTo(userPosition, 15, { duration: .7 });
}

function requestUserPosition() {
	return new Promise((resolve, reject) => {
		if (!navigator.geolocation) { reject(new Error('Locatie wordt niet ondersteund door deze browser.')); return; }
		navigator.geolocation.getCurrentPosition(position => { updateLocation(position); resolve(userPosition); }, error => {
			const messages = { 1: 'Locatietoegang geweigerd. Geef toestemming in je browser.', 2: 'Je locatie kon niet worden bepaald.', 3: 'De aanvraag voor je locatie duurde te lang.' };
			reject(new Error(messages[error.code] || 'Je locatie kon niet worden bepaald.'));
		}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
	});
}

function locateUser() {
	showToast('Je locatie wordt opgehaald...');
	requestUserPosition().then(() => showToast(`Je echte locatie gevonden (nauwkeurigheid wordt bijgehouden)`)).catch(error => showToast(error.message));
}

function showSuggestions(container, places, onSelect) {
	container.replaceChildren();
	if (!places.length) { container.classList.remove('is-visible'); return; }
	places.forEach(place => {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'suggestion-item';
		button.setAttribute('role', 'option');
		const title = document.createElement('span');
		title.textContent = place.name.split(',').slice(0, 2).join(', ');
		const detail = document.createElement('small');
		detail.textContent = place.name;
		button.append(title, detail);
		button.addEventListener('click', () => onSelect(place));
		container.appendChild(button);
	});
	container.classList.add('is-visible');
}

function attachSuggestions(input, container, onSelect) {
	let searchTimer;
	input.addEventListener('input', () => {
		setAppState('SEARCHING');
		window.clearTimeout(searchTimer);
		if (input.id === 'destination-input') { selectedDestination = null; navigationActive = false; resetRouteDisplay(); document.getElementById('start-route').innerHTML = 'Route berekenen <span>→</span>'; }
		if (input.value.trim().length < 3) { container.replaceChildren(); container.classList.remove('is-visible'); return; }
		searchTimer = window.setTimeout(async () => {
			try { showSuggestions(container, await searchPlaces(input.value), onSelect); } catch (error) { container.classList.remove('is-visible'); }
		}, 300);
	});
	input.addEventListener('blur', () => window.setTimeout(() => container.classList.remove('is-visible'), 180));
}

const destinationInput = document.getElementById('destination-input');
attachSuggestions(destinationInput, document.getElementById('destination-suggestions'), place => {
	selectedDestination = place;
	destinationInput.value = place.name;
	document.getElementById('destination-suggestions').classList.remove('is-visible');
});
attachSuggestions(searchInput, document.getElementById('search-suggestions'), place => {
	selectedDestination = place;
	resetRouteDisplay();
	destinationInput.value = place.name;
	searchInput.value = place.name;
	document.getElementById('search-suggestions').classList.remove('is-visible');
	routePanel.classList.add('is-open');
	map.flyTo([place.lat, place.lon], 14, { duration: .7 });
});

document.getElementById('zoom-in').addEventListener('click', () => map.zoomIn()); document.getElementById('zoom-out').addEventListener('click', () => map.zoomOut());
document.getElementById('locate-button').addEventListener('click', locateUser);
locateUser();
document.getElementById('route-button').addEventListener('click', () => { routePanel.classList.add('is-open'); if (!routeReady) document.getElementById('start-route').innerHTML = 'Route berekenen <span>→</span>'; }); document.getElementById('close-route').addEventListener('click', () => routePanel.classList.remove('is-open'));
document.getElementById('preview-route').addEventListener('click', () => { if (routeLine && routeReady) { setAppState('ROUTE_PREVIEW'); routePanel.classList.remove('is-open'); document.getElementById('route-preview').hidden = false; map.fitBounds(routeLine.getBounds(), { padding: [100, 100], animate: true }); } });
document.getElementById('close-preview').addEventListener('click', () => { document.getElementById('route-preview').hidden = true; setAppState('ROUTE_READY'); });
document.getElementById('preview-start-navigation').addEventListener('click', startNavigation);
document.getElementById('preview-previous').addEventListener('click', () => showToast('Dit is het eerste routepunt.'));
document.getElementById('preview-next').addEventListener('click', () => showToast('Volgende routepunt wordt geladen zodra routebeelden beschikbaar zijn.'));
document.getElementById('stop-navigation').addEventListener('click', stopNavigation);
document.getElementById('streetview-button').addEventListener('click', openStreetView);
document.getElementById('map-mode-button').addEventListener('click', closeStreetView);
document.getElementById('close-streetview').addEventListener('click', closeStreetView);
document.getElementById('start-route').addEventListener('click', async () => {
	if (routeReady && routeDestination && !navigationActive) { startNavigation(); return; }
	const query = document.getElementById('destination-input').value.trim();
	if (!query) { showToast('Vul eerst een plaats of adres in.'); return; }
	const startButton = document.getElementById('start-route');
	startButton.disabled = true;
	startButton.textContent = 'Route wordt berekend...';
	setAppState('ROUTE_LOADING');
	try {
		if (!userPosition) { showToast('Even je echte locatie ophalen...'); await requestUserPosition(); }
		const destination = selectedDestination && selectedDestination.name === query ? selectedDestination : await findPlace(query);
		const routeInfo = await drawRoute(destination);
		navigationActive = false;
		routeReady = true;
		setAppState('ROUTE_READY');
		startButton.innerHTML = 'Start navigatie <span>▶</span>';
		document.getElementById('preview-route').hidden = false;
		showToast(`Route gevonden · ${routeInfo} · verkeersdata niet live`);
	} catch (error) {
		setAppState('ERROR');
		showToast(error.message);
	} finally {
		startButton.disabled = false;
		if (!navigationActive && !routeDestination) startButton.innerHTML = 'Route berekenen <span>→</span>';
	}
});
searchInput.addEventListener('input', () => { clearSearch.classList.toggle('is-visible', searchInput.value.length > 0); if (searchInput.value.length > 0) resetRouteDisplay(); }); clearSearch.addEventListener('click', () => { searchInput.value = ''; clearSearch.classList.remove('is-visible'); searchInput.focus(); });
searchInput.addEventListener('keydown', async event => {
	if (event.key !== 'Enter' || !searchInput.value.trim()) return;
	try {
		const place = await findPlace(searchInput.value.trim());
		document.getElementById('destination-input').value = place.name;
		selectedDestination = place;
		resetRouteDisplay();
		routePanel.classList.add('is-open');
		map.flyTo([place.lat, place.lon], 14, { duration: .7 });
		showToast(`Bestemming toegevoegd: ${place.name.split(',')[0] || searchInput.value.trim()}`);
	} catch (error) {
		showToast(error.message);
	}
});
const style = document.createElement('style'); style.textContent = '.custom-pin{background:transparent;border:0}.pin-shape{display:grid;place-items:center;width:30px;height:30px;color:#fff;border:3px solid rgba(255,255,255,.9);border-radius:50% 50% 50% 0;box-shadow:0 3px 8px rgba(25,40,35,.3);transform:rotate(-45deg);font-weight:700;font-size:14px}'; document.head.appendChild(style);