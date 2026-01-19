const WFS_ENDPOINT = 'https://data.rivm.nl/geo/alo/ows';
const TYPE_NAME = 'alo:stookwijzer_v2';

const TIME_ZONE = 'Europe/Amsterdam';

const THEME_STORAGE_KEY = 'stookwijzer.theme';
const PC4_STORAGE_KEY = 'stookwijzer.pc4';

const state = {
  lastPc4: null,
  lastCoords: null,
  requestSeq: 0,
  activeController: null,
};

const el = {
  screen: document.getElementById('screen'),
  btnCircle: document.getElementById('btnCircle'),
  btnTheme: document.getElementById('btnTheme'),
  postcodeForm: document.getElementById('postcodeForm'),
  postcodeInput: document.getElementById('postcodeInput'),
  btnLocate: document.getElementById('btnLocate'),
  btnDemo: document.getElementById('btnDemo'),
  btnCheck: document.getElementById('btnCheck'),
  lat: document.getElementById('lat'),
  lon: document.getElementById('lon'),
  status: document.getElementById('status'),
  result: document.getElementById('result'),
  headline: document.getElementById('headline'),
  subline: document.getElementById('subline'),
  changesList: document.getElementById('changesList'),
  pc4: document.getElementById('pc4'),
  runtime: document.getElementById('runtime'),
  adviceRows: document.getElementById('adviceRows'),
};

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (e) {
    // Non-fatal; app should still work without offline/install.
    console.warn('Service worker registration failed', e);
  }
}

function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  // Button shows what you can switch TO.
  el.btnTheme.textContent = next === 'dark' ? '☀' : '☾';
  el.btnTheme.setAttribute('aria-pressed', String(next === 'light'));
}

function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  // Default to dark if nothing is saved.
  applyTheme(saved || 'dark');
}

function setStatus(message) {
  el.status.textContent = message ?? '';
}

function setLoading(isLoading) {
  el.btnCircle.disabled = isLoading;
  el.btnLocate.disabled = isLoading;
  el.btnDemo.disabled = isLoading;
  el.btnCheck.disabled = isLoading;

  if (el.postcodeInput) el.postcodeInput.disabled = isLoading;
}

let postcodeLookupTimer = null;

function triggerPc4LookupNow() {
  const pc4 = normalizePc4(el.postcodeInput.value);
  if (!pc4) return;
  if (pc4 === state.lastPc4) return;
  checkByPc4(pc4);
}

function schedulePc4Lookup() {
  if (postcodeLookupTimer) window.clearTimeout(postcodeLookupTimer);
  postcodeLookupTimer = window.setTimeout(() => {
    postcodeLookupTimer = null;
    triggerPc4LookupNow();
  }, 350);
}

function normalizePc4(input) {
  const raw = String(input ?? '').trim().toUpperCase().replaceAll(' ', '');
  // Accept 4 digits or 6-char NL postcodes; use first 4 digits.
  const m4 = raw.match(/^(\d{4})/);
  return m4 ? m4[1] : null;
}

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const TZ_PARTS_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function getTimeZoneOffsetMinutes(date, timeZone = TIME_ZONE) {
  const fmt = timeZone === TIME_ZONE
    ? TZ_PARTS_FORMAT
    : new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
  const parts = fmt.formatToParts(date);
  const values = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return (asUTC - date.getTime()) / 60000;
}

function dateFromAmsterdamParts(year, month, day, hour, minute) {
  const utc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offset = getTimeZoneOffsetMinutes(new Date(utc));
  return new Date(utc - offset * 60 * 1000);
}

function parseModelRuntime(value) {
  // Format in dataset: "dd-mm-jjjj uu:mm" in Europe/Amsterdam
  if (!value || typeof value !== 'string') return null;
  const m = value.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min] = m;
  return dateFromAmsterdamParts(Number(yyyy), Number(mm), Number(dd), Number(hh), Number(min));
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

const DATE_TIME_FMT = new Intl.DateTimeFormat('nl-NL', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

const TIME_FMT = new Intl.DateTimeFormat('nl-NL', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

const SHORT_DATE_TIME_FMT = new Intl.DateTimeFormat('nl-NL', {
  timeZone: TIME_ZONE,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

function formatDateTime(date) {
  return DATE_TIME_FMT.format(date);
}

function formatTime(date) {
  return TIME_FMT.format(date);
}

function formatShortDateTime(date) {
  return SHORT_DATE_TIME_FMT.format(date);
}

function adviceLabel(code) {
  // Domain: -1 = geen advies, 0 = geel, 1 = oranje, 2 = rood
  switch (code) {
    case 0:
      return { text: 'Geel', cls: 'yellow' };
    case 1:
      return { text: 'Oranje', cls: 'orange' };
    case 2:
      return { text: 'Rood', cls: 'red' };
    default:
      return { text: 'Geen advies', cls: 'gray' };
  }
}

function heroText(code) {
  switch (code) {
    case 0:
      return { headline: 'LET OP', subline: 'Stoken kan overlast geven' };
    case 1:
      return { headline: 'LET OP', subline: 'Beter niet stoken' };
    case 2:
      return { headline: 'NIET', subline: 'Stook geen hout' };
    default:
      return { headline: 'ONBEKEND', subline: 'Geen advies beschikbaar' };
  }
}

function toneForAdvice(code) {
  switch (code) {
    case 0:
      return 'yellow';
    case 1:
      return 'orange';
    case 2:
      return 'red';
    default:
      return 'neutral';
  }
}

function badgeHTML(code) {
  const { text, cls } = adviceLabel(code);
  return `<span class="badge"><span class="dot ${cls}"></span>${escapeHtml(text)}</span>`;
}

function smallAdviceBadgeHTML(code) {
  const { text, cls } = adviceLabel(code);
  return `<span class="changeBadge"><span class="dotBubble ${cls}"></span>${escapeHtml(text)}</span>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function pointInRing(point, ring) {
  // Ray-casting algorithm (lon/lat)
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, geometry) {
  if (!geometry) return false;

  if (geometry.type === 'Polygon') {
    const [outer, ...holes] = geometry.coordinates;
    if (!outer || !pointInRing(point, outer)) return false;
    for (const hole of holes) {
      if (hole && pointInRing(point, hole)) return false;
    }
    return true;
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((poly) => pointInPolygon(point, { type: 'Polygon', coordinates: poly }));
  }

  return false;
}

async function fetchStookwijzerFeature(lon, lat, signal) {
  // Small bbox around the point to limit response size.
  // 0.02 degrees is usually enough to catch a PC4 polygon without fetching too much.
  const d = 0.02;
  const minx = lon - d;
  const miny = lat - d;
  const maxx = lon + d;
  const maxy = lat + d;

  const url = new URL(WFS_ENDPOINT);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'GetFeature');
  url.searchParams.set('typeNames', TYPE_NAME);
  url.searchParams.set('outputFormat', 'application/json');
  url.searchParams.set('srsName', 'CRS:84');
  url.searchParams.set('count', '50');
  url.searchParams.set('bbox', `${minx},${miny},${maxx},${maxy},CRS:84`);

  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`WFS request failed (${res.status}) ${text.slice(0, 200)}`);
  }

  const fc = await res.json();
  const features = Array.isArray(fc?.features) ? fc.features : [];
  const point = [lon, lat];
  const match = features.find((f) => pointInPolygon(point, f.geometry));

  return match ?? null;
}

async function fetchStookwijzerFeatureByPc4(pc4, signal) {
  const url = new URL(WFS_ENDPOINT);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'GetFeature');
  url.searchParams.set('typeNames', TYPE_NAME);
  url.searchParams.set('outputFormat', 'application/json');
  url.searchParams.set('srsName', 'CRS:84');
  url.searchParams.set('count', '1');
  url.searchParams.set('cql_filter', `pc4='${pc4}'`);

  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`WFS request failed (${res.status}) ${text.slice(0, 200)}`);
  }

  const fc = await res.json();
  const features = Array.isArray(fc?.features) ? fc.features : [];
  return features[0] ?? null;
}

function buildBlocks(props) {
  return [
    { offset: 0, advies: props.advies_0, definitief: props.definitief_0 },
    { offset: 6, advies: props.advies_6, definitief: props.definitief_6 },
    { offset: 12, advies: props.advies_12, definitief: props.definitief_12 },
    { offset: 18, advies: props.advies_18, definitief: props.definitief_18 },
  ];
}

function buildSegments(runtime, blocks) {
  if (!runtime) return [];
  return blocks.map((b) => {
    const start = addHours(runtime, b.offset);
    const end = addHours(runtime, b.offset + 6);
    return {
      start,
      end,
      advies: Number.isFinite(b.advies) ? b.advies : -1,
      definitief: typeof b.definitief === 'boolean' ? b.definitief : null,
    };
  });
}

function segmentContaining(segments, atDate) {
  return segments.find((s) => atDate >= s.start && atDate < s.end) ?? null;
}

function fixedOrNotLabel(definitief) {
  return definitief === true ? 'vastgesteld' : 'kan nog wijzigen';
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatSlotRange(start, end, todayRef) {
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  const showStartDate = !(todayRef && isSameDay(start, todayRef));
  const showEndDate = !(todayRef && isSameDay(end, todayRef));

  if (sameDay) {
    const left = showStartDate ? formatShortDateTime(start) : formatTime(start);
    const right = formatTime(end);

    // If we show a date, render on two lines to prevent awkward wrapping (and never show a dash).
    if (showStartDate) {
      return {
        displayHtml: `${escapeHtml(left)}<br>${escapeHtml(right)}`,
        ariaText: `${left} tot ${right}`,
      };
    }

    const text = `${left}–${right}`;
    return { displayHtml: escapeHtml(text), ariaText: text };
  }

  const startText = showStartDate ? formatShortDateTime(start) : formatTime(start);
  const endText = showEndDate ? formatShortDateTime(end) : formatTime(end);
  return {
    displayHtml: `${escapeHtml(startText)}<br>${escapeHtml(endText)}`,
    ariaText: `${startText} tot ${endText}`,
  };
}

function adviceAt(runtime, blocks, atDate) {
  if (!runtime) {
    const first = blocks[0];
    return {
      advies: Number.isFinite(first?.advies) ? first.advies : -1,
      definitief: typeof first?.definitief === 'boolean' ? first.definitief : null,
    };
  }

  for (const b of blocks) {
    const start = addHours(runtime, b.offset);
    const end = addHours(runtime, b.offset + 6);
    if (atDate >= start && atDate < end) {
      return {
        advies: Number.isFinite(b?.advies) ? b.advies : -1,
        definitief: typeof b?.definitief === 'boolean' ? b.definitief : null,
      };
    }
  }

  // Outside modeled window
  return { advies: -1, definitief: null };
}

function canStillChangeLabel(definitief) {
  if (definitief === true) return '';
  return 'kan nog wijzigen';
}

function render(feature) {
  const props = feature?.properties ?? {};

  const pc4 = props.pc4 ?? '–';
  el.pc4.textContent = pc4;
  if (pc4 !== '–' && document.activeElement !== el.postcodeInput) {
    el.postcodeInput.value = pc4;
  }

  const runtime = parseModelRuntime(props.model_runtime);
  el.runtime.textContent = runtime
    ? `Model runtime: ${formatDateTime(runtime)}`
    : props.model_runtime
      ? `Model runtime: ${props.model_runtime}`
      : '';

  const blocks = buildBlocks(props);
  const now = new Date();
  const segmentsForNow = buildSegments(runtime, blocks);
  const segNow =
    segmentsForNow.length > 0
      ? segmentContaining(segmentsForNow, now) || (now < segmentsForNow[0].start ? segmentsForNow[0] : segmentsForNow[segmentsForNow.length - 1])
      : null;

  const current = segNow
    ? { advies: segNow.advies, definitief: segNow.definitief }
    : adviceAt(runtime, blocks, now);

  const tone = toneForAdvice(current.advies);
  el.screen.dataset.tone = tone;

  const { headline, subline } = heroText(current.advies);
  el.headline.textContent = headline;
  el.subline.textContent = subline;

  // Show the 4 time slots
  const segments = segmentsForNow;

  if (!runtime || !segments.length) {
    el.changesList.innerHTML = '<div class="emptyChange">Geen prognose beschikbaar.</div>';
  } else {
    el.changesList.innerHTML = segments
      .map((s) => {
        const range = formatSlotRange(s.start, s.end, now);
        const fixed = fixedOrNotLabel(s.definitief);
        return `
          <div class="changeItem" aria-label="${escapeHtml(range.ariaText)}: ${escapeHtml(adviceLabel(s.advies).text)} (${escapeHtml(fixed)})">
            <div class="changeLeft">
              <div class="changeTime">${range.displayHtml}</div>
              <div class="changeLabel">${escapeHtml(fixed)}</div>
            </div>
            ${smallAdviceBadgeHTML(s.advies)}
          </div>
        `;
      })
      .join('');
  }

  el.adviceRows.innerHTML = blocks
    .map((b) => {
      const advies = Number.isFinite(b.advies) ? b.advies : -1;
      const definitief = typeof b.definitief === 'boolean' ? (b.definitief ? 'Ja' : 'Nee') : '–';

      let timeLabel = `${b.offset}–${b.offset + 6} uur`;
      if (runtime) {
        const start = addHours(runtime, b.offset);
        const end = addHours(runtime, b.offset + 6);
        timeLabel = `${formatDateTime(start)} – ${formatDateTime(end)}`;
      }

      return `
        <tr>
          <td>${escapeHtml(timeLabel)}</td>
          <td>${badgeHTML(advies)}</td>
          <td>${escapeHtml(definitief)}</td>
        </tr>
      `;
    })
    .join('');

  el.result.hidden = false;
}

async function check() {
  const requestId = ++state.requestSeq;
  if (state.activeController) state.activeController.abort();
  const controller = new AbortController();
  state.activeController = controller;

  const lat = parseNumber(el.lat.value);
  const lon = parseNumber(el.lon.value);

  if (lat == null || lon == null) {
    setStatus('Vul latitude en longitude in.');
    return;
  }

  setLoading(true);
  setStatus('Bezig met ophalen…');
  el.result.hidden = true;

  try {
    const feature = await fetchStookwijzerFeature(lon, lat, controller.signal);

    if (!feature) {
      setStatus('Geen resultaat voor deze locatie (buiten NL of geen data).');
      el.screen.dataset.tone = 'neutral';
      el.headline.textContent = 'ONBEKEND';
      el.subline.textContent = 'Geen advies beschikbaar';
      return;
    }

    if (requestId === state.requestSeq) {
      setStatus('');
      state.lastCoords = { lat, lon };
      state.lastPc4 = null;
      render(feature);
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error(err);
    if (requestId === state.requestSeq) {
      setStatus('Fout bij ophalen. Probeer opnieuw.');
      el.screen.dataset.tone = 'neutral';
    }
  } finally {
    if (requestId === state.requestSeq) setLoading(false);
  }
}

async function checkByPc4(pc4) {
  const requestId = ++state.requestSeq;
  if (state.activeController) state.activeController.abort();
  const controller = new AbortController();
  state.activeController = controller;

  setLoading(true);
  setStatus('Bezig met ophalen…');
  el.result.hidden = true;

  try {
    const feature = await fetchStookwijzerFeatureByPc4(pc4, controller.signal);
    if (!feature) {
      if (requestId === state.requestSeq) {
        setStatus('Geen resultaat voor deze postcode.');
        el.screen.dataset.tone = 'neutral';
        el.headline.textContent = 'ONBEKEND';
        el.subline.textContent = 'Geen advies beschikbaar';
      }
      return;
    }

    if (requestId === state.requestSeq) {
      setStatus('');
      state.lastPc4 = pc4;
      state.lastCoords = null;
      localStorage.setItem(PC4_STORAGE_KEY, pc4);
      render(feature);
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error(err);
    if (requestId === state.requestSeq) {
      setStatus('Fout bij ophalen. Probeer opnieuw.');
      el.screen.dataset.tone = 'neutral';
    }
  } finally {
    if (requestId === state.requestSeq) setLoading(false);
  }
}

function locate() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation not supported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
    );
  });
}

async function locateAndCheck() {
  setLoading(true);
  setStatus('Locatie opvragen…');

  try {
    const pos = await locate();
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    el.lat.value = String(lat);
    el.lon.value = String(lon);
    setStatus('Locatie gevonden. Stookadvies ophalen…');
    await check();
  } catch (err) {
    console.error(err);
    setStatus('Locatie niet beschikbaar (toestemming geweigerd?). Vul handmatig in.');
  } finally {
    setLoading(false);
  }
}

el.btnLocate.addEventListener('click', locateAndCheck);

el.postcodeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  // Keep Enter-to-search working.
  triggerPc4LookupNow();
});

el.postcodeInput.addEventListener('input', () => {
  // Auto-search when a valid pc4 is typed; debounce to avoid spamming requests.
  schedulePc4Lookup();
});

el.postcodeInput.addEventListener('blur', () => {
  // If user tabs away, run immediately.
  if (postcodeLookupTimer) {
    window.clearTimeout(postcodeLookupTimer);
    postcodeLookupTimer = null;
  }
  triggerPc4LookupNow();
});

el.postcodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    // Avoid accidental form submission side effects; do an immediate lookup.
    e.preventDefault();
    if (postcodeLookupTimer) {
      window.clearTimeout(postcodeLookupTimer);
      postcodeLookupTimer = null;
    }
    triggerPc4LookupNow();
    return;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    el.postcodeInput.value = state.lastPc4 || el.postcodeInput.value;
    el.postcodeInput.blur();
  }
});

el.btnCircle.addEventListener('click', () => {
  // Refresh: prefer postcode mode if set, otherwise lat/lon, otherwise re-locate.
  if (state.lastPc4) {
    checkByPc4(state.lastPc4);
    return;
  }

  const lat = parseNumber(el.lat.value);
  const lon = parseNumber(el.lon.value);
  if (lat != null && lon != null) {
    check();
    return;
  }

  locateAndCheck();
});

el.btnTheme.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
});

el.btnDemo.addEventListener('click', () => {
  // Utrecht-ish
  el.lat.value = '52.0907';
  el.lon.value = '5.1214';
  setStatus('Demo locatie ingevuld. Stookadvies ophalen…');
  check();
});

el.btnCheck.addEventListener('click', check);

// Convenience: Enter triggers check
[el.lat, el.lon].forEach((inp) => {
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') check();
  });
});

// On load: try to fetch the advice immediately.
// If user denies location permission, they can still type lat/lon and press “Check”.
window.addEventListener('load', () => {
  registerServiceWorker();
  initTheme();

  const savedPc4 = localStorage.getItem(PC4_STORAGE_KEY);
  const pc4 = normalizePc4(savedPc4);
  if (pc4) {
    state.lastPc4 = pc4;
    el.postcodeInput.value = pc4;
    checkByPc4(pc4);
    return;
  }

  locateAndCheck();
});
