// ============================================================
// POSISI MARKER DI DENAH
// ============================================================
const LAYOUT_POSITIONS = {
  'Sleeve': {left:'56.5%', top:'60%'},
  'Coller Guide': {left:'50%', top:'60%'},
  'Valve KOJ': {left:'45.5%', top:'60%'},
  '3TF & 22MY': {left:'50.5%', top:'72%'},
  'Pipe Section': {left:'46%', top:'72%'},
  'Cap Header': {left:'54%', top:'81.5%'},
  'Tube Evaporator': {left:'49%', top:'81.5%'},
  'Tank Header': {left:'45.3%', top:'81.5%'},
  'Seat Valve HKZR & Boss Drive Face K2SA': {left:'41.5%', top:'74%'},
  'Pivot Camchain, Shaft In & Exh, Bus M Stand': {left:'42%', top:'60%'},
  'Rod HKZR': {left:'39%', top:'64.5%'},
  'Cutting': {left:'37.5%', top:'74%'},
  'Rod HKOJ': {left:'37.5%', top:'46%'},
  'Nut Hex Cap': {left:'37.5%', top:'35%'},
  'Cutting Size': {left:'37.5%', top:'29.5%'}
};

const LAYOUT_POSITIONS_FLOOR2 = {
  'NC': {left:'52%', top:'52%'},
  'F Yoke 5D9': {left:'64%', top:'71%'},
  'Final Check': {left:'61%', top:'84%'}
};

const FLOOR_CONFIG = {
  1: {title:'LAYOUT LANTAI 1 — LIVE ANDON', image:'/static/denah.png', alt:'Denah lantai 1'},
  2: {title:'LAYOUT LANTAI 2 — LIVE ANDON', image:'/static/denah_lantai2.png', alt:'Denah lantai 2'}
};

let currentFloor = 1;

const STATUS = {
  NORMAL: 'Berjalan Normal',
  MACHINE: 'Machine Problem',
  MATERIAL: 'Material Problem',
  QUALITY: 'Quality Problem'
};

let departments = [];

function updateClock(){
  const now=new Date();
  document.getElementById('clock').textContent=now.toLocaleTimeString('id-ID');
  document.getElementById('date').textContent=now.toLocaleDateString('id-ID',{
    weekday:'long',day:'2-digit',month:'long',year:'numeric'
  });
}
setInterval(updateClock,1000); updateClock();

function statusClass(status){
  if(status===STATUS.MACHINE || status==='Andon Call / Berhenti') return 'danger';
  if(status===STATUS.MATERIAL || status==='Perhatian / Changeover') return 'warning';
  if(status===STATUS.QUALITY) return 'quality';
  return 'normal';
}

function displayStatus(status){
  if(status==='Andon Call / Berhenti') return STATUS.MACHINE;
  if(status==='Perhatian / Changeover') return STATUS.MATERIAL;
  if(status==='Standby') return STATUS.NORMAL;
  return status || STATUS.NORMAL;
}

function esc(s){
  return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

function renderBoard(){
  const board=document.getElementById('board');
  board.innerHTML='';
  const groups={};
  departments.filter(d=>Number(d.floor||1)===currentFloor)
    .forEach(d=>(groups[d.cluster]??=[]).push(d));

  Object.entries(groups).forEach(([cluster,items])=>{
    const section=document.createElement('section');
    section.className='cluster';
    const sectionTitle = cluster === 'Final Check' ? 'FINAL CHECK' : `CLUSTER ${esc(cluster)}`;
    section.innerHTML=`<div class="cluster-title">${sectionTitle}</div><div class="cards"></div>`;
    const cards=section.querySelector('.cards');

    items.forEach(d=>{
      const cls=statusClass(d.status);
      const isProblem=cls!=='normal';
      const shownStatus=displayStatus(d.status);
      const card=document.createElement('article');
      card.className=`card ${cls} ${isProblem?'status-pulse':''}`;
      card.innerHTML=`
        <h3>${esc(d.department)}</h3>
        <span class="badge">${esc(shownStatus)}</span>`;
      cards.appendChild(card);
    });
    board.appendChild(section);
  });
}

function renderLayout(){
  const markers=document.getElementById('markers');
  markers.innerHTML='';

  const positions = currentFloor===2 ? LAYOUT_POSITIONS_FLOOR2 : LAYOUT_POSITIONS;
  departments.filter(d=>Number(d.floor||1)===currentFloor).forEach(d=>{
    const fallback=positions[d.department];
    const hasDbPosition=Number.isFinite(Number(d.position_left)) && Number.isFinite(Number(d.position_top));
    const pos=hasDbPosition
      ? {left:`${Number(d.position_left)}%`, top:`${Number(d.position_top)}%`}
      : fallback;
    if(!pos)return;

    const cls=statusClass(d.status);
    const marker=document.createElement('div');
    marker.className=`marker ${cls} ${cls!=='normal'?'status-pulse':''}`;
    marker.style.left=pos.left;
    marker.style.top=pos.top;
    marker.title=`${d.department} | ${displayStatus(d.status)}`;
    marker.textContent=d.department;
    markers.appendChild(marker);
  });
}

function renderKpi(){
  const visible=departments.filter(d=>Number(d.floor||1)===currentFloor);
  document.getElementById('total').textContent=visible.length;
  document.getElementById('normal').textContent=visible.filter(d=>statusClass(d.status)==='normal').length;
  document.getElementById('machine').textContent=visible.filter(d=>statusClass(d.status)==='danger').length;
  document.getElementById('material').textContent=visible.filter(d=>statusClass(d.status)==='warning').length;
  document.getElementById('quality').textContent=visible.filter(d=>statusClass(d.status)==='quality').length;
}

function problemClass(problem){
  if(problem==='Machine') return 'machine';
  if(problem==='Material') return 'material';
  if(problem==='Quality') return 'quality';
  return '';
}

function formatDuration(seconds, startTime){
  let total = (seconds === null || seconds === undefined || seconds === '') ? NaN : Number(seconds);
  if(!Number.isFinite(total) && startTime){
    total=Math.max(0, Math.floor((Date.now()-new Date(startTime.replace(' ','T')).getTime())/1000));
  }
  if(!Number.isFinite(total)) return '-';
  const h=Math.floor(total/3600);
  const m=Math.floor((total%3600)/60);
  const sec=total%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function renderHistory(rows){
  const body=document.getElementById('historyBody');
  if(!body)return;
  if(!rows.length){
    body.innerHTML='<tr><td colspan="7" class="history-empty">Belum ada histori Andon.</td></tr>';
    return;
  }
  body.innerHTML=rows.map(r=>{
    const cls=problemClass(r.problem_type);
    const start=(r.start_time||'').split(' ');
    const end=(r.end_time||'').split(' ');
    return `<tr>
      <td>${esc(start[0]||'-')}</td>
      <td>${esc(start[1]||'-')}</td>
      <td>${esc(r.department)}</td>
      <td><span class="history-problem ${cls}">${esc(r.problem_type)}</span></td>
      <td>${esc(end[1]||'AKTIF')}</td>
      <td>${formatDuration(r.duration_seconds, r.start_time)}</td>
      <td><span class="history-state ${r.end_time?'closed':'active'}">${r.end_time?'Selesai':'Aktif'}</span></td>
    </tr>`;
  }).join('');
}

async function loadHistory(){
  try{
    const r=await fetch(`/api/history?floor=${currentFloor}`,{cache:'no-store'});
    const rows=await r.json();
    renderHistory(rows);
  }catch(e){
    console.error('History error:',e);
  }
}

async function load(){
  try{
    const r=await fetch('/api/departments',{cache:'no-store'});
    departments=await r.json();
    renderKpi();
    renderBoard();
    renderLayout();
    document.getElementById('dbStatus').textContent='Database: SQLite terhubung';
  }catch(e){
    document.getElementById('dbStatus').textContent='Database: gagal terhubung';
    console.error(e);
  }
}

function setFloor(floor){
  currentFloor=Number(floor)===2 ? 2 : 1;
  document.querySelectorAll('.floor-tab').forEach(btn=>{
    btn.classList.toggle('active', Number(btn.dataset.floor)===currentFloor);
  });
  const cfg=FLOOR_CONFIG[currentFloor];
  document.getElementById('layoutTitle').textContent=cfg.title;
  const img=document.getElementById('layoutImage');
  img.src=cfg.image;
  img.alt=cfg.alt;
  renderKpi();
  renderBoard();
  renderLayout();
  loadHistory();
}

// ============================================================
// ZOOM DENAH
// ============================================================
let mapZoom = 1;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.1;

function applyMapZoom(){
  const map=document.getElementById('layoutMap');
  const stage=document.getElementById('mapStage');
  const value=document.getElementById('zoomResetBtn');
  if(!map || !stage)return;
  stage.style.setProperty('--map-zoom', mapZoom.toFixed(2));
  map.style.setProperty('--map-zoom', mapZoom.toFixed(2));
  if(value)value.textContent=`${Math.round(mapZoom*100)}%`;
}

function setMapZoom(value){
  mapZoom=Math.min(ZOOM_MAX,Math.max(ZOOM_MIN,Math.round(value*10)/10));
  applyMapZoom();
}

document.getElementById('zoomInBtn')?.addEventListener('click',()=>setMapZoom(mapZoom+ZOOM_STEP));
document.getElementById('zoomOutBtn')?.addEventListener('click',()=>setMapZoom(mapZoom-ZOOM_STEP));
document.getElementById('zoomResetBtn')?.addEventListener('click',()=>setMapZoom(1));
document.getElementById('layoutMap')?.addEventListener('wheel',(e)=>{
  e.preventDefault();
  setMapZoom(mapZoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
},{passive:false});
applyMapZoom();

// ============================================================
// TAMBAH LINE
// ============================================================
const lineModal=document.getElementById('lineModal');
const lineForm=document.getElementById('lineForm');
const lineMessage=document.getElementById('lineFormMessage');

function openLineModal(){
  lineMessage.textContent='';
  lineMessage.className='form-message full';
  document.getElementById('lineFloor').value=String(currentFloor);
  lineModal.classList.remove('hidden');
  lineModal.setAttribute('aria-hidden','false');
  document.getElementById('lineName').focus();
}

function closeLineModal(){
  lineModal.classList.add('hidden');
  lineModal.setAttribute('aria-hidden','true');
}

document.getElementById('addLineBtn')?.addEventListener('click',openLineModal);
document.getElementById('closeLineModal')?.addEventListener('click',closeLineModal);
document.getElementById('cancelLineBtn')?.addEventListener('click',closeLineModal);
lineModal?.addEventListener('click',(e)=>{if(e.target===lineModal)closeLineModal();});
document.addEventListener('keydown',(e)=>{if(e.key==='Escape' && !lineModal.classList.contains('hidden'))closeLineModal();});

lineForm?.addEventListener('submit',async(e)=>{
  e.preventDefault();
  const payload={
    floor:Number(document.getElementById('lineFloor').value),
    cluster:document.getElementById('lineCluster').value.trim(),
    department:document.getElementById('lineName').value.trim(),
    position_left:Number(document.getElementById('lineLeft').value),
    position_top:Number(document.getElementById('lineTop').value)
  };
  lineMessage.textContent='Menyimpan...';
  lineMessage.className='form-message full';
  try{
    const r=await fetch('/api/departments',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||'Gagal menambah line');
    lineMessage.textContent='Line berhasil ditambahkan.';
    lineMessage.className='form-message full success';
    lineForm.reset();
    document.getElementById('lineFloor').value=String(payload.floor);
    document.getElementById('lineLeft').value='50';
    document.getElementById('lineTop').value='50';
    currentFloor=payload.floor;
    document.querySelectorAll('.floor-tab').forEach(btn=>btn.classList.toggle('active',Number(btn.dataset.floor)===currentFloor));
    const cfg=FLOOR_CONFIG[currentFloor];
    document.getElementById('layoutTitle').textContent=cfg.title;
    const img=document.getElementById('layoutImage');
    img.src=cfg.image; img.alt=cfg.alt;
    await load();
    await loadHistory();
    setTimeout(closeLineModal,500);
  }catch(err){
    lineMessage.textContent=err.message;
    lineMessage.className='form-message full error';
  }
});

document.querySelectorAll('.floor-tab').forEach(btn=>{
  btn.addEventListener('click',()=>setFloor(btn.dataset.floor));
});

load();
loadHistory();
setInterval(load,5000);
setInterval(loadHistory,5000);
