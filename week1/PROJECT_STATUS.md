# SentinelSOC - Project Status

## 当前状态

项目已经从按学习日程划分的源码布局，重构为可直接放入 GitHub 仓库的职责型目录结构，并完成 PostgreSQL 存储链路优化。

## 已完成模块

| 模块 | 位置 | 状态 | 说明 |
|------|------|------|------|
| Mempool 监听 | src/listeners/mempoolListener.ts | ✅ | WebSocket 监听 pending 交易 |
| 交易解析 | src/parsers/transactionParser.ts | ✅ | 协议识别、ABI 解码、批量解析 |
| 一体化监控 | src/monitoring/integratedMonitor.ts | ✅ | 监听、解析、评分、持久化 |
| 数据库连接 | src/storage/db/connection.ts | ✅ | Pool 单例与关闭逻辑 |
| Schema 初始化 | src/storage/db/schema.ts | ✅ | 建表、索引、旧字段迁移 |
| 数据库演示 | src/storage/db/demo.ts | ✅ | 单独的演示写入脚本 |
| 业务服务 | src/storage/transactionService.ts | ✅ | 事务化保存与查询接口 |
| 工具库 | src/utils | ✅ | Logger 与 ABI 集合 |

## 本轮重构结果

### 存储写入链路

- saveAnalysisResult() 通过单事务一次性写入 transactions、risk_hits、transaction_logs
- addRiskHit() 和 addLog() 改为以 transactionId 为参数，不再重复按 txHash 查询
- integratedMonitor 直接调用事务化保存接口，避免半成功半失败的数据状态

### 字段语义

- transactions.value_wei 使用 Wei 作为真实存储单位
- transactions.call_data_bytes 存储 calldata 字节数，不再混用字符串长度概念
- 解析层同时保留 valueEth 供展示，valueWei 供存储和精确计算

### 结构调整

- 移除 src/day2-3、src/day4-5、src/day6-7 这些时间维度目录
- 新增 src/scripts 作为 npm 脚本入口层
- 数据库相关代码拆分为 connection、schema、demo、types 四个模块

## 已验证能力

```text
✅ npm run build
✅ npm run db:init
✅ 本地 PostgreSQL 连接
✅ Schema 初始化与旧字段迁移逻辑
✅ TypeScript 严格模式检查
```

## 当前命令集

```bash
npm run dev
npm run build
npm run clean
npm run db:init
npm run db:demo
npm run tx:parse
npm run mempool:listen
npm run integrated
```

## 下一步建议

1. 把规则命中逻辑从 integratedMonitor.ts 抽到独立 rules 模块
2. 为 risk_hits 增加去重键，避免重复消费同一笔交易时重复命中
3. 增加 REST API 或 dashboard 便于展示存储结果

**最后更新**: 2026-03-28
