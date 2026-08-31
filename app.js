(function () {
  "use strict";

  // Optional ?lat=&lon=&zoom= query params (used by the "hitta klubbar nära
  // mig" landing page after a browser geolocation lookup) center the map
  // there on load instead of the default whole-Sweden view. Values are
  // read once here and never sent anywhere - purely a client-side initial
  // view choice.
  var urlParams = new URLSearchParams(window.location.search);
  var initialLat = parseFloat(urlParams.get("lat"));
  var initialLon = parseFloat(urlParams.get("lon"));
  var initialZoom = parseFloat(urlParams.get("zoom"));
  var hasInitialLocation = isFinite(initialLat) && isFinite(initialLon);

  // Optional ?country=NO|DK|SE query param (used by the country-specific
  // landing pages) pre-selects that country's flag instead of the default
  // Sweden-only view. Validated against COUNTRY_META further down.
  var initialCountry = (urlParams.get("country") || "").toUpperCase();
  var defaultCenter = hasInitialLocation ? [initialLat, initialLon] : [62.5, 15.8];
  var defaultZoom = hasInitialLocation ? (isFinite(initialZoom) ? initialZoom : 12) : 5;

  var map = L.map("map", { zoomControl: true }).setView(defaultCenter, defaultZoom);

  if (hasInitialLocation) {
    L.circleMarker([initialLat, initialLon], {
      radius: 9,
      color: "#1a7a3c",
      weight: 3,
      fillColor: "#eafcef",
      fillOpacity: 1
    })
      .addTo(map)
      .bindPopup("Din plats")
      .openPopup();
  }

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bidragsgivare'
  }).addTo(map);

  var markerClusterGroup = L.markerClusterGroup({
    maxClusterRadius: 45,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false
  });
  map.addLayer(markerClusterGroup);

  function placeholderLogo(name) {
    var letters = initials(name);
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34">' +
      '<rect width="34" height="34" rx="6" fill="#1a7a3c"/>' +
      '<text x="17" y="22" font-family="Arial, sans-serif" font-size="13" font-weight="700" ' +
      'fill="#ffffff" text-anchor="middle">' +
      escapeXml(letters) +
      "</text></svg>";
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }

  function escapeXml(s) {
    return (s || "").replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }

  function norm(s) {
    if (!s) return "";
    return s
      .toString()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
  }

  function initials(name) {
    var parts = (name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    var s = parts[0][0];
    if (parts.length > 1) s += parts[1][0];
    return s.toUpperCase();
  }

  function titleCase(s) {
    if (!s) return "";
    return s
      .toLowerCase()
      .split(" ")
      .map(function (w) {
        return w ? w[0].toUpperCase() + w.slice(1) : w;
      })
      .join(" ");
  }

  var COUNTRY_META = {
    SE: { flag: "🇸🇪", label: "Sverige" },
    NO: { flag: "🇳🇴", label: "Norge" },
    DK: { flag: "🇩🇰", label: "Danmark" },
    FI: { flag: "🇫🇮", label: "Finland" },
    IS: { flag: "🇮🇸", label: "Island" }
  };
  var DEFAULT_ACTIVE_COUNTRY = "SE";

  var state = {
    all: [],
    district: "",
    youthOnly: false,
    activeCountries: {},
    markerById: {},
    placeIndex: {}, // normKey -> {label, clubs: []}
    filtered: []
  };

  function clubMatchesFilter(c) {
    if (!state.activeCountries[c.country]) return false;
    if (state.district && c.district !== state.district) return false;
    if (state.youthOnly && !c.has_youth) return false;
    return true;
  }

  // ---- country flag filter ----
  function buildCountryFlags() {
    var countries = Array.from(new Set(state.all.map(function (c) { return c.country; })));
    countries.sort(function (a, b) {
      if (a === DEFAULT_ACTIVE_COUNTRY) return -1;
      if (b === DEFAULT_ACTIVE_COUNTRY) return 1;
      var la = (COUNTRY_META[a] && COUNTRY_META[a].label) || a;
      var lb = (COUNTRY_META[b] && COUNTRY_META[b].label) || b;
      return la.localeCompare(lb, "sv");
    });
    var effectiveActiveCountry =
      initialCountry && COUNTRY_META[initialCountry] ? initialCountry : DEFAULT_ACTIVE_COUNTRY;
    countries.forEach(function (code) {
      state.activeCountries[code] = code === effectiveActiveCountry;
    });

    var wrap = document.getElementById("countryFlags");
    wrap.innerHTML = "";
    countries.forEach(function (code) {
      var meta = COUNTRY_META[code] || { flag: "🏳️", label: code };
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "flag-btn " + (state.activeCountries[code] ? "active" : "inactive");
      btn.textContent = meta.flag;
      btn.setAttribute("data-country", code);
      btn.setAttribute("aria-pressed", state.activeCountries[code] ? "true" : "false");
      btn.title = meta.label + (state.activeCountries[code] ? " (visas – klicka för att dölja)" : " (dold – klicka för att visa)");
      btn.addEventListener("click", function () {
        toggleCountry(code);
      });
      wrap.appendChild(btn);
    });
  }

  function updateCountryFlagButtons() {
    var wrap = document.getElementById("countryFlags");
    wrap.querySelectorAll(".flag-btn").forEach(function (btn) {
      var code = btn.getAttribute("data-country");
      var active = !!state.activeCountries[code];
      var meta = COUNTRY_META[code] || { label: code };
      btn.className = "flag-btn " + (active ? "active" : "inactive");
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.title = meta.label + (active ? " (visas – klicka för att dölja)" : " (dold – klicka för att visa)");
    });
  }

  function toggleCountry(code) {
    state.activeCountries[code] = !state.activeCountries[code];
    updateCountryFlagButtons();
    populateDistrictSelect();
    refreshMap();
  }

  function popupHtml(c) {
    var phones = (c.phones || [])
      .map(function (p) {
        return '<a href="tel:' + p.replace(/\s+/g, "") + '">' + p + "</a>";
      })
      .join(" · ");
    var website = c.website
      ? '<div class="popup-row">🔗 <a href="' +
        c.website +
        '" target="_blank" rel="noopener">' +
        c.website.replace(/^https?:\/\//, "") +
        "</a></div>"
      : "";
    var phoneRow = phones ? '<div class="popup-row">📞 ' + phones + "</div>" : "";
    var emailRow = c.email
      ? '<div class="popup-row">✉️ <a href="mailto:' + c.email + '">' + c.email + "</a></div>"
      : "";
    var addr = [c.address, [c.postal_code, titleCase(c.city)].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
    var addrRow = addr ? '<div class="popup-row">📍 ' + addr + "</div>" : "";
    var youthBadge = c.has_youth ? '<span class="badge">Ungdomsverksamhet</span>' : "";
    var fallback = placeholderLogo(c.name);
    var logoImg =
      '<img class="popup-logo" src="' +
      (c.logo_url || fallback) +
      '" onerror="this.onerror=null;this.src=\'' +
      fallback +
      "';\" alt=\"\" />";
    return (
      '<div class="popup-box">' +
      '<div class="popup-header">' +
      logoImg +
      '<div><div class="popup-title">' +
      escapeHtml(c.name) +
      '</div><div class="popup-sub">' +
      escapeHtml([c.district, c.municipality].filter(Boolean).join(" · ")) +
      "</div></div></div>" +
      addrRow +
      phoneRow +
      emailRow +
      website +
      youthBadge +
      "</div>"
    );
  }

  function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }

  function buildMarkers() {
    state.all.forEach(function (c) {
      if (c.lat == null || c.lon == null) return;
      var marker = L.marker([c.lat, c.lon], { title: c.name });
      marker.bindPopup(popupHtml(c), { maxWidth: 280 });
      marker._club = c;
      state.markerById[c.id] = marker;
    });
  }

  function refreshMap() {
    markerClusterGroup.clearLayers();
    var toAdd = [];
    state.filtered = [];
    state.all.forEach(function (c) {
      if (!clubMatchesFilter(c)) return;
      state.filtered.push(c);
      var m = state.markerById[c.id];
      if (m) toAdd.push(m);
    });
    markerClusterGroup.addLayers(toAdd);
    updateStats();
    renderSidebarList();
  }

  function clubsInView() {
    var bounds = map.getBounds();
    return state.filtered.filter(function (c) {
      return c.lat != null && c.lon != null && bounds.contains([c.lat, c.lon]);
    });
  }

  function updateStats() {
    document.getElementById("stats").textContent =
      state.filtered.length + " av " + state.all.length + " klubbar visas";
  }

  var SIDEBAR_CAP = 300;

  function renderSidebarList() {
    var list = document.getElementById("clubList");
    var title = document.getElementById("sidebarTitle");
    var visible = clubsInView();
    title.textContent = "Klubbar i vyn (" + visible.length + ")";
    var items = visible.slice(0, SIDEBAR_CAP);
    var html = items
      .map(function (c) {
        var fallback = placeholderLogo(c.name);
        var img =
          '<img class="logo" src="' +
          (c.logo_url || fallback) +
          '" onerror="this.onerror=null;this.src=\'' +
          fallback +
          "';\" alt=\"\" />";
        return (
          '<div class="club-item" data-id="' +
          c.id +
          '">' +
          img +
          '<div class="info"><div class="name">' +
          escapeHtml(c.name) +
          '</div><div class="loc">' +
          escapeHtml([titleCase(c.city) || c.municipality, c.district].filter(Boolean).join(" · ")) +
          "</div></div></div>"
        );
      })
      .join("");
    if (!visible.length) {
      html =
        '<div style="padding:12px 16px;color:#5b665f;font-size:0.85rem;">Inga klubbar i den här delen av kartan. Zooma ut eller panorera för att se fler.</div>';
    } else if (visible.length > SIDEBAR_CAP) {
      html +=
        '<div style="padding:12px 16px;color:#5b665f;font-size:0.8rem;">+' +
        (visible.length - SIDEBAR_CAP) +
        " fler klubbar i vyn. Zooma in för att se dem alla i listan.</div>";
    }
    list.innerHTML = html;
    list.querySelectorAll(".club-item").forEach(function (el) {
      el.addEventListener("click", function () {
        var id = el.getAttribute("data-id");
        flyToClub(id);
      });
    });
  }

  function flyToClub(id) {
    var m = state.markerById[id];
    if (!m) return;
    var c = m._club;
    if (!clubMatchesFilter(c)) {
      // reset filters so the club becomes visible
      state.district = "";
      state.youthOnly = false;
      document.getElementById("youthToggle").checked = false;
      if (!state.activeCountries[c.country]) {
        state.activeCountries[c.country] = true;
        updateCountryFlagButtons();
      }
      populateDistrictSelect();
      refreshMap();
    }
    map.setView(m.getLatLng(), 15, { animate: true });
    setTimeout(function () {
      markerClusterGroup.zoomToShowLayer(m, function () {
        m.openPopup();
      });
    }, 50);
    closeSidebarMobile();
  }

  function buildPlaceIndex() {
    var idx = {};
    state.all.forEach(function (c) {
      [c.city, c.municipality].forEach(function (raw) {
        if (!raw) return;
        var label = titleCase(raw);
        var key = norm(raw);
        if (!idx[key]) idx[key] = { label: label, key: key, clubs: [] };
        idx[key].clubs.push(c);
      });
    });
    state.placeIndex = idx;
  }

  function boundsForClubs(clubs) {
    var pts = clubs
      .filter(function (c) {
        return c.lat != null && c.lon != null;
      })
      .map(function (c) {
        return [c.lat, c.lon];
      });
    if (!pts.length) return null;
    return L.latLngBounds(pts);
  }

  function flyToPlace(key) {
    var entry = state.placeIndex[key];
    if (!entry) return;
    var bounds = boundsForClubs(entry.clubs);
    if (!bounds) return;
    if (entry.clubs.length === 1) {
      map.setView(bounds.getCenter(), 14, { animate: true });
    } else {
      map.fitBounds(bounds.pad(0.3), { maxZoom: 14, animate: true });
    }
    closeSidebarMobile();
  }

  // rebuilds the <option> list from clubs in currently active countries
  // only - callable repeatedly (init, and whenever a flag is toggled)
  function populateDistrictSelect() {
    var districts = Array.from(
      new Set(
        state.all
          .filter(function (c) { return state.activeCountries[c.country]; })
          .map(function (c) { return c.district; })
      )
    )
      .filter(Boolean)
      .sort(function (a, b) { return a.localeCompare(b, "sv"); });

    var sel = document.getElementById("districtSelect");
    sel.innerHTML = '<option value="">Alla distrikt</option>';
    districts.forEach(function (d) {
      var opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      sel.appendChild(opt);
    });

    if (state.district && districts.indexOf(state.district) === -1) {
      state.district = "";
    }
    sel.value = state.district;
  }

  function setupDistrictSelect() {
    var sel = document.getElementById("districtSelect");
    sel.addEventListener("change", function () {
      state.district = sel.value;
      refreshMap();
      if (state.district) {
        var bounds = boundsForClubs(state.filtered);
        if (bounds) map.fitBounds(bounds.pad(0.15), { maxZoom: 12 });
      } else {
        map.setView([62.5, 15.8], 5);
      }
    });
  }

  function setupYouthToggle() {
    document.getElementById("youthToggle").addEventListener("change", function (e) {
      state.youthOnly = e.target.checked;
      refreshMap();
    });
  }

  // ---- search ----
  var searchInput = document.getElementById("searchInput");
  var suggestionsBox = document.getElementById("suggestions");
  var activeIndex = -1;
  var currentSuggestions = [];

  function renderSuggestions(query) {
    var q = norm(query);
    currentSuggestions = [];
    if (!q) {
      suggestionsBox.classList.remove("open");
      suggestionsBox.innerHTML = "";
      return;
    }
    var placeMatches = Object.keys(state.placeIndex)
      .filter(function (k) {
        return k.indexOf(q) === 0 || k.indexOf(" " + q) !== -1;
      })
      .slice(0, 40)
      .map(function (k) {
        return state.placeIndex[k];
      })
      .sort(function (a, b) {
        return b.clubs.length - a.clubs.length;
      })
      .slice(0, 6);

    var clubMatches = state.all
      .filter(function (c) {
        return norm(c.name).indexOf(q) !== -1;
      })
      .slice(0, 6);

    var html = "";
    if (placeMatches.length) {
      html += '<div class="suggestion-group-title">Orter</div>';
      placeMatches.forEach(function (p) {
        currentSuggestions.push({ type: "place", key: p.key, label: p.label, count: p.clubs.length });
      });
    }
    if (clubMatches.length) {
      html += '<div class="suggestion-group-title">Klubbar</div>';
    }
    clubMatches.forEach(function (c) {
      currentSuggestions.push({ type: "club", id: c.id, label: c.name, sub: titleCase(c.city) });
    });

    // render in insertion order but keep group headers correctly placed
    html = "";
    if (placeMatches.length) {
      html += '<div class="suggestion-group-title">Orter</div>';
      placeMatches.forEach(function (p, i) {
        html +=
          '<div class="suggestion-item" data-type="place" data-key="' +
          p.key +
          '"><span>' +
          escapeHtml(p.label) +
          "</span><small>" +
          p.clubs.length +
          " klubbar</small></div>";
      });
    }
    if (clubMatches.length) {
      html += '<div class="suggestion-group-title">Klubbar</div>';
      clubMatches.forEach(function (c) {
        html +=
          '<div class="suggestion-item" data-type="club" data-id="' +
          c.id +
          '"><span>' +
          escapeHtml(c.name) +
          "</span><small>" +
          escapeHtml(titleCase(c.city)) +
          "</small></div>";
      });
    }
    if (!placeMatches.length && !clubMatches.length) {
      html = '<div class="suggestion-item">Inga träffar</div>';
    }
    suggestionsBox.innerHTML = html;
    suggestionsBox.classList.add("open");
    activeIndex = -1;

    suggestionsBox.querySelectorAll(".suggestion-item[data-type]").forEach(function (el) {
      el.addEventListener("click", function () {
        handleSuggestionSelect(el);
      });
    });
  }

  function handleSuggestionSelect(el) {
    var type = el.getAttribute("data-type");
    if (type === "place") {
      var key = el.getAttribute("data-key");
      searchInput.value = state.placeIndex[key].label;
      flyToPlace(key);
    } else if (type === "club") {
      var id = el.getAttribute("data-id");
      var m = state.markerById[id];
      searchInput.value = m ? m._club.name : "";
      flyToClub(id);
    }
    suggestionsBox.classList.remove("open");
  }

  searchInput.addEventListener("input", function () {
    renderSuggestions(searchInput.value);
  });

  searchInput.addEventListener("keydown", function (e) {
    var items = suggestionsBox.querySelectorAll(".suggestion-item[data-type]");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      items.forEach(function (it, i) { it.classList.toggle("active", i === activeIndex); });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      items.forEach(function (it, i) { it.classList.toggle("active", i === activeIndex); });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && items[activeIndex]) {
        handleSuggestionSelect(items[activeIndex]);
      } else if (items.length) {
        handleSuggestionSelect(items[0]);
      }
    } else if (e.key === "Escape") {
      suggestionsBox.classList.remove("open");
    }
  });

  document.addEventListener("click", function (e) {
    if (!suggestionsBox.contains(e.target) && e.target !== searchInput) {
      suggestionsBox.classList.remove("open");
    }
  });

  // ---- mobile sidebar ----
  function closeSidebarMobile() {
    document.getElementById("sidebar").classList.remove("open");
  }
  document.getElementById("sidebarBtn").addEventListener("click", function () {
    document.getElementById("sidebar").classList.toggle("open");
  });

  // ---- info modal ----
  var infoModal = document.getElementById("infoModal");
  document.getElementById("infoBtn").addEventListener("click", function () {
    infoModal.classList.add("open");
  });
  document.getElementById("infoClose").addEventListener("click", function () {
    infoModal.classList.remove("open");
  });
  infoModal.addEventListener("click", function (e) {
    if (e.target === infoModal) infoModal.classList.remove("open");
  });

  // keep the sidebar list in sync with what's currently visible on the map
  map.on("moveend", renderSidebarList);

  window.__fotbollskartan = { state: state, map: map, markerClusterGroup: markerClusterGroup, flyToClub: flyToClub, flyToPlace: flyToPlace };

  // ---- init ----
  fetch("data.json")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      state.all = data;
      buildPlaceIndex();
      buildCountryFlags();
      setupDistrictSelect();
      populateDistrictSelect();
      setupYouthToggle();
      buildMarkers();
      refreshMap();
    })
    .catch(function (err) {
      document.getElementById("stats").textContent = "Kunde inte ladda klubbdata.";
      console.error(err);
    });
})();
