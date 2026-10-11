# PR #7 云端近战与静止阴影诊断（2026-10-11）

当前阶段是验证候选原因，产品仍为 `1eb618b` / 4.1.0-alpha.3。静止阴影重复绘制已在真实本地场景确认；是否造成云端977ms卡顿尚未确认。实验不替代正式验收，不降低画质或250ms门槛，不合并或部署。

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
