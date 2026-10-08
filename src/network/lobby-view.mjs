const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** The front door of the forest. Configuration belongs to the pre-match sheet. */
export function lobbyView({ preferences, waiting, connected, name, identity, warning, testMode, practice, difficulty, connectionState, connectionRetries = 0 }) {
  const recover = ['expired','replaced'].includes(connectionState) ? 'reconnect' : connectionRetries >= 3 ? 'retry-connection' : null;
  return `<main class="grove-home" aria-label="词灵森林营地">
    <div class="grove-title"><p>THE GROVE OF LETTERS</p><h1>让词语，长成魔法</h1><span>灯火已亮，伙伴在森林里等你</span></div>
    <nav class="grove-nav grove-nav-left" aria-label="学习与收藏">
      <button data-action="study"><i aria-hidden="true">☙</i><span>词灵手册<small>听一听 · 学一学</small></span></button>
      <button data-action="library"><i aria-hidden="true">▱</i><span>卡牌与组牌<small>认识每位伙伴</small></span></button>
    </nav>
    <nav class="grove-nav grove-nav-right" aria-label="森林礼物与记录">
      <button data-action="collection"><i aria-hidden="true">✧</i><span>森林礼盒<small>${testMode ? '体验十连 · 不限次' : '学习时光的礼物'}</small></span></button>
      <button data-action="records"><i aria-hidden="true">♜</i><span>${practice?'本机排行榜':'个人成绩'}<small>看见自己的进步</small></span></button>
    </nav>
    <div class="grove-start"><button class="primary" data-action="${recover || 'match-setup'}"><span>${recover ? '重新连接森林' : waiting ? '查看准备进度' : '开始匹配'}</span><b aria-hidden="true">➜</b></button><p>${preferences.grade}年级 · ${preferences.course === 'all' ? '全年学习' : preferences.course.startsWith('s1') ? '上册' : '下册'} · ${esc(difficulty)}</p></div>
    <footer class="grove-footer"><button data-action="data">记录与备份</button>${practice?'<span>森林电脑试玩 · 记录仅在本机</span>':`<button class="grove-account" data-action="identity" title="营地身份与账号"><span>${identity?`${identity.kind==='guest'?'游客':'账号'} · ${esc(identity.name)}`:'确认游客身份'}</span><small>${identity?.kind==='account'?'账号记录':'注册 / 登录'}</small></button>`}<button data-action="help">初来森林</button></footer>
    ${warning && !/已保存|自动保存在|本机保存正常|记录保存在|本机记录已/.test(warning) ? `<p class="grove-save-status" role="status">${esc(warning)}</p>` : ''}
  </main>`;
}
