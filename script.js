const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const panel=$('#panel'), designArea=$('#designArea'), artboard=$('#artboard'), garmentWrap=$('#garmentWrap'), garmentCanvas=$('#garmentCanvas'), garmentCtx=garmentCanvas.getContext('2d');
const local3d=$('#local3d'), local3dScene=$('#local3dScene'), hoodieCube=$('#hoodieCube');
const dashboard=$('#dashboard'), workspace=$('#workspace'), projectsGrid=$('#projectsGrid');

const products={
  hoodie:{
    id:'hoodie',
    name:'Hoodie Oversize',
    shortName:'Hoodie',
    fit:'Oversize',
    description:'La sudadera original de ONLY UNBROKEN.',
    defaultColor:'#e1e2e6',
    sources:{front:'hoodie_front.png',back:'hoodie_back.png',left:'hoodie_left.png',right:'hoodie_right.png'}
  },
  tee:{
    id:'tee',
    name:'Playera Regular',
    shortName:'Playera',
    fit:'Regular / relajada',
    description:'Caída media, largo normal y manga estándar. No oversize ni crop.',
    defaultColor:'#e7e7e7',
    sources:{front:'tee_real_front_v18.png',back:'tee_real_back_v18.png',left:'tee_real_left_v18.png',right:'tee_real_right_v18.png'}
  }
};

const productImages={};
Object.values(products).forEach(product=>{
  productImages[product.id]={};
  Object.entries(product.sources).forEach(([face,src])=>{
    const im=new Image();
    im.decoding='async';
    im.src=src;
    productImages[product.id][face]=im;
  });
});

let currentProduct='hoodie';
let garmentColor=products.hoodie.defaultColor;
let activeTool='product', activeTab='design', layers=[], selectedId=null, seq=1, library=[];
let viewMode='edit', showGrid=false, backgroundMode='light', currentFace='front', editorZoom=1;
let yaw3d=0, dragging3d=false, dragStartX=0, dragStartYaw=0;
const zoomPointers=new Map();
let pinchActive=false,pinchStartDistance=0,pinchStartZoom=1;
const faceAngles={front:0,right:-90,back:-180,left:-270};
const faceOrder=['front','right','back','left'];
const faceCanvas3D={front:$('#face3d-front'),back:$('#face3d-back'),left:$('#face3d-left'),right:$('#face3d-right')};
const layerImgCache=new Map();
const layerPreviewCache=new Map();
const faceBaseCache=new Map();
const RENDER_W=1060, RENDER_H=1380;

const projectsKey='only_unbroken_projects_v14';
const projectsMetaKey='only_unbroken_projects_v21_meta';
const legacyStateKey='only_unbroken_turntable_v11';
const studioDBName='only_unbroken_studio_v19';
const studioDBStore='autosave';
let projects=[];
let currentProjectId=null;
let autosaveTimer=null;
let templateColor='#111111';
let pendingIDBSave=null;
let idbSaving=false;

function projectFreshness(list){
 if(!Array.isArray(list)||!list.length)return 0;
 return list.reduce((m,p)=>Math.max(m,Number(p?.updatedAt)||0),0);
}

function readLocalSavedAt(){
 const meta=Number(localStorage.getItem(projectsMetaKey)||0);
 return meta||projectFreshness(projects);
}

function openStudioDB(){
 return new Promise((resolve,reject)=>{
   if(!('indexedDB' in window)){resolve(null);return}
   const req=indexedDB.open(studioDBName,1);
   req.onupgradeneeded=()=>{
     const db=req.result;
     if(!db.objectStoreNames.contains(studioDBStore))db.createObjectStore(studioDBStore);
   };
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error);
 });
}

async function writeIDBEnvelope(envelope){
 const db=await openStudioDB();
 if(!db)return;
 await new Promise((resolve,reject)=>{
   const tx=db.transaction(studioDBStore,'readwrite');
   tx.objectStore(studioDBStore).put(envelope,'projects');
   tx.oncomplete=()=>resolve();
   tx.onerror=()=>reject(tx.error);
   tx.onabort=()=>reject(tx.error);
 });
 db.close();
}

async function drainIDBSaves(){
 if(idbSaving)return;
 idbSaving=true;
 try{
   while(pendingIDBSave){
     const envelope=pendingIDBSave;
     pendingIDBSave=null;
     try{await writeIDBEnvelope(envelope)}catch(e){}
   }
 }finally{
   idbSaving=false;
 }
}

function persistProjectsIDB(savedAt=Date.now()){
 let copy;
 try{copy=JSON.parse(JSON.stringify(projects))}catch(e){copy=projects}
 pendingIDBSave={savedAt,projects:copy};
 drainIDBSaves();
}

async function loadProjectsIDB(){
 try{
   const db=await openStudioDB();
   if(!db)return {savedAt:0,projects:[]};
   const raw=await new Promise((resolve,reject)=>{
     const tx=db.transaction(studioDBStore,'readonly');
     const req=tx.objectStore(studioDBStore).get('projects');
     req.onsuccess=()=>resolve(req.result||null);
     req.onerror=()=>reject(req.error);
   });
   db.close();

   // V19/V20 stored a plain array. V21 stores {savedAt, projects}.
   if(Array.isArray(raw)){
     return {savedAt:projectFreshness(raw),projects:raw};
   }
   if(raw&&Array.isArray(raw.projects)){
     return {savedAt:Number(raw.savedAt)||projectFreshness(raw.projects),projects:raw.projects};
   }
   return {savedAt:0,projects:[]};
 }catch(e){
   return {savedAt:0,projects:[]};
 }
}

function queueAutosave(delay=300){
 if(!currentProjectId)return;
 clearTimeout(autosaveTimer);
 autosaveTimer=setTimeout(()=>saveState(),delay);
}

function hexToRgb(h){h=h.replace('#','');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]}
function faceName(face){return ({front:'Frente',back:'Espalda',left:'Lado izquierdo',right:'Lado derecho'})[face]||'Frente'}
function currentGarment(){const set=productImages[currentProduct];return set[currentFace]||set.front}
function getTintedFace(face){
 const cacheKey=currentProduct+':'+face;
 const cached=faceBaseCache.get(cacheKey);
 if(cached && cached.color===garmentColor)return cached.canvas;
 const img=productImages[currentProduct][face];
 if(!img || !img.complete || !img.naturalWidth)return null;

 const c=document.createElement('canvas');
 c.width=RENDER_W;c.height=RENDER_H;
 const ctx=c.getContext('2d',{willReadFrequently:true});
 ctx.imageSmoothingEnabled=true;
 ctx.imageSmoothingQuality='high';
 ctx.clearRect(0,0,RENDER_W,RENDER_H);
 ctx.drawImage(img,0,0,RENDER_W,RENDER_H);

 const imageData=ctx.getImageData(0,0,RENDER_W,RENDER_H);
 const d=imageData.data,[r,g,b]=hexToRgb(garmentColor);
 for(let i=0;i<d.length;i+=4){
   if(d[i+3]===0)continue;
   const lum=(d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722)/255;
   const shade=Math.max(.3,Math.min(1.16,.2+lum*1.02));
   const detail=(lum-.62)*18;
   d[i]=Math.max(0,Math.min(255,r*shade+detail));
   d[i+1]=Math.max(0,Math.min(255,g*shade+detail));
   d[i+2]=Math.max(0,Math.min(255,b*shade+detail));
 }
 ctx.putImageData(imageData,0,0);
 faceBaseCache.set(cacheKey,{color:garmentColor,canvas:c});
 return c;
}

function renderGarment(){
 const base=getTintedFace(currentFace);
 if(!base)return;
 garmentCtx.imageSmoothingEnabled=true;
 garmentCtx.imageSmoothingQuality='high';
 garmentCtx.clearRect(0,0,garmentCanvas.width,garmentCanvas.height);
 garmentCtx.drawImage(base,0,0,garmentCanvas.width,garmentCanvas.height);
}

Object.entries(productImages).forEach(([productId,set])=>{
 Object.entries(set).forEach(([face,im])=>{
   im.onload=()=>{
     faceBaseCache.delete(productId+':'+face);
     if(productId===currentProduct){
       if(face===currentFace)renderGarment();
       renderAll3D(face);
     }
   };
 });
});

function tintGarmentToCanvas(face,targetCanvas){
 const base=getTintedFace(face);
 if(!base)return;
 const tx=targetCanvas.getContext('2d');
 const W=targetCanvas.width,H=targetCanvas.height;
 tx.imageSmoothingEnabled=true;
 tx.imageSmoothingQuality='high';
 tx.clearRect(0,0,W,H);
 tx.drawImage(base,0,0,W,H);

 const faceLayers=layers.filter(l=>(l.face||'front')===face);
 faceLayers.forEach(l=>{
   let im=layerImgCache.get(l.data);
   if(!im){
     im=new Image();
     im.decoding='async';
     im.onload=()=>renderAll3D(face);
     im.src=l.data;
     layerImgCache.set(l.data,im);
   }
   if(!im.complete || !im.naturalWidth)return;

   const w=l.w/100*W;
   const h=w/(l.aspect||1);
   const x=l.x/100*W;
   const y=l.y/100*H;

   drawLayerToContext(tx,l,im,x,y,w,h);
 });
}

function renderAll3D(faceOnly=null){
 if(faceOnly && faceCanvas3D[faceOnly]){
   tintGarmentToCanvas(faceOnly,faceCanvas3D[faceOnly]);
   return;
 }
 Object.keys(faceCanvas3D).forEach(face=>tintGarmentToCanvas(face,faceCanvas3D[face]));
}

function normalizedTurn(v){
 // 0 = front, 90 = right, 180 = back, 270 = left
 return ((-v)%360+360)%360;
}

function easeTurn(t){
 return t*t*(3-2*t);
}

function apply3DRotation(animate=true){
 if(!hoodieCube)return;
 hoodieCube.classList.toggle('dragging',!animate);
 const turn=normalizedTurn(yaw3d);
 const segment=turn/90;
 const idx=Math.floor(segment)%4;
 const rawT=segment-Math.floor(segment);
 const t=easeTurn(rawT);
 const a=faceOrder[idx];
 const b=faceOrder[(idx+1)%4];

 // Keep a garment visible during the entire rotation. This replaces the old
 // cube edge-on behavior that made the hoodie disappear mid-drag.
 for(const face of faceOrder){
   const c=faceCanvas3D[face];
   if(!c)continue;
   if(face===a){
     const sx=1-(.18*t);
     const tx=-7*t;
     c.style.opacity=String(1-t);
     c.style.transform=`translateX(${tx}%) scaleX(${sx}) scaleY(${1-.015*t})`;
     c.style.filter=`brightness(${1-.04*t})`;
     c.style.zIndex='2';
   }else if(face===b){
     const sx=.82+(.18*t);
     const tx=7*(1-t);
     c.style.opacity=String(t);
     c.style.transform=`translateX(${tx}%) scaleX(${sx}) scaleY(${.985+.015*t})`;
     c.style.filter=`brightness(${.96+.04*t})`;
     c.style.zIndex='3';
   }else{
     c.style.opacity='0';
     c.style.transform='scaleX(.88)';
     c.style.zIndex='1';
   }
 }
 hoodieCube.style.transform='rotateX(-1.5deg)';
}

function snap3DToFace(face,animate=true){
 yaw3d=faceAngles[face] ?? 0;
 apply3DRotation(animate);
}

function normalizeYaw(v){
 let n=((v+180)%360+360)%360-180;
 return n;
}

function nearestFaceFromYaw(v){
 const turn=normalizedTurn(v);
 const idx=Math.round(turn/90)%4;
 return faceOrder[idx];
}

local3dScene.addEventListener('pointerdown',e=>{
 if(viewMode!=='3d')return;
 dragging3d=true;
 dragStartX=e.clientX;
 dragStartYaw=yaw3d;
 hoodieCube.classList.add('dragging');
 local3dScene.setPointerCapture?.(e.pointerId);
 e.preventDefault();
});
local3dScene.addEventListener('pointermove',e=>{
 if(!dragging3d || viewMode!=='3d')return;
 const rect=local3dScene.getBoundingClientRect();
 yaw3d=dragStartYaw-(e.clientX-dragStartX)/Math.max(280,rect.width)*125;
 apply3DRotation(false);
 e.preventDefault();
});
function end3DDrag(){
 if(!dragging3d)return;
 dragging3d=false;
 hoodieCube.classList.remove('dragging');
 const face=nearestFaceFromYaw(yaw3d);
 currentFace=face;
 $$('.faceSwitcher [data-face]').forEach(b=>b.classList.toggle('active',b.dataset.face===face));
 snap3DToFace(face,true);
 renderPanel();
 saveState();
 notify('Modelo 3D · '+faceName(face).toLowerCase());
}
local3dScene.addEventListener('pointerup',end3DDrag);
local3dScene.addEventListener('pointercancel',end3DDrag);

function notify(msg){$('#stageHint').innerHTML='<span class="statusDot"></span>'+msg}
function setTool(tool){
 activeTool=tool; activeTab='design';
 $$('.tool[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));
 $$('.topnav button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='design'));
 renderPanel();
}
$$('.tool[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));

$$('.topnav button').forEach(b=>b.onclick=()=>{
 const tab=b.dataset.tab;
 if(tab==='home'){showDashboard();return}
 if(!currentProjectId){showDashboard();return}
 showEditorShell();
 activeTab=tab;
 $$('.topnav button').forEach(x=>x.classList.toggle('active',x===b));
 if(activeTab==='design') activeTool='product';
 renderPanel();
});

function renderPanel(){
 let h='';
 if(activeTab==='library'){
   h=`<h2>Biblioteca</h2><p>Tus diseños subidos aparecen aquí. Tócalos para agregarlos.</p>
   <div class="card"><div class="cardTitle">Tus archivos</div><div class="libraryGrid" id="libraryGrid">${libraryHTML()}</div></div>`;
 } else if(activeTab==='templates'){
   const tsw=['#111111','#ffffff','#e6dfcf','#8f93a3','#314c7a','#6e4b58','#4c624f','#7a5c86'];
   h=`<h2>Plantillas</h2><p>Elige el color y luego toca una plantilla. Después también puedes cambiarle el color desde Capas.</p>
   <div class="card"><div class="cardTitle">Color de la plantilla</div>
   <input id="templateColor" type="color" value="${templateColor}">
   <div class="swatches" style="margin-top:10px">${tsw.map(c=>`<button class="swatch ${c===templateColor?'active':''}" data-template-color="${c}" style="background:${c}"></button>`).join('')}</div>
   </div>
   <div class="card"><div class="cardTitle">Streetwear</div><div class="templateGrid">
   ${['ONLY UNBROKEN','NEVER FOLD','KEEP GOING','RESILIENCE','NO LIMITS','STAY REAL'].map(t=>`<button class="template" data-template="${t}" style="background:#f3f4f7;color:${templateColor};border-color:#d5d9e3"><strong>${t}</strong></button>`).join('')}
   </div></div>`;
 } else if(activeTab==='settings'){
   h=`<h2>Ajustes</h2><p>Configura la mesa de trabajo.</p>
   <div class="card"><div class="cardTitle">Vista sincronizada</div>
   <div class="row"><button class="btn" id="toggleGrid">${showGrid?'Quitar':'Mostrar'} cuadrícula</button><button class="btn" id="toggleBg">Fondo ${backgroundMode==='light'?'oscuro':'claro'}</button></div>
   <button class="btn wide" style="margin-top:8px" id="clearAll">Eliminar todos los diseños</button></div>`;
 } else if(activeTool==='product'){
   const p=products[currentProduct];
   h=`<h2>${p.name}</h2><p>${p.description}</p>
   <div class="card"><div class="cardTitle">Producto actual</div>
   <div style="display:flex;gap:10px;align-items:center"><div style="width:62px;height:72px;background:#eef1f6;border-radius:12px;display:grid;place-items:center"><img src="${p.sources.front}" style="max-width:56px;max-height:68px"></div>
   <div style="min-width:0"><b style="font-size:12px">${p.name}</b><div style="color:#8996bd;font-size:10px;margin-top:3px">${p.fit} · ${faceName(currentFace)}</div></div></div>
   <button class="btn wide" id="backToStudio" style="margin-top:10px">Prendas y mis proyectos</button></div>`;
 } else if(activeTool==='colors'){
   const sw=['#e1e2e6','#111216','#8b8f98','#344d7b','#536558','#72555a','#d6c2a2','#5a3b67'];
   h=`<h2>Colores</h2><p>El color se aplica a la prenda completa en frente, espalda y lados.</p>
   <div class="card"><div class="cardTitle">Color de la prenda</div>
   <input id="hoodColor" type="color" value="${garmentColor}">
   <div class="swatches" style="margin-top:10px">${sw.map(c=>`<button class="swatch ${c===garmentColor?'active':''}" data-color="${c}" style="background:${c}"></button>`).join('')}</div></div>`;
 } else if(activeTool==='text'){
   h=`<h2>Textos</h2><p>Agrega texto y muévelo directamente sobre la prenda.</p>
   <div class="card"><label>Texto</label><input id="textValue" type="text" value="ONLY UNBROKEN" maxlength="60">
   <div class="row"><div><label>Tipografía</label><select id="fontValue"><option>Impact</option><option>Arial Black</option><option>Georgia</option><option>Courier New</option></select></div>
   <div style="max-width:64px"><label>Color</label><input id="textColor" type="color" value="#111111"></div></div>
   <button class="btn primary wide" id="addText" style="margin-top:10px">Agregar texto</button></div>`;
 } else if(activeTool==='images'){
   h=`<h2>Imágenes</h2><p>Sube PNG, JPG o WEBP. Después arrástralo sobre el mockup.</p>
   <div class="card"><div class="uploadBox">Selecciona tu diseño<br><br><input id="imgUpload" type="file" accept="image/png,image/jpeg,image/webp"></div></div>`;
 } else if(activeTool==='pencil'){
   h=`<h2>Apple Pencil</h2><p>Dibuja, luego inserta el dibujo sobre la prenda.</p>
   <div class="card"><canvas id="pencilCanvas" class="pencilPad" width="1600" height="1200"></canvas>
   <div class="row"><div><label>Color</label><input id="pencilColor" type="color" value="#111111"></div><div><label>Grosor</label><input id="pencilSize" type="range" min="3" max="45" value="14"></div></div>
   <div class="row" style="margin-top:9px"><button class="btn" id="pencilClear">Limpiar</button><button class="btn primary" id="pencilAdd">Agregar dibujo</button></div></div>`;
 } else if(activeTool==='layers'){
   h=`<h2>Capas</h2><p>Aquí aparecen los diseños de todas las vistas. Toca uno para ir directo a él y editarlo.</p><div class="card">${layersHTML()}</div>
   ${selected()?`<div class="card"><div class="cardTitle">Seleccionado · ${faceName(selected().face||'front')}</div>
   ${selected().type==='plantilla'?`<label>Color de la plantilla</label>
   <input id="selectedTemplateColor" type="color" value="${selected().textColor||'#111111'}">
   <div class="swatches" style="margin:8px 0 10px">${['#111111','#ffffff','#e6dfcf','#8f93a3','#314c7a','#6e4b58','#4c624f','#7a5c86'].map(c=>`<button class="swatch ${c===(selected().textColor||'#111111')?'active':''}" data-selected-template-color="${c}" style="background:${c}"></button>`).join('')}</div>`:''}
   ${selected().type==='imagen'?`<label>Opacidad</label><input id="layerOpacity" type="range" min="5" max="100" value="${Math.round((selected().opacity??1)*100)}">
   <label>Intensidad / visibilidad</label><input id="layerIntensity" type="range" min="60" max="260" value="${Math.round((selected().intensity??1)*100)}">
   <label>Color sólido para que resalte</label><input id="selectedImageTint" type="color" value="${selected().tintColor||'#ffffff'}">
   <div class="row" style="margin-top:8px"><button class="btn ${selected().forceColor?'primary':''}" id="toggleImageTint">${selected().forceColor?'Quitar color sólido':'Usar color sólido'}</button><button class="btn" id="resetImageAdjust">Restablecer imagen</button></div>
   <div class="smallMuted" style="text-align:left;margin:8px 0 4px">Tip: si tu diseño es negro y la prenda también, activa “Usar color sólido” y elige blanco.</div>`:''}
   <label>Tamaño</label><input id="layerSize" type="range" min="8" max="80" value="${selected().w}">
   <label>Rotación</label><input id="layerRot" type="range" min="-180" max="180" value="${selected().rot}">
   <label>Mover este diseño a otra vista</label>
   <div class="faceMoveGrid">
     ${['front','back','left','right'].map(f=>`<button class="btn ${f===(selected().face||'front')?'active':''}" data-move-face="${f}">${faceName(f)}</button>`).join('')}
   </div>
   <div class="row" style="margin-top:8px"><button class="btn" id="centerSelected">Centrar</button><button class="btn primary" id="finishSelected">Listo · dejar de editar</button></div>
   <button class="btn wide" id="deleteSelected" style="margin-top:7px;color:#ff9aa5">Eliminar</button></div>`:''}`;
 }
 panel.innerHTML=h; bindPanel();
}
function libraryHTML(){
 if(!library.length)return `<div style="grid-column:1/-1;color:#8190ba;font-size:10px;padding:16px;text-align:center">Todavía no has subido imágenes.</div>`;
 return library.map((x,i)=>`<button class="libraryItem" data-lib="${i}"><img src="${x.data}"><span>${x.name}</span></button>`).join('');
}
function visibleLayers(){return layers.filter(l=>(l.face||'front')===currentFace)}
function layersHTML(){
 if(!layers.length)return `<div style="color:#8190ba;font-size:10px;text-align:center;padding:14px">Todavía no hay diseños.</div>`;
 return layers.slice().reverse().map(l=>`<div class="layerItem ${l.id===selectedId?'active':''}" data-layer="${l.id}"><div class="layerThumb"><img src="${l.data}"></div><div class="layerText"><b>${l.name}</b><span>${l.type} · ${faceName(l.face||'front')}</span></div></div>`).join('');
}
function bindPanel(){
 if(activeTool==='product'&&activeTab==='design'){
   const back=$('#backToStudio');
   if(back)back.onclick=()=>showDashboard();
 }
 if(activeTab==='library') panel.querySelectorAll('[data-lib]').forEach(b=>b.onclick=()=>addLayer(library[+b.dataset.lib].data,library[+b.dataset.lib].name,'imagen'));
 if(activeTab==='templates'){
   const tc=$('#templateColor');
   if(tc)tc.oninput=e=>{templateColor=e.target.value;renderPanel()};
   panel.querySelectorAll('[data-template-color]').forEach(b=>b.onclick=()=>{templateColor=b.dataset.templateColor;renderPanel()});
   panel.querySelectorAll('[data-template]').forEach(b=>b.onclick=()=>addTextLayer(b.dataset.template,'Impact',templateColor,'plantilla'));
 }
 if(activeTab==='settings'){
   $('#toggleGrid').onclick=()=>{showGrid=!showGrid;$('#gridbg').style.display=showGrid?'block':'none';renderPanel()};
   $('#toggleBg').onclick=()=>{backgroundMode=backgroundMode==='light'?'dark':'light';$('#artboard').style.background=backgroundMode==='light'?'radial-gradient(circle at 50% 42%,#fff 0,#f4f5f9 58%,#e9ebf2 100%)':'radial-gradient(circle at 50% 42%,#29314b 0,#141b31 68%,#0f1426 100%)';renderPanel()};
   $('#clearAll').onclick=()=>{layers=[];selectedId=null;renderLayers();saveState();renderPanel();notify('Diseños eliminados')};
 }
 if(activeTool==='colors'&&activeTab==='design'){
   $('#hoodColor').oninput=e=>{garmentColor=e.target.value;faceBaseCache.clear();renderGarment();renderAll3D();saveState()};
   panel.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{garmentColor=b.dataset.color;faceBaseCache.clear();renderGarment();renderAll3D();saveState();renderPanel()});
 }
 if(activeTool==='text'&&activeTab==='design') $('#addText').onclick=()=>addTextLayer($('#textValue').value,$('#fontValue').value,$('#textColor').value);
 if(activeTool==='images'&&activeTab==='design') $('#imgUpload').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{library.push({name:f.name,data:r.result});addLayer(r.result,f.name,'imagen');saveState()};r.readAsDataURL(f)};
 if(activeTool==='pencil'&&activeTab==='design') setupPencil();
 if(activeTool==='layers'&&activeTab==='design'){
   panel.querySelectorAll('[data-layer]').forEach(b=>b.onclick=()=>{
     selectedId=+b.dataset.layer;
     const l=selected();
     if(l){
       currentFace=l.face||'front';
       $$('.faceSwitcher [data-face]').forEach(x=>x.classList.toggle('active',x.dataset.face===currentFace));
       if(viewMode==='edit')renderGarment();
     }
     renderLayers();renderPanel();saveState();
   });
   if(selected()){
     if(selected().type==='plantilla'){
       const sc=$('#selectedTemplateColor');
       if(sc)sc.oninput=e=>recolorTemplateLayer(selected(),e.target.value);
       panel.querySelectorAll('[data-selected-template-color]').forEach(b=>b.onclick=()=>recolorTemplateLayer(selected(),b.dataset.selectedTemplateColor));
     }
     if(selected().type==='imagen'){
       const syncImageAdjust=()=>{layerPreviewCache.clear();renderLayers();if(activeTool==='layers')renderPanel();saveState()};
       const op=$('#layerOpacity');
       if(op)op.oninput=e=>{selected().opacity=Math.max(.05,Math.min(1,(+e.target.value||100)/100));syncImageAdjust()};
       const it=$('#layerIntensity');
       if(it)it.oninput=e=>{selected().intensity=Math.max(.6,Math.min(2.6,(+e.target.value||100)/100));syncImageAdjust()};
       const tint=$('#selectedImageTint');
       if(tint)tint.oninput=e=>{selected().tintColor=e.target.value;syncImageAdjust()};
       const toggleTint=$('#toggleImageTint');
       if(toggleTint)toggleTint.onclick=()=>{selected().forceColor=!selected().forceColor;syncImageAdjust()};
       const resetImg=$('#resetImageAdjust');
       if(resetImg)resetImg.onclick=()=>{Object.assign(selected(),{opacity:1,intensity:1,tintColor:'#ffffff',forceColor:false});syncImageAdjust()};
     }
     $('#layerSize').oninput=e=>{selected().w=+e.target.value;syncLayer(selected());saveState()};
     $('#layerRot').oninput=e=>{selected().rot=+e.target.value;syncLayer(selected());saveState()};
     $('#centerSelected').onclick=()=>{selected().x=50;selected().y=47;syncLayer(selected());saveState()};
     panel.querySelectorAll('[data-move-face]').forEach(b=>b.onclick=()=>moveSelectedToFace(b.dataset.moveFace));
     $('#finishSelected').onclick=finishEditing;
     $('#deleteSelected').onclick=()=>removeLayer(selected().id);
   }
 }
}
function textImage(text,font,color){
 const c=document.createElement('canvas');c.width=2400;c.height=720;const x=c.getContext('2d');
 x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';
 x.clearRect(0,0,c.width,c.height);x.fillStyle=color;x.textAlign='center';x.textBaseline='middle';
 let size=300;x.font=`900 ${size}px "${font}"`;while(x.measureText(text).width>2160&&size>90){size-=10;x.font=`900 ${size}px "${font}"`}
 x.fillText(text||'ONLY UNBROKEN',1200,360);
 return c.toDataURL('image/png');
}
function addTextLayer(text,font,color,type='texto'){
 addLayer(
   textImage(text,font,color),
   text||'Texto',
   type,
   {textValue:text||'Texto',fontValue:font||'Impact',textColor:color||'#111111'}
 );
}
function addLayer(data,name,type,extra={}){
 const im=new Image();im.onload=()=>{
   layerImgCache.set(data,im);
   const aspect=im.width/im.height;
   layers.push({id:seq++,data,name,type,aspect,x:50,y:47,w:Math.min(36,Math.max(18,22*aspect)),rot:0,face:currentFace,opacity:1,intensity:1,forceColor:false,tintColor:'#ffffff',...extra});
   selectedId=layers[layers.length-1].id;
   renderLayers();saveState();
   notify('Diseño agregado en '+faceName(currentFace).toLowerCase()+'. Arrástralo con el dedo o Apple Pencil.');
   setTool('layers')
 };
 im.src=data;
}
function recolorTemplateLayer(layer,color){
 if(!layer||layer.type!=='plantilla')return;
 const oldData=layer.data;
 layer.textColor=color;
 layer.textValue=layer.textValue||layer.name||'ONLY UNBROKEN';
 layer.fontValue=layer.fontValue||'Impact';
 layer.data=textImage(layer.textValue,layer.fontValue,color);
 layerImgCache.delete(oldData);
 renderLayers();
 saveState();
 if(activeTool==='layers')renderPanel();
 notify('Color de plantilla actualizado');
}
function selected(){return layers.find(l=>l.id===selectedId)||null}
function layerOpacityValue(l){return typeof l.opacity==='number'?Math.max(.05,Math.min(1,l.opacity)):1}
function layerIntensityValue(l){return typeof l.intensity==='number'?Math.max(.6,Math.min(2.6,l.intensity)):1}
function layerCanvasFilter(l){
 const intensity=layerIntensityValue(l);
 if(Math.abs(intensity-1)<0.01)return 'none';
 const contrast=1+Math.max(0,intensity-1)*0.75;
 const saturate=1+Math.max(0,intensity-1)*0.3;
 return `brightness(${intensity}) contrast(${contrast}) saturate(${saturate})`;
}
function layerNeedsTint(l){return l&&l.type==='imagen'&&!!l.forceColor}
function getTintedLayerPreviewData(l){
 if(!layerNeedsTint(l))return l.data;
 const key=[l.data,l.tintColor||'#ffffff'].join('|');
 const cached=layerPreviewCache.get(key);
 if(cached)return cached;
 const im=layerImgCache.get(l.data);
 if(!im||!im.complete||!im.naturalWidth)return l.data;
 const c=document.createElement('canvas');
 c.width=im.naturalWidth;c.height=im.naturalHeight;
 const x=c.getContext('2d');
 x.drawImage(im,0,0);
 x.globalCompositeOperation='source-in';
 x.fillStyle=l.tintColor||'#ffffff';
 x.fillRect(0,0,c.width,c.height);
 const out=c.toDataURL('image/png');
 layerPreviewCache.set(key,out);
 return out;
}
function applyLayerPreview(img,l){
 img.src=layerNeedsTint(l)?getTintedLayerPreviewData(l):l.data;
 img.style.opacity=String(layerOpacityValue(l));
 img.style.filter=layerNeedsTint(l)?'none':layerCanvasFilter(l);
}
function drawLayerToContext(tx,l,im,x,y,w,h){
 tx.save();
 tx.imageSmoothingEnabled=true;
 tx.imageSmoothingQuality='high';
 tx.globalAlpha=layerOpacityValue(l);
 tx.translate(x,y);
 tx.rotate((l.rot||0)*Math.PI/180);
 if(layerNeedsTint(l)){
   const off=document.createElement('canvas');
   off.width=im.naturalWidth||im.width;
   off.height=im.naturalHeight||im.height;
   const ox=off.getContext('2d');
   ox.imageSmoothingEnabled=true;
   ox.imageSmoothingQuality='high';
   ox.drawImage(im,0,0,off.width,off.height);
   ox.globalCompositeOperation='source-in';
   ox.fillStyle=l.tintColor||'#ffffff';
   ox.fillRect(0,0,off.width,off.height);
   tx.drawImage(off,-w/2,-h/2,w,h);
 } else {
   tx.filter=layerCanvasFilter(l);
   tx.drawImage(im,-w/2,-h/2,w,h);
 }
 tx.restore();
}
function renderLayers(){
 designArea.innerHTML='';
 visibleLayers().forEach(l=>{
   const el=document.createElement('div');el.className='designLayer'+(l.id===selectedId?' selected':'');el.dataset.id=l.id;
   el.style.left=l.x+'%';el.style.top=l.y+'%';el.style.width=l.w+'%';el.style.transform=`translate(-50%,-50%) rotate(${l.rot}deg)`;
   el.innerHTML=`<img src="${l.data}"><span class="handle rotate"></span><span class="handle resize"></span><span class="handle delete">×</span><span class="dragLabel">Mover</span>`;
   applyLayerPreview(el.querySelector('img'),l);
   designArea.appendChild(el);bindLayer(el,l);
 });
 const done=$('#doneEditBtn');
 if(done)done.style.display=(selectedId&&viewMode==='edit')?'inline-block':'none';
 renderAll3D();
}
function syncLayer(l){
 const el=designArea.querySelector(`[data-id="${l.id}"]`);if(el){el.style.left=l.x+'%';el.style.top=l.y+'%';el.style.width=l.w+'%';el.style.transform=`translate(-50%,-50%) rotate(${l.rot}deg)`;}
 renderAll3D(l.face||currentFace);
 queueAutosave();
}
function bindLayer(el,l){
 const resize=el.querySelector('.resize'),rotate=el.querySelector('.rotate'),del=el.querySelector('.delete');
 el.onpointerdown=e=>{
   if(e.target===resize||e.target===rotate||e.target===del)return;
   e.preventDefault();selectedId=l.id;renderLayers();if(activeTool==='layers')renderPanel();
   const area=designArea.getBoundingClientRect(),sx=e.clientX,sy=e.clientY,ox=l.x,oy=l.y;
   const move=ev=>{if(pinchActive)return;l.x=Math.max(4,Math.min(96,ox+(ev.clientX-sx)/area.width*100));l.y=Math.max(5,Math.min(95,oy+(ev.clientY-sy)/area.height*100));syncLayer(l)};
   const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);saveState()};
   window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
 };
 resize.onpointerdown=e=>{
   e.preventDefault();e.stopPropagation();const area=designArea.getBoundingClientRect(),sx=e.clientX,ow=l.w;
   const move=ev=>{l.w=Math.max(6,Math.min(80,ow+(ev.clientX-sx)/area.width*100));syncLayer(l)};
   const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);saveState();if(activeTool==='layers')renderPanel()};
   window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
 };
 rotate.onpointerdown=e=>{
   e.preventDefault();e.stopPropagation();const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
   const move=ev=>{l.rot=Math.round(Math.atan2(ev.clientY-cy,ev.clientX-cx)*180/Math.PI)+90;syncLayer(l)};
   const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);saveState();if(activeTool==='layers')renderPanel()};
   window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
 };
 del.onpointerdown=e=>{e.preventDefault();e.stopPropagation();removeLayer(l.id)};
}
function removeLayer(id){layers=layers.filter(x=>x.id!==id);if(selectedId===id)selectedId=null;renderLayers();saveState();renderPanel()}

function finishEditing(){
 if(!selectedId)return;
 selectedId=null;
 renderLayers();
 if(activeTool==='layers')renderPanel();
 saveState();
 notify('Diseño listo. Tócalo otra vez cuando quieras volver a editarlo.');
}
function moveSelectedToFace(face){
 const l=selected();if(!l)return;
 const oldFace=l.face||'front';
 l.face=face;
 currentFace=face;
 $$('.faceSwitcher [data-face]').forEach(b=>b.classList.toggle('active',b.dataset.face===face));
 if(viewMode==='edit'){renderGarment();renderLayers()}else{renderAll3D(oldFace);renderAll3D(face);snap3DToFace(face,true)}
 renderPanel();saveState();
 notify('Diseño movido a '+faceName(face).toLowerCase()+'. Puedes seguir acomodándolo sin volver a agregarlo.');
}
function setEditorZoom(value,save=true){
 editorZoom=Math.max(.6,Math.min(2.4,value));
 garmentWrap.style.setProperty('--editorZoom',editorZoom.toFixed(3));
 const z=$('#zoomResetBtn');if(z)z.textContent=Math.round(editorZoom*100)+'%';
 if(save)saveState();
}

function setupPencil(){
 const c=$('#pencilCanvas'),x=c.getContext('2d');x.lineCap='round';x.lineJoin='round';let drawing=false,last=null;
 const pos=e=>{const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*c.width/r.width,y:(e.clientY-r.top)*c.height/r.height}};
 c.onpointerdown=e=>{drawing=true;last=pos(e);c.setPointerCapture?.(e.pointerId);e.preventDefault()};
 c.onpointermove=e=>{if(!drawing)return;const p=pos(e),pressure=e.pointerType==='pen'&&e.pressure?e.pressure:.55;x.strokeStyle=$('#pencilColor').value;x.lineWidth=+$('#pencilSize').value*(.6+pressure*.8);x.beginPath();x.moveTo(last.x,last.y);x.lineTo(p.x,p.y);x.stroke();last=p;e.preventDefault()};
 c.onpointerup=()=>drawing=false;c.onpointercancel=()=>drawing=false;
 $('#pencilClear').onclick=()=>x.clearRect(0,0,c.width,c.height);
 $('#pencilAdd').onclick=()=>{const data=trimCanvas(c);if(data)addLayer(data,'Dibujo Apple Pencil','dibujo')};
}
function trimCanvas(c){
 const x=c.getContext('2d'),im=x.getImageData(0,0,c.width,c.height),d=im.data;let minX=c.width,minY=c.height,maxX=-1,maxY=-1;
 for(let y=0;y<c.height;y++)for(let xx=0;xx<c.width;xx++){if(d[(y*c.width+xx)*4+3]>5){minX=Math.min(minX,xx);maxX=Math.max(maxX,xx);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}}
 if(maxX<0){notify('Dibuja algo primero');return null}
 const p=18,w=maxX-minX+1+p*2,h=maxY-minY+1+p*2,o=document.createElement('canvas');o.width=w;o.height=h;o.getContext('2d').drawImage(c,minX-p,minY-p,w,h,0,0,w,h);return o.toDataURL('image/png')
}
function setView(mode){
 viewMode=mode;
 $('#editViewBtn').classList.toggle('active',mode==='edit');
 $('#view3dBtn').classList.toggle('active',mode==='3d');
 if(mode==='3d'){
   $('#artboard').style.display='none';
   local3d.style.display='block';
   renderAll3D();
   snap3DToFace(currentFace,true);
   const done=$('#doneEditBtn');if(done)done.style.display='none';
   notify('Modelo 3D listo · arrastra para girar');
 } else {
   local3d.style.display='none';
   $('#artboard').style.display='block';
   renderGarment();
   renderLayers();
   const done=$('#doneEditBtn');if(done)done.style.display=selectedId?'inline-block':'none';
   notify('Editor fácil listo · vista '+faceName(currentFace).toLowerCase());
 }
}
$('#editViewBtn').onclick=()=>setView('edit');$('#view3dBtn').onclick=()=>setView('3d');
$$('[data-face]').forEach(btn=>btn.onclick=()=>setFace(btn.dataset.face));
function setFace(face){
 currentFace=face;
 $$('.faceSwitcher [data-face]').forEach(b=>b.classList.toggle('active',b.dataset.face===face));
 if(selected() && (selected().face||'front')!==face) selectedId=null;
 if(viewMode==='3d'){
   renderAll3D();
   snap3DToFace(face,true);
 } else {
   renderGarment();
   renderLayers();
 }
 renderPanel();
 saveState();
 notify((viewMode==='3d'?'Modelo 3D':'Editor fácil')+' · vista '+faceName(face).toLowerCase());
}

$('#zoomOutBtn').onclick=()=>setEditorZoom(editorZoom-.15);
$('#zoomInBtn').onclick=()=>setEditorZoom(editorZoom+.15);
$('#zoomResetBtn').onclick=()=>setEditorZoom(1);
$('#doneEditBtn').onclick=finishEditing;

function pointerDistance(){
 const pts=[...zoomPointers.values()];
 if(pts.length<2)return 0;
 return Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
}
artboard.addEventListener('pointerdown',e=>{
 if(viewMode!=='edit'||e.pointerType==='mouse')return;
 const onDesign=!!e.target.closest?.('.designLayer');
 zoomPointers.set(e.pointerId,{x:e.clientX,y:e.clientY,onDesign});
 if(zoomPointers.size===2){
   const pts=[...zoomPointers.values()];
   if(!pts.some(p=>p.onDesign)){
     pinchActive=true;
     pinchStartDistance=pointerDistance();
     pinchStartZoom=editorZoom;
   }
 }
},true);
artboard.addEventListener('pointermove',e=>{
 if(!zoomPointers.has(e.pointerId))return;
 zoomPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(pinchActive&&zoomPointers.size>=2){
   const d=pointerDistance();
   if(pinchStartDistance>0){setEditorZoom(pinchStartZoom*(d/pinchStartDistance),false);queueAutosave();}
   e.preventDefault();
 }
},true);
const endZoomPointer=e=>{
 zoomPointers.delete(e.pointerId);
 if(zoomPointers.size<2){
   if(pinchActive)saveState();
   pinchActive=false;
 }
};
artboard.addEventListener('pointerup',endZoomPointer,true);
artboard.addEventListener('pointercancel',endZoomPointer,true);


// iPad/Safari: block native browser zoom inside the mockup.
// Custom editor zoom still works on empty mockup space.
['gesturestart','gesturechange','gestureend'].forEach(type=>{
 artboard.addEventListener(type,e=>e.preventDefault(),{passive:false});
});
artboard.addEventListener('touchmove',e=>{
 if(e.touches&&e.touches.length>1)e.preventDefault();
},{passive:false});

designArea.addEventListener('pointerdown',e=>{
 if(e.target===designArea&&!pinchActive&&selectedId)finishEditing();
});

$('#resetBtn').onclick=()=>{layers=[];selectedId=null;renderLayers();saveState();notify('Diseño del proyecto restablecido')};
$('#centerBtn').onclick=()=>{if(selected()){selected().x=50;selected().y=47;syncLayer(selected());saveState()}else notify('Selecciona un diseño primero')};
$('#undoBtn').onclick=()=>{const visible=visibleLayers(); if(visible.length){removeLayer(visible[visible.length-1].id); notify('Se deshizo el último diseño de '+faceName(currentFace).toLowerCase())}};
$('#saveBtn').onclick=()=>{saveState();const p=projects.find(x=>x.id===currentProjectId);notify('Proyecto guardado'+(p?' · '+p.name:''))};
$('#exportBtn').onclick=exportPNG;

function exportPNG(){
 const c=document.createElement('canvas');c.width=1800;c.height=1800;const x=c.getContext('2d');
 x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';
 x.fillStyle=backgroundMode==='light'?'#f2f4f8':'#151b31';x.fillRect(0,0,c.width,c.height);
 const g=document.createElement('canvas');g.width=garmentCanvas.width;g.height=garmentCanvas.height;
 const gx2=g.getContext('2d');gx2.imageSmoothingEnabled=true;gx2.imageSmoothingQuality='high';gx2.drawImage(garmentCanvas,0,0);
 const gw=1020,gh=1020*garmentCanvas.height/garmentCanvas.width,gx=(1800-gw)/2,gy=(1800-gh)/2;
 x.drawImage(g,gx,gy,gw,gh);
 const jobs=visibleLayers().map(l=>new Promise(res=>{const im=new Image();im.onload=()=>{const w=l.w/100*gw,h=w/l.aspect,px=gx+l.x/100*gw,py=gy+l.y/100*gh;x.save();x.translate(px,py);x.rotate(l.rot*Math.PI/180);x.drawImage(im,-w/2,-h/2,w,h);x.restore();res()};im.src=l.data}));
 Promise.all(jobs).then(()=>{const a=document.createElement('a');a.download=`only-unbroken-${currentProduct}-${currentFace}.png`;a.href=c.toDataURL('image/png');a.click();notify('PNG exportado')})
}

function defaultProjectState(productId){
 return {
   product:productId,
   garmentColor:products[productId].defaultColor,
   currentFace:'front',
   yaw3d:0,
   editorZoom:1,
   layers:[],
   library:[],
   showGrid:false,
   backgroundMode:'light',
   seq:1
 };
}

function snapshotState(){
 return {
   product:currentProduct,
   garmentColor,
   currentFace,
   yaw3d,
   editorZoom,
   layers:layers.map(({id,data,name,type,aspect,x,y,w,rot,face,textValue,fontValue,textColor,opacity,intensity,forceColor,tintColor})=>({id,data,name,type,aspect,x,y,w,rot,face,textValue,fontValue,textColor,opacity,intensity,forceColor,tintColor})),
   library,
   showGrid,
   backgroundMode,
   seq
 };
}

function applyProjectState(state){
 const s=state||defaultProjectState('hoodie');
 currentProduct=products[s.product]?s.product:'hoodie';
 garmentColor=s.garmentColor||products[currentProduct].defaultColor;
 currentFace=s.currentFace||'front';
 yaw3d=typeof s.yaw3d==='number'?s.yaw3d:(faceAngles[currentFace]??0);
 editorZoom=typeof s.editorZoom==='number'?s.editorZoom:1;
 layers=(s.layers||[]).map(l=>({...l,face:l.face||'front',opacity:typeof l.opacity==='number'?l.opacity:1,intensity:typeof l.intensity==='number'?l.intensity:1,forceColor:!!l.forceColor,tintColor:l.tintColor||'#ffffff'}));
 library=s.library||[];
 showGrid=!!s.showGrid;
 backgroundMode=s.backgroundMode||'light';
 seq=s.seq||100;
 selectedId=null;
 faceBaseCache.clear();

 $('#gridbg').style.display=showGrid?'block':'none';
 $('#artboard').style.background=backgroundMode==='light'
   ?'radial-gradient(circle at 50% 42%,#fff 0,#f4f5f9 58%,#e9ebf2 100%)'
   :'radial-gradient(circle at 50% 42%,#29314b 0,#141b31 68%,#0f1426 100%)';
 $$('.faceSwitcher [data-face]').forEach(b=>b.classList.toggle('active',b.dataset.face===currentFace));

 setEditorZoom(editorZoom,false);
 renderGarment();
 renderLayers();
 renderAll3D();
 snap3DToFace(currentFace,false);
 apply3DRotation(false);
 renderPanel();
}

function persistProjects(){
 const savedAt=Date.now();
 let localOk=true;
 try{
   localStorage.setItem(projectsKey,JSON.stringify(projects));
   localStorage.setItem(projectsMetaKey,String(savedAt));
 }catch(e){
   localOk=false;
 }
 persistProjectsIDB(savedAt);
 if(!localOk)notify('Guardado seguro activado. El proyecto se guardará en el almacenamiento grande del navegador.');
}

function saveState(){
 if(!currentProjectId)return;
 const p=projects.find(x=>x.id===currentProjectId);
 if(!p)return;
 p.product=currentProduct;
 p.state=snapshotState();
 p.updatedAt=Date.now();
 persistProjects();
}


function flushAutosave(){
 clearTimeout(autosaveTimer);
 if(currentProjectId)saveState();
}
window.addEventListener('pagehide',flushAutosave,{capture:true});
window.addEventListener('beforeunload',flushAutosave,{capture:true});
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='hidden')flushAutosave();
});
window.addEventListener('blur',()=>queueAutosave(0));
window.addEventListener('freeze',flushAutosave);

function migrateLegacyProject(){
 try{
   const legacy=JSON.parse(localStorage.getItem(legacyStateKey)||'null');
   if(!legacy)return;
   const id='legacy-'+Date.now();
   projects=[{
     id,
     name:'Mi Hoodie',
     product:'hoodie',
     updatedAt:Date.now(),
     state:{
       product:'hoodie',
       garmentColor:legacy.garmentColor||legacy.hoodieColor||products.hoodie.defaultColor,
       currentFace:legacy.currentFace||'front',
       yaw3d:typeof legacy.yaw3d==='number'?legacy.yaw3d:0,
       editorZoom:typeof legacy.editorZoom==='number'?legacy.editorZoom:1,
       layers:(legacy.layers||[]).map(l=>({...l,face:l.face||'front'})),
       library:legacy.library||[],
       showGrid:!!legacy.showGrid,
       backgroundMode:legacy.backgroundMode||'light',
       seq:legacy.seq||100
     }
   }];
   persistProjects();
 }catch(e){}
}

function loadProjects(){
 try{projects=JSON.parse(localStorage.getItem(projectsKey)||'[]')||[]}catch(e){projects=[]}
 if(!projects.length)migrateLegacyProject();
}

function nextProjectName(productId){
 const base=productId==='hoodie'?'Hoodie':'Playera';
 const n=projects.filter(p=>p.product===productId).length+1;
 return `${base} ${n}`;
}

function createProject(productId){
 if(!products[productId])return;
 if(currentProjectId)saveState();
 const id='project-'+Date.now();
 const p={
   id,
   name:nextProjectName(productId),
   product:productId,
   updatedAt:Date.now(),
   state:defaultProjectState(productId)
 };
 projects.unshift(p);
 currentProjectId=id;
 persistProjects();
 applyProjectState(p.state);
 showEditorShell();
 setTool('product');
 setView('edit');
 notify('Proyecto nuevo · '+products[productId].name);
}

function openProject(id){
 if(currentProjectId)saveState();
 const p=projects.find(x=>x.id===id);
 if(!p)return;
 currentProjectId=id;
 applyProjectState(p.state);
 showEditorShell();
 setTool('product');
 setView('edit');
 notify('Proyecto abierto · '+p.name);
}

function deleteProject(id){
 const p=projects.find(x=>x.id===id);
 if(!p)return;
 if(!confirm(`¿Eliminar "${p.name}"?`))return;
 projects=projects.filter(x=>x.id!==id);
 if(currentProjectId===id)currentProjectId=null;
 persistProjects();
 renderDashboard();
}

function renameProject(id){
 const p=projects.find(x=>x.id===id);
 if(!p)return;
 const name=prompt('Nombre del proyecto',p.name);
 if(!name||!name.trim())return;
 p.name=name.trim().slice(0,40);
 p.updatedAt=Date.now();
 persistProjects();
 renderDashboard();
}

function projectDate(ts){
 try{return new Intl.DateTimeFormat('es-MX',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(ts))}catch(e){return ''}
}

function renderDashboard(){
 if(!projectsGrid)return;
 if(!projects.length){
   projectsGrid.innerHTML=`<div class="projectEmpty">Todavía no tienes proyectos.<br>Elige una prenda de la izquierda para empezar.</div>`;
 }else{
   projectsGrid.innerHTML=projects
     .slice()
     .sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))
     .map(p=>{
       const product=products[p.product]||products.hoodie;
       const count=p.state?.layers?.length||0;
       return `<article class="projectCard">
         <div class="projectThumb"><img src="${product.sources.front}" alt=""></div>
         <div class="projectMeta">
           <b>${escapeHTML(p.name)}</b>
           <span>${product.name} · ${count} diseño${count===1?'':'s'}</span>
           <span>${projectDate(p.updatedAt)}</span>
         </div>
         <div class="projectActions">
           <button class="openProject" data-open-project="${p.id}">Abrir</button>
           <button data-rename-project="${p.id}">Renombrar</button>
           <button class="deleteProject" data-delete-project="${p.id}">Eliminar</button>
         </div>
       </article>`;
     }).join('');
 }
 projectsGrid.querySelectorAll('[data-open-project]').forEach(b=>b.onclick=()=>openProject(b.dataset.openProject));
 projectsGrid.querySelectorAll('[data-delete-project]').forEach(b=>b.onclick=()=>deleteProject(b.dataset.deleteProject));
 projectsGrid.querySelectorAll('[data-rename-project]').forEach(b=>b.onclick=()=>renameProject(b.dataset.renameProject));
}

function escapeHTML(v){
 return String(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}

function showDashboard(){
 if(currentProjectId)saveState();
 document.body.classList.add('menuOpen');
 dashboard.style.display='block';
 workspace.style.display='none';
 $$('.topnav button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='home'));
 renderDashboard();
}

function showEditorShell(){
 document.body.classList.remove('menuOpen');
 dashboard.style.display='none';
 workspace.style.display='grid';
 $$('.topnav button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='design'));
}

document.querySelectorAll('[data-create-product]').forEach(b=>b.onclick=()=>createProject(b.dataset.createProduct));

async function bootStudio(){
 loadProjects();

 const localProjects=projects;
 const localSavedAt=readLocalSavedAt();
 const idb=await loadProjectsIDB();

 if(Array.isArray(idb.projects)&&idb.projects.length && idb.savedAt>localSavedAt){
   projects=idb.projects;
 }else{
   projects=localProjects;
 }

 // Normalize both copies after selecting the freshest one.
 if(projects.length)persistProjects();
 showDashboard();
}
bootStudio();

// Safety save while editing. Normal edits also autosave immediately.
setInterval(()=>{if(currentProjectId)saveState()},2000);

