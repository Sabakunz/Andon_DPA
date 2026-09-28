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

const IS_DASHBOARD = APP_MODE === 'dashboard';
const IS_HISTORY = APP_MODE === 'history';
const IS_REPORT = APP_MODE === 'report';
const IS_SETTINGS = APP_MODE === 'settings';

let historyReportFloor = '';
let historyRequestController = null;
let historyRowsCacheByFloor = new Map();

/* =========================================================
   SIDEBAR TOGGLE
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {

  const sidebarToggle =
    document.getElementById('sidebarToggle');

  const sideMenu =
    document.getElementById('sideMenu');

  if (!sidebarToggle || !sideMenu) {
    return;
  }

  sidebarToggle.addEventListener('click', () => {

    sideMenu.classList.toggle('is-open');

  });

});

/* =========================================================
   SIDEBAR MENU
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {

  const sideMenu = document.getElementById('sideMenu');

  if (!sideMenu) return;

  const currentPath = window.location.pathname;

  const menuItems =
    sideMenu.querySelectorAll('.side-nav-item');

  menuItems.forEach(item => {

    const link = item.getAttribute('href');

    if (link === currentPath) {

      menuItems.forEach(menu => {
        menu.classList.remove('active');
      });

      item.classList.add('active');

    }

  });

});

/* =========================================================
   SIDEBAR MENU ITEM
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {

  const sideMenu = document.getElementById('sideMenu');

  if (!sideMenu) return;

  const sideMenuItems =
    sideMenu.querySelectorAll('.side-nav-item');

  sideMenuItems.forEach(item => {

    item.addEventListener('click', () => {

      sideMenu.classList.remove('is-open');

    });

  });

});

/* =========================================================
   SIDEBAR ACTIVE MENU
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {

  const sideMenu = document.getElementById('sideMenu');

  if (!sideMenu) return;

  const currentPath = window.location.pathname;

  const menuItems =
    sideMenu.querySelectorAll('.side-nav-item');

  menuItems.forEach(item => {

    const link = item.getAttribute('href');

    if (link === currentPath) {

      menuItems.forEach(menu => {
        menu.classList.remove('active');
      });

      item.classList.add('active');

    }

  });

});

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
  const shouldPulse = [
  'danger',
  'warning',
  'quality'
].includes(className);

      const marker = document.createElement('div');

marker.className =
  `marker ${className} ${
    shouldPulse
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

  setValue(
    'offline',
    visible.filter(
      department =>
        statusClass(
          effectiveStatus(department)
        ) === 'offline'
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
    ? `SIMPAN POSISI (${dirtyPositions.size})`
    : 'SIMPAN POSISI';

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

let historyRowsCache = [];

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

  const requestFloor =
    historyReportFloor === ''
      ? ''
      : String(historyReportFloor);

  const cacheKey = requestFloor;

  /* =====================================================
     TAMPILKAN CACHE TERLEBIH DAHULU
     ===================================================== */

  if (
    historyRowsCacheByFloor.has(cacheKey)
  ) {

    historyRowsCache =
      historyRowsCacheByFloor.get(cacheKey);

    populateHistoryLineFilter(
      historyRowsCache
    );

    applyHistoryFilters();

  }


  /* =====================================================
     BATalkan REQUEST SEBELUMNYA
     ===================================================== */

  if (historyRequestController) {

    historyRequestController.abort();

  }


  historyRequestController =
    new AbortController();

  const requestController =
    historyRequestController;


  try {

    const historyUrl =
      requestFloor === ''
        ? '/api/history'
        : `/api/history?floor=${requestFloor}`;


    const response =
      await fetch(
        historyUrl,
        {
          cache: 'no-store',
          signal: requestController.signal
        }
      );


    if (!response.ok) {

      throw new Error(
        `HTTP ${response.status}`
      );

    }


    const rows =
      await response.json();


    const freshRows =
      Array.isArray(rows)
        ? rows
        : [];


    /* =================================================
       SIMPAN HASIL TERBARU KE CACHE
       ================================================= */

    historyRowsCacheByFloor.set(
      cacheKey,
      freshRows
    );


    /*
     * Kalau user sudah pindah lantai
     * selama request berlangsung,
     * jangan render data lantai lama
     * ke layar.
     */

    if (
      historyReportFloor !== requestFloor
    ) {

      return;

    }


    historyRowsCache =
      freshRows;


    populateHistoryLineFilter(
      historyRowsCache
    );


    console.time('REPORT_RENDER');

    applyHistoryFilters();

    console.timeEnd('REPORT_RENDER');


  } catch (error) {

    if (
      error.name === 'AbortError'
    ) {

      return;

    }


    console.error(
      'History error:',
      error
    );

  }

}

/* =========================================================
   HISTORY FILTER
   ========================================================= */

function populateHistoryLineFilter(rows) {

  const select =
    document.getElementById(
      'historyLine'
    );

  if (!select) return;


  const currentValue =
    select.value;


  const lines = [
    ...new Set(
      rows
        .map(
          row => row.department
        )
        .filter(Boolean)
    )
  ].sort();


  select.innerHTML =
    `
      <option value="">
        Semua Line
      </option>
    ` +
    lines
      .map(
        line => `
          <option value="${esc(line)}">
            ${esc(line)}
          </option>
        `
      )
      .join('');


  if (
    lines.includes(
      currentValue
    )
  ) {

    select.value =
      currentValue;

  }

}


function applyHistoryFilters() {

  const dateValue =
    document.getElementById(
      'historyDate'
    )?.value || '';


  const lineValue =
    document.getElementById(
      'historyLine'
    )?.value || '';


  const problemValue =
    document.getElementById(
      'historyProblem'
    )?.value || '';


  const filtered =
    historyRowsCache.filter(
      row => {

        if (
          dateValue &&
          !String(
            row.start_time || ''
          ).startsWith(
            dateValue
          )
        ) {

          return false;

        }


        if (
          lineValue &&
          row.department !==
            lineValue
        ) {

          return false;

        }


        if (
          problemValue &&
          row.problem_type !==
            problemValue
        ) {

          return false;

        }


        return true;

      }
    );


  renderHistory(
    filtered
  );


  renderHistorySummary(
    filtered
  );

  renderDashboardAnalytics(
   filtered
  );

}


function renderHistorySummary(
  rows
) {

  const container =
    document.getElementById(
      'historySummary'
    );

  if (!container) return;


  const totalEvents =
    rows.length;


const totalDowntime =
  rows.reduce(
    (
      total,
      row
    ) => {

      let duration =
        Number(
          row.duration_seconds
        );

      if (
        !Number.isFinite(duration) ||
        duration < 0
      ) {
        duration = 0;
      }

      if (
        !row.end_time &&
        row.start_time
      ) {
        const liveDuration =
          Math.floor(
            (
              Date.now() -
              new Date(
                row.start_time
              ).getTime()
            ) / 1000
          );

        if (
          Number.isFinite(
            liveDuration
          ) &&
          liveDuration > duration
        ) {
          duration =
            liveDuration;
        }
      }

      return total + duration;
    },
    0
  );


  const activeEvents =
    rows.filter(
      row =>
        !row.end_time
    ).length;


  container.innerHTML = `

    <div class="history-summary-card">

      <small>
        TOTAL KEJADIAN
      </small>

      <strong>
        ${totalEvents}
      </strong>

    </div>


    <div class="history-summary-card">

      <small>
        TOTAL DOWNTIME
      </small>

      <strong>
        ${formatDuration(
          totalDowntime
        )}
      </strong>

    </div>


    <div class="history-summary-card">

      <small>
        EVENT AKTIF
      </small>

      <strong>
        ${activeEvents}
      </strong>

    </div>

  `;

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
  image.onload = () => {
    fitMapToScreen();
  };

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
   MAP ZOOM + PAN
   ========================================================= */

let mapZoom = 1;

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.06;
const ZOOM_ANIMATION_MS = 100;

let mapPanX = 0;
let mapPanY = 0;

let zoomAnimationFrame = null;

let smoothZoomTarget = 1;
let smoothZoomFocusX = 0;
let smoothZoomFocusY = 0;
let smoothZoomWorldX = 0;
let smoothZoomWorldY = 0;

let isPanning = false;
let panPointerId = null;
let panStartX = 0;
let panStartY = 0;
let panOriginX = 0;
let panOriginY = 0;

function getMapElements() {
  return {
    map: document.getElementById('layoutMap'),
    stage: document.getElementById('mapStage')
  };
}

function clampMapPosition() {
  const { map, stage } = getMapElements();

  if (!map || !stage) return;

  const contentWidth = stage.offsetWidth * mapZoom;
  const contentHeight = stage.offsetHeight * mapZoom;

  const viewportWidth = map.clientWidth;
  const viewportHeight = map.clientHeight;

  if (contentWidth <= viewportWidth) {
    const maxX = viewportWidth - contentWidth;

    mapPanX = Math.max(
      0,
      Math.min(maxX, mapPanX)
    );
  } else {
    const minX = viewportWidth - contentWidth;

    mapPanX = Math.max(
      minX,
      Math.min(0, mapPanX)
    );
  }

  if (contentHeight <= viewportHeight) {
    const maxY = viewportHeight - contentHeight;

    mapPanY = Math.max(
      0,
      Math.min(maxY, mapPanY)
    );
  } else {
    const minY = viewportHeight - contentHeight;

    mapPanY = Math.max(
      minY,
      Math.min(0, mapPanY)
    );
  }
}

function applyMapTransform() {
  const { stage } = getMapElements();

  if (!stage) return;

  clampMapPosition();

  stage.style.transform =
    `translate3d(${mapPanX}px, ${mapPanY}px, 0) scale(${mapZoom})`;

  const zoomValue =
    document.getElementById('zoomResetBtn');

  if (zoomValue) {
    zoomValue.textContent =
      `${Math.round(mapZoom * 100)}%`;
  }
}

function animateZoomAt(
  clientX,
  clientY,
  targetZoom
) {
  const { map } = getMapElements();

  if (!map) return;

  targetZoom = Math.max(
    ZOOM_MIN,
    Math.min(ZOOM_MAX, targetZoom)
  );

  const rect = map.getBoundingClientRect();

  smoothZoomFocusX = clientX - rect.left;
  smoothZoomFocusY = clientY - rect.top;

  smoothZoomWorldX =
    (smoothZoomFocusX - mapPanX) / mapZoom;

  smoothZoomWorldY =
    (smoothZoomFocusY - mapPanY) / mapZoom;

  smoothZoomTarget = targetZoom;

  if (!zoomAnimationFrame) {
    zoomAnimationFrame =
      requestAnimationFrame(smoothZoomStep);
  }
}

function smoothZoomStep() {
  const difference =
    smoothZoomTarget - mapZoom;

  if (Math.abs(difference) < 0.001) {
    mapZoom = smoothZoomTarget;

    mapPanX =
      smoothZoomFocusX -
      smoothZoomWorldX * mapZoom;

    mapPanY =
      smoothZoomFocusY -
      smoothZoomWorldY * mapZoom;

    applyMapTransform();

    zoomAnimationFrame = null;
    return;
  }

  // Kecepatan zoom yang halus
  mapZoom += difference * 0.22;

  mapPanX =
    smoothZoomFocusX -
    smoothZoomWorldX * mapZoom;

  mapPanY =
    smoothZoomFocusY -
    smoothZoomWorldY * mapZoom;

  applyMapTransform();

  zoomAnimationFrame =
    requestAnimationFrame(smoothZoomStep);
}

function zoomAtCenter(delta) {
  const { map } = getMapElements();

  if (!map) return;

  const rect =
    map.getBoundingClientRect();

  animateZoomAt(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
    mapZoom + delta
  );
}

function fitMapToScreen() {
  const { map, stage } = getMapElements();

  if (!map || !stage) return;

  cancelAnimationFrame(zoomAnimationFrame);

  const viewportWidth = map.clientWidth;
  const viewportHeight = map.clientHeight;

  const naturalWidth = stage.offsetWidth;
  const naturalHeight = stage.offsetHeight;

  if (!naturalWidth || !naturalHeight) {
    return;
  }

  let fitZoom = Math.min(
    viewportWidth / naturalWidth,
    viewportHeight / naturalHeight
  );

  fitZoom = Math.max(
    ZOOM_MIN,
    Math.min(ZOOM_MAX, fitZoom)
  );

  mapZoom = fitZoom;

  const contentWidth =
    naturalWidth * mapZoom;

  const contentHeight =
    naturalHeight * mapZoom;

  mapPanX =
    (viewportWidth - contentWidth) / 2;

  mapPanY =
    (viewportHeight - contentHeight) / 2;

  applyMapTransform();
}

function resetMapZoom() {
  const { map, stage } = getMapElements();

  if (!map || !stage) return;

  cancelAnimationFrame(zoomAnimationFrame);

  const viewportWidth = map.clientWidth;
  const viewportHeight = map.clientHeight;

  const contentWidth = stage.offsetWidth;
  const contentHeight = stage.offsetHeight;

  const targetZoom = 1;

  const targetPanX =
    (viewportWidth - contentWidth * targetZoom) / 2;

  const targetPanY =
    (viewportHeight - contentHeight * targetZoom) / 2;

  const startZoom = mapZoom;
  const startPanX = mapPanX;
  const startPanY = mapPanY;

  const startTime = performance.now();

  function animate(now) {
    const progress = Math.min(
      1,
      (now - startTime) / ZOOM_ANIMATION_MS
    );

    const eased =
      1 - Math.pow(1 - progress, 3);

    mapZoom =
      startZoom +
      (targetZoom - startZoom) * eased;

    mapPanX =
      startPanX +
      (targetPanX - startPanX) * eased;

    mapPanY =
      startPanY +
      (targetPanY - startPanY) * eased;

    applyMapTransform();

    if (progress < 1) {
      zoomAnimationFrame =
        requestAnimationFrame(animate);
    } else {
      zoomAnimationFrame = null;
    }
  }

  zoomAnimationFrame =
    requestAnimationFrame(animate);
}

/* =========================
   ZOOM BUTTON
   ========================= */

document
  .getElementById('zoomInBtn')
  ?.addEventListener(
    'click',
    () => zoomAtCenter(ZOOM_STEP)
  );

document
  .getElementById('zoomOutBtn')
  ?.addEventListener(
    'click',
    () => zoomAtCenter(-ZOOM_STEP)
  );

document
  .getElementById('zoomResetBtn')
  ?.addEventListener(
    'click',
    resetMapZoom
  );

document
  .getElementById('zoomFitBtn')
  ?.addEventListener(
    'click',
    fitMapToScreen
  );

/* =========================
   ZOOM DENGAN MOUSE WHEEL
   ========================= */

document
  .getElementById('layoutMap')
  ?.addEventListener(
    'wheel',
    event => {
      event.preventDefault();

      const map =
        document.getElementById(
          'layoutMap'
        );

      if (!map) return;

      const delta =
        event.deltaY < 0
          ? ZOOM_STEP
          : -ZOOM_STEP;

      animateZoomAt(
        event.clientX,
        event.clientY,
        mapZoom + delta
      );
    },
    {
      passive: false
    }
  );

/* =========================
   PAN / GESER DENAH
   ========================= */

function startMapPan(event) {
  if (event.button !== 0) return;

  if (
    event.target.closest('.zoom-controls') ||
    event.target.closest('.marker')
  ) {
    return;
  }

  const map =
    document.getElementById(
      'layoutMap'
    );

  if (!map) return;

  isPanning = true;
  panPointerId = event.pointerId;

  panStartX = event.clientX;
  panStartY = event.clientY;

  panOriginX = mapPanX;
  panOriginY = mapPanY;

  map.classList.add('is-panning');

  map.setPointerCapture(
    event.pointerId
  );
}

function moveMapPan(event) {
  if (
    !isPanning ||
    event.pointerId !== panPointerId
  ) {
    return;
  }

  mapPanX =
    panOriginX +
    (event.clientX - panStartX);

  mapPanY =
    panOriginY +
    (event.clientY - panStartY);

  applyMapTransform();
}

function endMapPan(event) {
  if (
    event.pointerId !== panPointerId
  ) {
    return;
  }

  const map =
    document.getElementById(
      'layoutMap'
    );

  isPanning = false;
  panPointerId = null;

  map?.classList.remove(
    'is-panning'
  );
}

document
  .getElementById('layoutMap')
  ?.addEventListener(
    'pointerdown',
    startMapPan
  );

document
  .getElementById('layoutMap')
  ?.addEventListener(
    'pointermove',
    moveMapPan
  );

document
  .getElementById('layoutMap')
  ?.addEventListener(
    'pointerup',
    endMapPan
  );

document
  .getElementById('layoutMap')
  ?.addEventListener(
    'pointercancel',
    endMapPan
  );

/* =========================
   RESIZE
   ========================= */

window.addEventListener(
  'resize',
  () => {
    applyMapTransform();
  }
);

applyMapTransform();

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
                <svg class="btn-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z"></path>
                  <path d="M14 7l3 3"></path>
                </svg>
                Edit
              </button>

              ${
                active
                  ? `
                    <button
                      class="mini-btn danger-btn"
                      onclick="deleteLine(${department.id})">
                      <svg class="btn-ico" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 7h16"></path>
                        <path d="M10 11v6"></path>
                        <path d="M14 11v6"></path>
                        <path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"></path>
                        <path d="M9 7V4h6v3"></path>
                      </svg>
                      Hapus
                    </button>
                  `
                  : `
                    <button
                      class="mini-btn"
                      onclick="toggleLine(${department.id}, false)">
                      <svg class="btn-ico" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 12l4.5 4.5L19 7"></path>
                      </svg>
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

if (IS_DASHBOARD) {

  loadHistory();

  setInterval(
    load,
    5000
  );

  setInterval(
    loadHistory,
    5000
  );

} else if (IS_HISTORY || IS_REPORT) {

  loadHistory();

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

if (IS_DASHBOARD) {
  startSupabaseRealtime();
}


/* =========================================================
   HISTORY FILTER EVENT
   ========================================================= */

function initHistoryFilters() {

  const historyDate =
    document.getElementById('historyDate');

  const historyLine =
    document.getElementById('historyLine');

  const historyProblem =
    document.getElementById('historyProblem');

  const historyReset =
    document.getElementById('historyReset');


  if (
    !historyDate &&
    !historyLine &&
    !historyProblem &&
    !historyReset
  ) {
    return;
  }


  if (historyDate) {

    historyDate.addEventListener(
      'change',
      () => {
        applyHistoryFilters();
      }
    );

  }


  if (historyLine) {

    historyLine.addEventListener(
      'change',
      () => {
        applyHistoryFilters();
      }
    );

  }


  if (historyProblem) {

    historyProblem.addEventListener(
      'change',
      () => {
        applyHistoryFilters();
      }
    );

  }


  if (historyReset) {

    historyReset.addEventListener(
      'click',
      () => {

        if (historyDate) {
          historyDate.value = '';
        }

        if (historyLine) {
          historyLine.value = '';
        }

        if (historyProblem) {
          historyProblem.value = '';
        }

        applyHistoryFilters();

      }
    );

  }

}


/* Jalankan filter setelah halaman siap */

if (document.readyState === 'loading') {

  document.addEventListener(
    'DOMContentLoaded',
    initHistoryFilters
  );

} else {

  initHistoryFilters();

}

/* =========================================================
   DASHBOARD ANALYTICS
   STEP 34B — DATA PROCESSING
   ========================================================= */

function renderDashboardAnalytics(rows) {

  const kpiContainer =
    document.getElementById(
      'dashboardAnalyticsKpis'
    );

  const trendContainer =
    document.getElementById(
      'dashboardTrend'
    );

  const categoryContainer =
    document.getElementById(
      'dashboardCategory'
    );

  const clusterContainer =
    document.getElementById(
      'dashboardClusters'
    );

  const topLineContainer =
    document.getElementById(
      'dashboardTopLines'
    );


  /*
   * Kalau sedang bukan Dashboard,
   * fungsi berhenti.
   */

if (
  !IS_REPORT ||
  (
    !kpiContainer &&
    !trendContainer &&
    !categoryContainer &&
    !clusterContainer &&
    !topLineContainer
  )
) {
  return;
}


  /* =====================================================
     TOTAL DOWNTIME
     ===================================================== */

  const totalDowntime =
    rows.reduce(
      (
        total,
        row
      ) => {

        let duration =
          Number(
            row.duration_seconds
          );


        if (
          !Number.isFinite(duration) ||
          duration < 0
        ) {

          duration = 0;

        }


        /*
         * Event aktif dihitung
         * sampai waktu sekarang.
         */

        if (
          !row.end_time &&
          row.start_time
        ) {

          const liveDuration =
            Math.floor(
              (
                Date.now() -
                new Date(
                  row.start_time
                ).getTime()
              ) / 1000
            );


          if (
            Number.isFinite(
              liveDuration
            ) &&
            liveDuration > duration
          ) {

            duration =
              liveDuration;

          }

        }


        return total + duration;

      },
      0
    );


  /* =====================================================
     AVERAGE DOWNTIME
     ===================================================== */

  const averageDowntime =
    rows.length
      ? Math.floor(
          totalDowntime /
          rows.length
        )
      : 0;


  /* =====================================================
     ACTIVE EVENT
     ===================================================== */

  const activeEvents =
    rows.filter(
      row =>
        !row.end_time
    ).length;


  /* =====================================================
     CATEGORY
     ===================================================== */

  const categoryCounts = {

    Machine: 0,

    Material: 0,

    Quality: 0

  };


  rows.forEach(
    row => {

      const problem =
        String(
          row.problem_type || ''
        ).trim();


      if (
        problem === 'Machine'
      ) {

        categoryCounts.Machine++;

      }

      else if (
        problem === 'Material'
      ) {

        categoryCounts.Material++;

      }

      else if (
        problem === 'Quality'
      ) {

        categoryCounts.Quality++;

      }

    }
  );


  /* =====================================================
     LINE
     ===================================================== */

  const lineCounts = {};


  rows.forEach(
    row => {

      const line =
        String(
          row.department || ''
        ).trim();


      if (!line) return;


      if (
        !lineCounts[line]
      ) {

        lineCounts[line] = {

          count: 0,

          downtime: 0

        };

      }


      lineCounts[line].count++;


      let duration =
        Number(
          row.duration_seconds
        );


      if (
        !Number.isFinite(duration) ||
        duration < 0
      ) {

        duration = 0;

      }


      if (
        !row.end_time &&
        row.start_time
      ) {

        const liveDuration =
          Math.floor(
            (
              Date.now() -
              new Date(
                row.start_time
              ).getTime()
            ) / 1000
          );


        if (
          Number.isFinite(
            liveDuration
          ) &&
          liveDuration > duration
        ) {

          duration =
            liveDuration;

        }

      }


      lineCounts[line].downtime +=
        duration;

    }
  );


  const sortedLines =
    Object.entries(
      lineCounts
    )
      .sort(
        (
          a,
          b
        ) =>
          b[1].count -
          a[1].count
      );


  /* =====================================================
     CLUSTER
     ===================================================== */

  /*
   * History menyimpan department,
   * sedangkan cluster tersimpan
   * pada data departments.
   *
   * Kita ambil mapping:
   *
   * department name -> cluster
   */

  const departmentClusterMap = {};


  if (
    Array.isArray(
      departments
    )
  ) {

    departments.forEach(
      department => {

        const name =
          String(
            department.department || ''
          ).trim();


        const cluster =
          String(
            department.cluster || ''
          ).trim();


        if (
          name &&
          cluster
        ) {

          departmentClusterMap[name] =
            cluster;

        }

      }
    );

  }


  const clusterCounts = {};


  rows.forEach(
    row => {

      const line =
        String(
          row.department || ''
        ).trim();


      if (!line) return;


      const cluster =
        departmentClusterMap[line] ||
        'Tanpa Cluster';


      if (
        !clusterCounts[cluster]
      ) {

        clusterCounts[cluster] = {

          total: 0,

          Machine: 0,

          Material: 0,

          Quality: 0

        };

      }


      clusterCounts[cluster].total++;


      const problem =
        String(
          row.problem_type || ''
        ).trim();


      if (
        problem === 'Machine' ||
        problem === 'Material' ||
        problem === 'Quality'
      ) {

        clusterCounts[cluster][problem]++;

      }

    }
  );


  /* =====================================================
     TREND 7 HARI
     ===================================================== */

  const trend = [];


  for (
    let i = 6;
    i >= 0;
    i--
  ) {

    const date =
      new Date();


    date.setHours(
      0,
      0,
      0,
      0
    );


    date.setDate(
      date.getDate() - i
    );


    const nextDate =
      new Date(
        date
      );


    nextDate.setDate(
      nextDate.getDate() + 1
    );


    const count =
      rows.filter(
        row => {

          if (
            !row.start_time
          ) {

            return false;

          }


          const rowDate =
            new Date(
              row.start_time
            );


          return (
            rowDate >= date &&
            rowDate < nextDate
          );

        }
      ).length;


    trend.push({

      date,

      count

    });

  }


  /* =====================================================
     RENDER KPI
     ===================================================== */

  if (kpiContainer) {

    kpiContainer.innerHTML = `

      <div class="dashboard-analytics-kpi">
        <small>TOTAL KEJADIAN</small>
        <strong>
          ${rows.length}
        </strong>
      </div>

      <div class="dashboard-analytics-kpi">
        <small>TOTAL DOWNTIME</small>
        <strong>
          ${formatDuration(
            totalDowntime
          )}
        </strong>
      </div>

      <div class="dashboard-analytics-kpi">
        <small>RATA-RATA DOWNTIME</small>
        <strong>
          ${formatDuration(
            averageDowntime
          )}
        </strong>
      </div>

      <div class="dashboard-analytics-kpi">
        <small>EVENT AKTIF</small>
        <strong>
          ${activeEvents}
        </strong>
      </div>

    `;

  }


/* =====================================================
   RENDER TREND DATA
   ===================================================== */

if (trendContainer) {

  const maxCount = Math.max(
    1,
    ...trend.map(item => item.count)
  );

  const width = 720;
  const height = 230;

  const padLeft = 38;
  const padRight = 8;
  const padTop = 18;
  const padBottom = 34;

  const chartWidth =
    width - padLeft - padRight;

  const chartHeight =
    height - padTop - padBottom;

  const points = trend.map(
    (item, index) => {

      const x =
        padLeft +
        (
          index /
          Math.max(1, trend.length - 1)
        ) *
        chartWidth;

      const y =
        padTop +
        chartHeight -
        (
          item.count /
          maxCount
        ) *
        chartHeight;

      return {
        x,
        y,
        count: item.count,
        date: item.date
      };

    }
  );


  /* =========================
     GARIS GRID
     ========================= */

  const gridLines = [];

  const gridCount =
    Math.max(3, Math.min(4, maxCount + 1));

  for (
    let i = 0;
    i < gridCount;
    i++
  ) {

    const value =
      Math.round(
        maxCount -
        (
          i /
          Math.max(1, gridCount - 1)
        ) *
        maxCount
      );

    const y =
      padTop +
      (
        i /
        Math.max(1, gridCount - 1)
      ) *
      chartHeight;

    gridLines.push(`
      <line
        x1="${padLeft}"
        y1="${y}"
        x2="${width - padRight}"
        y2="${y}"
        class="dashboard-chart-grid"
      />

      <text
        x="${padLeft - 10}"
        y="${y + 4}"
        text-anchor="end"
        class="dashboard-chart-y-label"
      >
        ${value}
      </text>
    `);

  }


  /* =========================
     LINE PATH
     ========================= */

  const linePath =
    points
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
      )
      .join(' ');


  /* =========================
     AREA PATH
     ========================= */

  const firstPoint =
    points[0];

  const lastPoint =
    points[points.length - 1];

  const areaPath = `
    M ${firstPoint.x} ${padTop + chartHeight}
    L ${points
      .map(
        point =>
          `${point.x} ${point.y}`
      )
      .join(' L ')}
    L ${lastPoint.x} ${padTop + chartHeight}
    Z
  `;


  /* =========================
     LABEL HARI
     ========================= */

  const dayLabels =
    points
      .map(
        point => `
          <text
            x="${point.x}"
            y="${height - 8}"
            text-anchor="middle"
            class="dashboard-chart-x-label"
          >
            ${point.date.toLocaleDateString(
              'id-ID',
              {
                weekday: 'short'
              }
            )}
          </text>
        `
      )
      .join('');


  /* =========================
     TITIK DATA
     ========================= */

  const dataPoints =
    points
      .map(
        point => `
          <circle
            cx="${point.x}"
            cy="${point.y}"
            r="5"
            class="dashboard-chart-point"
          />

          <circle
            cx="${point.x}"
            cy="${point.y}"
            r="2"
            class="dashboard-chart-point-inner"
          />
        `
      )
      .join('');


  trendContainer.innerHTML = `

    <div class="dashboard-trend-chart">

      <svg
        viewBox="0 0 ${width} ${height}"
        preserveAspectRatio="none"
        class="dashboard-trend-svg"
      >

        <defs>

          <linearGradient
            id="dashboardTrendGradient"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >

            <stop
              offset="0%"
              class="dashboard-gradient-top"
            />

            <stop
              offset="100%"
              class="dashboard-gradient-bottom"
            />

          </linearGradient>

        </defs>


        <!-- GRID -->

        ${gridLines.join('')}


        <!-- AREA -->

        <path
          d="${areaPath}"
          class="dashboard-chart-area"
        />


        <!-- LINE -->

        <path
          d="${linePath}"
          class="dashboard-chart-line"
        />


        <!-- POINT -->

        ${dataPoints}


        <!-- LABEL -->

        ${dayLabels}

      </svg>

    </div>

  `;

}


/* =====================================================
   RENDER CATEGORY DATA
   ===================================================== */

if (categoryContainer) {

  const totalCategory =
    Object.values(
      categoryCounts
    ).reduce(
      (sum, value) =>
        sum + value,
      0
    );


  const machine =
    categoryCounts.Machine || 0;

  const material =
    categoryCounts.Material || 0;

  const quality =
    categoryCounts.Quality || 0;


  const machinePercent =
    totalCategory
      ? Math.round(
          machine /
          totalCategory *
          100
        )
      : 0;

  const materialPercent =
    totalCategory
      ? Math.round(
          material /
          totalCategory *
          100
        )
      : 0;

  const qualityPercent =
    totalCategory
      ? 100 -
        machinePercent -
        materialPercent
      : 0;


  const machineAngle =
    machinePercent * 3.6;

  const materialAngle =
    materialPercent * 3.6;


  const machineEnd =
    machineAngle;

  const materialEnd =
    machineAngle +
    materialAngle;


  categoryContainer.innerHTML = `

    <div class="dashboard-donut-wrap">

      <div
        class="dashboard-donut"
        style="
          --machine-end:${machineEnd}deg;
          --material-end:${materialEnd}deg;
        "
      >

        <div class="dashboard-donut-center">

          <strong>
            ${totalCategory}
          </strong>

          <span>
            kejadian
          </span>

        </div>

      </div>


      <div class="dashboard-donut-legend">

        <div class="dashboard-donut-legend-item">

          <span
            class="dashboard-donut-dot machine"
          ></span>

          <span class="dashboard-donut-name">
            Machine
          </span>

          <strong>
            ${machinePercent}%
          </strong>

          <small>
            (${machine}×)
          </small>

        </div>


        <div class="dashboard-donut-legend-item">

          <span
            class="dashboard-donut-dot material"
          ></span>

          <span class="dashboard-donut-name">
            Material
          </span>

          <strong>
            ${materialPercent}%
          </strong>

          <small>
            (${material}×)
          </small>

        </div>


        <div class="dashboard-donut-legend-item">

          <span
            class="dashboard-donut-dot quality"
          ></span>

          <span class="dashboard-donut-name">
            Quality
          </span>

          <strong>
            ${qualityPercent}%
          </strong>

          <small>
            (${quality}×)
          </small>

        </div>

      </div>

    </div>

  `;

}


/* =====================================================
   RENDER CLUSTER DATA
   ===================================================== */

if (clusterContainer) {

  /*
   * Ambil semua cluster yang memang tersedia
   * di data departments.
   *
   * Jadi cluster tetap muncul walaupun
   * jumlah kejadiannya = 0.
   */

  const availableClusters = [
    ...new Set(
      departments
        .map(
          department =>
            String(
              department.cluster || ''
            ).trim()
        )
        .filter(Boolean)
    )
  ];


  /*
   * Pastikan cluster standar tetap tersedia.
   */

  const standardClusters = [
    'A',
    'B',
    'C',
    'D'
  ];


  const allClusters = [
    ...new Set([
      ...standardClusters,
      ...availableClusters
    ])
  ].filter(
  cluster =>
    cluster.toLowerCase() !== 'maintenance'
  );


  /*
   * Total semua kategori.
   */

  const totalAll = {

    total: 0,

    Machine: 0,

    Material: 0,

    Quality: 0

  };


  allClusters.forEach(
    cluster => {

      if (
        !clusterCounts[cluster]
      ) {

        clusterCounts[cluster] = {

          total: 0,

          Machine: 0,

          Material: 0,

          Quality: 0

        };

      }

    }
  );


  /*
   * Hitung total semua cluster.
   */

  Object.values(
    clusterCounts
  ).forEach(
    data => {

      totalAll.total +=
        data.total;

      totalAll.Machine +=
        data.Machine;

      totalAll.Material +=
        data.Material;

      totalAll.Quality +=
        data.Quality;

    }
  );


  /*
   * Buat card cluster.
   */

  const renderClusterCard =
    (
      cluster,
      data,
      isTotal = false
    ) => {

      const machine =
        Number(
          data.Machine || 0
        );

      const material =
        Number(
          data.Material || 0
        );

      const quality =
        Number(
          data.Quality || 0
        );

      const total =
        Number(
          data.total || 0
        );


      /*
       * Donut cluster.
       *
       * Kalau belum ada kejadian,
       * tampil abu-abu.
       */

      let donutBackground =
        '#dbe4f0';


      if (
        total > 0
      ) {

        const machineDeg =
          (
            machine /
            total
          ) * 360;

        const materialDeg =
          (
            material /
            total
          ) * 360;


        const materialEnd =
          machineDeg +
          materialDeg;


        donutBackground = `
          conic-gradient(
            #dc3d3d 0deg ${machineDeg}deg,
            #c98212 ${machineDeg}deg ${materialEnd}deg,
            #3264df ${materialEnd}deg 360deg
          )
        `;

      }


      return `

        <div
          class="
            dashboard-cluster-item
            ${isTotal ? 'is-total' : ''}
          "
          data-cluster="${esc(cluster)}"
        >

          <strong>
            ${esc(cluster)}
          </strong>


          <div
            class="dashboard-cluster-donut"
            style="
              background:
                ${donutBackground};
            "
          >

            <div
              class="dashboard-cluster-donut-center"
            >

              <b>
                ${total}
              </b>

            </div>

          </div>


          <div
            class="dashboard-cluster-details"
          >

            <span>
              <i class="machine"></i>
              Machine
              <b>${machine}</b>
            </span>

            <span>
              <i class="material"></i>
              Material
              <b>${material}</b>
            </span>

            <span>
              <i class="quality"></i>
              Quality
              <b>${quality}</b>
            </span>

          </div>

        </div>

      `;

    };


  /*
   * Render A, B, C, D.
   */

  clusterContainer.innerHTML =

    allClusters
      .map(
        cluster =>
          renderClusterCard(
            cluster,
            clusterCounts[cluster]
          )
      )
      .join('')

    +

    renderClusterCard(
      'Total Semua',
      totalAll,
      true
    );

}


  /* =====================================================
     RENDER TOP LINE
     ===================================================== */

  if (topLineContainer) {

    topLineContainer.innerHTML =
      sortedLines
        .slice(
          0,
          5
        )
        .map(
          (
            [
              line,
              data
            ]
          ) => `

            <div
              class="dashboard-top-line-item"
            >

              <strong>
                ${esc(line)}
              </strong>

              <b>
                ${data.count}×
              </b>

              <span>
                Total downtime
                ${formatDuration(
                  data.downtime
                )}
              </span>

            </div>

          `
        )
        .join('');

  }

}

/* =========================================================
   HISTORY / REPORT FLOOR TABS
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {

  const historyTabs =
    document.querySelectorAll(
      '#historyFloorTabs .page-floor-tab'
    );

  const reportTabs =
    document.querySelectorAll(
      '#reportFloorTabs .page-floor-tab'
    );

  const allTabs = [
    ...historyTabs,
    ...reportTabs
  ];

  if (!allTabs.length) {
    return;
  }

  allTabs.forEach(tab => {

    tab.addEventListener('click', async () => {

      const floor =
        tab.dataset.floor ?? '';

      historyReportFloor = floor;

      /*
       * Update active tab
       */
      const parent =
        tab.closest('.page-floor-tabs');

      if (parent) {

        parent
          .querySelectorAll('.page-floor-tab')
          .forEach(item => {
            item.classList.remove('active');
          });

        tab.classList.add('active');
      }

      /*
       * Sync tab antara History dan Report
       */
      document
        .querySelectorAll(
          '.page-floor-tab'
        )
        .forEach(item => {

          if (
            item.dataset.floor === floor
          ) {
            item.classList.add('active');
          } else {
            item.classList.remove('active');
          }

        });

      /*
       * Ambil ulang data tanpa menahan UI
       */
      loadHistory();

    });

  });

});