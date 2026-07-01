import { $ } from './dom-utils.js';
import { removeKey } from './auth-storage.js';
import { readProfileValue, writeProfileValue } from './profile-storage.js';

const PAINT_COLOR_ROWS = [
  [
    { color: '#ffffff', label: 'White' },
    { color: '#000000', label: 'Black', className: 'user-profile-option11-color--black' },
    { color: '#ff2d2d', label: 'Red' },
    { color: '#ffe600', label: 'Yellow' },
  ],
  [
    { color: '#2aeb6c', label: 'Green' },
    { color: '#0066ff', label: 'Blue' },
  ],
];

const BRUSH_SIZE = 56;
const RING_COLOR = '#dffce9';
const RING_FRACTION = 0.03;

export function getCirclePaintStorageKey(sessionUserId, slotNumber) {
  return `lingo-profile-circle-paint:${sessionUserId}:${slotNumber}`;
}

function getLegacyCirclePaintStorageKey(sessionUserId) {
  return `lingo-profile-circle-paint:${sessionUserId}`;
}

export function loadCirclePaint(sessionUserId, slotNumber) {
  if (!sessionUserId || !slotNumber) return '';
  try {
    const key = getCirclePaintStorageKey(sessionUserId, slotNumber);
    let data = readProfileValue(key) || '';
    if (!data && slotNumber === 11) {
      const legacy = readProfileValue(getLegacyCirclePaintStorageKey(sessionUserId));
      if (legacy) {
        writeProfileValue(key, legacy);
        void removeKey(getLegacyCirclePaintStorageKey(sessionUserId));
        data = legacy;
      }
    }
    return data;
  } catch {
    return '';
  }
}

export function saveCirclePaint(sessionUserId, slotNumber, dataUrl) {
  if (!sessionUserId || !slotNumber) return;
  try {
    const key = getCirclePaintStorageKey(sessionUserId, slotNumber);
    if (dataUrl) {
      writeProfileValue(key, dataUrl);
    } else {
      void removeKey(key);
    }
    void removeKey(getLegacyCirclePaintStorageKey(sessionUserId));
  } catch {
    // ignore storage errors
  }
}

export function clearCirclePaint(sessionUserId, slotNumber) {
  saveCirclePaint(sessionUserId, slotNumber, '');
}

export function buildPaintedMenuCircleHtml(dataUrl) {
  if (!dataUrl) return '';
  return `
    <span class="lang-picker-circle user-profile-paint-preview-circle">
      <span
        class="lang-picker-circle-bg lang-picker-circle-bg--empty user-profile-paint-preview-bg"
        style="background-image:url('${dataUrl.replace(/'/g, '%27')}')"
        aria-hidden="true"
      ></span>
    </span>
  `.trim();
}

function renderPalette(paletteEl, selectedColor) {
  paletteEl.innerHTML = PAINT_COLOR_ROWS.map((row, rowIndex) => {
    const capacity = rowIndex === 0 ? 4 : 3;
    return `
      <div
        class="user-profile-option11-palette-row user-profile-option11-palette-row--${capacity}"
        role="presentation"
      >
        ${row.map((swatch) => `
          <button
            type="button"
            class="user-profile-option11-color${swatch.className ? ` ${swatch.className}` : ''}${swatch.color === selectedColor ? ' is-selected' : ''}"
            data-color="${swatch.color}"
            style="background:${swatch.color}"
            aria-label="${swatch.label}"
          ></button>
        `).join('')}
      </div>
    `;
  }).join('');
}

function syncDeleteButton(deleteBtn, canDelete) {
  if (!deleteBtn) return;
  const wrap = deleteBtn.closest('.user-profile-option11-action--delete');
  if (wrap) wrap.hidden = !canDelete;
  deleteBtn.disabled = !canDelete;
}

export function initProfileCirclePaint(pageEl, {
  getSessionUserId,
  getSlotNumber,
  canDeleteSlot,
  onAccept,
  onCancel,
  onErase,
  onDelete,
} = {}) {
  if (!pageEl) return null;

  const canvas = $('#user-profile-option11-canvas', pageEl);
  const circleWrap = $('.user-profile-option11-circle', pageEl);
  const paletteEl = $('#user-profile-option11-palette', pageEl);
  const acceptBtn = $('#user-profile-option11-accept', pageEl);
  const cancelBtn = $('#user-profile-option11-cancel', pageEl);
  const eraseBtn = $('#user-profile-option11-erase', pageEl);
  const deleteBtn = $('#user-profile-option11-delete', pageEl);
  if (!canvas || !circleWrap || !paletteEl || !acceptBtn || !cancelBtn || !eraseBtn || !deleteBtn) {
    return null;
  }

  const ctx = canvas.getContext('2d');
  let color = PAINT_COLOR_ROWS[0][0].color;
  let drawing = false;
  let lastPoint = null;
  let draftDirty = false;
  let canvasSize = 0;

  renderPalette(paletteEl, color);

  function getPaintContext() {
    const sessionUserId = getSessionUserId?.() || '';
    const slotNumber = Number(getSlotNumber?.());
    return {
      sessionUserId,
      slotNumber: Number.isInteger(slotNumber) && slotNumber >= 1 ? slotNumber : null,
    };
  }

  function syncActionButtons() {
    const { sessionUserId, slotNumber } = getPaintContext();
    const canDelete = Boolean(
      sessionUserId
      && slotNumber
      && (canDeleteSlot?.(sessionUserId, slotNumber) ?? false),
    );
    syncDeleteButton(deleteBtn, canDelete);
  }

  function setSelectedColor(nextColor, button) {
    color = nextColor;
    paletteEl.querySelectorAll('.user-profile-option11-color').forEach((el) => {
      el.classList.toggle('is-selected', el === button);
    });
  }

  paletteEl.addEventListener('click', (event) => {
    const button = event.target.closest('.user-profile-option11-color');
    if (!button) return;
    setSelectedColor(button.dataset.color, button);
  });

  function getOuterRadius() {
    return canvasSize / 2;
  }

  function getRingWidth() {
    return canvasSize * RING_FRACTION;
  }

  function getPaintRadius() {
    return getOuterRadius() - getRingWidth();
  }

  function drawRing() {
    const center = getOuterRadius();
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, getPaintRadius() + getRingWidth() / 2, 0, Math.PI * 2);
    ctx.strokeStyle = RING_COLOR;
    ctx.lineWidth = getRingWidth();
    ctx.stroke();
    ctx.restore();
  }

  function resizeCanvas() {
    const canvasRect = canvas.getBoundingClientRect();
    const wrapRect = circleWrap.getBoundingClientRect();
    const size = Math.max(1, Math.round(canvasRect.width || wrapRect.width));
    if (size === canvasSize) return size;

    const { sessionUserId, slotNumber } = getPaintContext();
    const previous = draftDirty
      ? canvas.toDataURL('image/png')
      : (sessionUserId && slotNumber ? loadCirclePaint(sessionUserId, slotNumber) : '');
    canvasSize = size;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    fillBase();
    if (previous) {
      const image = new Image();
      image.onload = () => {
        ctx.drawImage(image, 0, 0, size, size);
        drawRing();
      };
      image.src = previous;
    }
    return size;
  }

  function fillBase() {
    const center = getOuterRadius();
    ctx.clearRect(0, 0, canvasSize, canvasSize);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvasSize, canvasSize);
    drawClipped(() => {
      ctx.fillStyle = '#2aeb6c';
      ctx.beginPath();
      ctx.arc(center, center, getPaintRadius(), 0, Math.PI * 2);
      ctx.fill();
    });
    drawRing();
  }

  function drawClipped(drawFn) {
    const center = getOuterRadius();
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, getPaintRadius(), 0, Math.PI * 2);
    ctx.clip();
    drawFn();
    ctx.restore();
  }

  function getCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function isInsideCircle(point) {
    const center = getOuterRadius();
    const radius = getPaintRadius();
    const dx = point.x - center;
    const dy = point.y - center;
    return (dx * dx + dy * dy) <= radius * radius;
  }

  function drawSegment(from, to) {
    drawClipped(() => {
      ctx.strokeStyle = color;
      ctx.lineWidth = BRUSH_SIZE;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    });
    draftDirty = true;
  }

  function drawDot(point) {
    drawClipped(() => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, BRUSH_SIZE / 2, 0, Math.PI * 2);
      ctx.fill();
    });
    draftDirty = true;
  }

  function onPointerDown(event) {
    event.preventDefault();
    const point = getCanvasPoint(event);
    if (!isInsideCircle(point)) return;
    drawing = true;
    lastPoint = point;
    canvas.setPointerCapture(event.pointerId);
    drawDot(point);
  }

  function onPointerMove(event) {
    if (!drawing) return;
    const point = getCanvasPoint(event);
    if (!lastPoint) {
      lastPoint = point;
      return;
    }
    drawSegment(lastPoint, point);
    lastPoint = point;
  }

  function finishStroke(event) {
    if (!drawing) return;
    drawing = false;
    lastPoint = null;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', finishStroke);
  canvas.addEventListener('pointercancel', finishStroke);
  canvas.addEventListener('pointerleave', finishStroke);

  function loadSaved() {
    draftDirty = false;
    syncActionButtons();
    resizeCanvas();
  }

  acceptBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const { sessionUserId, slotNumber } = getPaintContext();
    if (sessionUserId && slotNumber) {
      saveCirclePaint(sessionUserId, slotNumber, canvas.toDataURL('image/png'));
    }
    draftDirty = false;
    onAccept?.(slotNumber);
  });

  cancelBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const { slotNumber } = getPaintContext();
    draftDirty = false;
    onCancel?.(slotNumber);
  });

  eraseBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const { sessionUserId, slotNumber } = getPaintContext();
    if (sessionUserId && slotNumber) clearCirclePaint(sessionUserId, slotNumber);
    draftDirty = false;
    if (canvasSize) fillBase();
    onErase?.(slotNumber);
  });

  deleteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const { sessionUserId, slotNumber } = getPaintContext();
    if (!sessionUserId || !slotNumber) return;
    onDelete?.(slotNumber);
  });

  return {
    open() {
      canvasSize = 0;
      requestAnimationFrame(() => loadSaved());
    },
    close() {
      drawing = false;
      lastPoint = null;
    },
    syncActionButtons,
    getPreviewHtml(slotNumber) {
      const sessionUserId = getSessionUserId?.() || '';
      if (!sessionUserId || !slotNumber) return '';
      const saved = loadCirclePaint(sessionUserId, slotNumber);
      return saved ? buildPaintedMenuCircleHtml(saved) : '';
    },
  };
}
