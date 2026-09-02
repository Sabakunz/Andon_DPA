const APP_MODE = window.APP_MODE || 'dashboard';
const IS_SETTINGS = APP_MODE === 'settings';

const LAYOUT_POSITIONS = {
  'Sleeve': {left:56.5, top:60}, 'Coller Guide': {left:50, top:60},
  'Valve KOJ': {left:45.5, top:60}, '3TF & 22MY': {left:50.5, top:72},
  'Pipe Section': {left:46, top:72}, 'Cap Header': {left:54, top:81.5},
  'Tube Evaporator': {left:49, top:81.5}, 'Tank Header': {left:45.3, top:81.5},
  'Seat Valve HKZR & Boss Drive Face K2SA': {left:41.5, top:74},
  'Pivot Camchain, Shaft In & Exh, Bus M Stand': {left:42, top:60},
  'Rod HKZR': {left:39, top:64.5}, 'Cutting': {left:37.5, top:74},
  'Rod HKOJ': {left:37.5, top:46}, 'Nut Hex Cap': {left:37.5, top:35},
  'Cutting Size': {left:37.5, top:29.5}
};
const LAYOUT_POSITIONS_FLOOR2 = {
  'NC': {left:52, top:52}, 'F Yoke 5D9': {left:64, top:71}, 'Final Check': {left:61, top:84}
};
const FLOOR_CONFIG = {
  1:{title:`LAYOUT LANTAI 1 — ${IS_SETTINGS?'SETTING':'LIVE ANDON'}`,image:'/static/denah.png',alt:'Denah lantai 1'},
  2:{title:`LAYOUT LANTAI 2 — ${IS_SETTINGS?'SETTING':'LIVE ANDON'}`,image:'/static/denah_lantai2.png',alt:'Denah lantai 2'}
};
const STATUS={NORMAL:'Berjalan Normal',MACHINE:'Machine Problem',MATERIAL:'Material Problem',QUALITY:'Quality Problem'};
let currentFloor=1, departments=[], draggedMarker=null, dirtyPositions=new Set();

function updateClock(){
  const clock=document.getElementById('clock'), date=document.getElementById('date');
  if(!clock)return;
  const now=new Date();
  clock.textContent=now.toLocaleTimeString('id-ID');
  date.textContent=now.toLocaleDateString('id-ID',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
}
setInterval(updateClock,1000); updateClock();

function statusClass(status){
  if(status===STATUS.MACHINE||status==='Andon Call / Berhenti')return'danger';
  if(status===STATUS.MATERIAL||status==='Perhatian / Changeover')return'warning';
  if(status===STATUS.QUALITY)return'quality';
  return'normal';
}
function displayStatus(status){
  if(status==='Andon Call / Berhenti')return STATUS.MACHINE;
  if(status==='Perhatian / Changeover')return STATUS.MATERIAL;
  if(status==='Standby')return STATUS.NORMAL;
  return status||STATUS.NORMAL;
}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}

function getPosition(d){
  const fallback=(currentFloor===2?LAYOUT_POSITIONS_FLOOR2:LAYOUT_POSITIONS)[d.department]||{left:50,top:50};
  const left=Number(d.position_left), top=Number(d.position_top);
  return {
    left:Number.isFinite(left)?left:fallback.left,
    top:Number.isFinite(top)?top:fallback.top
  };
}
function renderBoard(){
  const board=document.getElementById('board'); if(!board)return;
  board.innerHTML='';
  const groups={};
  departments.filter(d=>Number(d.floor||1)===currentFloor&&Number(d.is_active)!==0)
    .forEach(d=>(groups[d.cluster]??=[]).push(d));
  Object.entries(groups).forEach(([cluster,items])=>{
    const section=document.createElement('section'); section.className='cluster';
    const title=cluster==='Final Check'?'FINAL CHECK':`CLUSTER ${esc(cluster)}`;
    section.innerHTML=`<div class="cluster-title">${title}</div><div class="cards"></div>`;
    const cards=section.querySelector('.cards');
    items.forEach(d=>{
      const cls=statusClass(d.status), card=document.createElement('article');
      card.className=`card ${cls} ${cls!=='normal'?'status-pulse':''}`;
      card.innerHTML=`<h3>${esc(d.department)}</h3><span class="badge">${esc(displayStatus(d.status))}</span>`;
      cards.appendChild(card);
    });
    board.appendChild(section);
  });
}
function renderLayout(){
  const markers=document.getElementById('markers'); if(!markers)return;
  markers.innerHTML='';
  departments.filter(d=>Number(d.floor||1)===currentFloor&&Number(d.is_active)!==0).forEach(d=>{
    const pos=getPosition(d), cls=statusClass(d.status);
    const marker=document.createElement('div');
    marker.className=`marker ${cls} ${cls!=='normal'?'status-pulse':''} ${IS_SETTINGS?'draggable-marker':''}`;
    marker.style.left=`${pos.left}%`; marker.style.top=`${pos.top}%`;
    marker.title=IS_SETTINGS?'Drag untuk memindahkan posisi':`${d.department} | ${displayStatus(d.status)}`;
    marker.textContent=d.department;
    marker.dataset.id=d.id;
    if(IS_SETTINGS){
      marker.addEventListener('pointerdown',startDrag);
      marker.addEventListener('dblclick',()=>openEditModal(d.id));
    }
    markers.appendChild(marker);
  });
}
function renderKpi(){
  const visible=departments.filter(d=>Number(d.floor||1)===currentFloor&&Number(d.is_active)!==0);
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
  set('total',visible.length); set('normal',visible.filter(d=>statusClass(d.status)==='normal').length);
  set('machine',visible.filter(d=>statusClass(d.status)==='danger').length);
  set('material',visible.filter(d=>statusClass(d.status)==='warning').length);
  set('quality',visible.filter(d=>statusClass(d.status)==='quality').length);
}

function startDrag(e){
  e.preventDefault();
  const marker=e.currentTarget;
  draggedMarker={id:Number(marker.dataset.id), pointerId:e.pointerId};
  marker.classList.add('dragging');
  marker.setPointerCapture(e.pointerId);
  marker.addEventListener('pointermove',dragMarker);
  marker.addEventListener('pointerup',endDrag,{once:true});
  marker.addEventListener('pointercancel',endDrag,{once:true});
}
function dragMarker(e){
  if(!draggedMarker)return;
  const map=document.getElementById('mapStage'), rect=map.getBoundingClientRect();
  let left=((e.clientX-rect.left)/rect.width)*100;
  let top=((e.clientY-rect.top)/rect.height)*100;
  left=Math.max(0,Math.min(100,left)); top=Math.max(0,Math.min(100,top));
  const d=departments.find(x=>Number(x.id)===draggedMarker.id); if(!d)return;
  d.position_left=Number(left.toFixed(2)); d.position_top=Number(top.toFixed(2));
  e.currentTarget.style.left=`${d.position_left}%`; e.currentTarget.style.top=`${d.position_top}%`;
  dirtyPositions.add(d.id);
  updateSaveButton();
}
function endDrag(e){
  const marker=e.currentTarget;
  marker.classList.remove('dragging');
  marker.removeEventListener('pointermove',dragMarker);
  draggedMarker=null;
}
function updateSaveButton(){
  const b=document.getElementById('saveLayoutBtn'); if(!b)return;
  b.textContent=dirtyPositions.size?`💾 SIMPAN POSISI (${dirtyPositions.size})`:'💾 SIMPAN POSISI';
  b.disabled=dirtyPositions.size===0;
}
async function savePositions(){
  if(!dirtyPositions.size)return;
  const btn=document.getElementById('saveLayoutBtn');
  btn.disabled=true; btn.textContent='Menyimpan...';
  try{
    for(const id of [...dirtyPositions]){
      const d=departments.find(x=>Number(x.id)===Number(id));
      if(!d)continue;
      const r=await fetch(`/api/departments/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({position_left:d.position_left,position_top:d.position_top})});
      const data=await r.json(); if(!r.ok)throw new Error(data.error||'Gagal menyimpan posisi');
    }
    dirtyPositions.clear();
    document.getElementById('dbStatus').textContent='Database: posisi layout tersimpan';
  }catch(e){
    document.getElementById('dbStatus').textContent=`Gagal menyimpan: ${e.message}`;
  }finally{updateSaveButton();}
}
document.getElementById('saveLayoutBtn')?.addEventListener('click',savePositions);

function problemClass(problem){return problem==='Machine'?'machine':problem==='Material'?'material':problem==='Quality'?'quality':'';}
function formatDuration(seconds,startTime){
  let total=(seconds===null||seconds===undefined||seconds==='')?NaN:Number(seconds);
  if(!Number.isFinite(total)&&startTime)total=Math.max(0,Math.floor((Date.now()-new Date(startTime.replace(' ','T')).getTime())/1000));
  if(!Number.isFinite(total))return'-';
  return`${String(Math.floor(total/3600)).padStart(2,'0')}:${String(Math.floor(total%3600/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
}
function renderHistory(rows){
  const body=document.getElementById('historyBody');if(!body)return;
  if(!rows.length){body.innerHTML='<tr><td colspan="7" class="history-empty">Belum ada histori Andon.</td></tr>';return;}
  body.innerHTML=rows.map(r=>{
    const cls=problemClass(r.problem_type),start=(r.start_time||'').split(' '),end=(r.end_time||'').split(' ');
    return`<tr><td>${esc(start[0]||'-')}</td><td>${esc(start[1]||'-')}</td><td>${esc(r.department)}</td>
    <td><span class="history-problem ${cls}">${esc(r.problem_type)}</span></td><td>${esc(end[1]||'AKTIF')}</td>
    <td>${formatDuration(r.duration_seconds,r.start_time)}</td><td><span class="history-state ${r.end_time?'closed':'active'}">${r.end_time?'Selesai':'Aktif'}</span></td></tr>`;
  }).join('');
}
async function loadHistory(){
  try{const r=await fetch(`/api/history?floor=${currentFloor}`,{cache:'no-store'});renderHistory(await r.json());}
  catch(e){console.error('History error:',e);}
}

function setFloor(floor){
  currentFloor=Number(floor)===2?2:1;
  document.querySelectorAll('.floor-tab').forEach(b=>b.classList.toggle('active',Number(b.dataset.floor)===currentFloor));
  const cfg=FLOOR_CONFIG[currentFloor], title=document.getElementById('layoutTitle'),img=document.getElementById('layoutImage');
  if(title)title.textContent=cfg.title;if(img){img.src=cfg.image;img.alt=cfg.alt;}
  renderKpi();renderBoard();renderLayout();
  if(!IS_SETTINGS)loadHistory();
  if(IS_SETTINGS)renderSettingsLines();
}
document.querySelectorAll('.floor-tab').forEach(b=>b.addEventListener('click',()=>setFloor(b.dataset.floor)));

let mapZoom=1; const ZOOM_MIN=.6,ZOOM_MAX=2.5,ZOOM_STEP=.1;
function applyMapZoom(){
  const map=document.getElementById('layoutMap'),stage=document.getElementById('mapStage'),value=document.getElementById('zoomResetBtn');
  if(!map||!stage)return;
  stage.style.setProperty('--map-zoom',mapZoom.toFixed(2));map.style.setProperty('--map-zoom',mapZoom.toFixed(2));
  if(value)value.textContent=`${Math.round(mapZoom*100)}%`;
}
function setMapZoom(v){mapZoom=Math.min(ZOOM_MAX,Math.max(ZOOM_MIN,Math.round(v*10)/10));applyMapZoom();}
document.getElementById('zoomInBtn')?.addEventListener('click',()=>setMapZoom(mapZoom+ZOOM_STEP));
document.getElementById('zoomOutBtn')?.addEventListener('click',()=>setMapZoom(mapZoom-ZOOM_STEP));
document.getElementById('zoomResetBtn')?.addEventListener('click',()=>setMapZoom(1));
document.getElementById('layoutMap')?.addEventListener('wheel',e=>{e.preventDefault();setMapZoom(mapZoom+(e.deltaY<0?ZOOM_STEP:-ZOOM_STEP));},{passive:false});
applyMapZoom();

async function load(){
  try{
    const url=IS_SETTINGS?'/api/departments?include_inactive=1':'/api/departments';
    const r=await fetch(url,{cache:'no-store'});departments=await r.json();
    renderKpi();renderBoard();renderLayout();if(IS_SETTINGS)renderSettingsLines();
    document.getElementById('dbStatus').textContent='Database: SQLite terhubung';
  }catch(e){document.getElementById('dbStatus').textContent='Database: gagal terhubung';console.error(e);}
}

// ---------------- SETTING: LINE MANAGEMENT ----------------
const modal=document.getElementById('lineModal'), form=document.getElementById('lineForm'), message=document.getElementById('lineFormMessage');
function resetLineForm(){
  if(!form)return;
  form.reset();document.getElementById('lineId').value='';
  document.getElementById('lineFloor').value=String(currentFloor);
  document.getElementById('lineLeft').value='50';document.getElementById('lineTop').value='50';
  document.getElementById('lineModalTitle').textContent='TAMBAH LINE';
  message.textContent='';message.className='form-message full';
}
function openAddModal(){resetLineForm();modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');document.getElementById('lineName').focus();}
function openEditModal(id){
  const d=departments.find(x=>Number(x.id)===Number(id));if(!d||!modal)return;
  document.getElementById('lineId').value=d.id;document.getElementById('lineFloor').value=d.floor;
  document.getElementById('lineCluster').value=d.cluster;document.getElementById('lineName').value=d.department;
  const p=getPosition(d);document.getElementById('lineLeft').value=p.left.toFixed(2);document.getElementById('lineTop').value=p.top.toFixed(2);
  document.getElementById('lineModalTitle').textContent='EDIT LINE';
  message.textContent='';message.className='form-message full';
  modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
}
function closeLineModal(){if(!modal)return;modal.classList.add('hidden');modal.setAttribute('aria-hidden','true');}
document.getElementById('addLineBtn')?.addEventListener('click',openAddModal);
document.getElementById('closeLineModal')?.addEventListener('click',closeLineModal);
document.getElementById('cancelLineBtn')?.addEventListener('click',closeLineModal);
modal?.addEventListener('click',e=>{if(e.target===modal)closeLineModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal?.classList.contains('hidden'))closeLineModal();});

form?.addEventListener('submit',async e=>{
  e.preventDefault();
  const id=document.getElementById('lineId').value;
  const payload={floor:Number(document.getElementById('lineFloor').value),cluster:document.getElementById('lineCluster').value.trim(),
    department:document.getElementById('lineName').value.trim(),position_left:Number(document.getElementById('lineLeft').value),position_top:Number(document.getElementById('lineTop').value)};
  message.textContent='Menyimpan...';message.className='form-message full';
  try{
    const r=await fetch(id?`/api/departments/${id}`:'/api/departments',{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data=await r.json();if(!r.ok)throw new Error(data.error||'Gagal menyimpan line');
    closeLineModal();dirtyPositions.delete(Number(id));await load();
    if(Number(payload.floor)!==currentFloor)setFloor(payload.floor);
  }catch(err){message.textContent=err.message;message.className='form-message full error';}
});

async function toggleLine(id,active){
  const action=active?'menonaktifkan':'mengaktifkan kembali';
  if(!confirm(`Yakin ingin ${action} line ini?`))return;
  try{
    const r=await fetch(`/api/departments/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_active:active?0:1})});
    const data=await r.json();if(!r.ok)throw new Error(data.error||'Gagal mengubah status line');
    await load();
  }catch(e){alert(e.message);}
}
function renderSettingsLines(){
  const body=document.getElementById('settingsLineBody');if(!body)return;
  const rows=departments.filter(d=>Number(d.floor||1)===currentFloor);
  if(!rows.length){body.innerHTML='<tr><td colspan="6" class="history-empty">Belum ada line.</td></tr>';return;}
  body.innerHTML=rows.map(d=>{
    const p=getPosition(d),active=Number(d.is_active)!==0;
    return`<tr class="${active?'':'inactive-row'}"><td>Lantai ${d.floor}</td><td>${esc(d.cluster)}</td><td><b>${esc(d.department)}</b></td>
      <td><span class="line-active ${active?'yes':'no'}">${active?'Aktif':'Nonaktif'}</span></td>
      <td>${p.left.toFixed(1)}% / ${p.top.toFixed(1)}%</td>
      <td class="table-actions"><button class="mini-btn" onclick="openEditModal(${d.id})">✏ Edit</button>
      <button class="mini-btn ${active?'danger-btn':''}" onclick="toggleLine(${d.id},${active})">${active?'Nonaktifkan':'Aktifkan'}</button></td></tr>`;
  }).join('');
}
window.openEditModal=openEditModal;window.toggleLine=toggleLine;

load();
if(!IS_SETTINGS){loadHistory();setInterval(load,5000);setInterval(loadHistory,5000);}
