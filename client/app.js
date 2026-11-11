/**
 * Grand Horizon Hotel - Client Application
 */

const API_BASE = '/api';

const ROUTE_MAP = {
  landing: '/',
  search: '/rooms',
  login: '/login',
  'my-bookings': '/bookings',
  'front-desk': '/front-desk',
  housekeeping: '/housekeeping',
  reports: '/reports',
  'room-admin': '/admin/rooms',
  'audit-logs': '/admin/audit',
  privacy: '/privacy',
  terms: '/terms',
  '404': '/404'
};

const PAGE_META = {
  landing: {
    title: 'Grand Horizon Hotel | Oceanfront Reservations in Dona Paula, Goa',
    description: 'Book oceanfront rooms, garden villas, and penthouses directly at Grand Horizon Hotel in Dona Paula, Goa.'
  },
  search: {
    title: 'Rooms and Availability | Grand Horizon Hotel',
    description: 'Search live hotel room inventory, compare nightly rates, and hold your suite for checkout.'
  },
  login: {
    title: 'Sign In or Create Account | Grand Horizon Hotel',
    description: 'Sign in or create a guest account to manage bookings and confirmation vouchers.'
  },
  'my-bookings': {
    title: 'My Reservations | Grand Horizon Hotel',
    description: 'Look up your hotel reservation reference, print confirmation vouchers, or manage cancellations.'
  },
  privacy: {
    title: 'Privacy Policy | Grand Horizon Hotel',
    description: 'Privacy Policy detailing guest data collection, security, cookies, and analytics at Grand Horizon Hotel.'
  },
  terms: {
    title: 'Terms and Conditions | Grand Horizon Hotel',
    description: 'Terms and Conditions covering room holds, rates, check-in/check-out policies, and refunds.'
  },
  '404': {
    title: '404 Page Not Found | Grand Horizon Hotel',
    description: 'The requested page could not be found at Grand Horizon Hotel.'
  }
};

const PATH_TO_VIEW = Object.fromEntries(
  Object.entries(ROUTE_MAP).map(([view, path]) => [path, view])
);

const FAQ_ITEMS = [
  {
    q: 'What are check-in and check-out times?',
    a: 'Standard check-in begins at 15:00 (3:00 PM) and check-out is at 11:00 (11:00 AM). A 15:00 late check-out add-on is available during booking.'
  },
  {
    q: 'How does the 10-minute checkout room hold work?',
    a: 'When you enter guest details and proceed to checkout, the system places an atomic 10-minute hold on an available physical room so another guest cannot book it while you pay. Expired holds automatically release the room.'
  },
  {
    q: 'Can I cancel my confirmed reservation online?',
    a: 'Yes. Confirmed reservations can be cancelled from the My Bookings page prior to check-in. Cancellations automatically process a full sandbox refund to the original test payment record.'
  },
  {
    q: 'What taxes and fees apply to room rates?',
    a: 'All stays include a 12% GST hospitality tax on room and add-on charges plus a $25.00 per night resort service fee. Friday and Saturday nights include a 15% weekend rate modifier.'
  },
  {
    q: 'Is airport transportation available?',
    a: 'Yes. You can add Private Airport Transfer ($60 flat fee) during Step 1 of checkout, or contact the 24-hour front desk with your flight details.'
  },
  {
    q: 'How do I look up a reservation without signing in?',
    a: 'Open My Bookings from the top navigation bar and enter your booking reference (for example, BK-2026-8812) into the lookup field.'
  }
];

const state = {
  currentUser: null,
  token: localStorage.getItem('gh_token') || null,
  currentRole: 'ANONYMOUS',
  currentView: 'landing',
  searchParams: {
    checkIn: '',
    checkOut: '',
    adults: 2,
    children: 0
  },
  cachedRoomTypes: [],
  availableAddOns: [],
  selectedRoomType: null,
  activeHold: null,
  holdTimerInterval: null,
  holdExpiresAt: null,
  confirmCallback: null,
  formLoadedAt: Date.now()
};

// ============================================================================
// First-Party Analytics (Privacy-respecting, stored in MongoDB)
// ============================================================================
async function trackAnalytics(event, metadata = null) {
  try {
    if (localStorage.getItem('gh_cookie_consent') === 'declined') return;
    await fetch(`${API_BASE}/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        path: window.location.pathname,
        utm: getUtmParams(),
        metadata
      })
    });
  } catch (e) {}
}

// ============================================================================
// Initialization & Startup
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  state.formLoadedAt = Date.now();
  syncThemeUI();
  initCookieBanner();
  captureUtmParameters();
  renderFaqList();
  setupDefaultDates();
  setupScrollListeners();

  await checkExistingSession();
  await Promise.all([
    loadAvailableAddOns(),
    loadLandingSuites()
  ]);

  const initialPath = window.location.pathname;
  if (initialPath === '/register') {
    navigate('login', false);
    switchAuthTab('register');
  } else {
    const initialView = PATH_TO_VIEW[initialPath] || '404';
    navigate(initialView, false);
  }

  // Close site search dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const desktopResults = document.getElementById('site-search-results');
    const desktopInput = document.getElementById('site-search-input');
    if (desktopResults && desktopInput && !desktopResults.contains(e.target) && e.target !== desktopInput) {
      desktopResults.classList.add('hidden');
    }
  });
});

window.addEventListener('popstate', () => {
  const path = window.location.pathname;
  if (path === '/register') {
    navigate('login', false);
    switchAuthTab('register');
  } else {
    const view = PATH_TO_VIEW[path] || '404';
    navigate(view, false);
  }
});

// ============================================================================
// Theme (Dark Mode Toggle), Scroll Bar, Back to Top, Mobile Menu, Cookie, UTM
// ============================================================================
function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('gh_theme', isDark ? 'dark' : 'light');
  syncThemeUI();
}

function syncThemeUI() {
  const isDark = document.documentElement.classList.contains('dark');
  const label = isDark ? 'Light Mode' : 'Dark Mode';
  const btnDesktop = document.getElementById('btn-theme-toggle');
  const btnMobile = document.getElementById('mob-theme-toggle');
  if (btnDesktop) btnDesktop.textContent = label;
  if (btnMobile) btnMobile.textContent = label;
}

function toggleMobileMenu(forceState = null) {
  const menu = document.getElementById('mobile-menu');
  const btn = document.getElementById('btn-mobile-menu');
  if (!menu || !btn) return;
  const shouldOpen = forceState !== null ? forceState : menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !shouldOpen);
  btn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
}

function setupScrollListeners() {
  const onScroll = () => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const pct = docHeight > 0 ? Math.min(100, (scrollTop / docHeight) * 100) : 0;

    const progressBar = document.getElementById('scroll-progress-bar');
    if (progressBar) progressBar.style.width = `${pct}%`;

    const header = document.getElementById('main-header');
    if (header) header.classList.toggle('header-scrolled', scrollTop > 10);

    const backToTop = document.getElementById('back-to-top');
    if (backToTop) backToTop.classList.toggle('hidden', scrollTop < 280);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initCookieBanner() {
  const consent = localStorage.getItem('gh_cookie_consent');
  const banner = document.getElementById('cookie-banner');
  if (banner && !consent) {
    banner.classList.remove('hidden');
  }
}

function setCookieConsent(choice) {
  localStorage.setItem('gh_cookie_consent', choice);
  const banner = document.getElementById('cookie-banner');
  if (banner) banner.classList.add('hidden');
  showToast(choice === 'accepted' ? 'Cookie preferences saved' : 'Essential storage only enabled', 'info');
}

function captureUtmParameters() {
  const params = new URLSearchParams(window.location.search);
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  const captured = {};
  let hasAny = false;

  keys.forEach((k) => {
    const val = params.get(k);
    if (val) {
      captured[k] = val;
      hasAny = true;
    }
  });

  if (hasAny) {
    captured.landing_path = window.location.pathname;
    captured.captured_at = new Date().toISOString();
    sessionStorage.setItem('gh_utm', JSON.stringify(captured));
  }

  const stored = getUtmParams();
  const indicator = document.getElementById('footer-utm-indicator');
  if (stored && indicator) {
    const sourceText = stored.utm_source || stored.utm_campaign || 'tracked';
    indicator.textContent = `Campaign: ${sourceText}`;
    indicator.classList.remove('hidden');
  }
}

function getUtmParams() {
  try {
    const raw = sessionStorage.getItem('gh_utm');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// ============================================================================
// Site Search (Rooms, Amenities, FAQs, Pages)
// ============================================================================
function handleSiteSearch(query, targetId = 'site-search-results') {
  const container = document.getElementById(targetId);
  if (!container) return;

  const q = (query || '').trim().toLowerCase();
  if (!q) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  const results = [];

  // 1. Search cached room types
  state.cachedRoomTypes.forEach((rt) => {
    const text = `${rt.name} ${rt.description} ${rt.bed_type} ${(rt.amenities || []).join(' ')}`.toLowerCase();
    if (text.includes(q)) {
      results.push({
        category: 'Room Category',
        title: rt.name,
        subtitle: `${rt.base_price_formatted}/night | ${rt.bed_type}`,
        action: () => navigate('search')
      });
    }
  });

  // 2. Search FAQs
  FAQ_ITEMS.forEach((item, idx) => {
    if (`${item.q} ${item.a}`.toLowerCase().includes(q)) {
      results.push({
        category: 'FAQ',
        title: item.q,
        subtitle: item.a.slice(0, 72) + '...',
        action: () => {
          navigate('landing');
          setTimeout(() => {
            toggleFaq(idx, true);
            const el = document.getElementById('faq-section');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }, 50);
        }
      });
    }
  });

  // 3. Static Pages
  const pages = [
    { name: 'Rooms & Booking Search', view: 'search', keywords: 'rooms availability search book reserve price' },
    { name: 'My Bookings & Reference Lookup', view: 'my-bookings', keywords: 'bookings reservations cancel lookup voucher' },
    { name: 'Sign In or Create Account', view: 'login', keywords: 'login register account password sign in' },
    { name: 'Property Policies & Check-In Times', view: 'landing', keywords: 'policies taxes check-in check-out address phone' }
  ];
  pages.forEach((p) => {
    if (`${p.name} ${p.keywords}`.toLowerCase().includes(q)) {
      results.push({
        category: 'Page',
        title: p.name,
        subtitle: `Open ${ROUTE_MAP[p.view] || '/'}`,
        action: () => navigate(p.view)
      });
    }
  });

  if (results.length === 0) {
    container.innerHTML = `<div class="p-3 text-xs theme-text-secondary">No matches found for "${escapeHtml(query)}".</div>`;
    container.classList.remove('hidden');
    return;
  }

  window.__siteSearchActions = results.slice(0, 8).map(r => r.action);
  container.innerHTML = results.slice(0, 8).map((r, i) => `
    <button type="button" onclick="triggerSiteSearchAction(${i}, '${targetId}')" class="w-full text-left p-2.5 rounded theme-row-hover block cursor-pointer border-0 bg-transparent">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-semibold theme-text-primary">${escapeHtml(r.title)}</span>
        <span class="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded surface-panel theme-text-secondary">${r.category}</span>
      </div>
      <div class="text-[11px] theme-text-secondary mt-0.5 truncate">${escapeHtml(r.subtitle)}</div>
    </button>
  `).join('');
  container.classList.remove('hidden');
}

function triggerSiteSearchAction(index, containerId) {
  const fn = window.__siteSearchActions && window.__siteSearchActions[index];
  const container = document.getElementById(containerId);
  if (container) container.classList.add('hidden');
  toggleMobileMenu(false);
  if (typeof fn === 'function') fn();
}

// ============================================================================
// Expandable FAQ
// ============================================================================
function renderFaqList() {
  const list = document.getElementById('faq-list');
  if (!list) return;

  list.innerHTML = FAQ_ITEMS.map((item, idx) => `
    <div>
      <button type="button" id="faq-btn-${idx}" onclick="toggleFaq(${idx})" aria-expanded="false" aria-controls="faq-panel-${idx}" class="faq-trigger px-5 py-4 flex items-center justify-between gap-4 text-sm font-semibold cursor-pointer border-0">
        <span>${item.q}</span>
        <span id="faq-icon-${idx}" class="font-mono text-base theme-text-secondary shrink-0">+</span>
      </button>
      <div id="faq-panel-${idx}" class="hidden px-5 pb-4 pt-1 text-xs theme-text-secondary leading-relaxed surface-panel border-0">
        ${item.a}
      </div>
    </div>
  `).join('');
}

function toggleFaq(index, forceOpen = null) {
  const btn = document.getElementById(`faq-btn-${index}`);
  const panel = document.getElementById(`faq-panel-${index}`);
  const icon = document.getElementById(`faq-icon-${index}`);
  if (!btn || !panel || !icon) return;

  const isHidden = panel.classList.contains('hidden');
  const shouldOpen = forceOpen !== null ? forceOpen : isHidden;

  panel.classList.toggle('hidden', !shouldOpen);
  btn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  icon.textContent = shouldOpen ? '-' : '+';
}

// ============================================================================
// Password Visibility, Copy Button, Form Status Helpers, Confirmation Modal
// ============================================================================
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  btn.textContent = isPassword ? 'Hide' : 'Show';
  btn.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
}

async function copyText(text, btnEl = null) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }

    if (btnEl) {
      const original = btnEl.textContent;
      btnEl.textContent = 'Copied';
      setTimeout(() => {
        btnEl.textContent = original;
      }, 1500);
    }
    showToast(`Copied to clipboard: ${text}`, 'success');
  } catch (err) {
    showToast('Unable to copy text', 'error');
  }
}

function setFormStatus(elementId, message = '', type = 'error') {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.className = type === 'success'
    ? 'form-status-success rounded px-4 py-3 text-xs'
    : 'form-status-error rounded px-4 py-3 text-xs';
  el.textContent = message;
  el.classList.remove('hidden');
}

function openConfirmModal({ title, message, confirmLabel = 'Confirm', onConfirm }) {
  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-message').textContent = message;
  const okBtn = document.getElementById('confirm-modal-ok');
  okBtn.textContent = confirmLabel;
  state.confirmCallback = onConfirm;

  okBtn.onclick = async () => {
    const fn = state.confirmCallback;
    closeConfirmModal();
    if (typeof fn === 'function') await fn();
  };

  document.getElementById('modal-confirm').classList.remove('hidden');
}

function closeConfirmModal() {
  document.getElementById('modal-confirm').classList.add('hidden');
  state.confirmCallback = null;
}

// ============================================================================
// Floating Contact / Inquiry Modal
// ============================================================================
function openContactModal() {
  setFormStatus('contact-form-error', '');
  setFormStatus('contact-form-success', '');
  if (state.currentUser) {
    const n = document.getElementById('contact-name');
    const e = document.getElementById('contact-email');
    if (n && !n.value) n.value = state.currentUser.name || '';
    if (e && !e.value) e.value = state.currentUser.email || '';
  }
  document.getElementById('modal-contact').classList.remove('hidden');
}

function closeContactModal() {
  document.getElementById('modal-contact').classList.add('hidden');
}

async function handleContactSubmit(e) {
  e.preventDefault();
  setFormStatus('contact-form-error', '');
  setFormStatus('contact-form-success', '');

  const name = document.getElementById('contact-name').value.trim();
  const email = document.getElementById('contact-email').value.trim();
  const message = document.getElementById('contact-message').value.trim();
  const honeypot = document.getElementById('contact-honeypot')?.value || '';

  if (name.length < 2) {
    setFormStatus('contact-form-error', 'Please enter your full name.', 'error');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFormStatus('contact-form-error', 'Please enter a valid email address.', 'error');
    return;
  }
  if (message.length < 5) {
    setFormStatus('contact-form-error', 'Please enter a message of at least 5 characters.', 'error');
    return;
  }

  const btn = document.getElementById('btn-contact-submit');
  btn.disabled = true;
  btn.innerHTML = `<span class="loading-spinner mr-2"></span> Sending...`;

  try {
    const res = await fetch(`${API_BASE}/inquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        message,
        utm: getUtmParams(),
        honeypot_website: honeypot,
        form_loaded_at: state.formLoadedAt
      })
    });
    const json = await res.json();
    btn.disabled = false;
    btn.textContent = 'Send Message';

    if (!json.success) {
      setFormStatus('contact-form-error', json.error?.message || 'Unable to send inquiry', 'error');
      return;
    }

    setFormStatus('contact-form-success', `Inquiry #${json.data.id} received. Our front desk team will reply to ${email}.`, 'success');
    document.getElementById('contact-message').value = '';
    trackAnalytics('inquiry_submitted', { inquiry_id: json.data.id });
    showToast('Message sent to Front Desk', 'success');
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Send Message';
    setFormStatus('contact-form-error', 'Network error while sending inquiry', 'error');
  }
}

// ============================================================================
// Dates & Default Inputs
// ============================================================================
function setupDefaultDates() {
  const today = new Date();
  const checkIn = new Date(today);
  checkIn.setDate(today.getDate() + 1);

  const checkOut = new Date(checkIn);
  checkOut.setDate(checkIn.getDate() + 3);

  const format = d => d.toISOString().split('T')[0];
  const todayIso = format(today);
  const inIso = format(checkIn);
  const outIso = format(checkOut);

  const pairs = [
    ['landing-check-in', 'landing-check-out'],
    ['search-check-in', 'search-check-out']
  ];

  pairs.forEach(([inId, outId]) => {
    const inEl = document.getElementById(inId);
    const outEl = document.getElementById(outId);
    if (!inEl || !outEl) return;

    inEl.min = todayIso;
    inEl.value = inIso;
    outEl.min = inIso;
    outEl.value = outIso;

    inEl.addEventListener('change', () => {
      outEl.min = inEl.value;
      if (outEl.value <= inEl.value) {
        const nextDay = new Date(inEl.value);
        nextDay.setDate(nextDay.getDate() + 1);
        outEl.value = format(nextDay);
      }
    });
  });

  state.searchParams.checkIn = inIso;
  state.searchParams.checkOut = outIso;

  const repStart = document.getElementById('report-start-date');
  const repEnd = document.getElementById('report-end-date');
  if (repStart && repEnd) {
    repStart.value = todayIso;
    const endWindow = new Date(today);
    endWindow.setDate(today.getDate() + 7);
    repEnd.value = format(endWindow);
  }
}

// ============================================================================
// Authentication & Session
// ============================================================================
async function checkExistingSession() {
  if (!state.token) {
    updateUserUI();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const json = await res.json();
    if (json.success) {
      state.currentUser = json.data.user;
      state.currentRole = json.data.user.role;
    } else {
      logout(false);
    }
  } catch (e) {
    logout(false);
  }
  updateUserUI();
}

function updateUserUI() {
  const userName = document.getElementById('user-name');
  const roleBadge = document.getElementById('user-role-badge');
  const btnLogin = document.getElementById('btn-login');
  const btnLogout = document.getElementById('btn-logout');
  const mobLogin = document.getElementById('mob-btn-login');
  const mobLogout = document.getElementById('mob-btn-logout');
  const staffSubnav = document.getElementById('staff-admin-subnav');
  const subnavTitle = document.getElementById('admin-subnav-title');
  const subnavMeta = document.getElementById('subnav-user-meta');
  const mobAdminSection = document.getElementById('mob-admin-section');

  if (state.currentUser) {
    userName.textContent = state.currentUser.name;
    userName.title = state.currentUser.name;
    roleBadge.textContent = state.currentRole;
    btnLogin.classList.add('hidden');
    btnLogout.classList.remove('hidden');
    if (mobLogin) mobLogin.classList.add('hidden');
    if (mobLogout) mobLogout.classList.remove('hidden');
    if (subnavMeta) subnavMeta.textContent = `${state.currentRole}: ${state.currentUser.name}`;

    if (state.currentRole === 'GUEST') {
      roleBadge.className = 'inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-semibold badge-occupied shrink-0';
    } else if (state.currentRole === 'STAFF') {
      roleBadge.className = 'inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-semibold badge-cleaning shrink-0';
    } else if (state.currentRole === 'ADMIN') {
      roleBadge.className = 'inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-semibold badge-available shrink-0';
    }
  } else {
    userName.textContent = 'Visitor';
    userName.title = 'Public Visitor';
    roleBadge.textContent = 'PUBLIC';
    roleBadge.className = 'inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-semibold badge-out-of-order shrink-0';
    btnLogin.classList.remove('hidden');
    btnLogout.classList.add('hidden');
    if (mobLogin) mobLogin.classList.remove('hidden');
    if (mobLogout) mobLogout.classList.add('hidden');
    if (subnavMeta) subnavMeta.textContent = 'Dona Paula, Goa Property';
  }

  const isStaffOrAdmin = state.currentRole === 'STAFF' || state.currentRole === 'ADMIN';
  const isAdmin = state.currentRole === 'ADMIN';

  if (staffSubnav) staffSubnav.classList.toggle('hidden', !isStaffOrAdmin);
  if (mobAdminSection) mobAdminSection.classList.toggle('hidden', !isStaffOrAdmin);
  if (subnavTitle) subnavTitle.textContent = isAdmin ? 'Admin Console' : 'Staff Workspace';

  ['nav-front-desk', 'mob-front-desk'].forEach(id => document.getElementById(id)?.classList.toggle('hidden', !isStaffOrAdmin));
  ['nav-housekeeping', 'mob-housekeeping'].forEach(id => document.getElementById(id)?.classList.toggle('hidden', !isStaffOrAdmin));
  ['nav-reports', 'mob-reports'].forEach(id => document.getElementById(id)?.classList.toggle('hidden', !isStaffOrAdmin));
  ['nav-room-admin', 'mob-room-admin'].forEach(id => document.getElementById(id)?.classList.toggle('hidden', !isAdmin));
  ['nav-audit-logs', 'mob-audit-logs'].forEach(id => document.getElementById(id)?.classList.toggle('hidden', !isAdmin));
}

function logout(notify = true) {
  state.token = null;
  state.currentUser = null;
  state.currentRole = 'ANONYMOUS';
  localStorage.removeItem('gh_token');
  updateUserUI();
  navigate('landing');
  if (notify) showToast('Signed out', 'info');
}

// ============================================================================
// Navigation Router
// ============================================================================
function updatePageMeta(viewName) {
  const meta = PAGE_META[viewName] || PAGE_META.landing;
  document.title = meta.title;
  const descEl = document.querySelector('meta[name="description"]');
  if (descEl) descEl.setAttribute('content', meta.description);
}

function navigate(viewName, pushHistory = true) {
  const views = ['landing', 'login', 'search', 'my-bookings', 'front-desk', 'housekeeping', 'reports', 'room-admin', 'audit-logs', 'privacy', 'terms', '404'];

  const staffViews = ['front-desk', 'housekeeping', 'reports'];
  const adminViews = ['room-admin', 'audit-logs'];
  if (staffViews.includes(viewName) && !['STAFF', 'ADMIN'].includes(state.currentRole)) {
    viewName = 'login';
  }
  if (adminViews.includes(viewName) && state.currentRole !== 'ADMIN') {
    viewName = 'login';
  }
  if (!views.includes(viewName)) {
    viewName = '404';
  }

  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.add('hidden');

    const tab = document.getElementById(`nav-${v}`);
    if (tab) {
      tab.classList.remove('nav-link-active');
      tab.classList.add('font-medium');
    }
  });

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) {
    targetView.classList.remove('hidden');
    state.currentView = viewName;
  }

  const activeTab = document.getElementById(`nav-${viewName}`);
  if (activeTab) {
    activeTab.classList.add('nav-link-active');
    activeTab.classList.remove('font-medium');
  }

  if (pushHistory && ROUTE_MAP[viewName] && viewName !== '404') {
    if (window.location.pathname !== ROUTE_MAP[viewName]) {
      window.history.pushState({ view: viewName }, '', ROUTE_MAP[viewName]);
    }
  }

  updatePageMeta(viewName);
  trackAnalytics('page_view', { view: viewName });

  if (viewName === 'landing') loadLandingSuites();
  else if (viewName === 'search') handleAvailabilitySearch();
  else if (viewName === 'front-desk') loadStaffBookings();
  else if (viewName === 'housekeeping') loadHousekeepingGrid();
  else if (viewName === 'reports') loadOperationsReport();
  else if (viewName === 'room-admin') loadAdminRoomTypes();
  else if (viewName === 'audit-logs') loadAuditLogs();
  else if (viewName === 'my-bookings') loadGuestBookings();

  window.scrollTo({ top: 0 });
}

// ============================================================================
// Landing Page Logic
// ============================================================================
async function loadLandingSuites() {
  const container = document.getElementById('landing-suites-grid');
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE}/room-types`);
    const json = await res.json();
    if (!json.success || !json.data) return;

    state.cachedRoomTypes = json.data;
    const suites = json.data.slice(0, 3);
    container.innerHTML = suites.map(rt => {
      const imgUrl = (rt.images && rt.images.length > 0)
        ? rt.images[0]
        : '/assets/images/executive.webp';

      return `
        <article class="surface-card surface-card-hover rounded-lg overflow-hidden flex flex-col">
          <div class="aspect-[16/10] surface-panel border-0 border-b theme-border">
            <img src="${imgUrl}" width="800" height="500" loading="lazy" alt="${escapeHtml(rt.name)} suite interior featuring ${escapeHtml(rt.bed_type)} (${rt.size_sqft} sq ft)" class="w-full h-full object-cover">
          </div>
          <div class="p-6 flex-1 flex flex-col justify-between space-y-4">
            <div>
              <div class="text-[11px] font-mono theme-text-secondary mb-1.5">${rt.bed_type} | ${rt.size_sqft} sq ft</div>
              <h3 class="text-base font-bold theme-text-primary">${rt.name}</h3>
              <p class="text-xs theme-text-secondary mt-1.5 leading-relaxed">${rt.description}</p>
            </div>
            <div class="pt-4 border-t theme-border flex items-center justify-between">
              <div>
                <span class="text-[10px] font-semibold uppercase theme-text-secondary block">From</span>
                <span class="text-base font-bold font-mono tabular-nums theme-text-primary">${rt.base_price_formatted}</span>
                <span class="text-[11px] theme-text-secondary">/ night</span>
              </div>
              <button type="button" onclick="navigate('search')" class="btn-secondary px-4 py-2 rounded text-xs">
                Check Dates
              </button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="col-span-full text-xs form-status-error rounded p-4 text-center">Failed to load room categories.</div>`;
  }
}

function handleLandingSearchSubmit(e) {
  e.preventDefault();
  setFormStatus('landing-search-error', '');
  const inDate = document.getElementById('landing-check-in').value;
  const outDate = document.getElementById('landing-check-out').value;
  if (outDate <= inDate) {
    setFormStatus('landing-search-error', 'Check-out date must be after check-in date.', 'error');
    return;
  }

  document.getElementById('search-check-in').value = inDate;
  document.getElementById('search-check-out').value = outDate;
  document.getElementById('search-adults').value = document.getElementById('landing-adults').value;
  document.getElementById('search-children').value = document.getElementById('landing-children').value;
  navigate('search');
}

// ============================================================================
// Dedicated Login & Registration Page
// ============================================================================
function switchAuthTab(mode) {
  const loginTab = document.getElementById('tab-auth-login');
  const regTab = document.getElementById('tab-auth-register');
  const loginForm = document.getElementById('login-form');
  const regForm = document.getElementById('register-form');

  setFormStatus('login-form-error', '');
  setFormStatus('login-form-success', '');
  setFormStatus('register-form-error', '');
  setFormStatus('register-form-success', '');

  if (mode === 'register') {
    regTab.className = 'pb-3 px-4 text-sm font-bold border-b-2 auth-tab-active theme-text-primary cursor-pointer';
    loginTab.className = 'pb-3 px-4 text-sm font-medium border-b-2 border-transparent theme-text-secondary cursor-pointer';
    loginForm.classList.add('hidden');
    regForm.classList.remove('hidden');
  } else {
    loginTab.className = 'pb-3 px-4 text-sm font-bold border-b-2 auth-tab-active theme-text-primary cursor-pointer';
    regTab.className = 'pb-3 px-4 text-sm font-medium border-b-2 border-transparent theme-text-secondary cursor-pointer';
    regForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
  }
}

async function handleLogin(e) {
  e.preventDefault();
  setFormStatus('login-form-error', '');
  setFormStatus('login-form-success', '');

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFormStatus('login-form-error', 'Please enter a valid email address.', 'error');
    return;
  }
  if (!password) {
    setFormStatus('login-form-error', 'Please enter your password.', 'error');
    return;
  }

  const btn = document.getElementById('btn-login-submit');
  btn.disabled = true;
  btn.innerHTML = `<span class="loading-spinner mr-2"></span> Signing In...`;

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const json = await res.json();
    btn.disabled = false;
    btn.textContent = 'Sign In';

    if (json.success) {
      state.token = json.data.token;
      state.currentUser = json.data.user;
      state.currentRole = json.data.user.role;
      localStorage.setItem('gh_token', state.token);
      updateUserUI();
      setFormStatus('login-form-success', `Signed in as ${state.currentUser.name}. Redirecting...`, 'success');
      showToast(`Signed in as ${state.currentUser.name}`, 'success');

      setTimeout(() => {
        if (state.currentRole === 'STAFF') navigate('front-desk');
        else if (state.currentRole === 'ADMIN') navigate('reports');
        else navigate('search');
      }, 450);
    } else {
      setFormStatus('login-form-error', json.error?.message || 'Sign in failed', 'error');
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Sign In';
    setFormStatus('login-form-error', 'Network error during sign in', 'error');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  setFormStatus('register-form-error', '');
  setFormStatus('register-form-success', '');

  const fullName = document.getElementById('reg-fullname').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const password = document.getElementById('reg-password').value;
  const honeypot = document.getElementById('reg-honeypot')?.value || '';

  if (fullName.length < 2) {
    setFormStatus('register-form-error', 'Please enter your full name.', 'error');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFormStatus('register-form-error', 'Please enter a valid email address.', 'error');
    return;
  }
  if (phone.replace(/\D/g, '').length < 7) {
    setFormStatus('register-form-error', 'Please enter a valid phone number (at least 7 digits).', 'error');
    return;
  }
  if (password.length < 6) {
    setFormStatus('register-form-error', 'Password must be at least 6 characters.', 'error');
    return;
  }

  const btn = document.getElementById('btn-register-submit');
  btn.disabled = true;
  btn.innerHTML = `<span class="loading-spinner mr-2"></span> Creating Account...`;

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName,
        email,
        phone,
        password,
        honeypot_website: honeypot,
        form_loaded_at: state.formLoadedAt
      })
    });
    const json = await res.json();
    btn.disabled = false;
    btn.textContent = 'Create Account';

    if (json.success) {
      state.token = json.data.token;
      state.currentUser = json.data.user;
      state.currentRole = json.data.user.role;
      localStorage.setItem('gh_token', state.token);
      updateUserUI();
      setFormStatus('register-form-success', `Account saved in MongoDB for ${state.currentUser.email}. Redirecting...`, 'success');
      showToast(`Account created. Welcome, ${state.currentUser.name}!`, 'success');
      setTimeout(() => navigate('search'), 550);
    } else {
      setFormStatus('register-form-error', json.error?.message || 'Registration failed', 'error');
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Create Account';
    setFormStatus('register-form-error', 'Network error during account registration', 'error');
  }
}

// ============================================================================
// Availability Search & Room Selection
// ============================================================================
async function handleAvailabilitySearch(e) {
  if (e) e.preventDefault();
  setFormStatus('search-form-error', '');

  const checkIn = document.getElementById('search-check-in').value;
  const checkOut = document.getElementById('search-check-out').value;
  const adults = document.getElementById('search-adults').value;
  const children = document.getElementById('search-children').value;

  state.searchParams = { checkIn, checkOut, adults, children };

  const roomsGrid = document.getElementById('rooms-grid');
  roomsGrid.innerHTML = [1, 2, 3].map(() => `
    <div class="surface-card rounded-lg p-6 space-y-4">
      <div class="h-44 skeleton-block"></div>
      <div class="h-4 w-2/3 skeleton-block"></div>
      <div class="h-3 w-full skeleton-block"></div>
      <div class="h-8 w-1/2 skeleton-block"></div>
    </div>
  `).join('');

  try {
    const url = `${API_BASE}/bookings/search?check_in=${checkIn}&check_out=${checkOut}&adults=${adults}&children=${children}`;
    const res = await fetch(url);
    const json = await res.json();

    if (!json.success) {
      setFormStatus('search-form-error', json.error?.message || 'Invalid search dates', 'error');
      roomsGrid.innerHTML = `
        <div class="col-span-full form-status-error rounded-lg p-6 text-center text-xs">
          ${json.error?.message || 'Failed to search availability'}
        </div>
      `;
      return;
    }

    renderRoomCards(json.data.available_room_types);
    trackAnalytics('search_availability', { check_in: checkIn, check_out: checkOut, adults, children });
  } catch (err) {
    setFormStatus('search-form-error', 'Failed to connect to server. Please try again.', 'error');
  }
}

function renderRoomCards(roomTypes) {
  const roomsGrid = document.getElementById('rooms-grid');
  const countEl = document.getElementById('search-results-count');

  if (!roomTypes || roomTypes.length === 0) {
    countEl.textContent = '0 room types available';
    roomsGrid.innerHTML = `
      <div class="col-span-full surface-card rounded-lg p-10 text-center theme-text-secondary">
        <h3 class="text-base font-bold theme-text-primary mb-1">No Available Rooms</h3>
        <p class="text-xs max-w-md mx-auto">No rooms match your selected dates and guest count. Try adjusting your check-in/check-out dates or party size.</p>
      </div>
    `;
    return;
  }

  countEl.textContent = `${roomTypes.length} room types found`;

  roomsGrid.innerHTML = roomTypes.map(rt => {
    const isAvail = rt.available_rooms_count > 0;
    const imgUrl = (rt.images && rt.images.length > 0)
      ? rt.images[0]
      : '/assets/images/executive.webp';

    const amenitiesList = (rt.amenities || []).slice(0, 4).map(a => `
      <span class="inline-block px-2 py-0.5 rounded text-[11px] surface-panel theme-text-primary">
        ${a}
      </span>
    `).join('');

    return `
      <article class="surface-card surface-card-hover rounded-lg overflow-hidden flex flex-col">
        <div class="relative aspect-[16/10] surface-panel border-0 border-b theme-border">
          <img src="${imgUrl}" width="800" height="500" loading="lazy" alt="${escapeHtml(rt.name)} interior featuring ${escapeHtml(rt.bed_type)}, ${rt.size_sqft} sq ft" class="w-full h-full object-cover">
          <div class="absolute top-3 right-3">
            ${isAvail
              ? `<span class="badge-available px-2.5 py-1 rounded text-[11px] font-mono font-semibold">
                   ${rt.available_rooms_count} available
                 </span>`
              : `<span class="badge-maintenance px-2.5 py-1 rounded text-[11px] font-mono font-semibold">
                   Sold Out
                 </span>`
            }
          </div>
        </div>

        <div class="p-6 flex-1 flex flex-col justify-between space-y-5">
          <div>
            <div class="text-[11px] font-mono theme-text-secondary mb-1.5">
              ${rt.bed_type} | ${rt.size_sqft} sq ft | Max ${rt.max_occupancy} guests
            </div>
            <h3 class="text-base font-bold theme-text-primary">${rt.name}</h3>
            <p class="text-xs theme-text-secondary mt-1.5 leading-relaxed">${rt.description}</p>

            <div class="flex flex-wrap gap-1.5 mt-3.5">
              ${amenitiesList}
            </div>
          </div>

          <div class="pt-4 border-t theme-border flex items-end justify-between gap-3">
            <div>
              <span class="text-[10px] font-semibold theme-text-secondary uppercase block">Base Rate</span>
              <span class="text-lg font-bold font-mono tabular-nums theme-text-primary">${rt.base_price_formatted}</span>
              <span class="text-[11px] theme-text-secondary">/ night</span>
            </div>

            <button onclick="openBookingModal(${rt.room_type_id})"
                    ${!isAvail ? 'disabled' : ''}
                    class="btn-primary px-4 py-2 rounded text-xs">
              ${isAvail ? 'Select Room' : 'Unavailable'}
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

// ============================================================================
// Booking Flow & 10-Minute Hold
// ============================================================================
async function loadAvailableAddOns() {
  try {
    const res = await fetch(`${API_BASE}/rooms/add-ons`);
    const json = await res.json();
    if (json.success) {
      state.availableAddOns = json.data;
    }
  } catch (e) {}
}

async function openBookingModal(roomTypeId) {
  state.selectedRoomType = roomTypeId;
  setFormStatus('hold-form-error', '');
  setFormStatus('payment-form-error', '');
  setFormStatus('payment-form-success', '');

  const res = await fetch(`${API_BASE}/room-types/${roomTypeId}`);
  const json = await res.json();
  const roomType = json.data;

  document.getElementById('modal-booking-room-name').textContent = roomType.name;
  document.getElementById('modal-booking-dates-summary').textContent =
    `${state.searchParams.checkIn} to ${state.searchParams.checkOut} | ${state.searchParams.adults} Adults, ${state.searchParams.children} Children`;

  if (state.currentUser) {
    document.getElementById('booking-guest-name').value = state.currentUser.name || '';
    document.getElementById('booking-guest-email').value = state.currentUser.email || '';
    document.getElementById('booking-guest-phone').value = state.currentUser.phone || '';
  }

  const addOnsContainer = document.getElementById('booking-add-ons-container');
  addOnsContainer.innerHTML = state.availableAddOns.map(ao => `
    <label class="flex items-start gap-3 p-3 rounded surface-card theme-row-hover cursor-pointer">
      <input type="checkbox" name="booking-addon" value="${ao.id}" onchange="updatePricePreview()" class="mt-0.5">
      <div class="flex-1 text-xs">
        <div class="flex justify-between font-semibold theme-text-primary">
          <span>${ao.name}</span>
          <span class="font-mono tabular-nums">$${(ao.price_cents / 100).toFixed(2)}${ao.per_night ? ' / night' : ' flat'}</span>
        </div>
        <p class="text-[11px] theme-text-secondary mt-0.5">${ao.description}</p>
      </div>
    </label>
  `).join('');

  await updatePricePreview();

  document.getElementById('booking-step-details').classList.remove('hidden');
  document.getElementById('booking-step-payment').classList.add('hidden');
  document.getElementById('booking-step-voucher').classList.add('hidden');
  document.getElementById('modal-booking').classList.remove('hidden');
}

function closeBookingModal() {
  document.getElementById('modal-booking').classList.add('hidden');
}

async function updatePricePreview() {
  const selectedAddOnIds = Array.from(document.querySelectorAll('input[name="booking-addon"]:checked')).map(cb => cb.value);

  try {
    const res = await fetch(`${API_BASE}/bookings/price-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_type_id: state.selectedRoomType,
        check_in: state.searchParams.checkIn,
        check_out: state.searchParams.checkOut,
        selected_add_ons: selectedAddOnIds
      })
    });
    const json = await res.json();
    if (json.success) {
      const q = json.data;
      const previewEl = document.getElementById('booking-price-preview');
      previewEl.innerHTML = `
        <div class="flex justify-between theme-text-secondary">
          <span>Room Charge (${q.nights} nights)</span>
          <span class="theme-text-primary font-mono tabular-nums">${q.base_price_formatted}</span>
        </div>
        ${q.add_ons_price_cents > 0 ? `
          <div class="flex justify-between theme-text-secondary">
            <span>Selected Add-ons</span>
            <span class="theme-text-primary font-mono tabular-nums">${q.add_ons_price_formatted}</span>
          </div>
        ` : ''}
        <div class="flex justify-between theme-text-secondary">
          <span>GST Hospitality Tax (12%)</span>
          <span class="theme-text-primary font-mono tabular-nums">${q.taxes_formatted}</span>
        </div>
        <div class="flex justify-between theme-text-secondary">
          <span>Service Fee ($25.00 / night)</span>
          <span class="theme-text-primary font-mono tabular-nums">${q.fees_formatted}</span>
        </div>
        <div class="flex justify-between pt-2.5 border-t theme-border text-sm font-bold theme-text-primary">
          <span>Estimated Total</span>
          <span class="font-mono tabular-nums text-base">${q.total_price_formatted}</span>
        </div>
      `;
    }
  } catch (e) {}
}

async function handlePlaceHold(e) {
  e.preventDefault();
  setFormStatus('hold-form-error', '');

  const guestName = document.getElementById('booking-guest-name').value.trim();
  const guestEmail = document.getElementById('booking-guest-email').value.trim();
  const guestPhone = document.getElementById('booking-guest-phone').value.trim();
  const specialRequests = document.getElementById('booking-special-requests').value.trim();
  const honeypot = document.getElementById('hold-honeypot')?.value || '';
  const selectedAddOnIds = Array.from(document.querySelectorAll('input[name="booking-addon"]:checked')).map(cb => cb.value);

  if (guestName.length < 2) {
    setFormStatus('hold-form-error', 'Please enter the primary guest full name.', 'error');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) {
    setFormStatus('hold-form-error', 'Please enter a valid email address.', 'error');
    return;
  }
  if (guestPhone.replace(/\D/g, '').length < 7) {
    setFormStatus('hold-form-error', 'Please enter a valid contact phone number (at least 7 digits).', 'error');
    return;
  }

  const btn = document.getElementById('btn-place-hold');
  btn.disabled = true;
  btn.innerHTML = `<span class="loading-spinner mr-2"></span> Securing Hold...`;

  try {
    const res = await fetch(`${API_BASE}/bookings/hold`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { 'Authorization': `Bearer ${state.token}` } : {})
      },
      body: JSON.stringify({
        room_type_id: state.selectedRoomType,
        check_in: state.searchParams.checkIn,
        check_out: state.searchParams.checkOut,
        num_adults: state.searchParams.adults,
        num_children: state.searchParams.children,
        guest_name: guestName,
        guest_email: guestEmail,
        guest_phone: guestPhone,
        selected_add_ons: selectedAddOnIds,
        special_requests: specialRequests,
        utm: getUtmParams(),
        honeypot_website: honeypot,
        form_loaded_at: state.formLoadedAt
      })
    });

    const json = await res.json();
    btn.disabled = false;
    btn.textContent = 'Place 10-Min Hold and Continue';

    if (!json.success) {
      setFormStatus('hold-form-error', json.error?.message || 'Failed to place room hold', 'error');
      return;
    }

    state.activeHold = json.data;
    trackAnalytics('hold_created', { room_type_id: state.selectedRoomType, ref: json.data.booking_reference });
    startHoldCountdown(json.data.hold_expires_at, json.data.booking_reference);

    document.getElementById('payment-booking-ref').textContent = json.data.booking_reference;
    document.getElementById('payment-room-desc').textContent = `Room ${json.data.room_number} (Floor ${json.data.floor})`;
    document.getElementById('payment-total-amount').textContent = json.data.pricing.total_price_formatted;
    document.getElementById('pay-btn-amount').textContent = json.data.pricing.total_price_formatted;
    document.getElementById('card-name').value = guestName;

    document.getElementById('booking-step-details').classList.add('hidden');
    document.getElementById('booking-step-payment').classList.remove('hidden');
    showToast('Room hold created for 10 minutes', 'success');
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Place 10-Min Hold and Continue';
    setFormStatus('hold-form-error', 'Network error while securing room hold', 'error');
  }
}

function startHoldCountdown(expiresAtIso, bookingRef) {
  if (state.holdTimerInterval) clearInterval(state.holdTimerInterval);
  state.holdExpiresAt = new Date(expiresAtIso).getTime();

  const banner = document.getElementById('active-hold-banner');
  document.getElementById('hold-banner-ref').textContent = bookingRef;
  banner.classList.remove('hidden');

  const updateTimerDisplay = () => {
    const now = Date.now();
    const diff = Math.max(0, state.holdExpiresAt - now);
    const totalSeconds = Math.floor(diff / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    const t1 = document.getElementById('payment-timer');
    const t2 = document.getElementById('hold-banner-timer');
    if (t1) t1.textContent = formatted;
    if (t2) t2.textContent = formatted;

    if (totalSeconds <= 0) {
      clearInterval(state.holdTimerInterval);
      banner.classList.add('hidden');
      state.activeHold = null;
      showToast('Hold expired. Room returned to inventory.', 'warning');
      closeBookingModal();
      handleAvailabilitySearch();
    }
  };

  updateTimerDisplay();
  state.holdTimerInterval = setInterval(updateTimerDisplay, 1000);
}

function resumeCheckout() {
  if (state.activeHold) {
    document.getElementById('modal-booking').classList.remove('hidden');
    document.getElementById('booking-step-details').classList.add('hidden');
    document.getElementById('booking-step-payment').classList.remove('hidden');
    document.getElementById('booking-step-voucher').classList.add('hidden');
  }
}

function fillTestCard(type) {
  const cardInput = document.getElementById('card-number');
  setFormStatus('payment-form-error', '');
  if (type === 'SUCCESS') {
    cardInput.value = '4242 4242 4242 4242';
    showToast('Test card 4242... selected (Approves)', 'info');
  } else {
    cardInput.value = '4000 0000 0000 0002';
    showToast('Test card 4000... selected (Declines)', 'info');
  }
}

async function handleConfirmPayment(e) {
  e.preventDefault();
  setFormStatus('payment-form-error', '');
  setFormStatus('payment-form-success', '');

  if (!state.activeHold) {
    setFormStatus('payment-form-error', 'No active room hold found', 'error');
    return;
  }

  const cardNumber = document.getElementById('card-number').value.trim();
  const cardExp = document.getElementById('card-exp').value.trim();
  const cardCvv = document.getElementById('card-cvv').value.trim();
  const cardName = document.getElementById('card-name').value.trim();

  if (cardName.length < 2) {
    setFormStatus('payment-form-error', 'Cardholder name is required.', 'error');
    return;
  }
  if (cardNumber.replace(/\D/g, '').length < 12) {
    setFormStatus('payment-form-error', 'Enter a valid 12-16 digit card number.', 'error');
    return;
  }
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(cardExp)) {
    setFormStatus('payment-form-error', 'Expiration must be in MM/YY format.', 'error');
    return;
  }
  if (!/^\d{3,4}$/.test(cardCvv)) {
    setFormStatus('payment-form-error', 'CVV must be 3 or 4 digits.', 'error');
    return;
  }

  const btn = document.getElementById('btn-confirm-pay');
  btn.disabled = true;
  btn.innerHTML = `<span class="loading-spinner mr-2"></span> Processing Payment...`;

  const idempotencyKey = `gh-pay-${state.activeHold.booking_reference}-${Date.now()}`;

  try {
    const res = await fetch(`${API_BASE}/bookings/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        ...(state.token ? { 'Authorization': `Bearer ${state.token}` } : {})
      },
      body: JSON.stringify({
        booking_reference: state.activeHold.booking_reference,
        payment_method: 'MOCK_CARD',
        card_number: cardNumber,
        card_exp: cardExp,
        card_cvv: cardCvv,
        billing_name: cardName
      })
    });

    const json = await res.json();
    btn.disabled = false;
    btn.innerHTML = `Confirm and Pay <span id="pay-btn-amount" class="ml-1 font-mono">${state.activeHold.pricing.total_price_formatted}</span>`;

    if (!json.success) {
      setFormStatus('payment-form-error', json.error?.message || 'Payment declined', 'error');
      return;
    }

    const confirmedRef = json.data.booking.booking_reference;
    if (state.holdTimerInterval) clearInterval(state.holdTimerInterval);
    document.getElementById('active-hold-banner').classList.add('hidden');
    state.activeHold = null;

    trackAnalytics('booking_confirmed', { booking_reference: confirmedRef });
    setFormStatus('payment-form-success', 'Payment authorized. Generating confirmation voucher...', 'success');
    showVoucher(json.data.booking, json.data.payment);
    showToast('Booking confirmed and stored in MongoDB', 'success');
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Confirm and Pay';
    setFormStatus('payment-form-error', 'Network error during payment confirmation', 'error');
  }
}

function confirmCancelHold() {
  if (!state.activeHold) return;
  openConfirmModal({
    title: 'Release Room Hold?',
    message: `Releasing hold ${state.activeHold.booking_reference} will cancel this checkout and immediately return the room to public availability.`,
    confirmLabel: 'Release Hold',
    onConfirm: handleCancelHold
  });
}

async function handleCancelHold() {
  if (state.activeHold) {
    try {
      await fetch(`${API_BASE}/bookings/${state.activeHold.booking_reference}/cancel`, {
        method: 'POST'
      });
    } catch (e) {}

    if (state.holdTimerInterval) clearInterval(state.holdTimerInterval);
    document.getElementById('active-hold-banner').classList.add('hidden');
    state.activeHold = null;
    closeBookingModal();
    showToast('Hold cancelled and room released', 'info');
    handleAvailabilitySearch();
  }
}

function showVoucher(booking, payment) {
  document.getElementById('voucher-ref').textContent = booking.booking_reference;

  const content = document.getElementById('voucher-content');
  content.innerHTML = `
    <div class="grid grid-cols-2 gap-4 border-b theme-border pb-3">
      <div>
        <span class="theme-text-secondary text-[10px] uppercase font-semibold block">Guest</span>
        <span class="font-bold theme-text-primary">${booking.guest_name}</span>
        <span class="text-[11px] theme-text-secondary block">${booking.guest_email}</span>
      </div>
      <div>
        <span class="theme-text-secondary text-[10px] uppercase font-semibold block">Room Assignment</span>
        <span class="font-bold theme-text-primary">${booking.room_type_name}</span>
        <span class="text-[11px] theme-text-secondary font-mono block">Room ${booking.room_number} (Floor ${booking.floor})</span>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4 border-b theme-border pb-3">
      <div>
        <span class="theme-text-secondary text-[10px] uppercase font-semibold block">Check-In</span>
        <span class="font-bold font-mono theme-text-primary">${booking.check_in} (15:00)</span>
      </div>
      <div>
        <span class="theme-text-secondary text-[10px] uppercase font-semibold block">Check-Out</span>
        <span class="font-bold font-mono theme-text-primary">${booking.check_out} (11:00)</span>
      </div>
    </div>

    <div class="space-y-1.5 theme-text-secondary pt-1">
      <div class="flex justify-between">
        <span>Room Charge:</span>
        <span class="font-mono tabular-nums theme-text-primary">${booking.base_price_formatted}</span>
      </div>
      ${booking.add_ons_price_cents > 0 ? `
        <div class="flex justify-between">
          <span>Add-ons:</span>
          <span class="font-mono tabular-nums theme-text-primary">${booking.add_ons_price_formatted}</span>
        </div>
      ` : ''}
      <div class="flex justify-between">
        <span>GST Hospitality Tax (12%):</span>
        <span class="font-mono tabular-nums theme-text-primary">${booking.taxes_formatted}</span>
      </div>
      <div class="flex justify-between">
        <span>Service Fee:</span>
        <span class="font-mono tabular-nums theme-text-primary">${booking.fees_formatted}</span>
      </div>
      <div class="flex justify-between pt-2 border-t theme-border text-sm font-bold theme-text-primary">
        <span>Total Paid:</span>
        <span class="font-mono tabular-nums">${booking.total_price_formatted}</span>
      </div>
    </div>

    ${payment ? `
      <div class="mt-2 pt-2 border-t theme-border text-[11px] theme-text-secondary font-mono">
        Transaction: ${payment.transaction_reference} | Card ending in ${payment.card_last_four}
      </div>
    ` : ''}
  `;

  document.getElementById('booking-step-details').classList.add('hidden');
  document.getElementById('booking-step-payment').classList.add('hidden');
  document.getElementById('booking-step-voucher').classList.remove('hidden');
}

// ============================================================================
// Guest Experience: My Bookings & Lookup
// ============================================================================
async function loadGuestBookings() {
  const container = document.getElementById('guest-bookings-list');
  container.innerHTML = `<div class="text-center py-8 text-xs theme-text-secondary"><span class="loading-spinner mr-2"></span> Loading reservations...</div>`;

  const emailParam = state.currentUser ? `email=${encodeURIComponent(state.currentUser.email)}` : '';
  try {
    const res = await fetch(`${API_BASE}/bookings/my-history?${emailParam}`, {
      headers: { ...(state.token ? { 'Authorization': `Bearer ${state.token}` } : {}) }
    });
    const json = await res.json();
    if (!json.success || !json.data || json.data.length === 0) {
      container.innerHTML = `
        <div class="text-center py-10 theme-text-secondary surface-panel rounded p-6">
          <h4 class="text-sm font-bold theme-text-primary">No Reservations Found</h4>
          <p class="text-xs mt-1">Sign in or enter a booking reference code above to view reservation details.</p>
        </div>
      `;
      return;
    }

    renderGuestBookings(json.data);
  } catch (err) {
    container.innerHTML = `<div class="form-status-error rounded p-4 text-center text-xs">Failed to load reservations.</div>`;
  }
}

async function handleBookingLookup() {
  const ref = document.getElementById('lookup-ref-input').value.trim();
  if (!ref) {
    showToast('Enter a booking reference code', 'warning');
    return;
  }

  const container = document.getElementById('guest-bookings-list');
  container.innerHTML = `<div class="text-center py-8 text-xs theme-text-secondary"><span class="loading-spinner mr-2"></span> Searching for ${escapeHtml(ref)}...</div>`;

  try {
    const res = await fetch(`${API_BASE}/bookings/${ref}`);
    const json = await res.json();
    if (!json.success) {
      container.innerHTML = `
        <div class="text-center py-8 text-xs form-status-error rounded">
          Booking reference '${escapeHtml(ref)}' not found.
        </div>
      `;
      return;
    }

    renderGuestBookings([json.data]);
  } catch (err) {
    showToast('Lookup failed', 'error');
  }
}

function renderGuestBookings(bookings) {
  const container = document.getElementById('guest-bookings-list');
  container.innerHTML = bookings.map(b => {
    const canCancel = (b.status === 'CONFIRMED' || b.status === 'HOLD');
    const badgeClass = getStatusBadgeClass(b.status);

    return `
      <div class="surface-card surface-card-hover rounded-lg p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div class="space-y-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-sm font-bold theme-text-primary">${b.booking_reference}</span>
            <button type="button" onclick="copyText('${b.booking_reference}', this)" class="btn-secondary px-2 py-0.5 rounded text-[10px]">Copy</button>
            <span class="${badgeClass} px-2 py-0.5 rounded text-[10px] font-mono font-semibold">${b.status}</span>
          </div>
          <h4 class="text-base font-bold theme-text-primary">${b.room_type_name} (Room ${b.room_number})</h4>
          <p class="text-xs theme-text-secondary font-mono">
            ${b.check_in} to ${b.check_out} | Guest: ${b.guest_name}
          </p>
        </div>

        <div class="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 theme-border pt-3 md:pt-0">
          <div class="text-left md:text-right">
            <span class="text-[10px] theme-text-secondary uppercase font-semibold block">Total</span>
            <span class="text-base font-bold font-mono tabular-nums theme-text-primary">${b.total_price_formatted}</span>
          </div>

          <div class="flex items-center gap-2">
            <button onclick='viewVoucherFromBooking(${JSON.stringify(b)})' class="btn-secondary px-3 py-1.5 rounded text-xs">
              View Voucher
            </button>
            ${canCancel ? `
              <button onclick="confirmCancelReservation('${b.booking_reference}')" class="btn-danger px-3 py-1.5 rounded text-xs">
                Cancel
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function viewVoucherFromBooking(booking) {
  showVoucher(booking, booking.payment || null);
  document.getElementById('modal-booking').classList.remove('hidden');
}

function confirmCancelReservation(reference) {
  openConfirmModal({
    title: `Cancel Reservation ${reference}?`,
    message: `Cancelling ${reference} will immediately release the room back to available inventory and process a full refund of the authorized sandbox payment.`,
    confirmLabel: 'Confirm Cancellation',
    onConfirm: () => handleCancelReservation(reference)
  });
}

async function handleCancelReservation(reference) {
  try {
    const res = await fetch(`${API_BASE}/bookings/${reference}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { 'Authorization': `Bearer ${state.token}` } : {})
      },
      body: JSON.stringify({ reason: 'Cancelled via portal' })
    });

    const json = await res.json();
    if (json.success) {
      showToast(`Reservation ${reference} cancelled and refunded`, 'success');
      if (state.currentView === 'front-desk') loadStaffBookings();
      else loadGuestBookings();
    } else {
      showToast(json.error?.message || 'Cancellation failed', 'error');
    }
  } catch (err) {
    showToast('Network error during cancellation', 'error');
  }
}

// ============================================================================
// Staff Operations: Front Desk
// ============================================================================
async function loadStaffBookings() {
  const tbody = document.getElementById('staff-bookings-table-body');
  tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center theme-text-secondary"><span class="loading-spinner mr-2"></span> Loading reservations...</td></tr>`;

  const filter = document.getElementById('staff-status-filter').value;
  const search = document.getElementById('staff-search-input').value.trim();

  let url = `${API_BASE}/bookings?status=${filter}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const json = await res.json();
    if (!json.success || json.data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center theme-text-secondary">No matching reservations found.</td></tr>`;
      return;
    }

    tbody.innerHTML = json.data.map(b => {
      const badgeClass = getStatusBadgeClass(b.status);
      return `
        <tr class="theme-row-hover">
          <td class="py-3.5 px-4 font-mono font-semibold theme-text-primary">${b.booking_reference}</td>
          <td class="py-3.5 px-4">
            <div class="font-semibold theme-text-primary">${b.guest_name}</div>
            <div class="text-[11px] theme-text-secondary">${b.guest_email} | ${b.guest_phone}</div>
          </td>
          <td class="py-3.5 px-4">
            <span class="font-mono font-semibold theme-text-primary">Room ${b.room_number}</span>
            <span class="text-[11px] theme-text-secondary block">${b.room_type_name}</span>
          </td>
          <td class="py-3.5 px-4 font-mono">
            <div>${b.check_in} to ${b.check_out}</div>
            <span class="text-[11px] font-sans theme-text-secondary">${b.num_adults} Adults, ${b.num_children} Children</span>
          </td>
          <td class="py-3.5 px-4 font-mono font-semibold tabular-nums theme-text-primary">${b.total_price_formatted}</td>
          <td class="py-3.5 px-4">
            <span class="${badgeClass} px-2 py-0.5 rounded text-[10px] font-mono font-semibold">${b.status}</span>
          </td>
          <td class="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
            ${b.status === 'CONFIRMED' ? `
              <button onclick="handleStaffCheckIn('${b.booking_reference}')" class="btn-primary px-2.5 py-1 rounded text-[11px]">
                Check In
              </button>
            ` : ''}
            ${b.status === 'CHECKED_IN' ? `
              <button onclick="handleStaffCheckOut('${b.booking_reference}')" class="btn-secondary px-2.5 py-1 rounded text-[11px]">
                Check Out
              </button>
            ` : ''}
            ${b.status === 'CONFIRMED' ? `
              <button onclick="confirmCancelReservation('${b.booking_reference}')" class="btn-danger px-2.5 py-1 rounded text-[11px]">
                Cancel
              </button>
            ` : ''}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center form-status-error">Failed to load reservations.</td></tr>`;
  }
}

let staffSearchTimeout = null;
function handleStaffSearch() {
  clearTimeout(staffSearchTimeout);
  staffSearchTimeout = setTimeout(() => {
    loadStaffBookings();
  }, 300);
}

async function handleStaffCheckIn(reference) {
  try {
    const res = await fetch(`${API_BASE}/bookings/${reference}/check-in`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const json = await res.json();
    if (json.success) {
      showToast('Guest checked in; room set to OCCUPIED', 'success');
      if (state.currentView === 'reports') loadOperationsReport();
      else loadStaffBookings();
    } else {
      showToast(json.error?.message || 'Check-in failed', 'error');
    }
  } catch (e) {
    showToast('Network error during check-in', 'error');
  }
}

async function handleStaffCheckOut(reference) {
  try {
    const res = await fetch(`${API_BASE}/bookings/${reference}/check-out`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const json = await res.json();
    if (json.success) {
      showToast('Guest checked out; room set to CLEANING', 'success');
      if (state.currentView === 'reports') loadOperationsReport();
      else loadStaffBookings();
    } else {
      showToast(json.error?.message || 'Check-out failed', 'error');
    }
  } catch (e) {
    showToast('Network error during check-out', 'error');
  }
}

// ============================================================================
// Housekeeping & Room Status Grid
// ============================================================================
async function loadHousekeepingGrid() {
  const container = document.getElementById('housekeeping-floor-grid');
  container.innerHTML = `<div class="text-center py-8 text-xs theme-text-secondary"><span class="loading-spinner mr-2"></span> Loading physical rooms...</div>`;

  try {
    const res = await fetch(`${API_BASE}/rooms`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const json = await res.json();
    if (!json.success) return;

    const floors = {};
    json.data.forEach(r => {
      if (!floors[r.floor]) floors[r.floor] = [];
      floors[r.floor].push(r);
    });

    container.innerHTML = Object.keys(floors).sort().map(floorNum => {
      const floorRooms = floors[floorNum];
      return `
        <div class="surface-card rounded-lg p-6">
          <div class="flex items-center justify-between mb-4 border-b theme-border pb-3">
            <h3 class="font-bold theme-text-primary text-sm">Floor ${floorNum} (${floorRooms.length} Rooms)</h3>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            ${floorRooms.map(r => {
              const badgeClass = getRoomStatusBadgeClass(r.status);
              return `
                <div class="surface-panel rounded p-4 flex flex-col justify-between space-y-3">
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-mono text-sm font-bold theme-text-primary">Room ${r.room_number}</span>
                    <span class="${badgeClass} px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold">${r.status}</span>
                  </div>
                  <div class="text-[11px] theme-text-primary font-medium">${r.room_type_name}</div>
                  ${r.notes ? `<div class="text-[11px] theme-text-secondary">Note: ${r.notes}</div>` : ''}

                  <div class="pt-2 border-t theme-border">
                    <select onchange="handleRoomStatusChange(${r.id}, this.value)" aria-label="Change status for room ${r.room_number}" class="theme-input w-full rounded px-2 py-1.5 text-[11px]">
                      <option value="AVAILABLE" ${r.status === 'AVAILABLE' ? 'selected' : ''}>AVAILABLE</option>
                      <option value="CLEANING" ${r.status === 'CLEANING' ? 'selected' : ''}>CLEANING</option>
                      <option value="OCCUPIED" ${r.status === 'OCCUPIED' ? 'selected' : ''}>OCCUPIED</option>
                      <option value="MAINTENANCE" ${r.status === 'MAINTENANCE' ? 'selected' : ''}>MAINTENANCE</option>
                      <option value="OUT_OF_ORDER" ${r.status === 'OUT_OF_ORDER' ? 'selected' : ''}>OUT_OF_ORDER</option>
                    </select>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="text-center form-status-error rounded py-6 text-xs">Failed to load room board.</div>`;
  }
}

async function handleRoomStatusChange(roomId, newStatus) {
  try {
    const res = await fetch(`${API_BASE}/rooms/${roomId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ status: newStatus })
    });
    const json = await res.json();
    if (json.success) {
      showToast(`Room status updated to ${newStatus}`, 'success');
      loadHousekeepingGrid();
    } else {
      showToast(json.error?.message || 'Update failed', 'error');
    }
  } catch (e) {
    showToast('Network error updating room status', 'error');
  }
}

// ============================================================================
// Operations Reporting
// ============================================================================
async function loadOperationsReport() {
  const startDate = document.getElementById('report-start-date').value;
  const endDate = document.getElementById('report-end-date').value;

  try {
    const res = await fetch(`${API_BASE}/reports/operations?start_date=${startDate}&end_date=${endDate}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const json = await res.json();
    if (!json.success) return;

    const data = json.data;

    document.getElementById('kpi-occupancy').textContent = `${data.metrics.occupancy_rate_percentage}%`;
    document.getElementById('kpi-room-nights').textContent = `${data.metrics.occupied_room_nights} / ${data.metrics.total_available_room_nights} nights`;
    document.getElementById('kpi-revenue').textContent = data.metrics.total_revenue_formatted;
    document.getElementById('kpi-adr').textContent = data.metrics.average_daily_rate_formatted;
    document.getElementById('kpi-revpar').textContent = data.metrics.revpar_formatted;
    document.getElementById('kpi-checked-in').textContent = data.metrics.checked_in_guests;
    document.getElementById('kpi-cancelled').textContent = data.metrics.cancellations_count;
    document.getElementById('kpi-refunded').textContent = `${data.metrics.refunded_amount_formatted} refunded`;

    const arrTbody = document.getElementById('report-arrivals-tbody');
    if (data.upcoming_arrivals.length === 0) {
      arrTbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center theme-text-secondary">No arrivals in selected range.</td></tr>`;
    } else {
      arrTbody.innerHTML = data.upcoming_arrivals.map(a => `
        <tr class="theme-row-hover">
          <td class="py-2.5 px-3 font-mono font-semibold">${a.booking_reference}</td>
          <td class="py-2.5 px-3">${a.guest_name}</td>
          <td class="py-2.5 px-3 font-mono">Room ${a.room_number}</td>
          <td class="py-2.5 px-3 font-mono">${a.check_in}</td>
          <td class="py-2.5 px-3 text-right">
            ${a.status === 'CONFIRMED' ? `
              <button onclick="handleStaffCheckIn('${a.booking_reference}')" class="btn-primary px-2.5 py-1 rounded text-[10px]">
                Check In
              </button>
            ` : `<span class="badge-checked-in px-2 py-0.5 rounded text-[10px] font-mono">In-House</span>`}
          </td>
        </tr>
      `).join('');
    }

    const depTbody = document.getElementById('report-departures-tbody');
    if (data.upcoming_departures.length === 0) {
      depTbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center theme-text-secondary">No departures in selected range.</td></tr>`;
    } else {
      depTbody.innerHTML = data.upcoming_departures.map(d => `
        <tr class="theme-row-hover">
          <td class="py-2.5 px-3 font-mono font-semibold">${d.booking_reference}</td>
          <td class="py-2.5 px-3">${d.guest_name}</td>
          <td class="py-2.5 px-3 font-mono">Room ${d.room_number}</td>
          <td class="py-2.5 px-3 font-mono">${d.check_out}</td>
          <td class="py-2.5 px-3 text-right">
            ${d.status === 'CHECKED_IN' ? `
              <button onclick="handleStaffCheckOut('${d.booking_reference}')" class="btn-secondary px-2.5 py-1 rounded text-[10px]">
                Check Out
              </button>
            ` : `<span class="badge-checked-out px-2 py-0.5 rounded text-[10px] font-mono">Checked Out</span>`}
          </td>
        </tr>
      `).join('');
    }

    const rtTbody = document.getElementById('report-type-breakdown-tbody');
    rtTbody.innerHTML = data.room_type_breakdown.map(rt => `
      <tr class="theme-row-hover">
        <td class="py-3 px-3 font-semibold">${rt.name}</td>
        <td class="py-3 px-3 font-mono tabular-nums">${rt.bookings_count}</td>
        <td class="py-3 px-3 font-mono tabular-nums">${rt.occupied_nights}</td>
        <td class="py-3 px-3 font-mono tabular-nums">${rt.occupancy_share_pct}%</td>
        <td class="py-3 px-3 text-right font-mono font-semibold tabular-nums theme-text-primary">${rt.revenue_formatted}</td>
      </tr>
    `).join('');

    // Load first-party analytics summary for operations telemetry
    try {
      const aRes = await fetch(`${API_BASE}/analytics/summary`, {
        headers: { 'Authorization': `Bearer ${state.token}` }
      });
      const aJson = await aRes.json();
      if (aRes.ok && aJson.success) {
        const totalEl = document.getElementById('analytics-total-events');
        const gridEl = document.getElementById('analytics-counts-grid');
        if (totalEl) totalEl.textContent = `${aJson.data.total_events || 0} total events`;
        if (gridEl) {
          const counts = aJson.data.event_counts || {};
          const items = [
            { key: 'page_view', label: 'Page Views' },
            { key: 'search_availability', label: 'Availability Searches' },
            { key: 'hold_created', label: 'Room Holds' },
            { key: 'booking_confirmed', label: 'Bookings Confirmed' },
            { key: 'inquiry_submitted', label: 'Guest Inquiries' }
          ];
          gridEl.innerHTML = items.map(it => `
            <div class="p-4 rounded theme-inset-box">
              <div class="text-[11px] uppercase tracking-wider theme-text-muted">${it.label}</div>
              <div class="mt-1 font-mono text-lg font-semibold tabular-nums theme-text-primary">${counts[it.key] || 0}</div>
            </div>
          `).join('');
        }
      }
    } catch { /* Non-fatal telemetry load failure */ }
  } catch (err) {
    showToast('Failed to load operations report', 'error');
  }
}

// ============================================================================
// Admin: Room Types & Physical Rooms
// ============================================================================
async function loadAdminRoomTypes() {
  const container = document.getElementById('admin-room-types-table');
  container.innerHTML = `<div class="text-center py-8 text-xs theme-text-secondary"><span class="loading-spinner mr-2"></span> Loading room types...</div>`;

  try {
    const res = await fetch(`${API_BASE}/room-types?include_inactive=true`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const json = await res.json();
    if (!json.success) return;

    container.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="theme-table-head uppercase text-[10px] font-semibold">
            <tr>
              <th class="py-3.5 px-3">ID / Room Type</th>
              <th class="py-3.5 px-3">Base Rate</th>
              <th class="py-3.5 px-3">Capacity</th>
              <th class="py-3.5 px-3">Rooms</th>
              <th class="py-3.5 px-3">Specs</th>
              <th class="py-3.5 px-3">Status</th>
            </tr>
          </thead>
          <tbody class="divide-y theme-border theme-text-primary">
            ${json.data.map(rt => `
              <tr class="theme-row-hover">
                <td class="py-3.5 px-3">
                  <div class="font-bold">[#${rt.id}] ${rt.name}</div>
                  <div class="text-[11px] font-mono theme-text-secondary">${rt.slug}</div>
                </td>
                <td class="py-3.5 px-3 font-mono font-bold tabular-nums">${rt.base_price_formatted}</td>
                <td class="py-3.5 px-3">${rt.max_adults} Adults, ${rt.max_children} Children</td>
                <td class="py-3.5 px-3 font-mono">
                  <span class="font-semibold">${rt.total_rooms} total</span>
                  <span class="text-[11px] theme-text-secondary block">${rt.available_rooms} ready</span>
                </td>
                <td class="py-3.5 px-3">${rt.bed_type} (${rt.size_sqft} sq ft)</td>
                <td class="py-3.5 px-3">
                  <span class="${rt.is_active ? 'badge-available' : 'badge-cancelled'} px-2 py-0.5 rounded text-[10px] font-mono font-semibold">
                    ${rt.is_active ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="text-center form-status-error rounded py-6 text-xs">Failed to load room types.</div>`;
  }
}

function openNewRoomTypeModal() {
  const name = prompt('Enter Room Type Name (e.g. Royal Konkan Seafront Suite):');
  if (!name) return;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const price = prompt('Enter Nightly Base Price in USD (e.g. 350):');
  if (!price) return;

  fetch(`${API_BASE}/room-types`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.token}`
    },
    body: JSON.stringify({
      name,
      slug,
      description: 'Oceanfront guest suite with private balcony.',
      basePriceCents: Math.round(Number(price) * 100),
      maxOccupancy: 3,
      maxAdults: 2,
      maxChildren: 1,
      bedType: '1 King Bed',
      sizeSqft: 500,
      amenities: ['Ocean View', 'Private Balcony', 'Wi-Fi', 'Rain Shower']
    })
  }).then(res => res.json()).then(json => {
    if (json.success) {
      showToast('Room type created', 'success');
      loadAdminRoomTypes();
    } else {
      showToast(json.error?.message || 'Creation failed', 'error');
    }
  });
}

function openNewPhysicalRoomModal() {
  const roomNumber = prompt('Enter New Room Number (e.g. 304):');
  if (!roomNumber) return;
  const floor = prompt('Enter Floor Number (e.g. 3):');
  if (!floor) return;
  const roomTypeId = prompt('Enter Room Type ID (e.g. 1):');
  if (!roomTypeId) return;

  fetch(`${API_BASE}/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.token}`
    },
    body: JSON.stringify({
      roomNumber,
      floor: Number(floor),
      roomTypeId: Number(roomTypeId),
      status: 'AVAILABLE',
      notes: 'Added via Room Admin'
    })
  }).then(res => res.json()).then(json => {
    if (json.success) {
      showToast(`Room ${roomNumber} added`, 'success');
      loadAdminRoomTypes();
    } else {
      showToast(json.error?.message || 'Creation failed', 'error');
    }
  });
}

// ============================================================================
// Admin: Audit Logs
// ============================================================================
async function loadAuditLogs() {
  const tbody = document.getElementById('audit-logs-table-body');
  tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center theme-text-secondary"><span class="loading-spinner mr-2"></span> Loading audit trail...</td></tr>`;

  try {
    const res = await fetch(`${API_BASE}/audit?limit=50`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const json = await res.json();
    if (!json.success || json.data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center theme-text-secondary">No audit logs recorded.</td></tr>`;
      return;
    }

    tbody.innerHTML = json.data.map(log => `
      <tr class="theme-row-hover">
        <td class="py-3 px-3 theme-text-secondary whitespace-nowrap">${log.created_at}</td>
        <td class="py-3 px-3">
          <span class="font-bold theme-text-primary">${log.actor_role}</span>
          <span class="text-[10px] theme-text-secondary block">${log.actor_email}</span>
        </td>
        <td class="py-3 px-3 font-semibold theme-text-primary">${log.action}</td>
        <td class="py-3 px-3 theme-text-primary">${log.entity_type}:${log.entity_id}</td>
        <td class="py-3 px-3 theme-text-secondary text-[10px] max-w-xs truncate">${JSON.stringify(log.details)}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center form-status-error">Failed to load audit logs.</td></tr>`;
  }
}

// ============================================================================
// UI Helpers & Toasts
// ============================================================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');

  let styleClass = 'surface-card theme-text-primary';
  if (type === 'success') styleClass = 'badge-available';
  else if (type === 'error') styleClass = 'badge-maintenance';
  else if (type === 'warning') styleClass = 'badge-cleaning';

  toast.className = `${styleClass} rounded px-4 py-3 shadow-md text-xs font-medium pointer-events-auto`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4500);
}

function getStatusBadgeClass(status) {
  switch (status) {
    case 'CONFIRMED': return 'badge-confirmed';
    case 'CHECKED_IN': return 'badge-checked-in';
    case 'CHECKED_OUT': return 'badge-checked-out';
    case 'HOLD': return 'badge-hold';
    case 'CANCELLED': return 'badge-cancelled';
    default: return 'badge-expired';
  }
}

function getRoomStatusBadgeClass(status) {
  switch (status) {
    case 'AVAILABLE': return 'badge-available';
    case 'OCCUPIED': return 'badge-occupied';
    case 'CLEANING': return 'badge-cleaning';
    case 'MAINTENANCE': return 'badge-maintenance';
    default: return 'badge-out-of-order';
  }
}
