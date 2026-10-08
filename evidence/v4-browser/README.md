# 原始浏览器验收记录

这些JSON来自GitHub Actions实际Chromium会话的安全报告，原样保留；包含虚构测试账号的汇总，不含Cookie、密码、恢复码、原始网络消息或数据库。截图仍需人工看图，自动检查绿灯不能替代视觉验收。

|记录|head|运行|解释|
|---|---|---|---|
|run2|e8a086dd390e09f6dcdedf45a17b79f4e97b660a|https://github.com/liuao8080/Spellwood-learning-game/actions/runs/37754110167|5组通过后复查发现重启时2次页面异常，不能作为零异常验收|
|run3|9e9fee2eb71883db3df5b675b7a0bb2541b1aafb|https://github.com/liuao8080/Spellwood-learning-game/actions/runs/37755487685|计时器修复，所有场景增加零页面异常门，5组通过|
|run4|d84988406eb2b3118564cc1df0fa0e1aeb1f19c1|https://github.com/liuao8080/Spellwood-learning-game/actions/runs/37756359321|提示遮挡修正、44px目标和横屏滚动可达性检查，5组通过，11个测试页面均零异常|

GitHub pull_request默认检出临时合并验证提交，所以报告commit不一定等于head。run2实际commit=a30233aca97c2fbbe6f3f5331c41618c6c08a818，源码树=f2d9bcb1ec3e732a8bdb9349d0a4bc4561328850；run4实际commit=1282dc336096ceb66c49d7fd6d6c9b4b9a1b6e34，源码树=71e752de7fa9573af2c99e3c955e85a4337234db。两者均已核对与各自head同树，没有把另一份源代码的结果当成本分支结果。

原始PNG/JSON完整压缩包SHA见artifact-digests.json。run2的34项与run4的40项原始证据另外随项目交付持久保存；GitHub artifact只有短期保留，不能把临时下载地址当长期交付。没有通过图像生成或预制画面冒充实录。

完整对战为脚本通过真实页面点击/键盘驱动，两个独立cookie/context；不是两个人类手动试玩。物理手机、连续帧率、听觉质量、真实公网延迟与长期负载均不在这个记录的证明范围。WebGL2确实启用，不能推断底层是物理GPU。
