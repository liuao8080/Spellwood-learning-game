import { HERO_SKINS, DEFAULT_HERO_SKIN, getHeroSkin } from '../hero-skins.mjs';
import { SKIN_RULES } from '../reward-journey.mjs';
import { COLLECTION_TEST_MODE } from '../collection.mjs';
import { HeroPreview } from './hero-preview.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const revealedCount=batch=>batch?Array.from({length:batch.count},(_,i)=>!!(batch.revealed&(1<<i))).filter(Boolean).length:0;
export function skinStatus(journey, skinId, mode='official') {
  const base=skinId===DEFAULT_HERO_SKIN, owned=base||journey[mode].owned.includes(skinId), equipped=journey.equipped.skinId===skinId&&journey.equipped.mode===(base?'base':mode);
  return {owned,equipped,label:base?'免费基础造型':owned?(mode==='test'?'体验收藏':'正式收藏'):'尚未拥有'};
}
export function skinRulesHTML(){return `<h3>人物造型的公开规则</h3><p>${HERO_SKINS.length}款人物造型，普通抽取每款${SKIN_RULES.ordinaryChance*100}%。1券抽1件，10券抽10件，十连没有折扣。</p><p>重复款每件得${SKIN_RULES.duplicateDust}叶屑；${SKIN_RULES.redeemDust}正式叶屑可指定兑换未拥有款。连续4次重复且尚未集齐时，下次从未拥有款中均匀抽取；抽到新款后重复计数归零。兑换不清除抽取保底。</p><p>十连内也会计算重复与保底。全部收齐后，每件重复仍得20叶屑，不再有未拥有保底；也可以留着券。</p><p>正式券来自学习任务，不需要购买。体验区无限试抽、无限试换，收藏与叶屑独立。所有造型永久保留，不加战斗数值。</p><p>整批结果先保存，再播放。稍后继续、跳过或刷新都不会重抽或再次扣券。人物造型与五日卡牌外观礼盒是两个独立的池。</p>`;}
/** Commands are intents only; committed progress is the sole presentation source. */
export class WardrobeView {
  constructor({root,store,preferences,onClose,onDaily,onNotice,onSound=()=>{},onMuteChange=()=>{},previewFactory=options=>new HeroPreview(options)}){
    Object.assign(this,{root,store,preferences,onClose,onDaily,onNotice,onSound,onMuteChange,previewFactory});
    this.opened=false;this.mode='official';this.view='wardrobe';this.selected=DEFAULT_HERO_SKIN;this.busy=false;this.epoch=0;this.index=0;this.muted=false;
    this.handler=event=>{const b=event.target.closest?.('[data-skin-action]');if(b&&!b.disabled)void this.click(b.dataset.skinAction,b.dataset.value);};root.addEventListener('click',this.handler);
    this.keyHandler=event=>{if(!this.opened)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close();}if(event.key==='Tab'){const list=[...root.querySelectorAll('button:not(:disabled),summary,[tabindex="0"]')];const first=list[0],last=list.at(-1);if(event.shiftKey&&(document.activeElement===first||!list.includes(document.activeElement))){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
  }
  open(){this.opener=document.activeElement;this.opened=true;this.root.hidden=false;this.view='wardrobe';const j=this.store()?.data?.journey;this.mode=j?.equipped.mode==='test'?'test':'official';this.selected=j?.equipped.skinId||DEFAULT_HERO_SKIN;this.render();this.root.querySelector('section')?.focus({preventScroll:true});}
  reset(){this.epoch++;this.opened=false;this.busy=false;this.preview?.dispose();this.preview=null;this.root.replaceChildren();this.root.hidden=true;this.setMuted(false);}
  close(){if(this.busy)return;const opener=this.opener;this.reset();this.onClose();(opener?.isConnected?opener:document.querySelector('[data-action="wardrobe"]'))?.focus({preventScroll:true});}
  setMuted(value){this.muted=!!value;this.onMuteChange(this.muted);}
  visibility(hidden){this.preview?.setHidden(hidden||!this.opened);}
  safeStore(){const s=this.store();return s?.loaded&&!s.dirty&&!s.issue&&s.data?.journey?s:null;}
  shell(){if(this.root.querySelector('.wardrobe-panel'))return;this.root.innerHTML='<div class="wardrobe-shade"><section class="wardrobe-panel" role="dialog" aria-modal="true" aria-labelledby="wardrobe-title" tabindex="-1"><header class="wardrobe-heading"><div><p class="eyebrow">THE FOREST WARDROBE</p><h2 id="wardrobe-title">人物衣橱</h2></div><div><button data-skin-action="mute">造型静音</button><button data-skin-action="close">返回营地</button></div></header><div class="wardrobe-top"></div><div class="wardrobe-body"><div class="hero-preview"><canvas aria-label="当前人物的立体模型"></canvas><img class="hero-preview-fallback" alt="当前人物肖像" hidden><div class="hero-caption" aria-live="polite"></div></div><div class="wardrobe-content"></div></div><div class="wardrobe-bottom"></div></section></div>';this.preview=this.previewFactory({canvas:this.root.querySelector('canvas'),reduced:this.preferences().reduced,onStatus:status=>{this.unavailable=status.available===false;const img=this.root.querySelector('.hero-preview-fallback');if(img)img.hidden=!this.unavailable;}});}
  render({reveal=false}={}){
    if(!this.opened)return;this.shell();const active=document.activeElement,key=this.root.contains(active)?{action:active.dataset?.skinAction,value:active.dataset?.value}:null;
    const top=this.root.querySelector('.wardrobe-top'),content=this.root.querySelector('.wardrobe-content'),bottom=this.root.querySelector('.wardrobe-bottom'),s=this.safeStore();
    this.root.querySelector('[data-skin-action="mute"]').textContent=this.muted?'恢复声音':'造型静音';this.root.querySelector('[data-skin-action="mute"]').setAttribute('aria-pressed',String(this.muted));this.root.querySelector('[data-skin-action="close"]').disabled=this.busy;
    if(!s){this.preview?.setHidden(true);this.root.classList.remove('skin-opening');top.innerHTML='<p role="status">先确认记录已保存，再展示或领取人物造型。</p>';content.innerHTML=`<p>结果尚未确认时，请重试同步。重试会取回同一次结果。</p><button data-skin-action="retry" ${this.busy?'disabled':''}>重试同步</button>`;bottom.innerHTML='';return;}
    const j=s.data.journey,w=j[this.mode],batch=j.openings[this.mode],isOpening=this.view==='opening'&&batch;
    if(this.view==='opening'&&!batch)this.view='wardrobe';this.root.classList.toggle('skin-opening',!!isOpening);this.preview?.setReduced(this.preferences().reduced);this.preview?.setHidden(false);
    if(isOpening){
      const count=revealedCount(batch),complete=count===batch.count;this.index=Math.max(0,Math.min(batch.count-1,this.index));const result=batch.results[this.index],shown=!!(batch.revealed&(1<<this.index));
      top.innerHTML=`<p class="skin-source">${this.mode==='test'?'体验造型 · 测试收藏':'免费造型券 · 正式收藏'} <strong>已揭开 ${count}/${batch.count}</strong></p>`;
      content.innerHTML=`<div class="skin-reveal-copy"><p>${shown?'森林的新相遇':'整批礼物已保存'}</p><h3>${shown?esc(getHeroSkin(result.skinId).name):`第 ${this.index+1} 件造型`}</h3><p>${shown?(result.duplicate?`重复款 · +${result.dust}${this.mode==='test'?'体验':'正式'}叶屑`:result.guaranteed?'未拥有保底 · 新收藏':'新收藏 · 已收好'):'点击揭开，看看这次的伙伴'}</p><p class="subtle">稍后回来或刷新，仍是同一批结果</p></div>`;
      bottom.innerHTML=`<div class="skin-index" role="group" aria-label="逐件揭示">${batch.results.map((_,i)=>`<button data-skin-action="index" data-value="${i}" aria-label="${batch.revealed&(1<<i)?'查看':'揭开'}第${i+1}件" aria-pressed="${i===this.index}" ${this.busy?'disabled':''}>${batch.revealed&(1<<i)?'✓':i+1}</button>`).join('')}</div><div class="skin-reveal-actions">${!shown?`<button class="primary" data-skin-action="reveal" ${this.busy?'disabled':''}>${this.busy?'正在保存…':'揭开这件造型'}</button>`:!complete?`<button class="primary" data-skin-action="next" ${this.busy?'disabled':''}>看下一件</button>`:''}<button data-skin-action="all" ${this.busy||complete?'disabled':''}>跳过动画并全部揭示</button><button data-skin-action="${complete?'finish':'later'}" ${this.busy?'disabled':''}>${complete?'收好并回衣橱':'稍后继续'}</button></div>`;
      this.showHero(shown?result.skinId:null,{reveal:shown&&reveal});
    }else{
      const status=skinStatus(j,this.selected,this.mode),skin=getHeroSkin(this.selected),dust=this.mode==='test'?w.dust:s.data.collection.earned.dust;
      top.innerHTML=`<div class="wardrobe-modes"><button data-skin-action="mode" data-value="official" aria-pressed="${this.mode==='official'}" ${this.busy?'disabled':''}>正式收藏 ${j.official.owned.length}/${HERO_SKINS.length}</button>${COLLECTION_TEST_MODE?`<button data-skin-action="mode" data-value="test" aria-pressed="${this.mode==='test'}" ${this.busy?'disabled':''}>体验收藏 ${j.test.owned.length}/${HERO_SKINS.length}</button>`:''}</div><div class="skin-wallet"><span>${this.mode==='test'?'体验券：无限':`造型券 ${j.skinTickets}`}</span><span>${this.mode==='test'?'体验':'正式'}叶屑 ${dust}</span><button data-skin-action="daily" ${this.busy?'disabled':''}>免费领取方式</button></div>${this.mode==='test'?'<p class="test-label">体验区 · 无限试抽 / 试换。收藏与叶屑不会转入正式钱包。</p>':''}<div class="skin-pack-actions">${batch?`<button class="primary" data-skin-action="resume" ${this.busy?'disabled':''}>继续上次 ${batch.count} 件礼物</button>`:`<button class="primary" data-skin-action="open" data-value="1" ${this.busy||this.mode==='official'&&j.skinTickets<1?'disabled':''}>${this.busy?'正在保存…':this.mode==='test'?'体验抽1件':'1券 · 抽1件'}</button><button data-skin-action="open" data-value="10" ${this.busy||this.mode==='official'&&j.skinTickets<10?'disabled':''}>${this.mode==='test'?'体验抽10件':'10券 · 抽10件'}</button>`}</div>`;
      const equipped=getHeroSkin(j.equipped.skinId);
      content.innerHTML=`<div class="skin-detail"><span>${status.label}${status.equipped?' · 正在使用':''}</span><h3>${esc(skin.name)}</h3><p>${esc(skin.description)}</p><p class="subtle">${status.owned?'已永久保存，只改变人物外观':'可用免费造型券抽取，或指定兑换'}</p><button class="primary" data-skin-action="${status.owned?'equip':'redeem'}" ${this.busy||status.equipped||!status.owned&&this.mode==='official'&&dust<SKIN_RULES.redeemDust?'disabled':''}>${status.equipped?'正在使用':status.owned?'穿上这个造型':this.mode==='test'?'体验兑换 · 免费':'100正式叶屑兑换'}</button><button data-skin-action="equipped">查看当前装备 · ${esc(equipped.name)}</button></div><div class="skin-gallery" role="group" aria-label="人物造型目录">${[getHeroSkin(DEFAULT_HERO_SKIN),...HERO_SKINS].map(item=>{const owned=skinStatus(j,item.id,this.mode);return `<button data-skin-action="select" data-value="${item.id}" aria-pressed="${item.id===this.selected}" class="${owned.owned?'owned':'locked'}" ${this.busy?'disabled':''}><img src="${item.thumb}" alt="" loading="lazy" width="96" height="96"><strong>${esc(item.name)}</strong><small>${owned.equipped?'正在使用':owned.label}</small></button>`;}).join('')}</div>`;
      bottom.innerHTML=`<p class="skin-guarantee">${w.owned.length===HERO_SKINS.length?'已集齐全部造型 · 重复仍得20叶屑':w.repeatStreak===4?'下一抽：未拥有款保底':`连续重复 ${w.repeatStreak}/4 · 4次后下一抽得未拥有款`}</p><details class="skin-rules"><summary>抽取、重复补偿与保底规则</summary>${skinRulesHTML()}</details>`;
      this.showHero(this.selected,{reveal});
    }
    if(key?.action&&!active.isConnected){[...this.root.querySelectorAll('button:not(:disabled)')].find(b=>b.dataset.skinAction===key.action&&b.dataset.value===key.value)?.focus({preventScroll:true});}
  }
  showHero(id,{reveal=false}={}){const stage=this.root.querySelector('.hero-preview'),caption=this.root.querySelector('.hero-caption'),img=this.root.querySelector('.hero-preview-fallback');stage.classList.toggle('sealed',!id);stage.classList.toggle('revealing',reveal&&!this.preferences().reduced);if(!id){this.preview?.setHidden(true);caption.textContent='✧';img.hidden=true;return;}const skin=getHeroSkin(id);img.src=skin.portrait;img.alt=skin.name;img.hidden=!this.unavailable;caption.textContent=skin.name;this.preview?.setHidden(false);this.preview?.setSkin(id,{reveal});}
  async mutate(action,{reveal=false,nextView}={}){
    if(this.busy||!this.safeStore())return {ok:false};const store=this.store(),epoch=this.epoch;this.busy=true;this.render();let painted=false;
    try{const result=await store.skinAction(action);if(epoch!==this.epoch||store!==this.store())return {ok:false};if(result.ok){if(nextView)this.view=nextView;this.busy=false;const confirmed=store.loaded&&!store.dirty&&!store.issue;this.render({reveal:reveal&&confirmed});painted=true;if(reveal&&confirmed&&!this.muted)this.onSound('summon');}else this.onNotice(({INSUFFICIENT_SKIN_TICKETS:'造型券不足，可以先去完成小任务',INSUFFICIENT_OFFICIAL_DUST:'正式叶屑不足，先保留这份收藏心愿',SKIN_PACK_PENDING:'还有上次的礼物，先继续揭开它',SKIN_NOT_OWNED:'请先在当前收藏来源中解锁这个造型'})[result.code]||'结果尚未确认，重试会继续同一次保存');return result;}
    catch{if(epoch===this.epoch)this.onNotice('这次保存尚未确认，请重试同步');return {ok:false};}
    finally{if(epoch===this.epoch){this.busy=false;if(!painted)this.render();}}
  }
  async click(action,value){
    if(action==='mute'){this.setMuted(!this.muted);this.render();return;}if(action==='close'){this.close();return;}if(this.busy)return;
    if(action==='retry'){const epoch=this.epoch,store=this.store();this.busy=true;this.render();try{await store?.retry();}finally{if(epoch===this.epoch&&store===this.store()){this.busy=false;this.render();}}return;}
    const store=this.safeStore();if(!store)return;const j=store.data.journey,batch=j.openings[this.mode];
    if(action==='mode'&&(value==='official'||value==='test'&&COLLECTION_TEST_MODE)){this.mode=value;this.view='wardrobe';}
    if(action==='select'&&[DEFAULT_HERO_SKIN,...HERO_SKINS.map(s=>s.id)].includes(value))this.selected=value;
    if(action==='equipped'){this.mode=j.equipped.mode==='test'?'test':'official';this.selected=j.equipped.skinId;}
    if(action==='daily'){this.reset();this.onDaily();return;}
    if(action==='open'&&[1,10].includes(Number(value))){this.index=0;await this.mutate({kind:'open',mode:this.mode,count:Number(value)},{nextView:'opening'});return;}
    if(action==='resume'&&batch){this.view='opening';this.index=batch.results.findIndex((_,i)=>!(batch.revealed&(1<<i)));if(this.index<0)this.index=0;}
    if(action==='later'){this.view='wardrobe';}
    if(action==='index'&&batch&&Number.isInteger(Number(value))&&Number(value)>=0&&Number(value)<batch.count){this.index=Number(value);if(!(batch.revealed&(1<<this.index))){await this.mutate({kind:'reveal',mode:this.mode,batchId:batch.id,index:this.index},{reveal:true});return;}}
    if(action==='next'&&batch){this.index=batch.results.findIndex((_,i)=>!(batch.revealed&(1<<i)));if(this.index<0)this.index=0;}
    if((action==='reveal'||action==='all')&&batch){if(action==='all')this.preview?.skip?.();await this.mutate({kind:'reveal',mode:this.mode,batchId:batch.id,index:action==='all'?'all':this.index},{reveal:action!=='all'});return;}
    if(action==='finish'&&batch){await this.mutate({kind:'close',mode:this.mode,batchId:batch.id},{nextView:'wardrobe'});return;}
    if(action==='equip'||action==='redeem'){const result=await this.mutate({kind:action,mode:this.selected===DEFAULT_HERO_SKIN?'base':this.mode,skinId:this.selected});if(result.ok)this.onNotice(action==='equip'?'造型已保存，下次对局会穿上它':'造型已收入收藏');return;}
    this.render();
  }
}
