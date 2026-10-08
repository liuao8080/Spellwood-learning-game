import {CARDS,CARD} from '../cards.mjs';
import {FINISHES,FINISH,COLLECTION_TEST_MODE,rewardBalance,dayKey} from '../collection.mjs';
import {PackScene} from '../arena3d/pack-scene.mjs';
import {artThumb} from './card-library.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bits=n=>n.toString(2).replace(/0/g,'').length;

/** Owns a persistent canvas; ordinary app renders never replace this scene. */
export class CollectionView {
 constructor({root,store,preferences,onClose,onStudy,onNotice,onSound,onMuteChange=()=>{}}){
  Object.assign(this,{root,store,preferences,onClose,onStudy,onNotice,onSound,onMuteChange});this.muted=false;
  this.opened=false;this.busy=false;this.view='home';this.mode=COLLECTION_TEST_MODE?'test':'earned';this.selected='sprout';this.packScene=null;this.openingId=null;this.status={};this.exitPrompt=false;this.summaryExpanded=false;
  this.clickHandler=e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled)void this.click(b.dataset.action,b.dataset.value,b.dataset.finish);};
  this.changeHandler=e=>{if(e.target.id==='collection-card'){this.selected=e.target.value;this.render();}};
  root.addEventListener('click',this.clickHandler);root.addEventListener('change',this.changeHandler);
  this.keyHandler=e=>{if(!this.opened)return;if(e.key==='Escape'){e.stopPropagation();this.close();}else if(e.key==='Tab'){const scope=this.exitPrompt?this.root.querySelector('.pack-exit-confirm'):this.root;const a=[...scope.querySelectorAll('button:not(:disabled),select,[tabindex="0"]')];if(!a.length)return;const first=a[0],last=a.at(-1);if(e.shiftKey&&(!this.root.contains(document.activeElement)||document.activeElement===scope.querySelector('section')||document.activeElement===first)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
  root.addEventListener('keydown',this.keyHandler);
  this.focusHandler=e=>{const b=e.target.closest?.('.pack-index button');if(b&&this.opened)this.packScene?.focus(Number(b.dataset.value));};root.addEventListener('focusin',this.focusHandler);
 }
 open(){this.opener=document.activeElement;this.opened=true;this.root.hidden=false;this.view=this.store()?.data?.collection?.opening?'opening':'home';this.render();this.root.querySelector('.collection-panel')?.focus({preventScroll:true});}
 reset(){this.setMuted(false);this.opened=false;this.exitPrompt=false;this.summaryExpanded=false;this.disposeScene();this.root.replaceChildren();this.root.hidden=true;this.renderedView=null;}
 close(force=false){if(this.busy)return;if(!force&&this.view==='opening'&&this.store()?.data?.collection?.opening){if(this.exitPrompt){this.exitPrompt=false;this.packScene?.setHidden(false);}else{this.exitPrompt=true;this.packScene?.setHidden(true);}this.paintExitPrompt();return;}this.reset();this.onClose();const target=this.opener?.isConnected?this.opener:document.querySelector('[data-action="collection"]');target?.focus({preventScroll:true});}
 paintExitPrompt(){const panel=this.root.querySelector('.collection-panel');if(panel)panel.inert=this.exitPrompt;const old=this.root.querySelector('.pack-exit-confirm');if(old)old.remove();if(!this.exitPrompt){this.root.querySelector('.collection-panel')?.focus({preventScroll:true});return;}const overlay=document.createElement('div');overlay.className='pack-exit-confirm';overlay.innerHTML='<section role="alertdialog" aria-modal="true" aria-labelledby="pack-exit-title" tabindex="-1"><h2 id="pack-exit-title">把这份礼物留到稍后？</h2><p>十张结果已经保存。回来继续揭开，会看到同一份礼物。</p><button class="primary" data-action="collection-cancel-close">继续揭卡</button><button data-action="collection-confirm-close">保存并回营地</button></section>';this.root.appendChild(overlay);overlay.querySelector('section')?.focus({preventScroll:true});}
 preserveFocus(fn){const active=document.activeElement,owned=this.root.contains(active),key=owned?{id:active.id,action:active.dataset?.action,value:active.dataset?.value,finish:active.dataset?.finish}:null;try{return fn();}finally{if(owned&&!active.isConnected&&this.opened){const target=[...this.root.querySelectorAll('button:not(:disabled),select,[tabindex="0"]')].find(x=>key.id?x.id===key.id:key.action&&x.dataset.action===key.action&&x.dataset.value===key.value&&x.dataset.finish===key.finish);(target||this.root.querySelector('.collection-panel'))?.focus({preventScroll:true});}}}
 setMuted(value){const changed=this.muted!==!!value;this.muted=!!value;if(changed)this.onMuteChange(this.muted);this.paintMute();}
 paintMute(){const b=this.root.querySelector('[data-action="collection-mute"]');if(b){b.textContent=this.muted?'恢复声音':'礼盒静音';b.setAttribute('aria-pressed',String(this.muted));b.setAttribute('aria-label',this.muted?'恢复礼盒音乐和音效':'暂停礼盒音乐和音效');b.title='仅在礼盒内生效，返回营地后恢复原声音设置';}}
 visibility(hidden){this.packScene?.setHidden(hidden||this.exitPrompt);}
 disposeScene(){this.resizeObserver?.disconnect();this.resizeObserver=null;this.packScene?.dispose();this.packScene=null;this.openingId=null;this.status={};}
 shell(){if(this.root.querySelector('.collection-panel'))return;this.root.innerHTML=`<div class="collection-shade"><section class="collection-panel" role="dialog" aria-modal="true" aria-labelledby="collection-title" tabindex="-1"><header class="collection-heading"><div><p class="eyebrow">GIFTS OF THE GROVE</p><h2 id="collection-title">森林礼盒</h2></div><div class="collection-heading-actions"><button data-action="collection-mute" aria-pressed="false">礼盒静音</button><button data-action="collection-close">返回营地</button></div></header><div class="collection-content"></div></section></div>`;}
 render(options={}){if(!this.opened)return;const changed=this.renderedView!==this.view;const value=this.preserveFocus(()=>this.renderContent(options));if(changed){const panel=this.root.querySelector('.collection-panel');if(panel)panel.scrollTop=0;this.renderedView=this.view;}return value;}
 renderContent({intro=false}={}){
  if(!this.opened)return;this.shell();const store=this.store(),data=store?.data,content=this.root.querySelector('.collection-content');
  this.root.classList.toggle('opening-immersive',this.view==='opening'&&!!data?.collection?.opening);this.paintMute();
  if(!data||!store.loaded||store.dirty||store.issue){this.disposeScene();content.innerHTML=`<div class="collection-empty"><h3>先保管好你的记录</h3><p>这次内容还没有可靠保存，礼盒结果会在保存完成后展示。请重试保存；仍失败时可返回“记录与备份”下载抢救副本。</p><button class="primary" data-action="collection-retry" ${this.busy?'disabled':''}>重试保存</button></div>`;return;}
  const s=data.collection;
  if(this.view==='opening'&&s.opening){this.renderOpening(s.opening,intro);return;}
  this.disposeScene();if(this.view==='opening')this.view='home';
  if(this.view==='album'){content.innerHTML=this.albumHTML(s);return;}
  if(this.view==='rules'){this.rules();return;}
  const today=s.days[dayKey(Date.now(),data.timeZone)]?.qids.length||0;
  content.innerHTML=`<div class="gift-intro"><span class="gift-emblem" aria-hidden="true">✧</span><div><h3>把学习的日子，收进森林</h3><p>累计5个有效学习日，获得一次免费十连。漏一天不会清零，答错后认真阅读讲解也算。</p></div></div><div class="reward-track"><strong>今日 ${today}/6 个知识点</strong><span>累计 ${s.totalDays} 个学习日 · 下一份礼盒 ${s.totalDays%5}/5</span><div class="day-leaves" aria-label="本轮学习日进度">${[0,1,2,3,4].map(i=>`<span class="${i<s.totalDays%5?'earned':''}">❧</span>`).join('')}</div><button data-action="collection-study">去学习一小轮</button></div><div class="pack-choices">${s.opening?`<button class="primary" data-action="collection-resume">继续上次十连</button>`:''}<button class="primary" data-action="collection-open" data-value="earned" ${this.busy||s.opening||rewardBalance(s)<1?'disabled':''}>学习礼盒 × ${rewardBalance(s)}</button>${COLLECTION_TEST_MODE?`<button class="test-pack-button" data-action="collection-open" data-value="test" ${this.busy||s.opening?'disabled':''}>体验十连 · 不限次</button><p class="test-label">当前为测试体验。测试收藏和材料独立保存，不会转入正式学习奖励。</p>`:''}</div><div class="collection-links"><button data-action="collection-album">我的外观收藏</button><button data-action="collection-rules">奖励规则与概率</button></div><p class="subtle">24张基础卡起步可玩。抽到的是精装外观，攻击、生命和效果保持相同。${store.singlePage?'当前浏览器请只打开一个游戏页面，避免并行保存冲突。':''}</p>`;
 }
 renderOpening(opening,intro){
  this.mode=opening.mode;
  const content=this.root.querySelector('.collection-content');
  if(this.openingId!==opening.id||!this.packScene){
   this.disposeScene();this.openingId=opening.id;
   content.innerHTML=`<div class="opening-heading"><span class="opening-source"></span><strong id="pack-count"></strong><span id="pack-renderer"></span></div><div class="pack-stage"><canvas id="pack-canvas" aria-label="森林礼盒与十张实体卡牌"></canvas><div id="pack-instruction"></div></div><div id="pack-controls"></div><div id="pack-results"></div>`;
   this.packScene=new PackScene({canvas:content.querySelector('#pack-canvas'),reduced:this.preferences().reduced,onReveal:index=>{void this.reveal(index);},onOpenRequested:()=>this.packScene?.launch(),onReady:()=>this.paintControls(),onStatus:status=>{this.status=status;this.paintControls();},onSound:cue=>this.onSound(cue)});
   this.resizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(()=>this.packScene?.resize()):null;this.resizeObserver?.observe(content.querySelector('.pack-stage'));
   this.packScene.setOpening(opening,{intro});
  }else this.packScene.setOpening(opening,{intro:false});
  this.paintControls();
 }
 paintControls(){return this.preserveFocus(()=>this.paintControlsContent());}
 paintControlsContent(){
  if(!this.opened||this.view!=='opening')return;
  const store=this.store();if(!store||store.dirty||store.issue)return;
  const o=store.data?.collection?.opening;if(!o)return;const count=bits(o.revealed),phase=this.status.phase;
  const title=this.root.querySelector('.opening-source');if(!title)return;title.textContent=o.mode==='test'?'体验十连 · 测试收藏':'学习奖励 · 正式收藏';
  this.root.querySelector('#pack-count').textContent=`已揭开 ${count}/10`;
  this.root.querySelector('#pack-renderer').textContent=this.status.renderer?.startsWith('CPU')?'兼容三维':'';
  this.root.querySelector('#pack-instruction').textContent=phase==='sealed'?'点击礼盒，或轻轻向上拖动':this.status.available===false?'画面暂不可用，可以用下方按钮查看已保存结果':phase==='ready'?'点击一张卡，看看森林送来的礼物':phase==='complete'?'十张外观都已收入收藏':'';
  this.root.querySelector('.pack-stage')?.classList.toggle('focused',Number.isInteger(this.status.focusedIndex));
  const allowReveal=['ready','complete'].includes(phase)||this.status.available===false;
  this.root.querySelector('#pack-controls').innerHTML=`<div class="pack-primary-actions">${Number.isInteger(this.status.focusedIndex)?'<button data-action="collection-unfocus">返回十卡</button>':''}${phase==='sealed'?'<button class="primary" data-action="collection-launch">打开礼盒</button>':''}<button data-action="collection-reveal-all" ${this.busy||count===10?'disabled':''}>${allowReveal?'全部揭示':'跳过动画并揭示'}</button><button data-action="collection-album" ${this.busy?'disabled':''}>稍后继续</button>${count===10?`<button class="primary" data-action="collection-finish" ${this.busy?'disabled':''}>收好这份礼物</button>`:''}</div><div class="pack-index ${this.status.available===false?'pack-index-fallback':''}" role="group" aria-label="逐张揭示或放大">${o.cards.map((c,i)=>`<button data-action="collection-reveal" data-value="${i}" ${this.busy||!allowReveal?'disabled':''} class="${o.revealed&(1<<i)?'revealed':''}" aria-label="${o.revealed&(1<<i)?`${esc(CARD[c.cardId].name)}，${FINISH[c.finish].name}，放大查看`:`揭开第${i+1}张`}">${o.revealed&(1<<i)?'✓':i+1}</button>`).join('')}</div>`;
  const shown=o.cards.map((c,i)=>({...c,i})).filter(c=>o.revealed&(1<<c.i));
  const results=this.root.querySelector('#pack-results');results.classList.toggle('summary-expanded',this.summaryExpanded);results.innerHTML=shown.length?`<button class="pack-summary-toggle" data-action="collection-summary">${this.summaryExpanded?'收起礼物清单':`查看已揭开的${shown.length}张`}</button>${this.summaryExpanded?`<div class="pack-summary">${shown.map(c=>`<button data-action="collection-focus" data-value="${c.i}" style="--finish:${FINISH[c.finish].color}">${artThumb(c.cardId)}<strong>${esc(CARD[c.cardId].name)}</strong><span>${FINISH[c.finish].name}${c.duplicate?` · 重复 +${c.dust}叶屑`:' · 新收藏'}</span></button>`).join('')}</div>`:''}`:'';
 }
 albumHTML(s){
  const card=CARD[this.selected]||CARDS[0],w=s[this.mode],equipped=s.equipped[card.id];
  return `<div class="collection-links"><button data-action="collection-home">返回礼盒</button>${s.opening?'<button data-action="collection-resume">继续上次十连</button>':''}</div><div class="album-modes">${COLLECTION_TEST_MODE?`<button data-action="collection-mode" data-value="test" aria-pressed="${this.mode==='test'}">测试收藏</button>`:''}<button data-action="collection-mode" data-value="earned" aria-pressed="${this.mode==='earned'}">学习收藏</button><strong>叶屑 ${w.dust}</strong></div><label class="album-selector">查看伙伴或法术<select id="collection-card">${CARDS.map(c=>`<option value="${c.id}" ${c.id===card.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><div class="album-feature">${artThumb(card.id)}<div><h3>${esc(card.name)}</h3><p>${esc(card.text)}</p><p>基础战斗卡始终可以使用。精装外观只改变边框和收藏光效。</p><button data-action="collection-equip" data-value="${card.id}" data-finish="base">使用原始外观</button></div></div><div class="finish-grid">${FINISHES.map(f=>{const owned=w.cards[`${card.id}:${f.id}`]||0,active=equipped?.mode===this.mode&&equipped.finish===f.id;return `<article style="--finish:${f.color}"><h4>${f.name}</h4><p>${owned?`已收集 ${owned} 次`:'尚未收藏'}</p><button data-action="${owned?'collection-equip':'collection-redeem'}" data-value="${card.id}" data-finish="${f.id}" ${this.busy||active||!owned&&w.dust<f.cost?'disabled':''}>${active?'正在使用':owned?'使用外观':`${f.cost}叶屑兑换`}</button></article>`;}).join('')}</div>`;
 }
 rules(){this.disposeScene();this.root.querySelector('.collection-content').innerHTML=`<div class="gift-rules"><h3>让每次学习都有收获</h3><p>一天学习6个不同知识点，读题、作答并阅读讲解，就算一个有效学习日。答错也可以，超时和反复点击同题不重复累计。题面停留至少2秒、讲解至少1.2秒；页面在后台的时间不计。英语掌握仍按原规则保存，与礼盒资格分开。</p><p>累计5天得到一次免费十连，漏日不清零。没有付费、倒计时购买或连续签到惩罚。日期按照本机学习档案的时区计算。</p><h3>公开概率</h3><p>每次独立抽取1张卡和1种外观。24张基础卡各有相同机会；外观概率如下，没有额外保底或隐藏调整。</p><ul>${FINISHES.map(f=>`<li>${f.name}：${f.chance}% · 重复转换${f.dust}叶屑 · 指定兑换${f.cost}叶屑</li>`).join('')}</ul><p>结果在动画开始前保存，跳过或刷新不会换一批结果。十连中的重复外观也会照常转成叶屑，可在对应收藏里定向兑换。</p>${COLLECTION_TEST_MODE?'<p>体验十连不限次数；其材料和收藏留在测试区域，之后关闭测试入口时不会加入正式学习钱包。</p>':''}<button class="primary" data-action="collection-home">明白了</button></div>`;}
 async reveal(index){
  const s=this.store(),o=s?.data?.collection?.opening;if(this.busy||!o||s.dirty||s.issue)return;
  if(o.revealed&(1<<index)){this.packScene?.focus(index);return;}
  await this.mutate({kind:'reveal-pack',id:o.id,index});
 }
 async mutate(action){this.busy=true;this.paintControls();try{const r=await this.store().collectionAction(action);if(!r.ok)this.onNotice('这次内容尚未保存，请重试或下载备份');return r;}finally{this.busy=false;this.render();}}
 async click(action,value,finish){
  if(action==='collection-mute'){this.setMuted(!this.muted);return;}
  if(action==='collection-close'){this.close();return;}
  if(action==='collection-confirm-close'){this.close(true);return;}
  if(action==='collection-cancel-close'){this.exitPrompt=false;this.packScene?.setHidden(false);this.paintExitPrompt();return;}
  if(action==='collection-summary'){this.summaryExpanded=!this.summaryExpanded;this.paintControls();return;}
  if(this.busy||this.exitPrompt)return;const store=this.store();
  if(action==='collection-retry'){this.busy=true;try{await store?.retry();}finally{this.busy=false;this.render();}return;}
  if(!store?.loaded||store.dirty||store.issue){this.onNotice('请先保存好当前进度');return;}
  if(action==='collection-home'){this.view='home';this.render();}
  else if(action==='collection-study'){this.reset();this.onStudy();}
  else if(action==='collection-album'){this.view='album';this.render();}
  else if(action==='collection-rules'){this.view='rules';this.render();}
  else if(action==='collection-mode'&&['test','earned'].includes(value)){this.mode=value;this.view='album';this.render();}
  else if(action==='collection-resume'){this.view='opening';this.render();}
  else if(action==='collection-open'){
   this.busy=true;this.render();try{const r=await store.openPack(value);if(r.ok&&r.data?.collection.opening){this.view='opening';this.busy=false;this.render({intro:true});}else this.onNotice(r.ok?'暂时没有可用学习礼盒':'礼盒尚未保存，重试会继续同一批结果');}finally{this.busy=false;this.render();}
  }else if(action==='collection-launch')this.packScene?.launch();
  else if(action==='collection-reveal')await this.reveal(Number(value));
  else if(action==='collection-unfocus')this.packScene?.focus(null);
  else if(action==='collection-focus'){this.summaryExpanded=false;this.packScene?.focus(Number(value));this.paintControls();}
  else if(action==='collection-reveal-all'){
   const o=store.data.collection.opening;if(o){this.packScene?.skip();await this.mutate({kind:'reveal-pack',id:o.id,index:'all'});}
  }else if(action==='collection-finish'){
   const o=store.data.collection.opening;if(o){const r=await this.mutate({kind:'close-pack',id:o.id});if(r.ok){this.view='home';this.render();}}
  }else if(action==='collection-redeem'){
   const r=await this.mutate({kind:'redeem-finish',mode:this.mode,cardId:value,finish});if(r.ok)this.onNotice(r.changed?'已用叶屑换好外观':'材料不足，或已收藏这个外观');
  }else if(action==='collection-equip'){
   const r=await this.mutate({kind:'equip-finish',mode:this.mode,cardId:value,finish});if(r.ok)this.onNotice('外观已保存，下一次看到这张手牌时就会使用');
  }
 }
}
