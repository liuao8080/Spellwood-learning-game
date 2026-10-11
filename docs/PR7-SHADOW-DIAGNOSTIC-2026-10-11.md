# PR #7 云端近战与静止阴影诊断（2026-10-11）

真实云端对照未支持把静止阴影重复绘制当成本次卡顿的已确认主因或可用修复：候选有效跳过B的深度绘制时，A约632ms的停顿仍存在，四段原250ms判定全部失败。重复绘制确实存在，但有限贡献仍未知。产品保持 `1eb618b` / 4.1.0-alpha.3的源码，不安装实验缓存；画质、正式测试和250ms门槛保留，不合并或部署。

## 原始失败已核实

[官方run38030577115](https://github.com/liuao8080/Spellwood-learning-game/actions/runs/38030577115/job/114150472250)对应PR #7 head `1eb618be87023ebdb9c2e4fb7f2587b881e80a29`。Actions实际checkout为合并检查提交 `0773964616a51925a3dc5069450e3f872070b03e`，tree `406e3371819900434a3fc52e094bb77df9042734`与本地head tree一致。下载的313份匿名原始证据逐文件核实SHA及字节数；完整原始压缩包SHA为 `d33006da308205bc7c83174c132baff27cc2b48d491adf9197449c38bd08de05`。

- 原29项浏览器检查28通过、1失败；32项NAT/身份/启动等Node检查通过。近战失败保留：原250ms要求收到977ms。
- 实际浏览器是Playwright1.64.0 / Chrome Headless Shell156.0.8078.4（r1248）。实际棋盘renderer是ANGLE Vulkan SwiftShader Subzero；没有把Chrome功能“enabled”标签当物理GPU证明。
- 原始18帧WebM中最大相邻PTS差为977ms（1.000→1.977s）；原片SHA `50093303a2fd68ada10422eae1d2abf088661c9b1f9eb3d745da3ef1c530ea49`。重新运行原解码器仍失败，没有把挑选的12张PNG间隔当帧率。
- 同一DOM时钟的可信点击+3000ms窗口内出现632.4、341.8、346.9ms的RAF间隔，尾部有实际样本括住。说明存在实际浏览器停顿，不只是视频编码间隔。
- 全46份A动作样本画质保持正常速、可见、level3/pixelScale.65/shadow512，buffer460×135；没有动作中的画质切换。程序预热已ready/performed。应用update/submit数值是CPU采样，不能当GPU完成时间。
- 权威状态只接受一次攻击：revision5→6、对方HP18→17一次、source.ready true→false，单位离位270.68px后回到0。没有据此发现战斗逻辑重复执行。

被动诊断、DOM记录和原片PTS有各自时钟原点；没有保存可用于精确互相对齐的偏移。不能用数字接近推断某次GPU、长任务、命中帧与视频帧完全对应。原片首尾之外的时间也不由相邻PTS门槛覆盖。

## 本地对照与边界

三个对照均调用原近战测试，原动作、阶段预算与250ms断言未变；保留全场景、两个独立游客、正常A/减少动作B、合法组牌与真实点击。实际HTTP app SHA均为 `b059f5bf1100fdaee258efac63508f466c035cdd6f9abdfde98f74f68d4678be`，源/原helper/原case/配置完整性均通过，零重试。

| 本地模式 | 原测试 | 原片最大PTS差 | 点击窗口RAF最大差 | RAF尾部 |
| --- | --- | --- | --- | --- |
| Chrome154有头Metal | 通过 | 36ms | 19ms | 已括住 |
| Chrome154有头SwiftShader | 通过 | 199ms | 197.8ms | 10ms未知 |
| Chrome154无头SwiftShader | 通过 | 163ms | 162.2ms | 38.3ms未知 |

本机是M4/ARM64/macOS，软件驱动LLVM10.0.0；云端Ubuntu/x86/Subzero/Chrome156不是同一环境。这里A/B实际level0/pixelScale1/shadow1024，与云端自适应输出不同，没有人工调低来取绿。每模式一次，未测进程CPU余量，不能据此证明CI机器等效或云端问题不存在。

## 重复绘制候选的实际证据

只读探针置于隔离源码副本，正式app和`src`不变。它链式调用原shadowMap/depth入口并通过renderer.info实际draw增量核实，使用完整阴影输入键的直接比较；摘要hash只是标记，不决定相等。

Metal探针原近战通过，原片46ms。但真正有用的候选证据在B：31个连续减少动作、可见浮字帧（493ms）使用同一完整阴影输入键，仍每帧37个实际depth draw，共1147次。浮字opacity变化，单位动作/hero pose字段均为0。A正常攻击60个采样帧的键全部变化，说明探针不是恒定键。

此处37是战斗实际caster数，初始化53不可替代。探针CPU开销中位.3ms/p95.5ms，不是GPU时间，未从墙钟中减去它来宣称加速。早先软件探针在原25s游客阶段超时，另一次硬件执行被中断，两条红记录保留；均不被当作完整近战结果。

## 隔离的因果实验

新实验在`tests/diagnostics/shared-shadow`及独立 `playwright.shared-shadow.config.mjs`。构建器复制正式源码到忽略的test-results目录，仅在副本安装观测器和保守复用控制器；所有正常color renderer.render都继续执行。A固定原行为，B通过实际公开静态HTML重新导航/重连，依次baseline→candidate→candidate→baseline。禁用复用的baseline仍采集同样的键，避免仅候选承担采集开销。

复用只允许减少动作、普通不透明PCF/单平行光场景且上一成功绘制的完整键和实际map身份/代数均一致；输入、dirty、map、上下文、尺寸或未知扩展有变化就刷新/退回原行为。正常动作不复用。Node测试只证明真实Three数据与控制器边界，不能证明GPU像素或云端因果。

lab控制器只在这套严格单光守门通过后临时设置全局`renderer.shadowMap.autoUpdate=false`，需要刷新时保留needsUpdate，render的finally恢复原autoUpdate值；不是多灯场景的per-light缓存。发现自定义矩阵更新器会先退回原行为，纹理UV键用独立Matrix3计算，避免采键额外调用自定义更新方法。任何隐藏/预热的无ticket绘制也先使缓存失效。

当前lab控制器79/79 Node检查通过（真实Three输入、模拟renderer调度/dirty消费），故意一直刷新阴影的stub在重复绘制回归处失败。它不复现云端GPU卡顿；只证明测试能捕获控制器冗余路径和输入/资源失效边界。`npm run check`、`npm run typecheck`和diff空白检查通过。独立源码复核允许进入本地真实场景实验，没有把这些结果当产品性能通过。

每段单独保存原250ms判定，即使某段卡顿失败也继续记录剩余对照；“诊断执行完成”不意味着验收通过。观察总绘制次数包含Sprite独立渲染通道，并单列bufferDirect子集，不能把mesh计数误称全部color。实验记录真实renderer、逐帧画质/阴影map尺寸、逐段canvas buffer、caster、HP/revision/牌数及原片/RAF窗口。

同一真实房间/单位仍需普通回合推进，HP、手牌、法力、deck会变化，浏览器缓存也会变热。ABBA只能减少顺序偏差，不能隐去这些自然混杂。静止阴影像素一致性、刷新覆盖及独立复核必须另行验证；云端证据未出前不安装到产品。

正式CI及原测试保持独立。main目前没有此workflow，不能直接workflow_dispatch；只为既有draft PR #7加一个真实pull_request诊断job，源推送同时启动原完整验收。没有伪造GITHUB_ACTIONS，也不需要改main。

## 证据与复跑

第一轮新lab在游戏正文前20101ms启动检查失败，所有10项来源完整性通过、0动作段。定位为实验选择了4190端口，被原Node Fetch按[标准bad-port表](https://fetch.spec.whatwg.org/#port-blocking)在发请求前拒绝（sieve）；并非服务器或游戏近战卡顿。实验端口统一改为4191，原20s健康检查及25s游客预算保留，不加入unsafe-port开关、不伪造健康响应。原失败与新配置来源分别保存，后续fresh run不覆盖它。

选出的原片、原失败checkpoint、313文件来源manifest、解码复核及本地对照/只读探针记录保留在 [证据目录](../evidence/pr7-shadow-2026-10-11/retained-files.json)。都是匿名棋盘/数值，无会话、DB、HAR、profile或凭据；原字节未重编码。完整原始本地目录仍在忽略的test-results中。

```sh
# 原证据复核：预期exit1和977ms，不是重新试玩
node scripts/recheck-normal-motion.mjs evidence/pr7-shadow-2026-10-11/original-ci test-results/pr7-original-recheck

# 独立lab，首次构建；保留已冻结实验，再构建必须先归档它
node scripts/build-shared-shadow-diagnostics.mjs
node --test tests/diagnostics/shared-shadow/shadow-cache.test.mjs
SPELLWOOD_SHARED_SHADOW_LOCAL=1 SPELLWOOD_SHARED_SHADOW_MODE=hardware-headed npx --no-install playwright test --config=playwright.shared-shadow.config.mjs
```

## 本地lab实际结果

4191的新运行 `hardware-headed-2026-10-11T03-44-34-014Z-e02ed921` 完成四段真实攻击，原片51/38/49/51ms均在原250ms内，各点击窗口RAF最大20.4/21.7/19.4/18.9ms且尾部均括住。执行25.988s、零重试、10项来源完整性全部true。baseline固定app SHA `641c004c0884c933f2472f9459a2f5e30120c08557519a6decfc259a6cb3cc31`，candidate `6b5f3a9348cf3f0f8c0b39f9d2f6ba5fa049330661ccf63a371073b16cc2566c`；原正式b059未改。

| B段 | 浮字帧数 | 每帧实际深度draw | 键内caster数量 | 每帧完整color draw |
| --- | --- | --- | --- | --- |
| baseline1 | 31 | 37 | 37 | 67 |
| candidate2 | 31 | 0 | 39 | 71 |
| candidate3 | 31 | 0 | 41 | 75 |
| baseline4 | 31 | 43 | 43 | 79 |

候选两段都在输入/map一致、成功postcommit并继续完整color绘制时复用；回到baseline恢复了每帧实际深度draw。四段A/B均level0/pixelScale1/shadow1024。自然回合增加手牌和caster，不能把四段写成同样37个caster；候选的实际draw为0也不代表场景caster为0。选图已亲自查看，A完整棋盘、模型与阴影可见，但A一直baseline，这些PNG不能证明B阴影像素完全一致或动作流畅。

这证明实验控制器在真实场景有效；本地baseline本来就在250ms内，**不证明云端977ms已解决**。真实云端对照、GPU像素/失效验证和最终产品回归待补充。产品尚未修改，物理手机、公网真人联机和部署仍未验证/执行。

推送前独立核查纠正了旧探针注释：当前Three0.186.1的Sprite经renderObject进入renderBufferDirect，故unclassified0正常；完整native总数算法仍保留，计数逻辑零变化。旧冻结版本及结果均保留，元数据中的observer SHA改变，所以另做一次新冻结真实ABBA核对，未把旧原片归到新payload。

最终冻结运行 `hardware-headed-2026-10-11T03-52-05-469Z-e30c2dc8` 四段53/36/36/49ms，RAF19.9/19.6/20.8/19.1ms、尾部均括住，10项来源完整性true。本轮自然抽到Rabbit，键内caster36/38/40/42、实际depth36/0/0/42、完整color66/70/74/78，各31浮字帧；不能与前轮Acorn场景强行归一性能。最终baseline SHA `d6f340fdd23732b2c38e73ec164dff3b65652fbdf3f9414aa5a258564f01ae72`、candidate `e7ecb7a40be5af30fc24b8aaa52bd3d2cd88052c4a7e508019fa5361668385aa`，正式b059/控制器8150保持。新运行原片、checkpoint和归因manifest在local-abba-final；所有原PNG另在本地忽略目录保留。

本轮Rabbit实际atk2/hp1，每段一条accepted攻击、revision+1、目标HP18→16→14→12→10；不是此前Acorn的atk1/hp2。报告与原始数值分别独立核实；所有本地contexts/专用server清理通过，4191已释放。保留的原TAP红输出含空行尾空格，只对这个归档文本路径关闭行尾空格提示以保存原字节，代码检查和性能门槛未变。

## 真实云端对照：候选不能作为修复

诊断提交 `2f3779c4f749f674346cb97d270567aef789e7ad` 已推送。[run38110136254的shared-shadow job](https://github.com/liuao8080/Spellwood-learning-game/actions/runs/38110136254/job/114383815060)完成四段真实UI对照；job success只表示实验执行完成，原250ms判定逐段保留为失败。该run的原正式chromium job最终失败，完整日志/原片结果见下方正式验收记录。

| B模式 | 原片最大PTS间隔 | A同钟最大RAF间隔 | B浮字帧实际depth | 键内caster | 完整color |
| --- | --- | --- | --- | --- | --- |
| baseline1 | **780ms** | **646.1ms** | 39 | 39 | 71 |
| candidate2 | **983ms** | **631.3ms** | 0 | 41 | 75 |
| candidate3 | **738ms** | **631.6ms** | 0 | 43 | 79 |
| baseline4 | **992ms** | **643.0ms** | 43 | 43 | 79 |

实际是官方Chromium的SwiftShader。四段A均level3/.65/512、buffer460×135，B均level0/1/1024、buffer1280×546。各段B的8条scene-frame观测行可见且减少动作，另保留1条点击前约8–9s的hidden/normal external warmup行；9条均无drop，没有抹去预热边界。没有人工质量切换。各段一次accepted攻击、revision+1、HP-1；自然turn4/6/8/10、手牌5/6/7/7、caster数量变化仍是混杂。每段仅2个浮字帧，少于原设的3帧观测要求；report仍写reuse-not-established，不降低该要求来宣称覆盖完成。

在候选2/3已有的浮字帧以及后续无浮字帧里，输入/map一致、postcommit/reused=true、实际depth=0且完整color继续。两个document都记录了timeOrigin，因此可按 `(Borigin-Aorigin)+Babs-A可信clickabs` 对齐浏览器采样：候选2的B零depth在点击后12.8/369.4/709.3ms，A631.3ms gap覆盖+92.4→723.7ms；候选3的B零depth在+11.0/370.0/720.8ms，A631.6ms gap覆盖+93.6→725.2ms。大停顿发生时B重复阴影已被移除。这里没有把视频PTS与浏览器原点混为一谈。

四份原WebM的17/18/18/18个全部PTS经独立ffprobe核实，视频SHA与checkpoint一致；所有RAF尾部有实际样本括住。应用CPU采样仍不能说明GPU完成/排队在哪里。两次候选、普通回合/重载与不同caster的实验不构成统计充分的收益测量，也不排除有限贡献，但足以拒绝把该cache当作当前CI解决方案。准确卡顿根因仍未定位，GPU完成/队列未直接测量；下一候选应另立计划和真实对照，本轮不扩成其他渲染重写。

原始safe ZIP为5,025,308bytes、67文件，GitHub与实际下载SHA均 `8f3706197b86e512ea6ef848535b0205e2ecce1f1ef2758e45efb493d0b2f60c`。checkout `1cf24e9472d26f79f1dd58f0f63285f26a17c4af` 的直接父含真实head2f377；tree `69379f380fa87b0e33e2bf3ee951bd08e662bb7a`与该本地提交相同。实际HTTP baseline d6f340/candidate e7ecb7、控制器8150、正式b059全部一致。10项remote来源完整性true；独立重读124项正式/原验收/诊断/清理引用、176项副本和6份bundle/HTML均匹配。build-manifest仅builtAt/commit/tree环境元数据不同；远端生成suite和work文件未在本地存在，不冒称本地逐项验证。

完整ZIP、root独立重读67文件的SHA索引、四份原片、原checkpoint及独立带时钟参数的验证JSON保留在 [cloud-abba](../evidence/pr7-shadow-2026-10-11/cloud-abba/archive-files.json)。没有重新编码、插帧、加速或隐藏失败。

另行准备的像素fixture/pipeline只完成静态核查、构建和list；没有启动GPU，不记像素通过，也不发布到产品。候选未成为CI修复，所以保留准备稿以便恢复，不继续扩大实验。

本次临时PR诊断触发固定到已完成的2f377提交，后续记录推送继续运行原完整正式CI，不自动重复这项已否定的候选。原run可通过GitHub的rerun重新执行同一份实验；独立本地配置保留。main仍没有workflow，新的manual dispatch目前不作为已验证复跑入口。

## 原正式CI已完成：近战仍失败

[同run的chromium job114383815006](https://github.com/liuao8080/Spellwood-learning-game/actions/runs/38110136254/job/114383815006)已完成，29项浏览器28通过、1失败，零重试。各步实际通过数1 smoke + 1 gesture + 2 layout + 16 school + 4 teacher + 4 model = 28；唯一失败是原正常近战最大原生帧间隔 **828ms/250ms**。32项NAT/身份/启动等Node通过、0失败/0跳过。完整log的安全数值摘录与原失败分开保留，没有拿本地33/33覆盖云端结论。

正式原片21帧、49,248bytes，SHA `8a345c2b408ba6113f76be674d452d1177383cd37d983fb4435e8f6855019173`。root再次调用原解码器得到828ms、同钟点击窗口RAF535.6ms/3个>250ms间隔，尾部已括住，exit1保留。977ms→828ms来自不同未改产品的实际CI运行，不当作本轮修复收益。

正式manifest记录313份safe文件，完整ZIP的GitHub摘要 `e86c5de02c9d31d7c6ea4851db23a7f9ff7c9d0b115599f2ecea0e15e172b63b`。本轮只下载并核实包含近战的part03：其原ZIP摘要 `b210b28c5a3a839d41c92107b47308e5a2c7dca6e0de492192ef3f61806cb284`及56份文件的大小/SHA逐一匹配；manifest自身原ZIP摘要d0ddc036…匹配。没有声称本轮独立下载核完全部313份。正式原片/checkpoint、原part03/manifest ZIP、来源及复核结果保留在 [formal-ci](../evidence/pr7-shadow-2026-10-11/formal-ci/root-verification.json)。

产品`src`、server、原E2E/官方配置、lockfile、画质及dist/assets相对1eb618b均0差异；仅诊断和文档/证据交付。像素准备稿及原哈希另在忽略的`test-results/shadow-pixels-not-applied-2026-10-11`，没有GPU通过声明。精确卡顿根因仍未定位，GPU完成/队列未直接测量；本轮结论仅是该候选不能作为已确认修复。后续记录提交会另外触发未改产品的原CI，其状态不被本记录预先写为通过。

本地原可玩客户端已恢复 `http://127.0.0.1:4173`，health确认protocol2/net-2.3/combat2.3、实际HTTP app仍b059，使用原`.data/spellwood.sqlite`，缓存未安装。恢复运行/哈希核实不是新一轮实际游戏/手机/公网验收。
