# 词灵对决 · Spellwood

森林主题的英语卡牌游戏。当前源码版本为 **3.2.9**，界面标记为 **3.2.9-preview**。

[公开电脑试玩](https://spellwood-3d-grove.hhhappygod.chatgpt.site/) · [版本记录](CHANGELOG.md) · [验证范围](docs/VALIDATION-3.2.9.md) · [服务端说明](server/README.md)

**当前公开 Site 只有电脑试玩，没有接入真人匹配服务器；公开真人匹配的部署与接入尚未完成。** 仓库另含 Node.js + WebSocket 权威服务器源码，具备匿名临时会话、真实双 WebSocket 匹配和权威回合等本地能力，协议测试已经通过。这些本地能力不代表公开联机已经提供；无需注册只是会话设计。

## 游戏内容

- 原创三维森林大厅、18种伙伴实体模型、24张基础卡牌、三套20张预组牌和自选套牌
- 一至六年级432项原创英语练习，按12册72单元组织；一年级词义图示及778段预制英语语音
- 每局最多4次词灵仪式、每回合最多一次；先选择效果，再通过英语练习唤醒。普通出牌和攻击无需答题
- 独立复习手册、按本机表现调整的电脑挑战、仅记录本浏览器真实完成对局的排行榜
- 累计5个有效学习日获得一次免费十连；礼盒只收集外观，无付费和属性加成。体验十连与正式学习钱包隔离
- 长按、右键或键盘 I 查看卡牌详情；横竖屏布局、减少动态、音量与本机备份

课程为自行编写的练习，不是教材官方题库。范围和来源见 [课程覆盖表](content/课程覆盖表.csv)。详细战斗规则见 [COMBAT-2.2.md](COMBAT-2.2.md)。

## 本地运行

需要 Node.js 24 或更高版本、npm。安装使用仓库内的 package-lock.json：

```sh
npm ci
```

### 三维电脑试玩

```sh
npm run build:practice
python3 -m http.server 4173 --bind 127.0.0.1 --directory practice-dist
```

打开 http://127.0.0.1:4173 。Python 3 仅用于这个静态预览命令，也可以使用其他静态 HTTP 服务。发布目录为 practice-dist，必须完整保留其中的脚本和素材。刷新会结束当前未完的临时电脑局；已保存的学习记录、礼盒结果及完成成绩继续保留。

### 本地权威匹配服务器

```sh
npm run build:network
npm run server
```

在同一台电脑打开 http://127.0.0.1:4173 。两个独立浏览器会话选择相同年级、学习范围和规则后可匹配，默认等待10秒后由电脑迎战。服务端只保存内存房间，重启会结束未完联网对局。GET /health 提供健康检查。

只对没有其他参与者的专用开发服务运行下面的协议冒烟检查，它会创建临时测试房间：

```sh
node scripts/smoke-running-server.mjs
```

配置、origin、超时和部署边界见 [server/README.md](server/README.md)，消息格式见 [server/PROTOCOL.md](server/PROTOCOL.md)。Docker 模板尚未实际构建或部署；公开服务还需要 HTTPS/WSS、正确 origin、监控及容量验证。

### 保留的旧离线入口

```sh
npm run build
npm run check
```

生成 dist/index.html，素材位于 dist/assets。旧入口的玩法和存档说明见 [README-2.7.5.md](README-2.7.5.md)。当前公共规则代码已更新，重新构建不保证与历史交付的2.7.5文件逐字节相同。

## 开发与检查

```sh
npm run typecheck
node --test --test-concurrency=1 --test-timeout=30000 tests/*.test.mjs
npm run build
npm run check
npm run build:network
npm run build:practice
```

npm test 默认最多同时运行2个测试文件；共享或低内存环境建议使用上面的串行命令。typecheck 主要覆盖旧核心的 JSDoc 接口，不是全工程静态类型证明。场景测试使用真实 Three.js 对象和射线，但模拟 Canvas/renderer，不证明 GPU 像素、触屏或设备帧率。部分离线图像审查脚本另需 @napi-rs/canvas 或 Blender；运行游戏无需这些可选工具。

3.2.9 的既有验证包括556项串行代码回归、三个入口构建、若干模拟手机视口及完整手动电脑局。本次 GitHub 导入没有重跑依赖安装或整套回归；准确的已过、未过和未测范围见 [验证记录](docs/VALIDATION-3.2.9.md)。仓库尚未配置 GitHub Actions，不能把无检查视为 CI 通过。

## 目录与素材

- src/arena3d：原创模型、实体卡牌、相机、射线、动作和 CPU 兼容渲染
- src/network：匹配界面、会话、学习记录、备份和礼盒
- src/practice：浏览器内电脑试玩适配
- server：权威战斗、匹配、判题、电脑托管和连接协议
- tests、scripts：行为回归、构建、协议冒烟及可选离线审查
- content：课程覆盖、素材生成记录和原始问题复现图片
- dist/assets：**必须纳入版本控制的源素材**，含806项图像/音乐/语音及2份素材依赖许可证
- evidence：各版本测试证据；日期、版本和模拟限制由同目录说明界定
- docs：项目方案与当前验证说明

虽然路径名是 dist/assets，它目前就是构建的素材输入。不要删除或整体忽略 dist。只忽略 dist/index.html、client-dist、practice-dist 等可重新生成的产物。源码包含实际运行所需的图像与音频，不依赖素材 CDN；不代表包含所有历史生成工具的工作文件或未恢复的原始素材。

## 存档和隐私

学习记录、设置和本机成绩保存在当前浏览器。新入口使用 spellwood.save.v3，可校验迁移同一来源的旧 v2/v1 记录，并保留旧键。不同地址、浏览器或设备不会自动同步，请通过“记录与备份”导出与恢复。

联网入口只把当前局或复习所需的选择交给服务器单次判定。服务端没有账户、聊天、长期成绩库或全服认证排名。完整题库存在于独立电脑试玩和本仓库；联网客户端排除完整答案库不等于能防止外部查题。

不要把真实学生资料、导出的个人备份、会话令牌或凭据提交到仓库。仓库只收录程序、素材及不含真实学生资料的测试证据。

## 维护约定

main 保留已确认基线。版本更改使用 codex/<简短主题> 分支，更新本文件和 CHANGELOG，完成适用检查后建立指向 main 的 draft PR。首次导入分支为 codex/import-spellwood-v3.2.9。合并与部署分别执行，不由一次源码推送隐含完成。

## 素材与许可

版权和依赖说明见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)、dist/assets/licenses、server/WS-LICENSE.txt 和 src/practice/NOBLE-HASHES-LICENSE.txt。美术、音乐及程序模型为本项目制作，不含商业游戏素材或教材扫描页。

本仓库尚未授予整个项目的开源许可。第三方组件按各自许可证使用；这些许可证不自动授权本项目全部代码和美术。
