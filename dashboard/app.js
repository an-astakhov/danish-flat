const COPENHAGEN_CENTER = [55.6761, 12.5683];
const money = new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

const state = {
  flats: [],
  filtered: [],
  selectedId: null,
  photoIndex: 0,
  markers: new Map(),
  halos: [],
  metroLayer: null
};

const elements = {
  list: document.querySelector("#listing-list"),
  template: document.querySelector("#listing-template"),
  search: document.querySelector("#search"),
  statusFilter: document.querySelector("#status-filter"),
  detail: document.querySelector("#detail"),
  empty: document.querySelector("#empty-state"),
  flatCount: document.querySelector("#flat-count"),
  averageRent: document.querySelector("#average-rent"),
  address: document.querySelector("#detail-address"),
  title: document.querySelector("#detail-title"),
  adLink: document.querySelector("#ad-link"),
  mapLink: document.querySelector("#map-link"),
  keyFacts: document.querySelector("#key-facts"),
  routeCards: document.querySelector("#route-cards"),
  costList: document.querySelector("#cost-list"),
  statusEdit: document.querySelector("#status-edit"),
  noteEdit: document.querySelector("#note-edit"),
  saveNote: document.querySelector("#save-note"),
  saveMessage: document.querySelector("#save-message"),
  aiNoteSection: document.querySelector("#ai-note-section"),
  aiNote: document.querySelector("#ai-note"),
  mainPhoto: document.querySelector("#main-photo"),
  photoEmpty: document.querySelector("#photo-empty"),
  photoPrev: document.querySelector("#photo-prev"),
  photoNext: document.querySelector("#photo-next"),
  photoCounter: document.querySelector("#photo-counter"),
  thumbnails: document.querySelector("#thumbnails"),
  metroKey: document.querySelector("#metro-key")
};

const map = L.map("map", { zoomControl: true }).setView(COPENHAGEN_CENTER, 12);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);
map.createPane("metro-lines");
map.getPane("metro-lines").style.zIndex = "350";
map.getPane("metro-lines").style.pointerEvents = "none";
map.createPane("metro-stations");
map.getPane("metro-stations").style.zIndex = "360";

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

function formatMoney(value) {
  return Number.isFinite(value) ? money.format(value) : "—";
}

function formatDate(value) {
  if (!value) return "—";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return dateFormatter.format(new Date(`${value}T12:00:00Z`));
}

function textOrDash(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function markerIcon(selected = false) {
  return L.divIcon({
    className: "",
    html: `<div class="flat-marker${selected ? " selected" : ""}"></div>`,
    iconSize: selected ? [22, 22] : [18, 18],
    iconAnchor: selected ? [11, 22] : [9, 18]
  });
}

function addMetroOverlay(metro) {
  const layer = L.layerGroup();
  const stations = new Map();

  for (const line of metro.lines || []) {
    const points = line.stations.map((station) => [station.lat, station.lng]);
    L.polyline(points, {
      pane: "metro-lines",
      color: "#ffffff",
      opacity: .85,
      weight: 8,
      interactive: false
    }).addTo(layer);
    L.polyline(points, {
      pane: "metro-lines",
      color: line.color,
      opacity: .9,
      weight: 4,
      interactive: false
    }).addTo(layer);

    const badge = createElement("span", "metro-badge", line.id);
    badge.style.backgroundColor = line.color;
    elements.metroKey.append(badge);

    for (const station of line.stations) {
      const current = stations.get(station.name) || { ...station, lines: [], positions: [] };
      if (!current.lines.some((item) => item.id === line.id)) current.lines.push({ id: line.id, color: line.color });
      current.positions.push([station.lat, station.lng]);
      stations.set(station.name, current);
    }
  }

  for (const station of stations.values()) {
    const lat = station.positions.reduce((sum, position) => sum + position[0], 0) / station.positions.length;
    const lng = station.positions.reduce((sum, position) => sum + position[1], 0) / station.positions.length;
    const popup = createElement("div", "metro-popup");
    popup.append(createElement("strong", "", station.name));
    const badges = createElement("div");
    for (const line of station.lines) {
      const badge = createElement("span", "metro-badge", line.id);
      badge.style.backgroundColor = line.color;
      badges.append(badge);
    }
    popup.append(badges);
    L.circleMarker([lat, lng], {
      pane: "metro-stations",
      radius: station.lines.length > 1 ? 6 : 4.5,
      color: "#163a30",
      weight: 1.5,
      fillColor: "#ffffff",
      fillOpacity: 1
    }).bindTooltip(station.name, { className: "metro-station-tooltip", direction: "top" }).bindPopup(popup).addTo(layer);
  }

  layer.addTo(map);
  L.control.layers({}, { "Copenhagen Metro": layer }, { position: "topright", collapsed: false }).addTo(map);
  state.metroLayer = layer;
}

function addMarkers() {
  state.markers.forEach((marker) => marker.remove());
  state.halos.forEach((halo) => halo.remove());
  state.markers.clear();
  state.halos = [];

  const bounds = [];
  for (const flat of state.filtered) {
    if (!flat.location || !Number.isFinite(flat.location.lat) || !Number.isFinite(flat.location.lng)) continue;
    const coordinates = [flat.location.lat, flat.location.lng];
    bounds.push(coordinates);

    if (flat.location.approximate) {
      state.halos.push(L.circle(coordinates, {
        radius: 220,
        color: "#ef7d62",
        fillColor: "#ef7d62",
        fillOpacity: .08,
        opacity: .45,
        weight: 1
      }).addTo(map));
    }

    const popup = createElement("div", "marker-popup");
    popup.append(createElement("strong", "", flat.title));
    popup.append(createElement("div", "", `${formatMoney(flat.rentDkk)} · ${textOrDash(flat.sqm)} m²`));
    const marker = L.marker(coordinates, { icon: markerIcon(flat.id === state.selectedId), title: flat.address })
      .addTo(map)
      .bindPopup(popup)
      .on("click", () => selectFlat(flat.id, false));
    state.markers.set(flat.id, marker);
  }

  if (bounds.length > 1) map.fitBounds(bounds, { padding: [45, 45], maxZoom: 14 });
  else if (bounds.length === 1) map.setView(bounds[0], 14);
}

function getStatus(flat) {
  return flat.status || "Unreviewed";
}

function renderList() {
  elements.list.replaceChildren();

  for (const flat of state.filtered) {
    const fragment = elements.template.content.cloneNode(true);
    const card = fragment.querySelector(".listing-card");
    const thumb = fragment.querySelector(".listing-thumb");
    const firstPhoto = flat.photos?.[0];

    card.dataset.id = flat.id;
    card.classList.toggle("active", flat.id === state.selectedId);
    card.setAttribute("aria-pressed", String(flat.id === state.selectedId));
    card.addEventListener("click", () => selectFlat(flat.id));

    if (firstPhoto) {
      thumb.src = safeUrl(firstPhoto.url);
      thumb.alt = firstPhoto.alt || `${flat.title} thumbnail`;
    } else {
      thumb.hidden = true;
      card.style.gridTemplateColumns = "1fr";
    }

    fragment.querySelector(".listing-price").textContent = `${formatMoney(flat.rentDkk)} / mo`;
    const pill = fragment.querySelector(".status-pill");
    pill.textContent = getStatus(flat);
    pill.dataset.status = getStatus(flat);
    fragment.querySelector(".listing-name").textContent = flat.title;
    fragment.querySelector(".listing-address").textContent = flat.address || "Address unavailable";
    const meta = [
      flat.roomsLabel || flat.rooms ? `${flat.roomsLabel || flat.rooms} rooms` : null,
      flat.sqm ? `${flat.sqm} m²` : null,
      formatDate(flat.available)
    ].filter((value) => value && value !== "—");
    fragment.querySelector(".listing-meta").textContent = meta.join(" · ") || "Details unavailable";
    elements.list.append(fragment);
  }
}

function makeFact(value, label) {
  const fact = createElement("div", "key-fact");
  fact.append(createElement("strong", "", value));
  fact.append(createElement("span", "", label));
  return fact;
}

function routeCard(label, value, detail, url) {
  const card = createElement("a", "route-card");
  card.href = safeUrl(url);
  card.target = "_blank";
  card.rel = "noreferrer";
  card.append(createElement("span", "", label));
  card.append(createElement("strong", "", value));
  card.append(createElement("small", "", detail));
  return card;
}

function costRow(label, value) {
  const row = createElement("div");
  row.append(createElement("dt", "", label));
  row.append(createElement("dd", "", value));
  return row;
}

function renderGallery(flat) {
  const photos = Array.isArray(flat.photos) ? flat.photos : [];
  if (state.photoIndex >= photos.length) state.photoIndex = 0;
  const hasPhotos = photos.length > 0;

  elements.mainPhoto.hidden = !hasPhotos;
  elements.photoEmpty.hidden = hasPhotos;
  elements.photoPrev.hidden = photos.length < 2;
  elements.photoNext.hidden = photos.length < 2;
  elements.photoCounter.hidden = !hasPhotos;
  elements.thumbnails.replaceChildren();

  if (!hasPhotos) return;
  const current = photos[state.photoIndex];
  elements.mainPhoto.src = safeUrl(current.url);
  elements.mainPhoto.alt = current.alt || `${flat.title}, photo ${state.photoIndex + 1}`;
  elements.photoCounter.textContent = `${state.photoIndex + 1} / ${photos.length}`;

  photos.forEach((photo, index) => {
    const button = createElement("button", `thumbnail${index === state.photoIndex ? " active" : ""}`);
    button.type = "button";
    button.setAttribute("aria-label", `View photo ${index + 1}`);
    const image = createElement("img");
    image.src = safeUrl(photo.url);
    image.alt = "";
    button.append(image);
    button.addEventListener("click", () => {
      state.photoIndex = index;
      renderGallery(flat);
    });
    elements.thumbnails.append(button);
  });

  const selectedThumbnail = elements.thumbnails.children[state.photoIndex];
  if (selectedThumbnail) {
    elements.thumbnails.scrollTo({ left: Math.max(0, selectedThumbnail.offsetLeft - 12), behavior: "smooth" });
  }
}

function renderDetail(flat) {
  if (!flat) {
    elements.detail.hidden = true;
    elements.empty.hidden = false;
    return;
  }

  elements.detail.hidden = false;
  elements.empty.hidden = true;
  elements.address.textContent = flat.location?.approximate ? `${flat.address} · approximate pin` : flat.address;
  elements.title.textContent = flat.title;
  elements.adLink.href = safeUrl(flat.adUrl);
  elements.mapLink.href = safeUrl(flat.mapUrl);

  elements.keyFacts.replaceChildren(
    makeFact(formatMoney(flat.rentDkk), "Monthly rent"),
    makeFact(`${textOrDash(flat.sqm)} m²`, "Living area"),
    makeFact(textOrDash(flat.roomsLabel || flat.rooms), "Rooms"),
    makeFact(formatDate(flat.available), "Available")
  );

  const nearest = flat.nearestMetro;
  const nordhavn = flat.commute?.nordhavn;
  const havneholmen = flat.commute?.havneholmen;
  elements.routeCards.replaceChildren(
    routeCard("Nearest metro", nearest?.name || "—", nearest?.distanceMeters != null ? `${flat.location?.approximate ? "~" : ""}${nearest.distanceMeters} m walk` : "Distance unavailable", nearest?.mapsUrl),
    routeCard("To Nordhavn", nordhavn?.minutes != null ? `${nordhavn.minutes} min` : "—", "Public transport incl. walking", nordhavn?.mapsUrl),
    routeCard("To Havneholmen", havneholmen?.minutes != null ? `${havneholmen.minutes} min` : "—", havneholmen?.minutes === 0 ? "Already within 500 m" : "Public transport incl. walking", havneholmen?.mapsUrl)
  );

  const outdoor = flat.outdoor?.length ? flat.outdoor.join(", ") : "—";
  elements.costList.replaceChildren(
    costRow("Utilities / month", flat.utilitiesText || formatMoney(flat.utilitiesDkk)),
    costRow("Deposit", flat.depositText || formatMoney(flat.depositDkk)),
    costRow("Prepaid rent", flat.prepaidRentText || formatMoney(flat.prepaidRentDkk)),
    costRow("Rental period", textOrDash(flat.rentalPeriod)),
    costRow("Floor", textOrDash(flat.floor)),
    costRow("Outdoor", outdoor)
  );

  elements.statusEdit.value = flat.status || "";
  elements.noteEdit.value = flat.note || "";
  elements.saveMessage.textContent = "";
  elements.aiNote.textContent = flat.noteAi || "No material watch-outs captured from the listing.";
  elements.aiNoteSection.hidden = false;
  renderGallery(flat);
}

function selectFlat(id, moveMap = true) {
  const flat = state.filtered.find((item) => item.id === id) || state.flats.find((item) => item.id === id);
  if (!flat) return;
  state.selectedId = flat.id;
  state.photoIndex = 0;
  renderList();
  renderDetail(flat);

  state.markers.forEach((marker, markerId) => marker.setIcon(markerIcon(markerId === flat.id)));
  if (moveMap && flat.location) map.flyTo([flat.location.lat, flat.location.lng], Math.max(map.getZoom(), 14), { duration: .65 });
}

function applyFilters() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const status = elements.statusFilter.value;
  state.filtered = state.flats.filter((flat) => {
    const haystack = `${flat.title} ${flat.address}`.toLocaleLowerCase();
    return (!query || haystack.includes(query)) && (!status || getStatus(flat) === status);
  });

  if (!state.filtered.some((flat) => flat.id === state.selectedId)) {
    state.selectedId = state.filtered[0]?.id || null;
    state.photoIndex = 0;
  }

  renderList();
  addMarkers();
  renderDetail(state.filtered.find((flat) => flat.id === state.selectedId));
}

async function saveReview() {
  const flat = state.flats.find((item) => item.id === state.selectedId);
  if (!flat) return;

  elements.saveNote.disabled = true;
  elements.saveMessage.textContent = "Saving…";
  try {
    const response = await fetch(`/api/flats/${encodeURIComponent(flat.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: elements.statusEdit.value, note: elements.noteEdit.value })
    });
    if (!response.ok) throw new Error((await response.json()).error || "Could not save");
    const result = await response.json();
    Object.assign(flat, result.flat);
    elements.saveMessage.textContent = "Saved locally";
    applyFilters();
  } catch (error) {
    elements.saveMessage.textContent = error.message;
  } finally {
    elements.saveNote.disabled = false;
  }
}

async function saveStatus() {
  const flat = state.flats.find((item) => item.id === state.selectedId);
  if (!flat) return;

  const previousStatus = flat.status || "";
  const nextStatus = elements.statusEdit.value;
  if (nextStatus === previousStatus) return;

  const selectedId = flat.id;
  const noteDraft = elements.noteEdit.value;
  elements.statusEdit.disabled = true;
  elements.saveNote.disabled = true;
  elements.saveMessage.textContent = "Saving statusâ€¦";
  try {
    const response = await fetch(`/api/flats/${encodeURIComponent(flat.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus })
    });
    if (!response.ok) throw new Error((await response.json()).error || "Could not save status");
    const result = await response.json();
    Object.assign(flat, result.flat);
    applyFilters();
    if (state.selectedId === selectedId) elements.noteEdit.value = noteDraft;
    elements.saveMessage.textContent = "Status saved";
  } catch (error) {
    elements.statusEdit.value = previousStatus;
    elements.saveMessage.textContent = error.message;
  } finally {
    elements.statusEdit.disabled = false;
    elements.saveNote.disabled = false;
  }
}

function changePhoto(direction) {
  const flat = state.flats.find((item) => item.id === state.selectedId);
  const count = flat?.photos?.length || 0;
  if (count < 2) return;
  state.photoIndex = (state.photoIndex + direction + count) % count;
  renderGallery(flat);
}

elements.search.addEventListener("input", applyFilters);
elements.statusFilter.addEventListener("change", applyFilters);
elements.statusEdit.addEventListener("change", saveStatus);
elements.saveNote.addEventListener("click", saveReview);
elements.photoPrev.addEventListener("click", () => changePhoto(-1));
elements.photoNext.addEventListener("click", () => changePhoto(1));
window.addEventListener("resize", () => map.invalidateSize());

async function initialize() {
  try {
    const [flatResponse, metroResponse] = await Promise.all([
      fetch("/api/flats", { cache: "no-store" }),
      fetch("/data/metro.json", { cache: "no-store" })
    ]);
    if (!flatResponse.ok) throw new Error("Could not load dashboard data");
    if (!metroResponse.ok) throw new Error("Could not load metro overlay data");
    const [tracker, metro] = await Promise.all([flatResponse.json(), metroResponse.json()]);
    addMetroOverlay(metro);
    state.flats = tracker.flats;
    state.filtered = [...state.flats];
    state.selectedId = state.flats[0]?.id || null;

    elements.flatCount.textContent = state.flats.length;
    const rents = state.flats.map((flat) => flat.rentDkk).filter(Number.isFinite);
    elements.averageRent.textContent = rents.length ? money.format(rents.reduce((sum, rent) => sum + rent, 0) / rents.length) : "—";
    applyFilters();
  } catch (error) {
    elements.empty.hidden = false;
    elements.empty.querySelector("h2").textContent = "Dashboard could not load";
    elements.empty.querySelector("p").textContent = error.message;
  }
}

initialize();
