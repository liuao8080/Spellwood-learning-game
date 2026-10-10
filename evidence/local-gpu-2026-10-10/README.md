# 本地GPU试玩证据 · 2026-10-10

[前后原图与正常速录像图库](review.html) · [完整试玩报告](../../docs/LOCAL-PLAYTEST-2026-10-10.md) · [结果JSON](results.json) · [归档逐文件SHA-256](manifest.json) · [图库/人工截图SHA-256](review-manifest.json)

接手实际PR #6 head `fd82c1aa8bfc381d6a6a298197a93945206ea5e7`，独立分支 `codex/local-gpu-refinement`。本轮最终alpha3 bundle为 `b059f5bf1100fdaee258efac63508f466c035cdd6f9abdfde98f74f68d4678be`。所有运行的提交父节点仍为fd82，未提交产品快照由各run的productSources/bundle及结束完整性核对归因，不把父提交误认为未改产品。

| 实际检查 | 结果 |
| --- | --- |
| 未改fd82完整本地基线 | 28/29，44px三位数列溢出失败；原近战47ms／250ms |
| 最终完整本地33项 | 33通过、无跳过／重试；五项源码完整性核对全部true |
| 最终原近战门槛 | 原生VP8最大PTS间隔36ms／250ms；一次权威攻击、HP18→17一次、归位0px |
| 额外原生桌面窗口 | viewport:null、实际844×406／DPR2；arena CSS708×224、buffer1062×336，原门槛52ms／250ms |
| 四种正常战斗效果 | 最终b059火花／回血／护盾／成长47／50／56／50ms最大原PTS间隔，各一次accepted与权威事件 |
| 正常开盒／逐张翻面 | 历史候选c49最大69／51ms；揭晓同canvas保持，mask0→1后连续翻面 |
| 完整代码回归 | 1141/1144，3个macOS127.0.0.2源地址绑定失败，无跳过；原多IP测试保留 |
| 构建及辅助检查 | typecheck、三个入口build、旧HTML素材check通过；本地清理4/4另外通过 |

设备为MacBook Air/M4/16GiB、macOS27.0.1、Node24.14.1、安装版有头Chrome154.0.8037.99。实际ANGLE Metal Apple M4及chrome://gpu硬件加速已核实；正常战斗样本保留level0／pixelScale1／1024阴影。固定DPR1窗口、OS原生DPR2窗口与物理显示器2560×1664分别记录，不能互换。

## 归档内容

13个 `original-evidence-NN.zip` 共171,312,374字节；1213个原始文件共182,884,521字节。压缩只改变容器，不修改PNG、WebM、JSON或TXT内容，逐项解压读回SHA-256与源文件一致。每个分片及条目的大小和SHA见[manifest.json](manifest.json)，原采集路径与选择方式见[sources.json](sources.json)。

- 完整原基线、最终33项、第一轮2项smoke/近战、额外原生DPR窗口、before/after-final/after-lanes动效与原帧均归档。
- 中间轮保留全部安全JSON及相关失败原图；其余中间局面图片仍在本机test-results，未声称全部上传。准备或list操作只有source-manifest，没有实际用例结果，不能计为通过。
- 原始红色状态保留：固定origin工具失败；新用例姓名/关闭选择器假设；礼盒关闭超时及遗留端口导致setup未执行；Escape/最小化复测失败。最终在body/截图/只读诊断完成后释放测试页面，再按原5秒关闭门槛通过并完整重跑33项。
- 前后图库的原图、六段原生VP8和最终人工截图另作便捷副本，按[review-manifest.json](review-manifest.json)核对。人工截图为最终版真实第二张实体卡点选、保存2/10后的界面，只证明外观与操作结果。

文件仅来自虚构隔离测试与本次专用本地试玩。凭据字段在原截图中已遮罩。无数据库、Cookie、profile、HAR、trace、桌面/全场录像、内部Playwright error-context或操作员临时答题文件。源码dist/assets未改变。

## 解释边界

PNG展示外观，原始视频PTS和被动RAF展示各自有限动作窗口；截图不证明流畅。VP8是有损原生录制，decoded PNG取既有源帧，无插帧、变速、缩放或重新编码。礼盒揭晓片段仅18个动态帧跨度0.532s，静止后按需停止绘制，不能把未录制尾段补算为零延迟。

自然对局的牌型、伙伴与血量不同，满场图及浮字帧不是严格像素A/B；同相机石面图是独立材质夹具而非对局。手机尺寸模拟不是手机真机，本地双会话不是公网真人验收。物理手机、低端GPU、全场长期FPS、音效及压力下画质恢复未通过验收；320窄屏远侧人物与短横屏单位仍较小。CI54历史995ms失败保持原事实。本轮不合并或公网部署。

复跑方法见[本地说明](../../tests/local/README.md)与[动效采集说明](../../tests/local/MOTION-README.md)。现有本机原采集目录可用 `python3 scripts/package-local-evidence.py evidence/local-gpu-2026-10-10/sources.json` 重新核对打包；不要用含内部诊断的整个test-results替换这些明确选择。
