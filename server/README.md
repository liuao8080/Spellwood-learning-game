# 本地权威服务器

这是独立联网入口的内存服务，不修改旧2.7.5离线存档或旧公开站点。协议字段见[PROTOCOL.md](PROTOCOL.md)。

## 本机运行

建议Node24；依赖精确锁定在package-lock.json（ws8.22.0）。

```sh
npm ci
node scripts/build-network.mjs
HOST=127.0.0.1 PORT=4173 npm run server
```

在同一个可访问该服务的运行环境打开http://127.0.0.1:4173。`GET /health`应返回ok、net-1.1、战斗2.2和题库版本。启动日志本身不证明另一个命令、容器或浏览器能够访问该端口；应分别验证health、首页和WebSocket。

如果4173已被占用，进程报告EADDRINUSE并停止，不会杀其他进程。若client-dist未构建，health仍可用，首页明确返回503 FRONTEND_NOT_BUILT。

支持的部署环境变量：

- HOST：默认127.0.0.1
- PORT：默认4173
- PUBLIC_ORIGIN：访问页面的完整origin；默认由监听地址构造
- ALLOWED_ORIGINS：可选逗号分隔的明确origin列表，不能写通配符
- CLIENT_DIST：可选前端输出目录

`createGameServer({port:0,config:{...}})`用于自动测试；客户端不能在协议里修改时限。默认时限见service.mjs中的DEFAULTS：匹配10秒，起手60秒，回合150秒，开始答题至少再留120秒，断线宽限20秒，双方离线/完成房间保留5分钟，会话和房间绝对上限2小时。

## 数据和信任边界

- 服务器用crypto洗牌，只下发本人手牌与对方手牌数量，不下发牌库或可重建牌序的seed
- 两位真人各有独立答题上下文；不接受客户端correct、任意power、分数或完整状态
- 私有题库与完整朗读文本索引仅在server/questions.mjs加载，在线静态目录没有源文件接口
- 完整题库本已在旧离线版和教材中公开；不承诺防查书、查旧题库或外部答题程序
- 匿名英文代号与重连秘密只保留临时会话；服务端不保存账户、长期学习档案、答案日志或IP历史
- 浏览器只在sessionStorage保存重连秘密，旧save.match不用于联网房间
- 收到private.feedback时，前端必须按challengeId持久去重学习写入；replayed:true是恢复回执，不能重复增加学习次数
- 会话恢复只返回本人的反馈。房间过期时同时清理房间、挑战及该房间的私有反馈回执
- 服务器重启会失去内存房间；旧令牌返回SESSION_EXPIRED。没有数据库恢复或全服认证排名

## 超时与重连

开始仪式即预约一次机会，不能取消重抽题。正常答错得1甲并写本人学习结果；超时也得1甲并消耗本次，但outcome=unanswered、没有learning字段，不记学习错误。

断线/回合超时可转电脑托管，结果标AI-assisted。真人席托管只代打卡牌与攻击，不能替本人免费答题施法。新开电脑对手仍有自己的自主仪式。已经由电脑行动、或已经超过本人时限的当前回合由它完成，用户可用room.reclaim申请下个本人回合恢复。只有尚未超时且电脑未走牌时才即时交回；接回不会刷新已用掉的时限，也不会取消对方正在安排的动作。本人快照的controlRequestPending会明确确认等待交接，界面显示已申请，避免重复点击。绝对会话期限在每个指令入口校验，不只依赖定时清理。

4001/session.replaced：另一连接接管同一临时会话，旧标签停止自动重连。4003：会话过期。普通网络错误才使用退避重连。

## 测试

```sh
npm run test:network
npm run typecheck
npm test
```

协议测试建立真实TCP/WebSocket连接，覆盖两客户端整局、电脑回退整局、双方起手和判题、隐藏字段、非法/重复/乱序命令、恢复回执、超时、清理与源目录隔离。脚本客户端使用自己的安全视图，不以localStorage同步充当联机。

对没有其他参与者的专用本地开发服务，可另开终端运行`node scripts/smoke-running-server.mjs`进行两模拟客户端完整对局；加`--solo`验证默认等待后由电脑迎战。脚本只允许本地地址、不会读取私有答案，创建的是真实临时测试房间。

这些测试不等同浏览器3D/触控/网络环境验收。旧tsconfig目前主要覆盖旧核心模块；新服务使用Node语法检查和协议/安全回归，不能把旧typecheck描述为完整服务静态类型证明。

## Docker迁移准备

server/Dockerfile与配套忽略文件是交付模板，尚未在本轮运行Docker构建或部署。它使用官方Node镜像和多阶段构建，最终镜像不保留开发依赖。健康探针只访问本机127.0.0.1，检查权威接口、首页和前端脚本；按PUBLIC_ORIGIN设置Host，不向该公开域名发请求。可单独运行node server/healthcheck.mjs验证。Docker运行在容器内监听0.0.0.0，示例只把端口映射到主机127.0.0.1。

```sh
docker build -f server/Dockerfile -t spellwood-local .
docker run --rm -p 127.0.0.1:4173:4173 \
  -e PUBLIC_ORIGIN=http://127.0.0.1:4173 spellwood-local
```

公开迁移需要另行配置HTTPS/WSS、受信任反向代理与正确PUBLIC_ORIGIN。反代必须保留正确Host和WebSocket Upgrade/Connection语义；不信任任意客户端X-Forwarded-For。当前内存架构只支持一个权威进程，不能随机把同一房间请求分配到多个副本。公开滥用/负载尚未验收，不应仅凭本地测试宣称生产级防作弊或规模能力。

探针调度参数依据[Docker HEALTHCHECK官方说明](https://docs.docker.com/reference/dockerfile/#healthcheck)。目前只验证Node探针与打包运行目录，不能称Docker镜像构建成功。

参考：[ws官方文档](https://github.com/websockets/ws)、[Node官方容器镜像](https://github.com/nodejs/docker-node)、[Docker构建上下文与专用忽略文件](https://docs.docker.com/build/concepts/context/#dockerignore-files)。
