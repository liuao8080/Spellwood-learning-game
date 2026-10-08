import {CARDS,CARD,DECKS,validateCustomDeck} from '../cards.mjs';
import {cardGuide} from '../card-guide.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function artThumb(id){const c=CARD[id];return `<span class="library-art" style="background-image:url('/assets/${c.art>=6?`cards/${id}.webp`:'creatures.webp'}');${c.art<6?`background-size:300% 200%;background-position:${c.art%3*50}% ${Math.floor(c.art/3)*100}%`:''}" aria-hidden="true"></span>`;}
export class CardLibrary {
 constructor({preferences,onSave,onChange,onNotice,onClose}){Object.assign(this,{preferences,onSave,onChange,onNotice,onClose});this.tab='cards';this.selected='sprout';this.draft=[];this.busy=false;}
 open(){const p=this.preferences();this.draft=[...(validateCustomDeck(p.customDeck)?p.customDeck:(DECKS.find(d=>d.id===p.deckId)||DECKS[0]).ids)];this.tab='cards';this.selected='sprout';}
 counts(){return Object.fromEntries(CARDS.map(c=>[c.id,this.draft.filter(id=>id===c.id).length]));}
 html(){const count=this.counts(),c=CARD[this.selected],g=cardGuide(c.id);return `<section class="dialog card-library" role="dialog" aria-modal="true" aria-labelledby="library-title"><header class="library-heading"><div><p class="eyebrow">THE FIELD GUIDE</p><h2 id="library-title">卡牌与组牌</h2></div><button data-action="library-close">返回营地</button></header><p class="subtle">24张基础战斗卡都能使用。收藏外观不增加攻击或生命。</p><div class="library-tabs"><button data-action="library-tab" data-value="cards" aria-pressed="${this.tab==='cards'}">看懂卡牌</button><button data-action="library-tab" data-value="deck" aria-pressed="${this.tab==='deck'}">自选套牌 ${this.draft.length}/20</button></div><div class="library-layout"><div class="library-grid">${[...CARDS].sort((a,b)=>a.cost-b.cost).map(x=>`<button class="library-card ${x.id===c.id?'chosen':''}" data-action="library-card" data-value="${x.id}" aria-label="${esc(x.name)}，${x.cost}能量${this.tab==='deck'?`，已选${count[x.id]}张`:''}">${artThumb(x.id)}<b class="library-cost">${x.cost}</b><strong>${esc(x.name)}</strong><span>${this.tab==='deck'?`已选 ${count[x.id]}/3`:x.type==='spell'?'法术':`${x.atk}攻击 · ${x.hp}生命`}</span></button>`).join('')}</div><aside class="library-detail"><p class="eyebrow">${esc(g.element)} · ${esc(g.keyword)}</p><h3>${esc(c.name)}</h3><p class="card-facts">${g.cost} 能量${g.type==='伙伴'?` · ${g.atk} 攻击 · ${g.hp} 生命`:' · 法术'}</p><p class="card-effect">${esc(c.text)}</p><p>${esc(g.target)}</p><p>${esc(g.timing)}</p><p>${esc(g.rule)}</p><details class="card-info-tip"><summary>${g.exchange?'攻击前看看':'使用小提示'}</summary>${g.exchange?`<p>${esc(g.exchange)}</p>`:''}<p>${esc(g.tip)}</p></details><h4>试试看</h4><p>${esc(g.example)}</p>${this.tab==='deck'?`<div class="deck-counter"><button data-action="library-remove" ${!count[c.id]||this.busy?'disabled':''} aria-label="减少${esc(c.name)}">−</button><strong>${count[c.id]} / 3</strong><button data-action="library-add" ${count[c.id]>=3||this.draft.length>=20||this.busy?'disabled':''} aria-label="加入${esc(c.name)}">＋</button></div>`:''}</aside></div>${this.tab==='deck'?`<footer class="deck-footer"><p>选满20张，每种最多3张。当前${this.draft.length}张</p><div><button data-action="library-empty" ${this.busy?'disabled':''}>重新选择</button><button data-action="library-preset" ${this.busy?'disabled':''}>恢复森之守护</button><button class="primary" data-action="library-save" ${!validateCustomDeck(this.draft)||this.busy?'disabled':''}>${this.busy?'正在保存…':'保存并使用套牌'}</button></div></footer>`:''}</section>`;}
 async click(action,value){
  if(action==='library-close'){if(!this.busy)this.onClose();return;}
  if(this.busy)return;
  if(action==='library-tab'&&['cards','deck'].includes(value))this.tab=value;
  if(action==='library-card'&&Object.hasOwn(CARD,value))this.selected=value;
  if(action==='library-add'&&this.draft.length<20&&(this.counts()[this.selected]||0)<3)this.draft.push(this.selected);
  if(action==='library-remove'){const i=this.draft.indexOf(this.selected);if(i>=0)this.draft.splice(i,1);}
  if(action==='library-empty')this.draft=[];
  if(action==='library-preset')this.draft=[...DECKS[0].ids];
  if(action==='library-save'&&validateCustomDeck(this.draft)){
   this.busy=true;this.onChange();try{const ok=await this.onSave([...this.draft]);if(ok){this.onNotice('自选20张已保存，下一局就用它');this.onClose();}else this.onNotice('套牌尚未保存，请检查本机存档状态');}finally{this.busy=false;}
  }
  this.onChange();
 }
}
