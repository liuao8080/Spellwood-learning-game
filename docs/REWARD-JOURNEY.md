# 今日小任务与人物皮肤

本文件描述新的纯奖励模型。它本身不代表 HTTP、数据库、页面或部署已接入。

## 给玩家的规则

- 每个上海学习日有三个小任务：完成 3 个不同知识点得 5 正式叶屑；完成 6 个不同知识点得 1 造型券；在学习桌完成同一单元 2 道不同题，或正常完成一场合格对局，再得 1 造型券。同一题可同时推进多个任务，答错也算参与。
- 合格对局要求进入至少 2 个本人回合，并亲自完成至少 3 次合法出牌或攻击。正常胜、负、平都可以；退出、投降、过期以及电脑代做的动作不满足条件。电脑局和真人局都能完成。
- 完成读题与反馈阅读后自动收好奖励。公开参与要求仍为读题 2 秒、反馈 1.2 秒；这些时间由服务器验证。答得太快可继续读完反馈，不需要重答。没有作答、过期或未完成有效参与，不发正式奖励。
- 每个持久玩家身份首次完成 3 题任务另送 1 造型券，仅一次；游客注册后保留原身份，不再发一次。通常每日最多 2 券、5 叶屑，首日另有这 1 券。
- 学习日按固定 Asia/Shanghai 时区切换。题目归入服务器开始挑战的那一天，即使答完时已过午夜也不会重复算两天。隔天任务重新开始；漏一天不扣券、不扣叶屑，也不清空已有学习日或礼盒。
- 现有累计 5 个正式学习日的卡牌外观十连独立保留；人物皮肤不会代替它。全部完成后显示“今天的礼物已收好，随时可以休息”。
- 人物皮肤与卡牌外观分池。皮肤池有 20 款，普通抽取每款 5%；若前 4 次抽取连续重复且尚有未拥有款，第 5 次从未拥有款中均匀抽取。抽到新款后重复计数归零。直接兑换不是抽取，不会消除已有的抽取保底。
- 1 券抽 1 件，10 券抽 10 件，单件概率与补偿规则相同，没有十连折扣。重复皮肤得 20 正式叶屑；100 正式叶屑可指定兑换一款未拥有的皮肤。十连内先抽到的皮肤立即算已拥有，因此同批后续相同款也属于重复。
- 全部收齐后不再提示未拥有保底；抽到的每件仍补偿 20 叶屑，也可以保留券。皮肤永久保留，不加任何战斗数值。
- 抽取先保存全部结果，再播放动画。关闭动画不会退款、重抽或丢失未揭结果。再次进入接着查看。体验区可无限试抽、无限试换，其收藏和叶屑与正式奖励完全分开，并显示体验标签。

## 模块与持久化边界

源码：`src/reward-journey.mjs`。目录来源：`src/hero-skins.mjs` 的 20 项 `HERO_SKINS`；基础人物 `forest_apprentice` 不进入奖励池。

状态为版本 1，保存在原玩家 profile 下，由持久 `ownerId` 持有。`freshJourney({ownerId})` 仅用于该身份首次创建；`normalizeJourney(undefined, {ownerId})` 是唯一建立默认值的迁移入口。已有状态为 null、损坏、未知版本、身份不符时必须报错，不能自动重建新客权益。注册沿用同一份状态；旧档导入和客户端存档不能覆写此状态。

“新客一次”精确指每个持久 `playerId` 一次。彻底清除游客凭据后若创建了另一个新游客身份，系统不能凭本模块判断是同一个人。这里不使用硬件指纹，也不声称能阻止重装后以另一新身份获得新客礼物；登录找回的原账号仍是同一身份。

此模块只持有造型券、两套皮肤所有权/重复计数、体验叶屑、任务进度与批次。**没有正式叶屑余额，也没有累计学习日/卡饰礼包余额。** 原有官方叶屑钱包、正式学习日、卡饰钱包和历史本机资料均继续由现有模块拥有。

每个命令返回：

`{ state, changed, replayed, officialDustDelta, receipt }`

- `state` 是独立的新对象，输入永不修改；失败抛出带 `code` 的异常。
- `changed` 表示新命令已记入状态，包括已经完成目标后的无奖励操作；不能拿它当“有新奖励”。以 `receipt.completed`、`skinTicketsAwarded` 和 `officialDustDelta` 判断奖励。
- `officialDustDelta` 是本次应写入原官方叶屑钱包的精确变化：暖身 +5、重复每件 +20、兑换 −100。重试永远为 0；历史回执保留最初的奖励说明。
- UI 只能在父事务提交成功之后播放奖励或抽取动画。

## 调用契约

所有事件均由服务器构造。玩家请求不能直接提供 `ownerId`、资格、参与次数、判题结果、服务器时间或随机结果作为可信输入。此纯模块不会代替身份认证、题库检查、挑战归属、过期校验或服务器计时。

| 函数 | 参数 |
| --- | --- |
| `freshJourney` | `{ ownerId }` |
| `normalizeJourney` | `(storedState, { ownerId }?)` |
| `rewardDay` / `rewardPeriod` | 可信毫秒时间；固定上海日期与 `shanghai-v1:YYYY-MM-DD` 周期 |
| `dailySummary` | `(state, serverNow)`；只读，不自动发奖或清空余额 |
| `applyQualifiedLearning` | `(state, {ownerId,eventId,qid,unitId,source,issuedAt,answeredAt,qualifiedAt}, options?)` |
| `applyQualifiedMatch` | `(state, {ownerId,eventId,matchId,mode,termination,ownTurns,ownActions,issuedAt,finishedAt}, options?)` |
| `openSkinPack` | `(state, {ownerId,operationId,issuedAt,mode,count}, {randomValues,expectedRevision?})` |
| `revealSkinPack` | `(state, {ownerId,operationId,issuedAt,mode,batchId,index}, options?)` |
| `closeSkinPack` | `(state, {ownerId,operationId,issuedAt,mode,batchId}, options?)` |
| `redeemSkin` | `(state, {ownerId,operationId,issuedAt,mode,skinId}, {officialDustBalance,expectedRevision?})` |
| `equipSkin` | `(state, {ownerId,operationId,issuedAt,mode,skinId}, options?)` |

`options.expectedRevision` 在第一次执行时必须与 journey 版本相符；成功重试先于版本检查返回。父数据库仍必须用整个玩家档案的 CAS 版本，不能将这里的检查当作锁。

学习事件 `source` 为 `study` 或 `match`；只有 `study` 参与同单元两题路线，两类均推进 3/6 题。`unitId` 应包括年级和学期，避免不同课程同名单元相撞。题目、单元、`issuedAt`、`answeredAt` 和首次 `qualifiedAt` 来自同一服务器回执。正确率不参与奖励。模块验证时间顺序、反馈至少 1.2 秒、从签发到合格至少 3.2 秒；服务器另外验证真实读题/反馈记录、未过期与唯一性。首次资格时间须稳定，不将每次 HTTP 重试的当前时间改写进去。

对局 `mode` 为 `pve` 或 `pvp`；`termination` 为 `normal`、`surrender`、`quit` 或 `expired`。`ownTurns` 与 `ownActions` 必须只统计本人实际操作，不能包含托管。对局的 `issuedAt` 也绑定服务器开始该对局的奖励日；`finishedAt` 不搬移该归属。

皮肤 `mode` 为 `official` 或 `test`，`count` 仅 1 或 10。`randomValues` 由服务器生成，长度必须等于 count，每项为 `[0,1)` 有限值；生产不要接受客户端传入种子或随机值。每件使用一项随机值，不使用隐藏的按人概率。动作指纹不含重试时间、随机值或过时 UI 版本，已提交开包不会因新随机值重抽。

批次 ID 等于最初 `operationId`。`index` 为从 0 开始的结果序号或 `'all'`。揭示位掩码在 state 的 `openings[mode].revealed` 中；1 抽全部揭示为 1，10 抽为 1023。提前关闭回执 `pending:true`，继续保留原批次；全揭之后的新关闭动作才归档。每次新用户动作使用新的 operationId，重试同一动作沿用原 ID。

体验区兑换无消耗；官方兑换使用父事务内读到的 `officialDustBalance`，成功后父事务写入 −100。已拥有款不再次收费。装备皮肤必须在相应来源已拥有；默认皮肤不需要解锁，装备结果保留来源标记。

## 原子提交与幂等

1. 服务器验证身份、读取永久事件总账并比较稳定请求内容。同 ID 不同内容是冲突；同内容返回原回执与当前状态。
2. 在原玩家 SQLite 事务中读取当前档案/官方叶屑余额与 CAS 版本，调用 reducer。
3. 原子写入 journey、旧官方叶屑钱包的 delta、原有学习日更新及永久事件回执。任何余额约束、版本冲突或写入失败都整体回滚；不发送成功动画。
4. CAS 冲突后重读并重新计算，不提交此前候选状态。开包的候选结果只有提交后才对客户端可见；响应丢失由永久回执恢复。

永久总账至少按 `(playerId,eventId)` 与 `(playerId,operationId)` 唯一；事件 ID 建议直接源于挑战 ID/对局 ID。同 ID 内容比较使用上述语义字段，不包含答案正文、凭证或每次重试的新随机数。

内存状态保留最近 35 个有活动的奖励日、128 个活动回执、64 个命令回执、20 个完成批次；未揭批次每来源各 1 个，永久保留。被裁剪的历史有时间水位；过旧未知请求会报 `REWARD_HISTORY_EXPIRED` 或 `REWARD_DAY_EXPIRED`，不会再次发奖。未揭批次与尚保留的完成批次也能直接恢复同一开包回执。**这些有界历史不是终身幂等总账的替代品**；所有历史重试/冲突仍先查现有 SQLite 永久回执。已有批次内的 10 件结果不会按新版目录重抽。

旧 `collection.qualifyDay` 使用 `answeredAt`；接入时需用挑战签发周期对齐新正式学习日，避免上海午夜时任务与旧五日礼包把同一挑战算到不同天。本模块不直接更改该旧逻辑。

## 已运行验证与模拟限制

`tests/reward-journey.test.mjs` 覆盖：不同题/重复事件/冲突、错题、读题边界、无参与、同单元与对局替代路线、上海午夜、漏日、注册保留身份、JSON 重启恢复、1/10 抽、重复保底、全收集、兑换、来源隔离、取消与揭示、历史裁剪、CAS 候选冲突及故障不修改原状态。

固定种子模型，每个观察点 120 次模拟：假设每天做完全部任务、首日领取新客券、花完所有券、完全不做指定兑换。

| 活跃学习日 | 总券 | 收集皮肤最少 / 中位 / 最多 | 平均累计叶屑 |
| --- | ---: | ---: | ---: |
| 10 | 21 | 11 / 13 / 18 | 201 |
| 20 | 41 | 17 / 19 / 20 | 541 |
| 30 | 61 | 20 / 20 / 20 | 970 |

极端固定抽值 0 的 50 日模型：101 次抽取仍能完成 20 款，累计 1870 叶屑；全收集后不出现空池或虚假保底。普通池 400 个等间隔取样每款恰为 20 次；保底池按未拥有数量均分。

这是规则模型的回归验证，不是儿童行为、留存或现实收集周期数据。故障与 CAS 测试验证纯 reducer/调用契约，没有替代父模块的真实 SQLite 事务、HTTP 权限或浏览器端到端测试。
