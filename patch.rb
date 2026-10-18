# encoding: UTF-8
text = File.read('index.html', encoding: 'UTF-8')

def replace_exact!(text, old_s, new_s)
  old_s = old_s.encode('UTF-8')
  new_s = new_s.encode('UTF-8')
  unless text.include?(old_s)
    abort("Pattern not found:\n#{old_s[0,200]}")
  end
  text.sub!(old_s, new_s)
end

replace_exact!(text, <<'OLD', <<'NEW')
const layerImgCache=new Map();
const faceBaseCache=new Map();
OLD
const layerImgCache=new Map();
const layerPreviewCache=new Map();
const faceBaseCache=new Map();
NEW

replace_exact!(text, <<'OLD', <<'NEW')
   ${selected().type==='plantilla'?`<label>Color de la plantilla</label>
   <input id="selectedTemplateColor" type="color" value="${selected().textColor||'#111111'}">
   <div class="swatches" style="margin:8px 0 10px">${['#111111','#ffffff','#e6dfcf','#8f93a3','#314c7a','#6e4b58','#4c624f','#7a5c86'].map(c=>`<button class="swatch ${c===(selected().textColor||'#111111')?'active':''}" data-selected-template-color="${c}" style="background:${c}"></button>`).join('')}</div>`:''}
   <label>Tamaño</label><input id="layerSize" type="range" min="8" max="80" value="${selected().w}">
   <label>Rotación</label><input id="layerRot" type="range" min="-180" max="180" value="${selected().rot}">
OLD
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
NEW

replace_exact!(text, <<'OLD', <<'NEW')
     if(selected().type==='plantilla'){
       const sc=$('#selectedTemplateColor');
       if(sc)sc.oninput=e=>recolorTemplateLayer(selected(),e.target.value);
       panel.querySelectorAll('[data-selected-template-color]').forEach(b=>b.onclick=()=>recolorTemplateLayer(selected(),b.dataset.selectedTemplateColor));
     }
     $('#layerSize').oninput=e=>{selected().w=+e.target.value;syncLayer(selected());saveState()};
OLD
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
NEW

replace_exact!(text, <<'OLD', <<'NEW')
function addLayer(data,name,type,extra={}){
 const im=new Image();im.onload=()=>{
   const aspect=im.width/im.height;
   layers.push({id:seq++,data,name,type,aspect,x:50,y:47,w:Math.min(36,Math.max(18,22*aspect)),rot:0,face:currentFace,...extra});
OLD
function addLayer(data,name,type,extra={}){
 const im=new Image();im.onload=()=>{
   layerImgCache.set(data,im);
   const aspect=im.width/im.height;
   layers.push({id:seq++,data,name,type,aspect,x:50,y:47,w:Math.min(36,Math.max(18,22*aspect)),rot:0,face:currentFace,opacity:1,intensity:1,forceColor:false,tintColor:'#ffffff',...extra});
NEW

replace_exact!(text, <<'OLD', <<'NEW')
function selected(){return layers.find(l=>l.id===selectedId)||null}
function renderLayers(){
 designArea.innerHTML='';
 visibleLayers().forEach(l=>{
   const el=document.createElement('div');el.className='designLayer'+(l.id===selectedId?' selected':'');el.dataset.id=l.id;
   el.style.left=l.x+'%';el.style.top=l.y+'%';el.style.width=l.w+'%';el.style.transform=`translate(-50%,-50%) rotate(${l.rot}deg)`;
   el.innerHTML=`<img src="${l.data}"><span class="handle rotate"></span><span class="handle resize"></span><span class="handle delete">×</span><span class="dragLabel">Mover</span>`;
   designArea.appendChild(el);bindLayer(el,l);
 });
OLD
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
NEW

replace_exact!(text, <<'OLD', <<'NEW')
   tx.save();
   tx.imageSmoothingEnabled=true;
   tx.imageSmoothingQuality='high';
   tx.translate(x,y);
   tx.rotate((l.rot||0)*Math.PI/180);
   tx.drawImage(im,-w/2,-h/2,w,h);
   tx.restore();
OLD
   drawLayerToContext(tx,l,im,x,y,w,h);
NEW

replace_exact!(text, <<'OLD', <<'NEW')
   layers:layers.map(({id,data,name,type,aspect,x,y,w,rot,face,textValue,fontValue,textColor})=>({id,data,name,type,aspect,x,y,w,rot,face,textValue,fontValue,textColor})),
OLD
   layers:layers.map(({id,data,name,type,aspect,x,y,w,rot,face,textValue,fontValue,textColor,opacity,intensity,forceColor,tintColor})=>({id,data,name,type,aspect,x,y,w,rot,face,textValue,fontValue,textColor,opacity,intensity,forceColor,tintColor})),
NEW

replace_exact!(text, <<'OLD', <<'NEW')
 layers=(s.layers||[]).map(l=>({...l,face:l.face||'front'}));
OLD
 layers=(s.layers||[]).map(l=>({...l,face:l.face||'front',opacity:typeof l.opacity==='number'?l.opacity:1,intensity:typeof l.intensity==='number'?l.intensity:1,forceColor:!!l.forceColor,tintColor:l.tintColor||'#ffffff'}));
NEW

File.write('index.html', text)
