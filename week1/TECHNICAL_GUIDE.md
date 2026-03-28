# SentinelSOC - Technical Guide

## 1. 模块划分

SentinelSOC 现在采用职责驱动的目录结构：

```text
src/
├── listeners/    # 接入链上事件流
├── parsers/      # calldata 解析与协议识别
├── monitoring/   # 风险评估和流程编排
├── scripts/      # npm 命令入口
├── storage/      # 业务查询与持久化
│   └── db/       # PostgreSQL 基础设施
└── utils/        # ABI、日志等公共能力
```

这种结构比按 day/week 分类更适合长期维护，因为目录名直接表达系统职责，而不是开发时间线。

## 2. 监听层

listeners/mempoolListener.ts 负责：

- 创建 WebSocketProvider
- 监听 pending 交易哈希
- 拉取交易详情并做轻量风险启发式判断
- 输出统一日志

目前启发式规则仍保持简单：approve、transferFrom、permit 直接标记为高关注交易。这个模块只负责接收和初筛，不承担持久化职责。

## 3. 解析层

parsers/transactionParser.ts 负责把链上原始交易转换成结构化对象。

### 3.1 协议识别

- 根据 to 地址识别 Uniswap V2/V3、Aave V2/V3、Curve
- 对无法识别的目标统一标记为 Unknown

### 3.2 ABI 解析

- 根据协议选择对应 Interface
- 调用 ethers.Interface.parseTransaction({ data })
- 输出方法名、4-byte selector 和参数映射

### 3.3 本轮已完成的请求优化

- 缓存 provider.getNetwork() 结果，避免重复探测链信息
- parseRecentBlock() 优先走 provider.getBlock(blockTag, true)
- 批量解析时按 2 个请求为一组执行，降低免费 RPC 限流概率

### 3.4 输出模型

```typescript
interface ParsedTransaction {
  txHash: string;
  from: string;
  to: string;
  valueEth: string;
  valueWei: string;
  chainId: string;
  protocol: string;
  methodName: string | null;
  methodSignature: string | null;
  callDataBytes: number;
  parameters: Record<string, unknown> | null;
}
```

这里最关键的是把展示字段和值字段分开：

- valueEth 用于日志和阈值判断
- valueWei 用于精确存储
- callDataBytes 表示真实字节数，不再复用错误的长度语义

## 4. 存储基础设施

storage/db 被拆成四个文件：

| 文件 | 职责 |
|------|------|
| connection.ts | 维护 PostgreSQL Pool 单例 |
| schema.ts | 建表、索引和兼容迁移 |
| demo.ts | 演示事务化写入 |
| types.ts | 存储层类型定义 |

### 4.1 为什么要拆开

旧版 database.ts 同时承担连接、Schema、demo 三类职责，不利于维护。拆分后：

- 初始化逻辑可以独立运行
- demo 可以作为 smoke test 使用
- connection 生命周期更清楚
- 类型不会散落在多个业务文件里

## 5. 事务化业务服务

storage/transactionService.ts 是 PostgreSQL 业务入口。

### 5.1 saveAnalysisResult

这是当前最重要的写接口：

```typescript
await service.saveAnalysisResult({
  transaction: { ... },
  riskHits: [...],
  log: { ... }
});
```

内部顺序：

1. BEGIN
2. UPSERT transactions
3. INSERT risk_hits
4. INSERT transaction_logs
5. COMMIT

任何一步异常都会 ROLLBACK。

### 5.2 去掉重复查询

旧实现的问题是：

- addRiskHit() 先按 txHash 查询 transaction id
- addLog() 再按 txHash 查询一次 transaction id

现在已经改为：

- 先通过 UPSERT 拿到 transaction.id
- 后续 risk_hits 和 logs 直接使用 transactionId

这样减少了 SQL 往返，也降低了高并发下的不一致风险。

## 6. Schema 语义修正

### 6.1 value_wei

transactions 表改为用 Wei 持久化金额：

```sql
value_wei NUMERIC(78, 0) NOT NULL
```

原因很直接：

- 链上原始值天然就是 Wei
- 精确值存储不应依赖展示单位
- 后续做计算、对账、扩展到 token 原始单位更自然

### 6.2 call_data_bytes

transactions 表中的 calldata 字段改为：

```sql
call_data_bytes INTEGER NOT NULL
```

它表示真实字节数，而不是 hex 字符串长度，更不是 method selector 的长度。

## 7. 旧字段迁移策略

schema.ts 会自动兼容旧数据库：

- 如果检测到 value_eth，则新建 value_wei 并按 10^18 进行迁移
- 如果检测到 call_data_length，则重命名为 call_data_bytes
- 迁移完成后删除旧字段

这使得本地已有数据库不需要手工删表重建。

## 8. 集成监控链路

monitoring/integratedMonitor.ts 的端到端流程如下：

```text
pending tx hash
  -> parseTransaction()
  -> evaluateRiskHits()
  -> saveAnalysisResult()
  -> getStatistics() / detectRiskPatterns()
```

MVP 风险规则当前包括：

- Unknown 和 1inch Router 提高协议风险分
- approve、transferFrom、permit、swap、flashLoan 提高方法风险分
- 大额 ETH 交易增加风险分
- 合约创建增加风险分

## 9. 当前保留的技术债

1. risk_hits 还没有幂等键，重复消费相同交易时可能重复插入
2. 规则逻辑仍内嵌在 integratedMonitor.ts，后续应抽成 rules 模块
3. transactions 表还缺少 block_number、nonce、gas_price_wei 等字段
4. 目前仍以控制台日志为主，尚未接入外部告警系统

## 10. 推荐后续演进

1. 新增 rules 目录，实现配置化规则引擎
2. 新增 api 目录，提供查询接口
3. 新增 alerts 目录，对接飞书或钉钉
4. 新增 tests 目录，补事务化写入和迁移逻辑的单元测试

**最后更新**: 2026-03-28