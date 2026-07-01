import { apiFetch, clearAuthSession, fetchCurrentUser, getAuthToken, getRecoveryPhrase, getStoredUser, setStoredUser } from './auth.js';
import { createLangPicker, createCollapsibleNumberedCircleGrid, hideAllLangPickerCarets } from './lang-picker.js';
import {
  buildPaintedMenuCircleHtml,
  clearCirclePaint,
  initProfileCirclePaint,
  loadCirclePaint,
  saveCirclePaint,
} from './profile-circle-paint.js';
import {
  addProfileSlot,
  canDeleteProfileSlot,
  deleteProfileSlot,
  loadProfileSlotNumbers,
  MAX_PROFILE_SLOTS,
} from './profile-slots.js';
import { $, escapeHtml } from './dom-utils.js';
import { createMicWave } from './mic-wave.js';
import { getRecordingMimeType } from './media-utils.js';
import { formatCloneVoiceLanguageList } from './elevenlabs-languages.js';
import {
  getProfileMenuSelectionStorageKey,
  loadActiveProfileSlot,
  voiceApiPath,
} from './profile-active-slot.js';
import { readProfileValue, writeProfileValue } from './profile-storage.js';
import { getVoicePrompt, getVoiceUi, resolveVoiceLanguage, VOICE_SAMPLE_TARGET } from './voice-prompts.js';

const profileMicWave = createMicWave();
let profileWaveRaf = null;

const USER_PROFILE_BADGES_HTML = `
    <span class="user-profile-badge user-profile-badge--plus">
      <svg viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    </span>
    <span class="user-profile-badge user-profile-badge--check">
      <svg viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M1.75 5.25 4 7.5 8.25 2.75" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>
    <span class="user-profile-badge user-profile-badge--close">
      <svg viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M2 5h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    </span>
`;

function loadProfileUserMenuSelection(userId) {
  if (!userId) return null;
  try {
    const raw = readProfileValue(getProfileMenuSelectionStorageKey(userId));
    if (!raw) return null;
    const number = Number(raw);
    return number >= 1 && number <= MAX_PROFILE_SLOTS ? number : null;
  } catch {
    return null;
  }
}

function saveProfileUserMenuSelection(userId, number) {
  if (!userId || !number) return;
  try {
    writeProfileValue(getProfileMenuSelectionStorageKey(userId), String(number));
  } catch {
    // ignore storage errors
  }
}

function buildProfileAvatarCircleContent(selection, sessionUserId) {
  if (!selection) {
    return '<span class="lang-picker-circle-bg user-profile-circle-bg" aria-hidden="true">🪪</span>';
  }
  const paint = sessionUserId ? loadCirclePaint(sessionUserId, selection) : '';
  if (paint) {
    const safeUrl = paint.replace(/'/g, '%27');
    return `<span class="lang-picker-circle-bg lang-picker-circle-bg--empty user-profile-paint-preview-bg" style="background-image:url('${safeUrl}')" aria-hidden="true"></span>`;
  }
  if (selection === 11) {
    return `
      <span class="lang-picker-circle-bg lang-picker-circle-bg--empty" aria-hidden="true"></span>
      <span class="lang-picker-circle-label lang-picker-circle-label--symbol">${PROFILE_USER_MENU_OPTION_11_SYMBOL}</span>
    `.trim();
  }
  return `
    <span class="lang-picker-circle-bg lang-picker-circle-bg--empty" aria-hidden="true"></span>
    <span class="lang-picker-circle-label">${escapeHtml(String(selection))}</span>
  `.trim();
}

function buildProfileAvatarCircleHtml(selection, sessionUserId, { badges = false } = {}) {
  const painted = selection && sessionUserId && loadCirclePaint(sessionUserId, selection);
  return `
    <span class="lang-picker-circle user-profile-circle${painted ? ' user-profile-avatar--painted' : ''}">
      ${buildProfileAvatarCircleContent(selection, sessionUserId)}
      ${badges ? USER_PROFILE_BADGES_HTML : ''}
    </span>
  `.trim();
}

const PROFILE_SWITCH_USER_ICON_SVG = `
  <svg class="user-profile-switch-user-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="9" cy="7" r="3.5"></circle>
    <path d="M2.5 19.5c0-3.2 2.8-5.5 6.5-5.5s6.5 2.3 6.5 5.5"></path>
    <circle cx="17.5" cy="8" r="2.5"></circle>
    <path d="M21 18.5c0-2.2-1.8-4-4-4"></path>
  </svg>
`;

const PROFILE_EDIT_USER_ICON_SVG = `
  <svg class="user-profile-edit-user-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 20h9"></path>
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
  </svg>
`;

function buildProfileCollapsibleUserTriggerHtml(selection) {
  const selectionLabel = selection ? String(selection) : '';
  return `
    <span class="lang-picker-circle user-profile-circle user-profile-switch-user-circle">
      <span class="lang-picker-circle-bg lang-picker-circle-bg--empty user-profile-switch-user-bg" aria-hidden="true"></span>
      <span class="lang-picker-circle-label lang-picker-circle-label--symbol user-profile-switch-user-glyph">${PROFILE_SWITCH_USER_ICON_SVG}</span>
      ${selectionLabel ? `<span class="user-profile-switch-user-number">${escapeHtml(selectionLabel)}</span>` : ''}
    </span>
  `.trim();
}

function buildProfileEditUserButtonHtml(selection, sessionUserId) {
  const painted = selection && sessionUserId && loadCirclePaint(sessionUserId, selection);
  const inner = selection
    ? buildProfileAvatarCircleContent(selection, sessionUserId)
    : '<span class="lang-picker-circle-bg lang-picker-circle-bg--empty user-profile-collapsible-empty-bg" aria-hidden="true"></span>';
  return `
    <span class="lang-picker-circle user-profile-circle user-profile-edit-user-circle${painted ? ' user-profile-avatar--painted' : ''}">
      ${inner}
      <span class="user-profile-badge user-profile-collapsible-badge user-profile-edit-user-badge" aria-hidden="true">${PROFILE_EDIT_USER_ICON_SVG}</span>
    </span>
  `.trim();
}

function syncProfileAvatarDisplay() {
  const user = getStoredUser();
  const userId = user?.id || '';
  const selection = profileUserMenuSelection;

  const trigger = $('#user-profile-trigger', rootEl);
  if (trigger) {
    trigger.innerHTML = buildProfileAvatarCircleHtml(selection, userId, { badges: true });
  }

  profileUserMenuPicker?.refreshTrigger?.();
  if (profileUserMenuPicker?.isExpanded?.()) {
    profileUserMenuPicker?.refresh?.();
  }

  const editBtn = $('#user-profile-edit-user-btn', rootEl);
  if (editBtn) {
    const userId = user?.id || '';
    editBtn.innerHTML = buildProfileEditUserButtonHtml(selection, userId);
    editBtn.disabled = !selection;
  }
}

function buildProfileCircleMarkup() {
  const user = getStoredUser();
  return buildProfileAvatarCircleHtml(profileUserMenuSelection, user?.id, { badges: true });
}

const PROFILE_SPEAK_AUDIO_ICON_SVG = `
  <svg class="user-profile-speak-audio-icon" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true">
    <path d="M204.055 213.905q-18.12-5.28-34.61-9a145.92 145.92 0 0 1-6.78-44.33c0-65.61 42.17-118.8 94.19-118.8 52.02 0 94.15 53.14 94.15 118.76a146.3 146.3 0 0 1-6.16 42.32q-20.52 4.3-43.72 11.05c-22 6.42-39.79 12.78-48.56 16.05-8.72-3.27-26.51-9.63-48.51-16.05zm-127.95 84.94a55.16 55.16 0 1 0 55.16 55.15 55.16 55.16 0 0 0-55.16-55.15zm359.79 0a55.16 55.16 0 1 0 55.16 55.15 55.16 55.16 0 0 0-55.15-55.15zm-71.15 55.15a71.24 71.24 0 0 1 42.26-65v-77.55c-64.49 0-154.44 35.64-154.44 35.64s-89.95-35.64-154.44-35.64v74.92a71.14 71.14 0 0 1 0 135.28v7c64.49 0 154.44 41.58 154.44 41.58s89.99-41.55 154.44-41.55v-9.68a71.24 71.24 0 0 1-42.26-65z"/>
  </svg>
`;

const PROFILE_CHECK_ICON = (className) => `
  <svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 13l4 4L19 7" />
  </svg>
`;

const PROFILE_RECORDING_MIC_SVG = `
  <svg class="compose-mic-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.03c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
  </svg>
`;

const PROFILE_RECORDING_ACCEPT_SVG = PROFILE_CHECK_ICON('compose-recording-send-icon');

const PROFILE_CLOSE_SESSION_ICON_SVG = `
  <svg class="user-profile-close-session-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.59L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
  </svg>
`;

const PROFILE_SHOW_SEED_ICON_SVG = `
  <svg class="user-profile-seed-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
  </svg>
`;

const PROFILE_HIDE_SEED_ICON_SVG = `
  <svg class="user-profile-seed-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
  </svg>
`;

const PROFILE_CREATE_ACCOUNT_ICON_SVG = `
  <svg class="user-profile-create-account-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
  </svg>
`;

const PROFILE_RECORDING_CANCEL_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
`;

const SUPER_USER_ID = 'u-super';
const VOICE_LANG_PREFIX = 'lingo-voice-lang:';

const PROFILE_OFFLINE_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'th', name: 'Thai' },
  { code: 'zh', name: 'Chinese' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'it', name: 'Italian' },
];

const PROFILE_VOICE_LANGUAGES = PROFILE_OFFLINE_LANGUAGES;

let rootEl = null;
let menuOpen = false;
let voiceProfile = null;
let recordingSession = null;
let creatingVoice = false;
let savingSample = false;
let onUserChange = null;
let showToastFn = () => {};
let profileLanguages = [];
let voiceLang = 'en';
const PROFILE_USER_MENU_OPTION_11_SYMBOL = '◎';

let profileUserMenuSelection = null;
let profileUserMenuPicker = null;
let profileUserGridOpen = false;
let paintEditSlotNumber = null;
let paintEditIsNew = false;
const draftProfileSlotKeys = new Set();
let option11PageOpen = false;
let voiceSamplesPageOpen = false;
let profileCirclePaint = null;

const MIN_SAMPLES = VOICE_SAMPLE_TARGET;

function toast(message) {
  showToastFn(message);
}

function getDisplayName(user) {
  return user?.name?.trim() || 'User';
}

function applyDisplayName(user) {
  return user;
}

function getCurrentProfileSlot() {
  const userId = getStoredUser()?.id;
  if (!userId) return null;
  return profileUserMenuSelection ?? loadProfileUserMenuSelection(userId) ?? loadActiveProfileSlot(userId);
}

function syncStoredUserVoiceState() {
  const user = getStoredUser();
  if (!user) return;
  const updated = {
    ...user,
    voiceReady: voiceProfile?.voiceReady ?? false,
    voiceSampleCount: voiceProfile?.sampleCount ?? 0,
    voiceStatus: voiceProfile?.status ?? 'none',
    activeProfileSlot: getCurrentProfileSlot(),
  };
  setStoredUser(updated);
  onUserChange?.(updated);
}

async function deleteProfileSlotVoice(sessionUserId, slotNumber) {
  if (!sessionUserId || !slotNumber) return;
  try {
    await apiFetch(voiceApiPath('/api/voice/profile', slotNumber), { method: 'DELETE' });
  } catch {
    // ignore network errors
  }
}

export function getActiveProfileSlotNumber() {
  return getCurrentProfileSlot();
}

function getVoiceLangStorageKey(userId, slotNumber) {
  return `${VOICE_LANG_PREFIX}${userId}:${slotNumber}`;
}

function loadVoiceLangPrefs(user, slotNumber = getCurrentProfileSlot()) {
  if (!user || !slotNumber) return;
  try {
    voiceLang = resolveVoiceLanguage(
      readProfileValue(getVoiceLangStorageKey(user.id, slotNumber))
      || readProfileValue(`${VOICE_LANG_PREFIX}${user.id}`)
      || readProfileValue(`${VOICE_LANG_PREFIX}primary:${user.id}`)
      || 'en',
    );
  } catch {
    voiceLang = 'en';
  }
}

function saveVoiceLangPref(userId, code, slotNumber = getCurrentProfileSlot()) {
  if (!userId || !slotNumber) return;
  try {
    writeProfileValue(getVoiceLangStorageKey(userId, slotNumber), resolveVoiceLanguage(code));
  } catch {
    // ignore storage errors
  }
}

function updateVoicePromptText() {
  const user = getStoredUser();
  if (!user) return;
  const page = $('#user-profile-voice-samples-page', rootEl);
  if (!page) return;
  const state = getProfileState(user);
  const prompt = getVoicePrompt(
    voiceLang,
    nextPromptIndex(state.sampleCount, state.maxSamples),
  );
  const el = $('.user-profile-prompt-text', page);
  if (el) el.textContent = `"${prompt}"`;
}

async function ensureProfileLanguages() {
  if (profileLanguages.length) return profileLanguages;
  try {
    const res = await apiFetch('/api/languages');
    if (!res.ok) throw new Error('Failed to load languages');
    profileLanguages = await res.json();
  } catch {
    profileLanguages = [...PROFILE_OFFLINE_LANGUAGES];
  }
  return profileLanguages;
}

function setupProfileLangPicker(root, user, langSlotId = 'user-profile-voice-samples-lang') {
  const slot = $(`#${langSlotId}`, root);
  if (!slot || !profileLanguages.length) return;

  slot.innerHTML = '';

  createLangPicker(slot, {
    languages: profileLanguages,
    value: voiceLang,
    circle: true,
    closeProfileOnOpen: false,
    onChange: (code) => {
      voiceLang = resolveVoiceLanguage(code);
      saveVoiceLangPref(user.id, code, getCurrentProfileSlot());
      renderMenuContent();
    },
    onFocusEdit: () => {
      hideAllLangPickerCarets();
    },
  });
}

function buildProfileMenuItems(sessionUserId) {
  const slotNumbers = loadProfileSlotNumbers(sessionUserId);
  const items = slotNumbers.map((number) => {
    const paint = loadCirclePaint(sessionUserId, number);
    return {
      key: number,
      ariaLabel: `User ${number}`,
      html: paint ? buildPaintedMenuCircleHtml(paint) : undefined,
      symbol: paint ? undefined : (number === 11 ? PROFILE_USER_MENU_OPTION_11_SYMBOL : String(number)),
    };
  });

  if (slotNumbers.length < MAX_PROFILE_SLOTS) {
    items.push({
      key: 'add',
      ariaLabel: 'Add user',
      symbol: '+',
      menuClass: 'user-profile-menu-add-option',
    });
  }

  return items;
}

function getDraftProfileSlotKey(sessionUserId, slotNumber) {
  return `${sessionUserId}:${slotNumber}`;
}

function isDraftProfileSlot(sessionUserId, slotNumber) {
  return draftProfileSlotKeys.has(getDraftProfileSlotKey(sessionUserId, slotNumber));
}

function openPaintEditor(slotNumber, { isNew = false } = {}) {
  paintEditSlotNumber = slotNumber;
  paintEditIsNew = isNew;
  setOption11PageOpen(true);
}

function handlePaintAccept(slotNumber) {
  const sessionUserId = getStoredUser()?.id;
  if (slotNumber && sessionUserId) {
    profileUserMenuSelection = slotNumber;
    saveProfileUserMenuSelection(sessionUserId, slotNumber);
    draftProfileSlotKeys.delete(getDraftProfileSlotKey(sessionUserId, slotNumber));
  }
  paintEditSlotNumber = null;
  paintEditIsNew = false;
  setOption11PageOpen(false);
  renderMenuContent();
  syncProfileAvatarDisplay();
}

function handlePaintCancel(slotNumber) {
  const sessionUserId = getStoredUser()?.id;
  if (paintEditIsNew && sessionUserId && slotNumber && !loadCirclePaint(sessionUserId, slotNumber)) {
    deleteProfileSlot(sessionUserId, slotNumber);
    draftProfileSlotKeys.delete(getDraftProfileSlotKey(sessionUserId, slotNumber));
  }
  paintEditSlotNumber = null;
  paintEditIsNew = false;
  setOption11PageOpen(false);
  renderMenuContent();
  syncProfileAvatarDisplay();
}

function handlePaintErase() {
  renderMenuContent();
  syncProfileAvatarDisplay();
}

function handlePaintDelete(slotNumber) {
  const sessionUserId = getStoredUser()?.id;
  if (!sessionUserId || !slotNumber) return;

  clearCirclePaint(sessionUserId, slotNumber);
  if (!deleteProfileSlot(sessionUserId, slotNumber)) {
    toast('Cannot delete the last user');
    return;
  }

  void deleteProfileSlotVoice(sessionUserId, slotNumber);

  if (profileUserMenuSelection === slotNumber) {
    const remaining = loadProfileSlotNumbers(sessionUserId);
    profileUserMenuSelection = remaining[0] ?? null;
    if (profileUserMenuSelection) {
      saveProfileUserMenuSelection(sessionUserId, profileUserMenuSelection);
    }
  }

  paintEditSlotNumber = null;
  paintEditIsNew = false;
  profileUserGridOpen = true;
  setOption11PageOpen(false);
  renderMenuContent();
  syncProfileAvatarDisplay();
}

function handleAddProfileUser() {
  const sessionUserId = getStoredUser()?.id;
  if (!sessionUserId) return;

  const slotNumber = addProfileSlot(sessionUserId);
  if (!slotNumber) {
    toast('User limit reached');
    return;
  }

  profileUserMenuSelection = slotNumber;
  saveProfileUserMenuSelection(sessionUserId, slotNumber);
  draftProfileSlotKeys.add(getDraftProfileSlotKey(sessionUserId, slotNumber));
  profileUserGridOpen = true;
  renderMenuContent();
  syncProfileAvatarDisplay();
}

function setupProfileUserGrid(panel) {
  const triggerSlot = $('#user-profile-user-trigger', panel);
  const panelSlot = $('#user-profile-user-panel', panel);
  if (!triggerSlot || !panelSlot) return;

  triggerSlot.innerHTML = '';
  panelSlot.innerHTML = '';

  const user = getStoredUser();
  const sessionUserId = user?.id || '';
  if (sessionUserId && profileUserMenuSelection === null) {
    profileUserMenuSelection = loadProfileUserMenuSelection(sessionUserId);
  }
  const slotNumbers = loadProfileSlotNumbers(sessionUserId);
  if (profileUserMenuSelection && !slotNumbers.includes(profileUserMenuSelection)) {
    profileUserMenuSelection = slotNumbers[0] ?? null;
  }

  const menuItems = buildProfileMenuItems(sessionUserId);

  profileUserMenuPicker = createCollapsibleNumberedCircleGrid(triggerSlot, {
    panelContainer: panelSlot,
    items: menuItems,
    value: profileUserMenuSelection,
    open: profileUserGridOpen,
    onOpenChange: (open) => {
      profileUserGridOpen = open;
    },
    getTriggerHtml: ({ selected }) => (
      buildProfileCollapsibleUserTriggerHtml(selected)
    ),
    onChange: (number) => {
      if (recordingSession) cancelVoiceSampleRecording();
      profileUserMenuSelection = number;
      saveProfileUserMenuSelection(sessionUserId, number);
      syncProfileAvatarDisplay();
      loadVoiceLangPrefs(getStoredUser(), number);
      void refreshVoiceProfile();
    },
    onOptionAction: (key) => {
      if (key === 'add') {
        handleAddProfileUser();
        return true;
      }
      return false;
    },
  });
}

function setOption11PageOpen(open) {
  option11PageOpen = open;
  const page = $('#user-profile-option11-page', rootEl);
  if (page) page.hidden = !open;
  if (open) {
    if (voiceSamplesPageOpen) setVoiceSamplesPageOpen(false);
    profileUserMenuPicker?.close?.();
    window.dispatchEvent(new CustomEvent('lingo:close-lang-pickers'));
    profileCirclePaint?.syncActionButtons?.();
    profileCirclePaint?.open();
  } else {
    profileCirclePaint?.close();
    paintEditSlotNumber = null;
    paintEditIsNew = false;
  }
}

function setVoiceSamplesPageOpen(open) {
  const wasOpen = voiceSamplesPageOpen;
  voiceSamplesPageOpen = open;
  const page = $('#user-profile-voice-samples-page', rootEl);
  if (page) page.hidden = !open;
  if (open) {
    if (option11PageOpen) setOption11PageOpen(false);
    window.dispatchEvent(new CustomEvent('lingo:close-lang-pickers'));
    void renderVoiceSamplesPage();
  } else if (wasOpen && recordingSession) {
    cancelVoiceSampleRecording();
  }
}

function nextPromptIndex(sampleCount, maxSamples = MIN_SAMPLES) {
  return Math.min(sampleCount, maxSamples - 1);
}

function getProfileState(user) {
  const maxSamples = voiceProfile?.maxSamples ?? MIN_SAMPLES;
  const sampleCount = voiceProfile?.sampleCount ?? user?.voiceSampleCount ?? 0;
  const canRecordMore = voiceProfile?.canRecordMore ?? sampleCount < maxSamples;
  return {
    maxSamples,
    sampleCount,
    canRecordMore,
    voiceReady: voiceProfile?.voiceReady ?? user?.voiceReady ?? false,
    status: voiceProfile?.status ?? user?.voiceStatus ?? 'none',
    elevenlabsConfigured: voiceProfile?.elevenlabsConfigured !== false,
    samplesComplete: sampleCount >= maxSamples,
  };
}

function discardActiveRecording() {
  const session = recordingSession;
  if (!session) return;

  recordingSession = null;
  teardownProfileRecordingWave();
  try {
    if (session.recorder.state !== 'inactive') session.recorder.stop();
  } catch {
    // ignore stop errors when discarding
  }
  session.stream.getTracks().forEach((track) => track.stop());
}

function getProfileRecordingToolbar() {
  const page = $('#user-profile-voice-samples-page', rootEl);
  const levelEl = $('#user-voice-level', page);
  const toolbar = levelEl?.closest('.user-profile-recording-toolbar');
  return { page, levelEl, toolbar };
}

function startProfileWaveLoop() {
  cancelAnimationFrame(profileWaveRaf);
  const tick = () => {
    if (!recordingSession) return;
    const { levelEl, toolbar } = getProfileRecordingToolbar();
    profileMicWave.applyMicVoicePulse(levelEl, toolbar);
    profileWaveRaf = requestAnimationFrame(tick);
  };
  profileWaveRaf = requestAnimationFrame(tick);
}

function stopProfileWaveLoop() {
  if (profileWaveRaf) cancelAnimationFrame(profileWaveRaf);
  profileWaveRaf = null;
}

function setupProfileRecordingWave() {
  requestAnimationFrame(() => {
    if (!recordingSession) return;
    const { levelEl, toolbar } = getProfileRecordingToolbar();
    profileMicWave.ensureLevelBars(levelEl, toolbar, true);
    profileMicWave.observeWaveResize(levelEl, toolbar, () => Boolean(recordingSession));
    startProfileWaveLoop();
  });
}

function teardownProfileRecordingWave() {
  stopProfileWaveLoop();
  profileMicWave.unobserveWaveResize();
  profileMicWave.teardownMicMeter();
}

function stopMediaRecorder(recorder) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Recording stop timed out — try again')), 8000);
    const finish = (err) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    recorder.addEventListener('stop', () => finish(), { once: true });
    recorder.addEventListener('error', () => finish(new Error('Recording failed')), { once: true });

    if (recorder.state === 'recording') {
      try {
        recorder.requestData();
      } catch {
        // not supported in every browser
      }
      recorder.stop();
    } else if (recorder.state === 'inactive') {
      finish();
    }
  });
}

async function maybeEnsureVoiceConfigured() {
  const user = getStoredUser();
  if (!user || creatingVoice || recordingSession || savingSample) return;

  const state = getProfileState(user);
  if (state.samplesComplete && state.elevenlabsConfigured && !state.voiceReady) {
    await createVoiceProfile(false);
  }
}

function buildVoiceRecordingMarkup({
  ui,
  prompt,
  isRecording,
  recordingAtLimit,
  showRecord,
  savingSample,
}) {
  return `
    ${recordingAtLimit ? `<p class="user-profile-note">${ui.recordingBlocked}</p>` : ''}

    ${showRecord || (isRecording && !recordingAtLimit) ? `
    <div class="user-profile-prompt">
      <div class="user-profile-prompt-line">
        <div class="user-profile-prompt-label" title="${escapeHtml(ui.readNext)}" aria-label="${escapeHtml(ui.readNext)}">
          ${PROFILE_SPEAK_AUDIO_ICON_SVG}
        </div>
        <p class="user-profile-prompt-text">"${escapeHtml(prompt)}"</p>
      </div>
    </div>
    ` : ''}

    <div class="user-profile-actions${isRecording ? ' user-profile-actions--recording' : ''}">
      ${isRecording ? `
      <div class="compose-toolbar user-profile-recording-toolbar">
        <div class="compose-toolbar-left">
          <button
            type="button"
            class="compose-recording-cancel"
            id="user-voice-cancel-btn"
            title="${escapeHtml(ui.cancelRecording)}"
            aria-label="${escapeHtml(ui.cancelRecording)}"
            ${savingSample ? 'disabled' : ''}
          >
            ${PROFILE_RECORDING_CANCEL_SVG}
          </button>
        </div>
        <div class="compose-toolbar-center">
          <div class="compose-level" id="user-voice-level" aria-hidden="true"></div>
        </div>
        <div class="compose-toolbar-right">
          <button
            type="button"
            class="compose-recording-send user-profile-recording-accept"
            id="user-voice-stop-btn"
            title="${escapeHtml(ui.stopSample)}"
            aria-label="${escapeHtml(ui.stopSample)}"
            ${savingSample ? 'disabled' : ''}
          >
            ${PROFILE_RECORDING_ACCEPT_SVG}
          </button>
        </div>
      </div>
      ` : showRecord ? `
      <div class="user-profile-mic-action">
        <button
          type="button"
          class="user-profile-record-mic user-profile-record-mic--solo"
          id="user-voice-record-btn"
          title="${escapeHtml(ui.recordSample)}"
          aria-label="${escapeHtml(ui.recordSample)}"
        >
          ${PROFILE_RECORDING_MIC_SVG}
        </button>
      </div>
      ` : ''}
    </div>
  `;
}

function bindVoiceRecordingControls(root) {
  $('#user-voice-record-btn', root)?.addEventListener('click', () => void startVoiceSampleRecording());
  $('#user-voice-stop-btn', root)?.addEventListener('click', () => void stopVoiceSampleRecording());
  $('#user-voice-cancel-btn', root)?.addEventListener('click', () => cancelVoiceSampleRecording());
}

async function renderVoiceSamplesPage() {
  const user = getStoredUser();
  const page = $('#user-profile-voice-samples-page', rootEl);
  const main = $('#user-profile-voice-samples-main', page);
  if (!page || !main || !user) return;

  await ensureProfileLanguages();
  loadVoiceLangPrefs(user);
  const ui = getVoiceUi(voiceLang);
  const state = getProfileState(user);
  const { maxSamples, sampleCount, canRecordMore } = state;
  const prompt = getVoicePrompt(voiceLang, nextPromptIndex(sampleCount, maxSamples));
  const isRecording = Boolean(recordingSession);
  const recordingAtLimit = isRecording && !canRecordMore;
  const showRecord = canRecordMore && !isRecording && !creatingVoice && !savingSample;

  main.innerHTML = buildVoiceRecordingMarkup({
    ui,
    prompt,
    isRecording,
    recordingAtLimit,
    showRecord,
    savingSample,
  });

  bindVoiceRecordingControls(page);
  setupProfileLangPicker(page, user);
  if (isRecording) setupProfileRecordingWave();
}

async function renderMenuContent() {
  const user = getStoredUser();
  const panel = $('#user-profile-panel', rootEl);
  if (!panel || !user) return;

  await ensureProfileLanguages();
  loadVoiceLangPrefs(user);
  const ui = getVoiceUi(voiceLang);
  const state = getProfileState(user);
  const { maxSamples, sampleCount } = state;
  const savedCount = Math.min(sampleCount, maxSamples);
  const cloneLanguageList = formatCloneVoiceLanguageList(voiceLang);

  panel.innerHTML = `
    <div class="user-profile-layout">
      <div class="user-profile-top-row user-profile-top-row--split">
        <div class="user-profile-top-row-left">
          <button
            type="button"
            class="user-profile-header-circle user-profile-samples-circle lang-bar-circle-slot"
            id="user-profile-samples-btn"
            title="${escapeHtml(ui.samplesSaved)}"
            aria-label="${escapeHtml(ui.samplesSaved)}: ${savedCount}/${maxSamples}"
          >
            <span class="user-profile-samples-circle-count">${savedCount}/${maxSamples}</span>
          </button>
          <div
            class="user-profile-user-trigger-slot lang-bar-circle-slot"
            id="user-profile-user-trigger"
          ></div>
        </div>
        <button
          type="button"
          class="user-profile-header-circle user-profile-edit-user-btn lang-bar-circle-slot"
          id="user-profile-edit-user-btn"
          title="${escapeHtml(ui.editUser)}"
          aria-label="${escapeHtml(ui.editUser)}"
        ></button>
      </div>
      <div
        class="user-profile-user-panel-slot"
        id="user-profile-user-panel"
        hidden
      ></div>

    <div class="user-profile-session-area">
      <div class="user-profile-session-bar">
        <button
          type="button"
          class="user-profile-session-toggle"
          id="user-profile-session-toggle"
          aria-expanded="false"
          aria-controls="user-profile-session-row"
          aria-label="Session options"
        >&gt;_</button>
        <div class="user-profile-session-row" id="user-profile-session-row" hidden>
          <div class="user-profile-session-drawer" id="user-profile-session-drawer">
            ${user.id === SUPER_USER_ID ? `
            <button
              type="button"
              class="user-profile-create-account user-profile-session-icon-btn"
              id="user-profile-create-account"
              title="${escapeHtml(ui.createAccount)}"
              aria-label="${escapeHtml(ui.createAccount)}"
            >${PROFILE_CREATE_ACCOUNT_ICON_SVG}</button>
            ` : ''}
            <button
              type="button"
              class="user-profile-recovery-btn user-profile-session-icon-btn"
              id="user-profile-recovery-toggle"
              title="${escapeHtml(ui.showRecoveryPhrase)}"
              aria-label="${escapeHtml(ui.showRecoveryPhrase)}"
            >${PROFILE_SHOW_SEED_ICON_SVG}</button>
          </div>
          <span class="user-profile-session-spacer" aria-hidden="true"></span>
          <div class="user-profile-session-end">
            <button
              type="button"
              class="user-profile-clone-languages-toggle user-profile-session-icon-btn"
              id="user-profile-clone-languages-toggle"
              aria-expanded="false"
              aria-controls="user-profile-clone-languages-text"
              title="${escapeHtml(ui.showCloneVoiceLanguages)}"
              aria-label="${escapeHtml(ui.showCloneVoiceLanguages)}"
            >*</button>
            <button
              type="button"
              class="user-profile-signout user-profile-session-icon-btn"
              id="user-profile-signout"
              title="${escapeHtml(ui.switchUser)}"
              aria-label="${escapeHtml(ui.switchUser)}"
            >
              ${PROFILE_CLOSE_SESSION_ICON_SVG}
            </button>
          </div>
        </div>
      </div>
      <p
        class="user-profile-clone-languages-text"
        id="user-profile-clone-languages-text"
        hidden
      >
        <span class="user-profile-clone-languages-label">${escapeHtml(ui.cloneVoiceLanguagesFootnote)}:</span>
        ${escapeHtml(cloneLanguageList)}
      </p>
      <p class="user-profile-recovery-text" id="user-profile-recovery-text" hidden></p>
      <p class="user-profile-recovery-text user-profile-admin-seed" id="user-profile-admin-seed" hidden></p>
    </div>
    </div>
  `;

  $('#user-profile-samples-btn', panel)?.addEventListener('click', () => setVoiceSamplesPageOpen(true));
  $('#user-profile-edit-user-btn', panel)?.addEventListener('click', () => {
    const sessionUserId = getStoredUser()?.id;
    if (!profileUserMenuSelection || !sessionUserId) return;
    openPaintEditor(profileUserMenuSelection, {
      isNew: isDraftProfileSlot(sessionUserId, profileUserMenuSelection),
    });
  });
  $('#user-profile-signout', panel)?.addEventListener('click', () => signOut());
  $('#user-profile-create-account', panel)?.addEventListener('click', () => void createAdminAccount(panel));

  const sessionRow = $('#user-profile-session-row', panel);
  const sessionToggle = $('#user-profile-session-toggle', panel);
  const recoveryToggle = $('#user-profile-recovery-toggle', panel);
  const recoveryText = $('#user-profile-recovery-text', panel);
  const cloneLangToggle = $('#user-profile-clone-languages-toggle', panel);
  const cloneLangText = $('#user-profile-clone-languages-text', panel);

  const setCloneLanguagesOpen = (open) => {
    if (!cloneLangToggle || !cloneLangText) return;
    cloneLangText.hidden = !open;
    cloneLangToggle.setAttribute('aria-expanded', String(open));
    cloneLangToggle.title = open ? ui.hideCloneVoiceLanguages : ui.showCloneVoiceLanguages;
    cloneLangToggle.setAttribute('aria-label', open ? ui.hideCloneVoiceLanguages : ui.showCloneVoiceLanguages);
  };

  sessionToggle?.addEventListener('click', () => {
    const opening = sessionRow?.hidden;
    if (!sessionRow || !sessionToggle) return;

    sessionRow.hidden = !opening;
    sessionToggle.setAttribute('aria-expanded', String(opening));

    if (!opening) {
      setCloneLanguagesOpen(false);
      if (recoveryText) {
        recoveryText.hidden = true;
        recoveryText.textContent = '';
      }
      const adminSeed = $('#user-profile-admin-seed', panel);
      if (adminSeed) {
        adminSeed.hidden = true;
        adminSeed.textContent = '';
      }
      setRecoveryToggleUi(recoveryToggle, voiceLang, false);
    }
  });

  cloneLangToggle?.addEventListener('click', () => {
    setCloneLanguagesOpen(cloneLangText?.hidden);
  });

  recoveryToggle?.addEventListener('click', () => {
    const uiStrings = getVoiceUi(voiceLang);
    const visible = !recoveryText?.hidden;
    if (visible) {
      recoveryText.hidden = true;
      recoveryText.textContent = '';
      setRecoveryToggleUi(recoveryToggle, voiceLang, false);
      return;
    }

    const phrase = getRecoveryPhrase(user.id) || getAuthToken() || '';
    if (!phrase) {
      recoveryText.textContent = uiStrings.recoveryPhraseMissing;
    } else {
      recoveryText.textContent = phrase;
    }
    recoveryText.hidden = false;
    setRecoveryToggleUi(recoveryToggle, voiceLang, true);
  });

  setupProfileUserGrid(panel);
  syncProfileAvatarDisplay();
  if (voiceSamplesPageOpen) {
    await renderVoiceSamplesPage();
  }
}

async function createAdminAccount(panel) {
  const uiStrings = getVoiceUi(voiceLang);
  const button = $('#user-profile-create-account', panel);
  const adminSeed = $('#user-profile-admin-seed', panel);
  const recoveryText = $('#user-profile-recovery-text', panel);
  if (button) button.disabled = true;

  try {
    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || uiStrings.createAccountFailed);
      return;
    }

    if (recoveryText) {
      recoveryText.hidden = true;
      recoveryText.textContent = '';
    }
    if (adminSeed) {
      adminSeed.textContent = data.recoveryPhrase || '';
      adminSeed.hidden = !data.recoveryPhrase;
    }
  } catch {
    window.alert(uiStrings.createAccountFailed);
  } finally {
    if (button) button.disabled = false;
  }
}

function setRecoveryToggleUi(recoveryToggle, voiceLang, showingPhrase) {
  if (!recoveryToggle) return;
  const uiStrings = getVoiceUi(voiceLang);
  recoveryToggle.innerHTML = showingPhrase
    ? PROFILE_HIDE_SEED_ICON_SVG
    : PROFILE_SHOW_SEED_ICON_SVG;
  const label = showingPhrase ? uiStrings.hideRecoveryPhrase : uiStrings.showRecoveryPhrase;
  recoveryToggle.setAttribute('aria-label', label);
  recoveryToggle.setAttribute('title', label);
}

function getTriggerVisualState(user) {
  if (menuOpen) return 'open';
  const { samplesComplete, voiceReady } = getProfileState(user);
  if (voiceReady || samplesComplete) return 'ready';
  return 'setup';
}

function updateTrigger() {
  const user = getStoredUser();
  const trigger = $('#user-profile-trigger', rootEl);
  if (!trigger) return;

  const visual = getTriggerVisualState(user);
  trigger.dataset.visual = visual;

  const name = getDisplayName(user) || 'User';

  const labels = {
    open: `Close ${name} profile`,
    ready: `Close ${name} profile`,
    setup: `Open ${name} profile`,
  };
  trigger.title = labels[visual];
  trigger.setAttribute('aria-label', labels[visual]);
  syncProfileAvatarDisplay();
}

function setMenuOpen(open) {
  menuOpen = open;
  if (!open) {
    if (recordingSession) cancelVoiceSampleRecording();
    setOption11PageOpen(false);
    setVoiceSamplesPageOpen(false);
    profileUserMenuPicker?.close?.();
    profileUserGridOpen = false;
  }
  rootEl?.classList.toggle('is-open', open);
  const trigger = $('#user-profile-trigger', rootEl);
  const panel = $('#user-profile-panel', rootEl);
  trigger?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (panel) panel.hidden = !open;
  if (open) {
    window.dispatchEvent(new CustomEvent('lingo:close-lang-pickers'));
  }
  updateTrigger();
}

async function refreshVoiceProfile() {
  const slot = getCurrentProfileSlot();
  if (!slot) return;

  const res = await apiFetch(voiceApiPath('/api/voice/profile', slot));
  if (!res.ok) return;
  voiceProfile = await res.json();

  const user = getStoredUser();
  const state = getProfileState(user);
  if (!state.canRecordMore && recordingSession) {
    discardActiveRecording();
    toast(`Extra recording discarded — you already have ${state.maxSamples} samples`);
  }

  syncStoredUserVoiceState();
  renderMenuContent();
  updateTrigger();
  await maybeEnsureVoiceConfigured();
}

async function fetchCurrentUserForSlot(slot) {
  const res = await apiFetch(voiceApiPath('/api/me', slot));
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  if (!data.user) return null;
  setStoredUser(data.user);
  return data;
}

export async function refreshUserSession() {
  const user = getStoredUser();
  const slot = getCurrentProfileSlot() ?? loadActiveProfileSlot(user?.id);
  const data = slot ? await fetchCurrentUserForSlot(slot) : await fetchCurrentUser();
  if (data?.user) {
    setStoredUser(applyDisplayName(data.user));
    profileUserMenuSelection = loadProfileUserMenuSelection(data.user.id) ?? slot;
    voiceProfile = data.voiceProfile ? {
      ...data.voiceProfile,
      samples: data.voiceProfile.samples || [],
    } : null;
    syncStoredUserVoiceState();
    if (!voiceProfile) {
      await refreshVoiceProfile();
    } else {
      renderMenuContent();
      updateTrigger();
    }
  }
  updateTrigger();
  onUserChange?.(getStoredUser());
}

async function startVoiceSampleRecording() {
  if (recordingSession) return;

  const user = getStoredUser();
  const maxSamples = voiceProfile?.maxSamples ?? MIN_SAMPLES;
  const sampleCount = voiceProfile?.sampleCount ?? user?.voiceSampleCount ?? 0;
  const canRecordMore = voiceProfile?.canRecordMore ?? sampleCount < maxSamples;
  if (!canRecordMore) {
    toast(`You already have ${maxSamples} voice samples`);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const mimeType = getRecordingMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    const chunks = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recordingSession = {
      stream,
      recorder,
      chunks,
      mimeType: recorder.mimeType || mimeType || 'audio/webm',
      startedAt: Date.now(),
    };

    recorder.start(250);
    profileMicWave.primeMicAudioOnGesture();
    profileMicWave.prepareMicMeter(stream);
    renderMenuContent();
    setupProfileRecordingWave();
  } catch {
    toast('Microphone access is required to record voice samples');
  }
}

function cancelVoiceSampleRecording() {
  discardActiveRecording();
  renderMenuContent();
}

async function stopVoiceSampleRecording() {
  const session = recordingSession;
  if (!session || savingSample) return;

  const user = getStoredUser();
  const state = getProfileState(user);
  if (!state.canRecordMore) {
    cancelVoiceSampleRecording();
    toast(`You already have ${state.maxSamples} samples`);
    return;
  }

  savingSample = true;
  renderMenuContent();

  try {
    await stopMediaRecorder(session.recorder);
    teardownProfileRecordingWave();
    session.stream.getTracks().forEach((track) => track.stop());
    recordingSession = null;

    const durationMs = Date.now() - session.startedAt;
    if (durationMs < 1200) {
      toast('Record a little longer — at least 2 seconds');
      return;
    }

    const blob = new Blob(session.chunks, { type: session.mimeType });
    if (!blob.size) {
      toast('No audio captured — try again');
      return;
    }

    const form = new FormData();
    form.append('audio', blob, `voice-sample.${session.mimeType.includes('mp4') ? 'mp4' : 'webm'}`);

    const res = await apiFetch(voiceApiPath('/api/voice/samples', getCurrentProfileSlot()), {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || 'Could not save voice sample');
      renderMenuContent();
      return;
    }

    toast('Voice sample saved');
    await refreshUserSession();

    if (data.readyForClone && voiceProfile?.elevenlabsConfigured !== false && !getStoredUser()?.voiceReady) {
      await createVoiceProfile(false);
    }
  } catch (err) {
    toast(err.message || 'Could not save voice sample');
    renderMenuContent();
  } finally {
    savingSample = false;
    if (recordingSession) discardActiveRecording();
    else teardownProfileRecordingWave();
    session.stream.getTracks().forEach((track) => track.stop());
    renderMenuContent();
  }
}

async function resetAllVoiceSamples() {
  if (recordingSession || savingSample || creatingVoice) return;

  const user = getStoredUser();
  const ui = getVoiceUi(user?.nativeLanguage);
  if (!window.confirm(ui.confirmRecordAgain)) return;

  const res = await apiFetch(voiceApiPath('/api/voice/samples', getCurrentProfileSlot()), { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast(data.error || 'Could not reset samples');
    return;
  }
  toast(ui.recordAgain);
  await refreshUserSession();
}

async function createVoiceProfile(isUpdate) {
  if (creatingVoice) return;
  creatingVoice = true;
  renderMenuContent();

  try {
    const res = await apiFetch(voiceApiPath('/api/voice/create', getCurrentProfileSlot()), { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || 'Could not create voice profile');
      renderMenuContent();
      return;
    }
    toast(isUpdate ? 'Voice profile updated' : 'Personal voice ready');
    await refreshUserSession();
  } catch (err) {
    toast(err.message || 'Could not create voice profile');
    renderMenuContent();
  } finally {
    creatingVoice = false;
    renderMenuContent();
  }
}

function signOut() {
  const user = getStoredUser();
  discardActiveRecording();
  clearAuthSession(user?.id);
  setMenuOpen(false);
  window.dispatchEvent(new CustomEvent('lingo:unauthorized'));
}

function bindMenuEvents() {
  const trigger = $('#user-profile-trigger', rootEl);
  const panel = $('#user-profile-panel', rootEl);

  trigger?.addEventListener('click', async (event) => {
    event.stopPropagation();
    const nextOpen = !menuOpen;
    setMenuOpen(nextOpen);
    if (nextOpen) {
      await ensureProfileLanguages();
      await refreshVoiceProfile();
      await renderMenuContent();
    }
  });

  panel?.addEventListener('pointerdown', (event) => {
    if (event.target.closest(
      'button, a, input, textarea, select, .lang-picker, .lang-picker-circle-trigger, .lang-picker-circle-option, .user-profile-header-circle, .lang-picker-collapsible-user-trigger, .user-profile-user-panel-slot, .user-profile-edit-user-btn'
    )) {
      return;
    }
    setMenuOpen(false);
  });

  document.addEventListener('pointerdown', (event) => {
    if (menuOpen && rootEl && !rootEl.contains(event.target)) {
      setMenuOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && recordingSession) {
      cancelVoiceSampleRecording();
      return;
    }
    if (event.key === 'Escape' && option11PageOpen) {
      event.stopPropagation();
      handlePaintCancel(paintEditSlotNumber);
      return;
    }
    if (event.key === 'Escape' && voiceSamplesPageOpen) {
      event.stopPropagation();
      setVoiceSamplesPageOpen(false);
      return;
    }
    if (event.key === 'Escape' && profileUserMenuPicker?.isExpanded?.()) {
      event.stopPropagation();
      profileUserMenuPicker.close();
      profileUserGridOpen = false;
      return;
    }
    if (event.key === 'Escape' && menuOpen) {
      const openInnerPanel = panel?.querySelector('.lang-picker-circle-panel:not([hidden])');
      if (openInnerPanel) return;
      setMenuOpen(false);
      trigger?.focus();
    }
  });

  const option11Page = $('#user-profile-option11-page', rootEl);
  option11Page?.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });

  const voiceSamplesPage = $('#user-profile-voice-samples-page', rootEl);
  voiceSamplesPage?.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });

  $('#user-profile-voice-samples-back', rootEl)?.addEventListener('click', (event) => {
    event.stopPropagation();
    setVoiceSamplesPageOpen(false);
  });
}

export function initUserProfile(slotEl, { onChange, showToast } = {}) {
  if (!slotEl) return;
  onUserChange = onChange;
  showToastFn = showToast || (() => {});
  rootEl = document.createElement('div');
  rootEl.className = 'user-profile';
  rootEl.innerHTML = `
    <button type="button" class="user-profile-trigger" id="user-profile-trigger" data-visual="setup" aria-haspopup="true" aria-expanded="false">
      ${buildProfileCircleMarkup()}
    </button>
    <div class="user-profile-panel" id="user-profile-panel" hidden></div>
    <div class="user-profile-option11-page" id="user-profile-option11-page" hidden>
      <div class="user-profile-option11-main">
        <div class="user-profile-option11-circle">
          <canvas
            class="user-profile-option11-canvas"
            id="user-profile-option11-canvas"
            aria-label="Paint circle"
          ></canvas>
        </div>
        <div class="user-profile-option11-palette" id="user-profile-option11-palette"></div>
      </div>
      <div class="user-profile-option11-footer">
        <div class="user-profile-option11-erase-row">
          <div class="user-profile-option11-action">
            <button
              type="button"
              class="user-profile-option11-erase"
              id="user-profile-option11-erase"
              aria-label="Erase painting"
              title="Erase drawing"
            >
              <span class="lang-picker-circle">
                <span class="lang-picker-circle-bg lang-picker-circle-bg--empty" aria-hidden="true"></span>
                <span class="lang-picker-circle-label lang-picker-circle-label--symbol">⌫</span>
              </span>
            </button>
            <span class="user-profile-option11-action-caption">Erase</span>
          </div>
          <div class="user-profile-option11-action user-profile-option11-action--delete" id="user-profile-option11-delete-wrap" hidden>
            <button
              type="button"
              class="user-profile-option11-delete"
              id="user-profile-option11-delete"
              aria-label="Delete user"
              title="Delete user account"
            >
              <span class="lang-picker-circle">
                <span class="lang-picker-circle-bg lang-picker-circle-bg--empty" aria-hidden="true"></span>
                <span class="lang-picker-circle-label lang-picker-circle-label--symbol user-profile-option11-delete-x">×</span>
              </span>
            </button>
            <span class="user-profile-option11-action-caption user-profile-option11-action-caption--delete">Delete user</span>
          </div>
        </div>
        <div class="user-profile-option11-confirm-row">
          <button
            type="button"
            class="user-profile-option11-cancel"
            id="user-profile-option11-cancel"
            aria-label="Cancel"
            title="Cancel"
          >×</button>
          <button
            type="button"
            class="user-profile-option11-accept"
            id="user-profile-option11-accept"
            aria-label="Save and close"
            title="Save"
          >✓</button>
        </div>
      </div>
    </div>
    <div class="user-profile-voice-samples-page" id="user-profile-voice-samples-page" hidden>
      <button
        type="button"
        class="user-profile-voice-samples-back"
        id="user-profile-voice-samples-back"
        aria-label="Go back"
      >←</button>
      <div class="user-profile-voice-samples-layout">
        <div class="user-profile-voice-samples-top">
          <div
            class="user-profile-lang-slot user-profile-prompt-lang lang-bar-circle-slot"
            id="user-profile-voice-samples-lang"
          ></div>
        </div>
        <div class="user-profile-voice-samples-main" id="user-profile-voice-samples-main"></div>
      </div>
    </div>
  `;
  slotEl.appendChild(rootEl);

  profileCirclePaint = initProfileCirclePaint($('#user-profile-option11-page', rootEl), {
    getSessionUserId: () => getStoredUser()?.id || '',
    getSlotNumber: () => paintEditSlotNumber,
    canDeleteSlot: (sessionUserId, slotNumber) => canDeleteProfileSlot(sessionUserId, slotNumber),
    onAccept: (slotNumber) => handlePaintAccept(slotNumber),
    onCancel: (slotNumber) => handlePaintCancel(slotNumber),
    onErase: () => handlePaintErase(),
    onDelete: (slotNumber) => handlePaintDelete(slotNumber),
  });

  const user = getStoredUser();
  profileUserMenuSelection = loadProfileUserMenuSelection(user?.id);

  bindMenuEvents();
  window.addEventListener('lingo:close-profile-menu', () => setMenuOpen(false));
  void ensureProfileLanguages();
  updateTrigger();
  renderMenuContent();
}
