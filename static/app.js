/*
 * ANDON DASHBOARD - APP.JS
 * PT Dharma Precision Parts
 *
 * Fungsi:
 * - Dashboard Live Andon
 * - Status Machine / Material / Quality / Offline
 * - Supabase Realtime
 * - History Andon
 * - Setting line
 * - Station ID & Station Name
 * - Drag & drop posisi line
 * - Reset line
 * - Floor 1 / Floor 2
 */

const APP_MODE = window.APP_MODE || 'dashboard';
const IS_SETTINGS = APP_MODE === 'settings';

/* =========================================================
   LAYOUT POSITION
   ========================================================= */

const LAYOUT_POSITIONS = {
  'Sleeve': { left: 56.5, top: 60 },
  'Coller Guide': { left: 50, top: 60 },
  'Valve KOJ': { left: 45.5, top: 60 },
  '3TF & 22MY': { left: 50.5, top: 72 },
  'Pipe Section': { left: 46, top: 72 },
  'Cap Header': { left: 54, top: 81.5 },
  'Tube Evaporator': { left: 49, top: 81.5 },
  'Tank Header': { left: 45.3, top: 81.5 },
  'Seat Valve HKZR & Boss Drive Face K2SA': {
    left: 41.5,
    top: 74
  },
  'Pivot Camchain, Shaft In & Exh, Bus M Stand': {
    left: 42,
    top: 60
  },
  'Rod HKZR': { left: 39, top: 64.5 },
  'Cutting': { left: 37.5, top: 74 },
  'Rod HKOJ': { left: 37.5, top: 46 },
  'Nut Hex Cap': { left: 37.5, top: 35 },
  'Cutting Size': { left: 37.5, top: 29.5 }
};

const LAYOUT_POSITIONS_FLOOR2 = {
  'NC': { left: 52, top: 52 },
  'F Yoke 5D9': { left: 64, top: 71 },
  'Final Check': { left: 61, top: 84 }
};

const FLOOR_CONFIG = {
  1: {
    title: `LAYOUT LANTAI 1 — ${IS_SETTINGS ? 'SETTING' : 'LIVE ANDON'}`,
    image: '/static/denah.png',
    alt: 'Denah lantai 1'
  },

  2: {
    title: `LAYOUT LANTAI 2 — ${IS_SETTINGS ? 'SETTING' : 'LIVE ANDON'}`,
    image: '/static/denah_lantai2.png',
    alt: 'Denah lantai 2'
  }
};

/* =========================================================
   STATUS
   ========================================================= */

const STATUS = {
  NORMAL: 'Berjalan Normal',
  MACHINE: 'Machine Problem',
  MATERIAL: 'Material Problem',
  QUALITY: 'Quality Problem',
  OFFLINE: 'Offline'
};

const OFFLINE_TIMEOUT_MS = 60000;

/* =========================================================
   GLOBAL STATE
   ========================================================= */

let currentFloor = 1;
let departments = [];
let draggedMarker = null;
let dirtyPositions = new Set();

/* =========================================================
   CLOCK
   ========================================================= */

function updateClock() {
  const clock = document.getElementById('clock');
  const date = document.getElementById('date');

  if (!clock) return;

  const now = new Date();

  clock.textContent = now.toLocaleTimeString('id-ID');

  if (date) {
    date.textContent = now.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  }
}

setInterval(updateClock, 1000);
updateClock();

/* =========================================================
   STATUS HELPER
   ========================================================= */

function statusClass(status) {
  if (status === STATUS.OFFLINE) {
    return 'offline';
  }

  if (
    status === STATUS.MACHINE ||
    status === 'Andon Call / Berhenti'
  ) {
    return 'danger';
  }

  if (
    status === STATUS.MATERIAL ||
    status === 'Perhatian / Changeover'
  ) {
    return 'warning';
  }

  if (status === STATUS.QUALITY) {
    return 'quality';
  }

  return 'normal';
}

function displayStatus(status) {
  if (status === 'Andon Call / Berhenti') {
    return STATUS.MACHINE;
  }

  if (status === 'Perhatian / Changeover') {
    return STATUS.MATERIAL;
  }

  if (status === 'Standby') {
    return STATUS.NORMAL;
  }

  return status || STATUS.NORMAL;
}

function isStationOffline(department) {
  if (!department.last_update) {
    return true;
  }

  const lastUpdate = new Date(department.last_update).getTime();

  if (!Number.isFinite(lastUpdate)) {
    return true;
  }

  return Date.now() - lastUpdate > OFFLINE_TIMEOUT_MS;
}

function effectiveStatus(department) {
  if (isStationOffline(department)) {
    return STATUS.OFFLINE;
  }

  return displayStatus(department.status);
}

/* =========================================================
   SECURITY / HTML ESCAPE
   ========================================================= */

function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    match => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[match])
  );
}

/* =========================================================
   POSITION
   ========================================================= */

function getPosition(department) {
  const positions =
    currentFloor === 2
      ? LAYOUT_POSITIONS_FLOOR2
      : LAYOUT_POSITIONS;

  const fallback =
    positions[department.department] || {
      left: 50,
      top: 50
    };

  const left = Number(department.position_left);
  const top = Number(department.position_top);

  return {
    left: Number.isFinite(left) ? left : fallback.left,
    top: Number.isFinite(top) ? top : fallback.top
  };
}

/* =========================================================
   RENDER BOARD
   ========================================================= */

function renderBoard() {
  const board = document.getElementById('board');

  if (!board) return;

  board.innerHTML = '';

  const groups = {};

  departments
    .filter(
      department =>
        Number(department.floor || 1) === currentFloor &&
        Number(department.is_active) !== 0
    )
    .forEach(department => {
      if (!groups[department.cluster]) {
        groups[department.cluster] = [];
      }

      groups[department.cluster].push(department);
    });

  Object.entries(groups).forEach(([cluster, items]) => {
    const section = document.createElement('section');

    section.className = 'cluster';

    const title =
      cluster === 'Final Check'
        ? 'FINAL CHECK'
        : `CLUSTER ${esc(cluster)}`;

    section.innerHTML = `
      <div class="cluster-title">${title}</div>
      <div class="cards"></div>
    `;

    const cards = section.querySelector('.cards');

    items.forEach(department => {
      const status = effectiveStatus(department);
      const className = statusClass(status);

      const card = document.createElement('article');

      card.className =
        `card ${className} ${
          ['danger', 'warning', 'quality'].includes(className)
            ? 'status-pulse'
            : ''
        }`;

      card.innerHTML = `
        <h3>${esc(department.department)}</h3>

        <div class="card-status-row">
          <span class="badge">
            ${esc(status)}
          </span>

          <button
            class="reset-line-btn"
            type="button"
            title="Reset ${esc(department.department)} menjadi normal"
            data-reset-id="${department.id}">
            ↻ RESET
          </button>
        </div>
      `;

      card
        .querySelector('.reset-line-btn')
        ?.addEventListener(
          'click',
          () => resetLine(department.id)
        );

      cards.appendChild(card);
    });

    board.appendChild(section);
  });
}

/* =========================================================
   RESET LINE
   ========================================================= */

async function resetLine(id) {
  const department = departments.find(
    item => Number(item.id) === Number(id)
  );

  if (!department) return;

  if (displayStatus(department.status) === STATUS.NORMAL) {
    return;
  }

  const buttons = document.querySelectorAll(
    `[data-reset-id="${id}"]`
  );

  buttons.forEach(button => {
    button.disabled = true;
    button.textContent = 'RESET...';
  });

  try {
    const response = await fetch(
      `/api/lora/command/${id}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          command: 'RESET'
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || 'Gagal reset line'
      );
    }

    /*
     * Update lokal supaya tampilan langsung normal
     * tanpa menunggu polling berikutnya.
     */
    department.status = STATUS.NORMAL;
    department.priority = 'Normal';
    department.issue = null;

    renderBoard();
    renderLayout();
    renderKpi();

    await loadHistory();

  } catch (error) {
    alert(
      `Gagal reset ${department.department}: ${error.message}`
    );

    buttons.forEach(button => {
      button.disabled = false;
      button.textContent = '↻ RESET';
    });
  }
}

window.resetLine = resetLine;

/* =========================================================
   RENDER LAYOUT
   ========================================================= */

function renderLayout() {
  const markers = document.getElementById('markers');

  if (!markers) return;

  markers.innerHTML = '';

  departments
    .filter(
      department =>
        Number(department.floor || 1) === currentFloor &&
        Number(department.is_active) !== 0
    )
    .forEach(department => {
      const position = getPosition(department);
      const status = effectiveStatus(department);
      const className = statusClass(status);

      const marker = document.createElement('div');

      marker.className =
        `marker ${className} ${
          className !== 'normal'
            ? 'status-pulse'
            : ''
        } ${
          IS_SETTINGS
            ? 'draggable-marker'
            : ''
        }`;

      marker.style.left = `${position.left}%`;
      marker.style.top = `${position.top}%`;

      marker.title = IS_SETTINGS
        ? 'Drag untuk memindahkan posisi'
        : `${department.department} | ${status}`;

      marker.textContent = department.department;

      marker.dataset.id = department.id;

      if (IS_SETTINGS) {
        marker.addEventListener(
          'pointerdown',
          startDrag
        );

        marker.addEventListener(
          'dblclick',
          () => openEditModal(department.id)
        );
      }

      markers.appendChild(marker);
    });
}

/* =========================================================
   KPI
   ========================================================= */

function renderKpi() {
  const visible = departments.filter(
    department =>
      Number(department.floor || 1) === currentFloor &&
      Number(department.is_active) !== 0
  );

  const setValue = (id, value) => {
    const element = document.getElementById(id);

    if (element) {
      element.textContent = value;
    }
  };

  setValue('total', visible.length);

  setValue(
    'normal',
    visible.filter(
      department =>
        statusClass(
          effectiveStatus(department)
        ) === 'normal'
    ).length
  );

  setValue(
    'machine',
    visible.filter(
      department =>
        statusClass(
          effectiveStatus(department)
        ) === 'danger'
    ).length
  );

  setValue(
    'material',
    visible.filter(
      department =>
        statusClass(
          effectiveStatus(department)
        ) === 'warning'
    ).length
  );

  setValue(
    'quality',
    visible.filter(
      department =>
        statusClass(
          effectiveStatus(department)
        ) === 'quality'
    ).length
  );
}

/* =========================================================
   DRAG & DROP LAYOUT
   ========================================================= */

function startDrag(event) {
  event.preventDefault();

  const marker = event.currentTarget;

  draggedMarker = {
    id: Number(marker.dataset.id),
    pointerId: event.pointerId
  };

  marker.classList.add('dragging');

  marker.setPointerCapture(
    event.pointerId
  );

  marker.addEventListener(
    'pointermove',
    dragMarker
  );

  marker.addEventListener(
    'pointerup',
    endDrag,
    { once: true }
  );

  marker.addEventListener(
    'pointercancel',
    endDrag,
    { once: true }
  );
}

function dragMarker(event) {
  if (!draggedMarker) return;

  const mapStage =
    document.getElementById('mapStage');

  if (!mapStage) return;

  const rect =
    mapStage.getBoundingClientRect();

  let left =
    ((event.clientX - rect.left) / rect.width) *
    100;

  let top =
    ((event.clientY - rect.top) / rect.height) *
    100;

  left = Math.max(
    0,
    Math.min(100, left)
  );

  top = Math.max(
    0,
    Math.min(100, top)
  );

  const department = departments.find(
    item =>
      Number(item.id) === draggedMarker.id
  );

  if (!department) return;

  department.position_left =
    Number(left.toFixed(2));

  department.position_top =
    Number(top.toFixed(2));

  event.currentTarget.style.left =
    `${department.position_left}%`;

  event.currentTarget.style.top =
    `${department.position_top}%`;

  dirtyPositions.add(department.id);

  updateSaveButton();
}

function endDrag(event) {
  const marker = event.currentTarget;

  marker.classList.remove('dragging');

  marker.removeEventListener(
    'pointermove',
    dragMarker
  );

  draggedMarker = null;
}

/* =========================================================
   SAVE LAYOUT POSITION
   ========================================================= */

function updateSaveButton() {
  const button =
    document.getElementById(
      'saveLayoutBtn'
    );

  if (!button) return;

  button.textContent = dirtyPositions.size
    ? `💾 SIMPAN POSISI (${dirtyPositions.size})`
    : '💾 SIMPAN POSISI';

  button.disabled =
    dirtyPositions.size === 0;
}

async function savePositions() {
  if (!dirtyPositions.size) return;

  const button =
    document.getElementById(
      'saveLayoutBtn'
    );

  if (!button) return;

  button.disabled = true;
  button.textContent = 'Menyimpan...';

  try {
    for (const id of [...dirtyPositions]) {
      const department =
        departments.find(
          item =>
            Number(item.id) === Number(id)
        );

      if (!department) continue;

      const response =
        await fetch(
          `/api/departments/${id}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type':
                'application/json'
            },
            body: JSON.stringify({
              position_left:
                department.position_left,

              position_top:
                department.position_top
            })
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
          'Gagal menyimpan posisi'
        );
      }
    }

    dirtyPositions.clear();

    const dbStatus =
      document.getElementById(
        'dbStatus'
      );

    if (dbStatus) {
      dbStatus.textContent =
        'Database: posisi layout tersimpan';
    }

  } catch (error) {
    const dbStatus =
      document.getElementById(
        'dbStatus'
      );

    if (dbStatus) {
      dbStatus.textContent =
        `Gagal menyimpan: ${error.message}`;
    }

  } finally {
    updateSaveButton();
  }
}

document
  .getElementById('saveLayoutBtn')
  ?.addEventListener(
    'click',
    savePositions
  );

/* =========================================================
   HISTORY
   ========================================================= */

function problemClass(problem) {
  if (problem === 'Machine') {
    return 'machine';
  }

  if (problem === 'Material') {
    return 'material';
  }

  if (problem === 'Quality') {
    return 'quality';
  }

  return '';
}

function formatDuration(
  seconds,
  startTime
) {
  let total =
    seconds === null ||
    seconds === undefined ||
    seconds === ''
      ? NaN
      : Number(seconds);

  if (
    !Number.isFinite(total) &&
    startTime
  ) {
    total = Math.max(
      0,
      Math.floor(
        (
          Date.now() -
          new Date(
            startTime.replace(
              ' ',
              'T'
            )
          ).getTime()
        ) / 1000
      )
    );
  }

  if (!Number.isFinite(total)) {
    return '-';
  }

  const hours =
    Math.floor(total / 3600);

  const minutes =
    Math.floor(
      (total % 3600) / 60
    );

  const secondsValue =
    total % 60;

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(secondsValue).padStart(2, '0')
  ].join(':');
}

function formatHistoryDate(value) {
  if (!value) return '-';

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return '-';
  }

  return date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function formatHistoryTime(value) {
  if (!value) return 'AKTIF';

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return '-';
  }

  return date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function renderHistory(rows) {
  const body = document.getElementById('historyBody');

  if (!body) return;

  if (!rows.length) {
    body.innerHTML = `
      <tr>
        <td colspan="7" class="history-empty">
          Belum ada histori Andon.
        </td>
      </tr>
    `;

    return;
  }

  body.innerHTML = rows
    .map(row => {
      const className = problemClass(row.problem_type);

      const startDate = formatHistoryDate(
        row.start_time
      );

      const startTime = formatHistoryTime(
        row.start_time
      );

      const endTime = row.end_time
        ? formatHistoryTime(row.end_time)
        : 'AKTIF';

      const status = row.end_time
        ? 'Selesai'
        : 'Aktif';

      return `
        <tr>
          <td>${esc(startDate)}</td>

          <td>${esc(startTime)}</td>

          <td>${esc(row.department)}</td>

          <td>
            <span class="history-problem ${className}">
              ${esc(row.problem_type)}
            </span>
          </td>

          <td>${esc(endTime)}</td>

          <td>
            ${formatDuration(
              row.duration_seconds,
              row.start_time
            )}
          </td>

          <td>
            <span class="history-state ${
              row.end_time
                ? 'closed'
                : 'active'
            }">
              ${status}
            </span>
          </td>
        </tr>
      `;
    })
    .join('');
}

async function loadHistory() {
  try {
    const response =
      await fetch(
        `/api/history?floor=${currentFloor}`,
        {
          cache: 'no-store'
        }
      );

    const rows =
      await response.json();

    renderHistory(rows);

  } catch (error) {
    console.error(
      'History error:',
      error
    );
  }
}

/* =========================================================
   FLOOR
   ========================================================= */

function setFloor(floor) {
  currentFloor =
    Number(floor) === 2
      ? 2
      : 1;

  document
    .querySelectorAll('.floor-tab')
    .forEach(button => {
      button.classList.toggle(
        'active',
        Number(button.dataset.floor) ===
          currentFloor
      );
    });

  const config =
    FLOOR_CONFIG[currentFloor];

  const title =
    document.getElementById(
      'layoutTitle'
    );

  const image =
    document.getElementById(
      'layoutImage'
    );

  if (title) {
    title.textContent =
      config.title;
  }

  if (image) {
    image.src =
      config.image;

    image.alt =
      config.alt;
  }

  renderKpi();
  renderBoard();
  renderLayout();

  if (!IS_SETTINGS) {
    loadHistory();
  }

  if (IS_SETTINGS) {
    renderSettingsLines();
  }
}

document
  .querySelectorAll('.floor-tab')
  .forEach(button => {
    button.addEventListener(
      'click',
      () =>
        setFloor(
          button.dataset.floor
        )
    );
  });

/* =========================================================
   MAP ZOOM
   ========================================================= */

let mapZoom = 1;

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.1;

function centerMapViewport() {
  const map =
    document.getElementById(
      'layoutMap'
    );

  if (!map) return;

  requestAnimationFrame(() => {
    map.scrollLeft =
      Math.max(
        0,
        (
          map.scrollWidth -
          map.clientWidth
        ) / 2
      );

    map.scrollTop =
      Math.max(
        0,
        (
          map.scrollHeight -
          map.clientHeight
        ) / 2
      );
  });
}

function applyMapZoom() {
  const map =
    document.getElementById(
      'layoutMap'
    );

  const stage =
    document.getElementById(
      'mapStage'
    );

  const value =
    document.getElementById(
      'zoomResetBtn'
    );

  if (!map || !stage) return;

  const zoom =
    mapZoom.toFixed(2);

  stage.style.setProperty(
    '--map-zoom',
    zoom
  );

  map.style.setProperty(
    '--map-zoom',
    zoom
  );

  if (value) {
    value.textContent =
      `${Math.round(mapZoom * 100)}%`;
  }

  centerMapViewport();
}

function setMapZoom(value) {
  mapZoom =
    Math.min(
      ZOOM_MAX,
      Math.max(
        ZOOM_MIN,
        Math.round(value * 10) / 10
      )
    );

  applyMapZoom();
}

document
  .getElementById('zoomInBtn')
  ?.addEventListener(
    'click',
    () =>
      setMapZoom(
        mapZoom + ZOOM_STEP
      )
  );

document
  .getElementById('zoomOutBtn')
  ?.addEventListener(
    'click',
    () =>
      setMapZoom(
        mapZoom - ZOOM_STEP
      )
  );

document
  .getElementById('zoomResetBtn')
  ?.addEventListener(
    'click',
    () => setMapZoom(1)
  );

document
  .getElementById('layoutMap')
  ?.addEventListener(
    'wheel',
    event => {
      event.preventDefault();

      setMapZoom(
        mapZoom +
          (
            event.deltaY < 0
              ? ZOOM_STEP
              : -ZOOM_STEP
          )
      );
    },
    { passive: false }
  );

window.addEventListener(
  'resize',
  centerMapViewport
);

applyMapZoom();

/* =========================================================
   LOAD DATA
   ========================================================= */

async function load() {
  try {
    const url = IS_SETTINGS
      ? '/api/departments?include_inactive=1'
      : '/api/departments';

    const response =
      await fetch(
        url,
        {
          cache: 'no-store'
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    departments =
      await response.json();

    renderKpi();
    renderBoard();
    renderLayout();

    if (IS_SETTINGS) {
      renderSettingsLines();
    }

    const dbStatus =
      document.getElementById(
        'dbStatus'
      );

    if (dbStatus) {
      dbStatus.textContent =
        'Database: Supabase terhubung';
    }

  } catch (error) {
    const dbStatus =
      document.getElementById(
        'dbStatus'
      );

    if (dbStatus) {
      dbStatus.textContent =
        'Database: gagal terhubung';
    }

    console.error(
      'Load error:',
      error
    );
  }
}

/* =========================================================
   SETTING - LINE MANAGEMENT
   ========================================================= */

const modal =
  document.getElementById(
    'lineModal'
  );

const form =
  document.getElementById(
    'lineForm'
  );

const message =
  document.getElementById(
    'lineFormMessage'
  );

/* =========================================================
   RESET FORM
   ========================================================= */

function resetLineForm() {
  if (!form) return;

  form.reset();

  document.getElementById(
    'lineId'
  ).value = '';

  document.getElementById(
    'lineStationId'
  ).value = '';

  document.getElementById(
    'lineStationName'
  ).value = '';

  document.getElementById(
    'lineFloor'
  ).value =
    String(currentFloor);

  document.getElementById(
    'lineLeft'
  ).value = '50';

  document.getElementById(
    'lineTop'
  ).value = '50';

  document.getElementById(
    'lineModalTitle'
  ).textContent =
    'TAMBAH LINE';

  if (message) {
    message.textContent = '';
    message.className =
      'form-message full';
  }
}

/* =========================================================
   OPEN ADD MODAL
   ========================================================= */

function openAddModal() {
  resetLineForm();

  if (!modal) return;

  modal.classList.remove(
    'hidden'
  );

  modal.setAttribute(
    'aria-hidden',
    'false'
  );

  document
    .getElementById('lineName')
    ?.focus();
}

/* =========================================================
   OPEN EDIT MODAL
   ========================================================= */

function openEditModal(id) {
  const department =
    departments.find(
      item =>
        Number(item.id) ===
        Number(id)
    );

  if (!department || !modal) {
    return;
  }

  document.getElementById(
    'lineId'
  ).value =
    department.id;

  document.getElementById(
    'lineStationId'
  ).value =
    department.station_id ??
    department.id;

  document.getElementById(
    'lineStationName'
  ).value =
    department.station_name ??
    department.department;

  document.getElementById(
    'lineFloor'
  ).value =
    department.floor;

  document.getElementById(
    'lineCluster'
  ).value =
    department.cluster;

  document.getElementById(
    'lineName'
  ).value =
    department.department;

  const position =
    getPosition(department);

  document.getElementById(
    'lineLeft'
  ).value =
    position.left.toFixed(2);

  document.getElementById(
    'lineTop'
  ).value =
    position.top.toFixed(2);

  document.getElementById(
    'lineModalTitle'
  ).textContent =
    'EDIT LINE';

  if (message) {
    message.textContent = '';
    message.className =
      'form-message full';
  }

  modal.classList.remove(
    'hidden'
  );

  modal.setAttribute(
    'aria-hidden',
    'false'
  );
}

/* =========================================================
   CLOSE MODAL
   ========================================================= */

function closeLineModal() {
  if (!modal) return;

  modal.classList.add(
    'hidden'
  );

  modal.setAttribute(
    'aria-hidden',
    'true'
  );
}

document
  .getElementById('addLineBtn')
  ?.addEventListener(
    'click',
    openAddModal
  );

document
  .getElementById('closeLineModal')
  ?.addEventListener(
    'click',
    closeLineModal
  );

document
  .getElementById('cancelLineBtn')
  ?.addEventListener(
    'click',
    closeLineModal
  );

modal?.addEventListener(
  'click',
  event => {
    if (
      event.target === modal
    ) {
      closeLineModal();
    }
  }
);

document.addEventListener(
  'keydown',
  event => {
    if (
      event.key === 'Escape' &&
      !modal?.classList.contains(
        'hidden'
      )
    ) {
      closeLineModal();
    }
  }
);

/* =========================================================
   SAVE LINE
   ========================================================= */

form?.addEventListener(
  'submit',
  async event => {
    event.preventDefault();

    const id =
      document.getElementById(
        'lineId'
      ).value;

    const payload = {
      station_id: Number(
        document.getElementById(
          'lineStationId'
        ).value
      ),

      station_name:
        document
          .getElementById(
            'lineStationName'
          )
          .value.trim(),

      floor: Number(
        document.getElementById(
          'lineFloor'
        ).value
      ),

      cluster:
        document
          .getElementById(
            'lineCluster'
          )
          .value.trim(),

      department:
        document
          .getElementById(
            'lineName'
          )
          .value.trim(),

      position_left: Number(
        document.getElementById(
          'lineLeft'
        ).value
      ),

      position_top: Number(
        document.getElementById(
          'lineTop'
        ).value
      )
    };

    if (message) {
      message.textContent =
        'Menyimpan...';

      message.className =
        'form-message full';
    }

    try {
      const response =
        await fetch(
          id
            ? `/api/departments/${id}`
            : '/api/departments',
          {
            method: id
              ? 'PUT'
              : 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify(
                payload
              )
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
          'Gagal menyimpan line'
        );
      }

      closeLineModal();

      dirtyPositions.delete(
        Number(id)
      );

      await load();

      if (
        Number(payload.floor) !==
        currentFloor
      ) {
        setFloor(
          payload.floor
        );
      }

    } catch (error) {
      if (message) {
        message.textContent =
          error.message;

        message.className =
          'form-message full error';
      }
    }
  }
);

/* =========================================================
   ACTIVATE / DEACTIVATE LINE
   ========================================================= */

async function toggleLine(
  id,
  active
) {
  const action =
    active
      ? 'menonaktifkan'
      : 'mengaktifkan kembali';

  if (
    !confirm(
      `Yakin ingin ${action} line ini?`
    )
  ) {
    return;
  }

  try {
    const response =
      await fetch(
        `/api/departments/${id}`,
        {
          method: 'PUT',

          headers: {
            'Content-Type':
              'application/json'
          },

          body: JSON.stringify({
            is_active:
              active ? 0 : 1
          })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
        'Gagal mengubah status line'
      );
    }

    await load();

  } catch (error) {
    alert(
      error.message
    );
  }
}

/* =========================================================
   DELETE LINE
   ========================================================= */

async function deleteLine(id) {
  const department =
    departments.find(
      item =>
        Number(item.id) ===
        Number(id)
    );

  if (!department) return;

  const confirmed =
    confirm(
      `Hapus line "${department.department}"?\n\n` +
      `Line akan dinonaktifkan dari Dashboard, ` +
      `tetapi histori Andon tetap disimpan.`
    );

  if (!confirmed) return;

  try {
    const response =
      await fetch(
        `/api/departments/${id}`,
        {
          method: 'DELETE'
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
        'Gagal menghapus line'
      );
    }

    dirtyPositions.delete(
      Number(id)
    );

    await load();

  } catch (error) {
    alert(
      error.message
    );
  }
}

/* =========================================================
   SETTING TABLE
   ========================================================= */

function renderSettingsLines() {
  const body =
    document.getElementById(
      'settingsLineBody'
    );

  if (!body) return;

  const rows =
    departments.filter(
      department =>
        Number(
          department.floor || 1
        ) === currentFloor
    );

  if (!rows.length) {
    body.innerHTML = `
      <tr>
        <td
          colspan="8"
          class="history-empty">
          Belum ada line.
        </td>
      </tr>
    `;

    return;
  }

  body.innerHTML =
    rows
      .map(department => {
        const position =
          getPosition(
            department
          );

        const active =
          Number(
            department.is_active
          ) !== 0;

        return `
          <tr
            class="${
              active
                ? ''
                : 'inactive-row'
            }">

            <td>
              Lantai ${department.floor}
            </td>

            <td>
              ${esc(
                department.cluster
              )}
            </td>

            <td>
              <b>
                ${esc(
                  department.station_id ??
                  department.id
                )}
              </b>
            </td>

            <td>
              ${esc(
                department.station_name ??
                department.department
              )}
            </td>

            <td>
              <b>
                ${esc(
                  department.department
                )}
              </b>
            </td>

            <td>
              <span
                class="line-active ${
                  active
                    ? 'yes'
                    : 'no'
                }">
                ${
                  active
                    ? 'Aktif'
                    : 'Nonaktif'
                }
              </span>
            </td>

            <td>
              ${position.left.toFixed(1)}%
              /
              ${position.top.toFixed(1)}%
            </td>

            <td class="table-actions">

              <button
                class="mini-btn"
                onclick="openEditModal(${department.id})">
                ✏ Edit
              </button>

              ${
                active
                  ? `
                    <button
                      class="mini-btn danger-btn"
                      onclick="deleteLine(${department.id})">
                      🗑 Hapus
                    </button>
                  `
                  : `
                    <button
                      class="mini-btn"
                      onclick="toggleLine(${department.id}, false)">
                      Aktifkan
                    </button>
                  `
              }

            </td>
          </tr>
        `;
      })
      .join('');
}

/* =========================================================
   GLOBAL FUNCTIONS
   ========================================================= */

window.openEditModal =
  openEditModal;

window.toggleLine =
  toggleLine;

window.deleteLine =
  deleteLine;

/* =========================================================
   INITIAL LOAD
   ========================================================= */

load();

if (!IS_SETTINGS) {
  loadHistory();

  setInterval(
    load,
    5000
  );

  setInterval(
    loadHistory,
    5000
  );
}

/* =========================================================
   SUPABASE REALTIME
   ========================================================= */

async function startSupabaseRealtime() {
  try {
    const configResponse =
      await fetch(
        '/api/supabase-config',
        {
          cache: 'no-store'
        }
      );

    if (!configResponse.ok) {
      throw new Error(
        'Gagal mengambil konfigurasi Supabase'
      );
    }

    const config =
      await configResponse.json();

    if (
      !config.url ||
      !config.key
    ) {
      throw new Error(
        'Konfigurasi Supabase tidak lengkap'
      );
    }

    const {
      createClient
    } = await import(
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
    );

    const realtimeClient =
      createClient(
        config.url,
        config.key
      );

    realtimeClient
      .channel(
        'andon-realtime'
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table:
            'andon_current_state'
        },
        async payload => {
          console.log(
            'REALTIME ANDON:',
            payload
          );

          await load();
        }
      )
      .subscribe(
        status => {
          console.log(
            'SUPABASE REALTIME:',
            status
          );
        }
      );

  } catch (error) {
    console.error(
      'Realtime gagal:',
      error
    );
  }
}

startSupabaseRealtime();