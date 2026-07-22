// Shared app utilities: online/offline pill, toast, service worker registration, small helpers.

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('Service worker registration failed', err);
      });
    });
  }
}

export function initOfflinePill() {
  const pill = document.querySelector('[data-offline-pill]');
  if (!pill) return;
  function update() {
    const online = navigator.onLine;
    pill.textContent = online ? 'Online' : 'Offline — saved locally';
    pill.className = 'offline-pill ' + (online ? 'online' : 'offline');
  }
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

export function markActiveNav() {
  const here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.bottom-nav a').forEach((a) => {
    const target = a.getAttribute('href');
    if (target === here) a.classList.add('active');
  });
}

let toastTimer = null;
export function showToast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

export function nowLocalDatetimeValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function captureGeolocation(onResult, onError) {
  if (!('geolocation' in navigator)) {
    onError && onError(new Error('Geolocation not supported on this device'));
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => onResult({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
    (err) => onError && onError(err),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
}

export function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function initHeaderNav() {
  registerServiceWorker();
  initOfflinePill();
  markActiveNav();
}
