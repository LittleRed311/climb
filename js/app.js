// ============================================================
// FACEMASH LEADERBOARD – Application Logic
// Vanilla JS ES Module with Firebase CDN + geofire-common
// ============================================================

// ── Firebase SDK (CDN imports) ──
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js';
import {
  getAuth,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  collection,
  query,
  where,
  orderBy,
  limit,
  startAt,
  endAt,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-storage.js';

// ── Geohash library ──
import {
  geohashForLocation,
  geohashQueryBounds,
  distanceBetween
} from 'https://esm.sh/geofire-common@6.0.0';

// ============================================================
// 🔧 FIREBASE CONFIGURATION
// Replace these placeholder values with your actual Firebase
// project configuration from the Firebase Console.
// Go to: Project Settings → General → Your apps → Web app
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyD6Ut3iVrCarvYQXajDaT9310-fQ9XwX2w",
  authDomain: "climb-d09e0.firebaseapp.com",
  projectId: "climb-d09e0",
  storageBucket: "climb-d09e0.firebasestorage.app",
  messagingSenderId: "129700664600",
  appId: "1:129700664600:web:ff0115d8978696ba193a6d",
  measurementId: "G-B5NMWKEZZ2"
};

// ── Initialize Firebase services ──
const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const db      = getFirestore(app);
const storage = getStorage(app);

// ============================================================
// STATE
// ============================================================
let currentUser   = null;   // Firebase Auth user
let currentProfile = null;  // Firestore profile document data
let leftCandidate  = null;  // Current left matchup profile
let rightCandidate = null;  // Current right matchup profile
let votingCooldown = false; // Rate-limit flag
let refreshCooldown = false; // Refresh rate-limit flag

// Active leaderboard state
let activeLbTab = 'global';
let activeState = '';

// Geolocation data (collected during onboarding)
let userLat = null;
let userLng = null;
let userState = '';
let userGeohash = '';

// File selected for upload
let selectedPhotoFile = null;

// ============================================================
// DOM REFERENCES
// ============================================================
const $ = (id) => document.getElementById(id);

const DOM = {
  // Views
  authScreen:        $('auth-screen'),
  appScreen:         $('app-screen'),
  viewArena:         $('view-arena'),
  viewLeaderboard:   $('view-leaderboard'),

  // Auth
  btnGoogleSignin:   $('btn-google-signin'),

  // Onboarding
  onboardingModal:   $('onboarding-modal'),
  onboardingForm:    $('onboarding-form'),
  inputUsername:     $('input-username'),
  usernameError:     $('username-error'),
  locationStatus:    $('location-status'),
  locationDot:       $('location-dot'),
  locationText:      $('location-text'),
  btnRequestLocation:$('btn-request-location'),
  uploadArea:        $('upload-area'),
  uploadPreview:     $('upload-preview'),
  inputPhoto:        $('input-photo'),
  photoError:        $('photo-error'),
  btnCreateProfile:  $('btn-create-profile'),

  // Header
  navTabs:           document.querySelectorAll('.nav-tab'),
  userAvatar:        $('user-avatar'),
  btnSignout:        $('btn-signout'),

  // Arena
  arenaGrid:         $('arena-grid'),
  voteCardLeft:      $('vote-card-left'),
  voteCardRight:     $('vote-card-right'),
  votePhotoLeft:     $('vote-photo-left'),
  voteUsernameLeft:  $('vote-username-left'),
  voteRatingLeft:    $('vote-rating-left'),
  votePhotoRight:    $('vote-photo-right'),
  voteUsernameRight: $('vote-username-right'),
  voteRatingRight:   $('vote-rating-right'),
  btnSkip:           $('btn-skip'),
  cooldownBar:       $('cooldown-bar'),

  // Leaderboard
  lbTabs:            document.querySelectorAll('.lb-tab'),
  stateSelector:     $('state-selector'),
  stateSelect:       $('state-select'),
  cacheBadge:        $('cache-badge'),
  btnRefresh:        $('btn-refresh'),
  lbList:            $('lb-list'),
  lbEmpty:           $('lb-empty'),

  // Mobile nav
  mobileNavBtns:     document.querySelectorAll('.mobile-nav-btn'),

  // Toast
  toastContainer:    $('toast-container'),
};

// ============================================================
// UTILITIES
// ============================================================

/**
 * Show a toast notification.
 * @param {string} message - Text to display
 * @param {'success'|'error'|'info'} type - Toast style
 */
function showToast(message, type = 'success') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || ''}</span><span>${message}</span>`;
  DOM.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
}

/**
 * Show/hide skeleton loaders in the arena.
 * @param {boolean} show
 */
function toggleArenaSkeleton(show) {
  const skels = ['skel-photo-left', 'skel-name-left', 'skel-rating-left',
                 'skel-photo-right', 'skel-name-right', 'skel-rating-right'];
  const reals = ['vote-photo-left', 'vote-username-left', 'vote-rating-left',
                 'vote-photo-right', 'vote-username-right', 'vote-rating-right'];

  skels.forEach(id => {
    const el = $(id);
    if (el) el.style.display = show ? 'block' : 'none';
  });
  reals.forEach(id => {
    const el = $(id);
    if (el) el.classList.toggle('hidden', show);
  });
}

/**
 * Show/hide leaderboard skeleton loaders.
 * @param {boolean} show
 */
function toggleLbSkeleton(show) {
  for (let i = 1; i <= 5; i++) {
    const el = $(`skel-lb-${i}`);
    if (el) el.style.display = show ? 'grid' : 'none';
  }
}

/**
 * Compress an image file using canvas before upload.
 * Resizes to max 800px dimension and converts to JPEG at 0.8 quality.
 * @param {File} file
 * @returns {Promise<Blob>}
 */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const MAX_DIM = 800;
    const QUALITY = 0.8;
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.onload = () => {
        let { width, height } = img;

        // Scale down proportionally
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round(height * (MAX_DIM / width));
            width = MAX_DIM;
          } else {
            width = Math.round(width * (MAX_DIM / height));
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas compression failed'));
          },
          'image/jpeg',
          QUALITY
        );
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Calculate the Haversine distance between two lat/lng points in meters.
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================================================
// CACHING (localStorage)
// ============================================================
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in ms
const REFRESH_COOLDOWN_MS = 30_000; // 30 seconds between manual refreshes

/**
 * Get cached leaderboard data if still fresh.
 * @param {string} key - Cache key
 * @returns {Array|null} - Cached data or null if stale/missing
 */
function getCachedLb(key) {
  try {
    const raw = localStorage.getItem(`lb_${key}`);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp < CACHE_TTL) return data;
    return null;
  } catch {
    return null;
  }
}

/**
 * Store leaderboard data in cache.
 * @param {string} key
 * @param {Array} data
 */
function setCachedLb(key, data) {
  try {
    localStorage.setItem(`lb_${key}`, JSON.stringify({
      data,
      timestamp: Date.now()
    }));
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

/**
 * Invalidate a specific cache entry.
 * @param {string} key
 */
function invalidateCache(key) {
  try { localStorage.removeItem(`lb_${key}`); } catch { /* ignore */ }
}

/**
 * Get the age label for a cache entry.
 * @param {string} key
 * @returns {string}
 */
function getCacheAge(key) {
  try {
    const raw = localStorage.getItem(`lb_${key}`);
    if (!raw) return 'Live';
    const { timestamp } = JSON.parse(raw);
    const ageMs = Date.now() - timestamp;
    if (ageMs < 60_000) return 'Cached just now';
    const mins = Math.floor(ageMs / 60_000);
    return `Cached ${mins}m ago`;
  } catch {
    return 'Live';
  }
}

// ============================================================
// AUTHENTICATION
// ============================================================

/**
 * Handle Google Sign-In via popup.
 */
async function handleGoogleSignIn() {
  try {
    DOM.btnGoogleSignin.disabled = true;
    DOM.btnGoogleSignin.innerHTML = '<span class="spinner"></span> Signing in…';
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    // onAuthStateChanged will handle the rest
  } catch (err) {
    console.error('Sign-in error:', err);
    showToast('Sign-in failed. Please try again.', 'error');
    DOM.btnGoogleSignin.disabled = false;
    DOM.btnGoogleSignin.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
      Sign in with Google`;
  }
}

/**
 * Handle Sign Out.
 */
async function handleSignOut() {
  try {
    await signOut(auth);
    currentUser = null;
    currentProfile = null;
    showView('auth');
  } catch (err) {
    console.error('Sign-out error:', err);
    showToast('Sign-out failed.', 'error');
  }
}

/**
 * Auth state listener — routes user to onboarding or arena.
 */
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    // Check if profile exists in Firestore
    const profileRef = doc(db, 'profiles', user.uid);
    const profileSnap = await getDoc(profileRef);

    if (profileSnap.exists()) {
      currentProfile = profileSnap.data();
      enterApp();
    } else {
      // First-time user — show onboarding
      showView('app'); // Need app screen visible for modal z-index
      DOM.onboardingModal.classList.add('active');
    }
  } else {
    currentUser = null;
    currentProfile = null;
    showView('auth');
    DOM.onboardingModal.classList.remove('active');
  }
});

// ============================================================
// VIEW ROUTING
// ============================================================

/**
 * Switch between auth screen and app screen.
 * @param {'auth'|'app'} view
 */
function showView(view) {
  DOM.authScreen.classList.toggle('active', view === 'auth');
  DOM.appScreen.classList.toggle('active', view === 'app');
}

/**
 * Switch between arena and leaderboard within the app.
 * @param {'arena'|'leaderboard'} view
 */
function switchAppView(view) {
  DOM.viewArena.style.display = view === 'arena' ? 'block' : 'none';
  DOM.viewLeaderboard.style.display = view === 'leaderboard' ? 'block' : 'none';

  // Update nav tab states
  DOM.navTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
  DOM.mobileNavBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));

  if (view === 'leaderboard') {
    loadLeaderboard(activeLbTab, false);
  }
}

/**
 * Enter the main app after auth + profile confirmed.
 */
function enterApp() {
  showView('app');
  DOM.onboardingModal.classList.remove('active');

  // Set header avatar
  if (currentProfile?.photoURL) {
    DOM.userAvatar.src = currentProfile.photoURL;
    DOM.userAvatar.alt = `${currentProfile.username}'s profile photo`;
  }

  // Load first matchup
  loadMatchup();
}

// ============================================================
// ONBOARDING
// ============================================================

/**
 * Request browser geolocation.
 */
function requestLocation() {
  if (!navigator.geolocation) {
    DOM.locationText.textContent = 'Geolocation not supported';
    DOM.locationDot.classList.add('denied');
    return;
  }

  DOM.locationText.textContent = 'Requesting location…';
  DOM.btnRequestLocation.disabled = true;

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      userGeohash = geohashForLocation([userLat, userLng]);

      // Reverse geocode to get state using BigDataCloud (free, no API key)
      try {
        const resp = await fetch(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${userLat}&longitude=${userLng}&localityLanguage=en`
        );
        const geoData = await resp.json();
        userState = normalizeStateName(geoData.principalSubdivision || '');
      } catch {
        userState = '';
      }

      DOM.locationDot.classList.add('granted');
      DOM.locationText.textContent = userState
        ? `📍 ${userState} (${userLat.toFixed(2)}, ${userLng.toFixed(2)})`
        : `📍 ${userLat.toFixed(2)}, ${userLng.toFixed(2)}`;

      validateOnboardingForm();
    },
    (err) => {
      console.warn('Geolocation error:', err);
      DOM.locationDot.classList.add('denied');
      DOM.locationText.textContent = 'Location denied — state/local rankings unavailable';
      DOM.btnRequestLocation.disabled = false;
      // Location is optional — user can still create profile
      validateOnboardingForm();
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

/**
 * Normalize a subdivision name to match our 56 recognized state/territory names.
 * BigDataCloud returns full names like "California" which usually match directly.
 */
function normalizeStateName(name) {
  const VALID_STATES = [
    'Alabama','Alaska','American Samoa','Arizona','Arkansas','California',
    'Colorado','Connecticut','Delaware','District of Columbia','Florida',
    'Georgia','Guam','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas',
    'Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
    'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada',
    'New Hampshire','New Jersey','New Mexico','New York','North Carolina',
    'North Dakota','Northern Mariana Islands','Ohio','Oklahoma','Oregon',
    'Pennsylvania','Puerto Rico','Rhode Island','South Carolina','South Dakota',
    'Tennessee','Texas','US Virgin Islands','Utah','Vermont','Virginia',
    'Washington','West Virginia','Wisconsin','Wyoming'
  ];

  // Normalize common variations
  const ALIASES = {
    'Washington, D.C.': 'District of Columbia',
    'Washington DC': 'District of Columbia',
    'D.C.': 'District of Columbia',
    'DC': 'District of Columbia',
    'U.S. Virgin Islands': 'US Virgin Islands',
    'United States Virgin Islands': 'US Virgin Islands',
    'USVI': 'US Virgin Islands',
    'Commonwealth of the Northern Mariana Islands': 'Northern Mariana Islands',
    'CNMI': 'Northern Mariana Islands',
  };

  const trimmed = name.trim();
  if (ALIASES[trimmed]) return ALIASES[trimmed];
  if (VALID_STATES.includes(trimmed)) return trimmed;

  // Fuzzy: case-insensitive match
  const lower = trimmed.toLowerCase();
  const match = VALID_STATES.find(s => s.toLowerCase() === lower);
  return match || '';
}

/**
 * Handle photo file selection.
 */
function handlePhotoSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  // Validate type
  if (!file.type.startsWith('image/')) {
    DOM.photoError.textContent = 'Please select an image file (JPG, PNG, or WebP).';
    DOM.photoError.classList.add('visible');
    return;
  }

  // Validate size (5 MB max before compression)
  if (file.size > 5 * 1024 * 1024) {
    DOM.photoError.textContent = 'File is too large. Maximum size is 5 MB.';
    DOM.photoError.classList.add('visible');
    return;
  }

  DOM.photoError.classList.remove('visible');
  selectedPhotoFile = file;

  // Show preview
  const reader = new FileReader();
  reader.onload = (ev) => {
    DOM.uploadPreview.src = ev.target.result;
    DOM.uploadArea.classList.add('has-image');
  };
  reader.readAsDataURL(file);

  validateOnboardingForm();
}

/**
 * Check if the onboarding form has enough data to submit.
 */
function validateOnboardingForm() {
  const username = DOM.inputUsername.value.trim();
  const usernameValid = /^[a-zA-Z0-9_]{3,20}$/.test(username);
  const hasPhoto = !!selectedPhotoFile;
  DOM.btnCreateProfile.disabled = !(usernameValid && hasPhoto);
}

/**
 * Submit the onboarding form — create profile in Firestore.
 */
async function handleOnboardingSubmit(e) {
  e.preventDefault();
  if (!currentUser) return;

  const username = DOM.inputUsername.value.trim();

  // Final validation
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    DOM.usernameError.textContent = 'Username must be 3–20 chars: letters, numbers, underscores.';
    DOM.usernameError.classList.add('visible');
    return;
  }

  if (!selectedPhotoFile) {
    DOM.photoError.textContent = 'Please select a profile photo.';
    DOM.photoError.classList.add('visible');
    return;
  }

  // Disable form while processing
  DOM.btnCreateProfile.disabled = true;
  DOM.btnCreateProfile.innerHTML = '<span class="spinner"></span> <span>Creating profile…</span>';

  try {
    // 1. Compress image before upload (resize to max 800px, JPEG 0.8 quality)
    const compressedBlob = await compressImage(selectedPhotoFile);

    // 2. Upload compressed photo to Firebase Storage
    const photoRef = ref(storage, `photos/${currentUser.uid}/profile.jpg`);
    await uploadBytes(photoRef, compressedBlob, { contentType: 'image/jpeg' });
    const photoURL = await getDownloadURL(photoRef);

    // 3. Create Firestore profile document
    const profileData = {
      uid:          currentUser.uid,
      username:     username,
      photoURL:     photoURL,
      eloRating:    1200,
      wins:         0,
      losses:       0,
      lat:          userLat || 0,
      lng:          userLng || 0,
      geohash:      userGeohash || '',
      state:        userState || '',
      randomWeight: Math.random(),
      createdAt:    serverTimestamp()
    };

    await setDoc(doc(db, 'profiles', currentUser.uid), profileData);

    currentProfile = profileData;
    showToast('Profile created! Let the voting begin. 🎉');
    enterApp();

  } catch (err) {
    console.error('Profile creation error:', err);
    showToast('Failed to create profile. Please try again.', 'error');
    DOM.btnCreateProfile.disabled = false;
    DOM.btnCreateProfile.innerHTML = '<span>Create Profile & Start Voting</span>';
  }
}

// ============================================================
// VOTING ARENA
// ============================================================

/**
 * Fetch two random profiles for a matchup using the optimized
 * randomWeight query pattern (avoids reading entire collection).
 */
async function loadMatchup() {
  toggleArenaSkeleton(true);
  DOM.voteCardLeft.classList.remove('voted', 'disabled');
  DOM.voteCardRight.classList.remove('voted', 'disabled');

  try {
    const profilesRef = collection(db, 'profiles');
    const rand1 = Math.random();

    // ── Fetch first candidate ──
    let q1 = query(profilesRef,
      where('randomWeight', '>=', rand1),
      orderBy('randomWeight'),
      limit(2) // Fetch 2 so we can skip self
    );
    let snap1 = await getDocs(q1);

    // Wraparound if no results
    if (snap1.empty) {
      q1 = query(profilesRef,
        where('randomWeight', '<=', rand1),
        orderBy('randomWeight', 'desc'),
        limit(2)
      );
      snap1 = await getDocs(q1);
    }

    if (snap1.empty) {
      // Not enough profiles in the database yet
      showEmptyArena();
      return;
    }

    // Pick first candidate that isn't the current user
    let candidate1 = null;
    let candidate1Doc = null;
    snap1.forEach(d => {
      if (!candidate1 && d.id !== currentUser.uid) {
        candidate1 = d.data();
        candidate1Doc = d;
      }
    });

    if (!candidate1) {
      showEmptyArena();
      return;
    }

    // ── Fetch second candidate ──
    const rand2 = Math.random();
    let q2 = query(profilesRef,
      where('randomWeight', '>=', rand2),
      orderBy('randomWeight'),
      limit(3) // Fetch 3 to have room to skip self + first candidate
    );
    let snap2 = await getDocs(q2);

    if (snap2.empty) {
      q2 = query(profilesRef,
        where('randomWeight', '<=', rand2),
        orderBy('randomWeight', 'desc'),
        limit(3)
      );
      snap2 = await getDocs(q2);
    }

    let candidate2 = null;
    snap2.forEach(d => {
      if (!candidate2 && d.id !== currentUser.uid && d.id !== candidate1Doc.id) {
        candidate2 = d.data();
      }
    });

    if (!candidate2) {
      showEmptyArena();
      return;
    }

    leftCandidate = candidate1;
    rightCandidate = candidate2;

    // Render the matchup
    renderMatchup();

  } catch (err) {
    console.error('Matchup load error:', err);
    showToast('Failed to load matchup. Please refresh.', 'error');
  }
}

/**
 * Show empty state when not enough profiles exist.
 */
function showEmptyArena() {
  toggleArenaSkeleton(false);
  DOM.votePhotoLeft.classList.add('hidden');
  DOM.voteUsernameLeft.classList.add('hidden');
  DOM.voteRatingLeft.classList.add('hidden');
  DOM.votePhotoRight.classList.add('hidden');
  DOM.voteUsernameRight.classList.add('hidden');
  DOM.voteRatingRight.classList.add('hidden');

  DOM.arenaGrid.innerHTML = `
    <div style="grid-column: 1/-1;" class="empty-state">
      <div class="empty-state-icon">👥</div>
      <p class="empty-state-text">Need at least 2 profiles to start matchups. Share the link with friends!</p>
    </div>
  `;
}

/**
 * Render the two candidates into the arena UI.
 */
function renderMatchup() {
  toggleArenaSkeleton(false);

  DOM.votePhotoLeft.src = leftCandidate.photoURL;
  DOM.votePhotoLeft.alt = `${leftCandidate.username}'s photo`;
  DOM.voteUsernameLeft.textContent = leftCandidate.username;
  DOM.voteRatingLeft.textContent = `${Math.round(leftCandidate.eloRating)} ELO`;

  DOM.votePhotoRight.src = rightCandidate.photoURL;
  DOM.votePhotoRight.alt = `${rightCandidate.username}'s photo`;
  DOM.voteUsernameRight.textContent = rightCandidate.username;
  DOM.voteRatingRight.textContent = `${Math.round(rightCandidate.eloRating)} ELO`;
}

/**
 * Handle a vote. The winner is the clicked card's candidate.
 * @param {'left'|'right'} side
 */
async function handleVote(side) {
  if (votingCooldown || !leftCandidate || !rightCandidate) return;

  // ── Rate-limit: 1.5s cooldown ──
  votingCooldown = true;
  DOM.voteCardLeft.classList.add('disabled');
  DOM.voteCardRight.classList.add('disabled');
  DOM.btnSkip.disabled = true;

  // Show cooldown bar animation
  DOM.cooldownBar.classList.remove('active');
  // Force reflow to restart animation
  void DOM.cooldownBar.offsetWidth;
  DOM.cooldownBar.classList.add('active');

  // Highlight the voted card
  const votedCard = side === 'left' ? DOM.voteCardLeft : DOM.voteCardRight;
  votedCard.classList.add('voted');

  const winner = side === 'left' ? leftCandidate : rightCandidate;
  const loser  = side === 'left' ? rightCandidate : leftCandidate;

  // ── Elo Calculation (K=32) ──
  const K = 32;
  const expectedWinner = 1 / (1 + Math.pow(10, (loser.eloRating - winner.eloRating) / 400));
  const expectedLoser  = 1 / (1 + Math.pow(10, (winner.eloRating - loser.eloRating) / 400));
  const winnerDelta = Math.round(K * (1 - expectedWinner));
  const loserDelta  = Math.round(K * (0 - expectedLoser));

  const winnerNewElo = winner.eloRating + winnerDelta;
  const loserNewElo  = loser.eloRating + loserDelta;

  try {
    // ── Batched write for atomicity ──
    const batch = writeBatch(db);

    batch.update(doc(db, 'profiles', winner.uid), {
      eloRating: winnerNewElo,
      wins: winner.wins + 1
    });

    batch.update(doc(db, 'profiles', loser.uid), {
      eloRating: loserNewElo,
      losses: loser.losses + 1
    });

    await batch.commit();

    showToast(`${winner.username} wins! (+${winnerDelta} ELO)`);

    // Invalidate global leaderboard cache since ratings changed
    invalidateCache('global');

  } catch (err) {
    console.error('Vote error:', err);
    showToast('Vote failed. Please try again.', 'error');
  }

  // ── Wait for cooldown, then load next matchup ──
  setTimeout(() => {
    votingCooldown = false;
    DOM.voteCardLeft.classList.remove('disabled');
    DOM.voteCardRight.classList.remove('disabled');
    DOM.btnSkip.disabled = false;
    DOM.cooldownBar.classList.remove('active');
    loadMatchup();
  }, 1500);
}

// ============================================================
// LEADERBOARD
// ============================================================

/**
 * Load the active leaderboard. Uses caching.
 * @param {string} type - 'global', 'state', or 'local'
 * @param {boolean} forceRefresh - Bypass cache
 */
async function loadLeaderboard(type, forceRefresh = false) {
  activeLbTab = type;

  // Update tab styles
  DOM.lbTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.lb === type));

  // Show/hide state selector
  DOM.stateSelector.classList.toggle('visible', type === 'state');

  // For state tab, need a state selected
  if (type === 'state' && !activeState) {
    // Default to user's state or show empty
    if (currentProfile?.state) {
      activeState = currentProfile.state;
      DOM.stateSelect.value = activeState;
    } else {
      renderLbEntries([]);
      return;
    }
  }

  // Build cache key
  let cacheKey = type;
  if (type === 'state') cacheKey = `state_${activeState}`;
  if (type === 'local') cacheKey = `local_${currentProfile?.geohash?.substring(0, 4) || 'none'}`;

  // Check cache (unless forced refresh)
  if (!forceRefresh) {
    const cached = getCachedLb(cacheKey);
    if (cached) {
      renderLbEntries(cached);
      DOM.cacheBadge.textContent = getCacheAge(cacheKey);
      return;
    }
  }

  // Fetch from Firestore
  toggleLbSkeleton(true);
  DOM.lbEmpty.classList.add('hidden');
  clearLbEntries();

  try {
    let profiles = [];

    if (type === 'global') {
      profiles = await fetchGlobalLeaderboard();
    } else if (type === 'state') {
      profiles = await fetchStateLeaderboard(activeState);
    } else if (type === 'local') {
      profiles = await fetchLocalLeaderboard();
    }

    setCachedLb(cacheKey, profiles);
    DOM.cacheBadge.textContent = 'Just updated';
    renderLbEntries(profiles);

  } catch (err) {
    console.error('Leaderboard fetch error:', err);
    showToast('Failed to load leaderboard.', 'error');
    toggleLbSkeleton(false);
  }
}

/**
 * Fetch global leaderboard — top 50 by Elo rating.
 */
async function fetchGlobalLeaderboard() {
  const q = query(
    collection(db, 'profiles'),
    orderBy('eloRating', 'desc'),
    limit(50)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

/**
 * Fetch state leaderboard — top 50 in a specific state.
 */
async function fetchStateLeaderboard(state) {
  const q = query(
    collection(db, 'profiles'),
    where('state', '==', state),
    orderBy('eloRating', 'desc'),
    limit(50)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

/**
 * Fetch local leaderboard — profiles within 10-mile radius.
 * Uses geohash range queries + client-side distance filtering.
 */
async function fetchLocalLeaderboard() {
  if (!currentProfile?.lat || !currentProfile?.lng) {
    return [];
  }

  const center = [currentProfile.lat, currentProfile.lng];
  const radiusMeters = 16093; // 10 miles in meters

  // Get geohash query bounds
  const bounds = geohashQueryBounds(center, radiusMeters);
  const promises = [];

  for (const b of bounds) {
    const q = query(
      collection(db, 'profiles'),
      orderBy('geohash'),
      startAt(b[0]),
      endAt(b[1]),
      limit(50)
    );
    promises.push(getDocs(q));
  }

  const snapshots = await Promise.all(promises);

  // Merge results and filter by actual distance
  const matchingProfiles = [];
  const seenUids = new Set();

  for (const snap of snapshots) {
    for (const d of snap.docs) {
      const data = d.data();
      if (seenUids.has(data.uid)) continue;
      seenUids.add(data.uid);

      // Verify actual distance (geohash is approximate)
      const dist = haversineDistance(center[0], center[1], data.lat, data.lng);
      if (dist <= radiusMeters) {
        matchingProfiles.push(data);
      }
    }
  }

  // Sort by Elo descending, take top 50
  matchingProfiles.sort((a, b) => b.eloRating - a.eloRating);
  return matchingProfiles.slice(0, 50);
}

/**
 * Clear the leaderboard list of real entries (not skeletons).
 */
function clearLbEntries() {
  const entries = DOM.lbList.querySelectorAll('.lb-entry');
  entries.forEach(el => el.remove());
}

/**
 * Render leaderboard entries into the DOM.
 * @param {Array} profiles
 */
function renderLbEntries(profiles) {
  toggleLbSkeleton(false);
  clearLbEntries();

  if (profiles.length === 0) {
    DOM.lbEmpty.classList.remove('hidden');
    return;
  }

  DOM.lbEmpty.classList.add('hidden');

  profiles.forEach((p, i) => {
    const rank = i + 1;
    const entry = document.createElement('div');
    entry.className = 'lb-entry';
    if (rank <= 3) entry.dataset.rank = rank;

    const medalEmoji = rank === 1 ? '👑' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';

    entry.innerHTML = `
      <div class="lb-rank">${medalEmoji || '#' + rank}</div>
      <img class="lb-avatar" src="${escapeHtml(p.photoURL)}" alt="${escapeHtml(p.username)}'s photo" loading="lazy">
      <div class="lb-info">
        <span class="lb-name">${escapeHtml(p.username)}</span>
        <span class="lb-meta">${p.wins || 0}W – ${p.losses || 0}L${p.state ? ' · ' + escapeHtml(p.state) : ''}</span>
      </div>
      <div class="lb-elo">${Math.round(p.eloRating)}</div>
    `;

    DOM.lbList.appendChild(entry);
  });
}

/**
 * Minimal HTML escaping for safe text insertion.
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Handle manual refresh with rate limiting.
 */
function handleRefresh() {
  if (refreshCooldown) {
    showToast('Please wait before refreshing again.', 'info');
    return;
  }

  refreshCooldown = true;
  DOM.btnRefresh.disabled = true;
  DOM.btnRefresh.classList.add('spinning');

  // Refresh current leaderboard
  loadLeaderboard(activeLbTab, true);

  setTimeout(() => {
    refreshCooldown = false;
    DOM.btnRefresh.disabled = false;
    DOM.btnRefresh.classList.remove('spinning');
  }, REFRESH_COOLDOWN_MS);
}

// ============================================================
// EVENT LISTENERS
// ============================================================

// ── Auth ──
DOM.btnGoogleSignin.addEventListener('click', handleGoogleSignIn);
DOM.btnSignout.addEventListener('click', handleSignOut);

// ── Onboarding ──
DOM.btnRequestLocation.addEventListener('click', requestLocation);
DOM.uploadArea.addEventListener('click', () => DOM.inputPhoto.click());
DOM.inputPhoto.addEventListener('change', handlePhotoSelect);
DOM.inputUsername.addEventListener('input', () => {
  DOM.usernameError.classList.remove('visible');
  validateOnboardingForm();
});
DOM.onboardingForm.addEventListener('submit', handleOnboardingSubmit);

// ── Navigation (desktop tabs) ──
DOM.navTabs.forEach(tab => {
  tab.addEventListener('click', () => switchAppView(tab.dataset.view));
});

// ── Navigation (mobile bottom nav) ──
DOM.mobileNavBtns.forEach(btn => {
  btn.addEventListener('click', () => switchAppView(btn.dataset.view));
});

// ── Voting ──
DOM.voteCardLeft.addEventListener('click', () => handleVote('left'));
DOM.voteCardRight.addEventListener('click', () => handleVote('right'));

// Keyboard support for voting cards
DOM.voteCardLeft.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleVote('left'); }
});
DOM.voteCardRight.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleVote('right'); }
});

DOM.btnSkip.addEventListener('click', () => {
  if (!votingCooldown) loadMatchup();
});

// ── Leaderboard tabs ──
DOM.lbTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const type = tab.dataset.lb;
    if (type === 'state') {
      activeState = DOM.stateSelect.value;
    }
    loadLeaderboard(type, false);
  });
});

// ── State selector ──
DOM.stateSelect.addEventListener('change', (e) => {
  activeState = e.target.value;
  if (activeState) {
    loadLeaderboard('state', false);
  }
});

// ── Refresh button ──
DOM.btnRefresh.addEventListener('click', handleRefresh);

// ============================================================
// INITIALIZATION
// ============================================================
// Auth state observer (registered above) handles routing automatically.
// No explicit init call needed — Firebase onAuthStateChanged fires on load.
console.log('%c⚡ Facemash Leaderboard loaded', 'color: #a855f7; font-weight: bold; font-size: 14px;');
