# SentinelSOC

一个面向 DeFi 风险监控场景的 TypeScript 项目，覆盖三条主链路：实时监听待处理交易、解析 calldata、将分析结果持久化到 PostgreSQL。

这次重构完成了四个关键优化：

- 去掉 addRiskHit 和 addLog 里按 txHash 反查 transaction id 的重复查询
- 将 transaction、risk_hits、transaction_logs 的写入合并为单个数据库事务
- 将数据库连接、Schema 初始化、演示脚本拆分为独立模块
- 将存储字段从 value_eth、call_data_length 收正为 value_wei、call_data_bytes

## 项目结构

```text
src/
├── index.ts
├── listeners/
│   └── mempoolListener.ts
├── monitoring/
│   └── integratedMonitor.ts
├── parsers/
│   └── transactionParser.ts
├── scripts/
│   ├── demoDatabase.ts
│   ├── initDatabase.ts
│   ├── listenMempool.ts
│   ├── parseTransactions.ts
│   └── runIntegrated.ts
├── storage/
│   ├── db/
│   │   ├── connection.ts
│   │   ├── demo.ts
│   │   ├── schema.ts
│   │   └── types.ts
│   └── transactionService.ts
└── utils/
    ├── abis.ts
    └── logger.ts
```

## 快速开始

### 1. 安装依赖

```bash
cd code/week1
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

至少配置以下变量：

```env
INFURA_WS_URL=wss://mainnet.infura.io/ws/v3/YOUR_INFURA_KEY
INFURA_HTTP_URL=https://mainnet.infura.io/v3/YOUR_INFURA_KEY
DATABASE_URL=postgres://postgres:postgres@localhost:5432/sentinelsoc
```

### 3. 初始化数据库 Schema

```bash
npm run db:init
```

### 4. 写入一条演示数据

```bash
npm run db:demo
```

### 5. 运行功能脚本

```bash
npm run tx:parse
npm run mempool:listen
npm run integrated
```

## 可用命令

| 命令 | 说明 |
|------|------|
| npm run dev | 输出项目信息 |
| npm run build | 编译 TypeScript |
| npm run clean | 清理 dist |
| npm run db:init | 初始化或迁移 PostgreSQL Schema |
| npm run db:demo | 插入一条演示分析结果 |
| npm run tx:parse | 解析最近区块内交易 |
| npm run mempool:listen | 监听 pending 交易 |
| npm run integrated | 运行监听 + 解析 + 存储一体化流程 |

## 核心设计

### 1. 解析层优化

- 复用 provider.getNetwork() 结果，避免重复探测链信息
- 使用 provider.getBlock(blockTag, true) 预取区块交易，减少 RPC 往返
- 批量解析时限制并发为 2，显著降低免费 RPC 限流概率
- ParsedTransaction 同时保留 valueEth 和 valueWei，显示层与存储层职责分离

### 2. 存储层优化

- TransactionService.saveAnalysisResult() 使用单事务保存交易、风险命中和处理日志
- 风险命中和日志插入改为直接使用 transactionId，不再重复查询 tx_hash
- Schema 初始化模块内置旧字段迁移逻辑，可将历史 value_eth 自动迁移到 value_wei

### 3. 数据库模型

```sql
CREATE TABLE transactions (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) UNIQUE NOT NULL,
  chain_id BIGINT NOT NULL,
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42),
  value_wei NUMERIC(78, 0) NOT NULL,
  protocol VARCHAR(64) NOT NULL,
  method_name VARCHAR(128),
  method_signature VARCHAR(32),
  call_data_bytes INTEGER NOT NULL,
  parsed_parameters JSONB,
  risk_score INTEGER NOT NULL DEFAULT 0,
  is_risky BOOLEAN NOT NULL DEFAULT FALSE,
  risk_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

```sql
CREATE TABLE risk_hits (
  id BIGSERIAL PRIMARY KEY,
  transaction_id BIGINT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  rule_name VARCHAR(128) NOT NULL,
  score_delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

```sql
CREATE TABLE transaction_logs (
  id BIGSERIAL PRIMARY KEY,
  transaction_id BIGINT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  action VARCHAR(32) NOT NULL,
  details TEXT NOT NULL,
  metadata JSONB,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 典型数据流

```text
pending tx hash
  -> listeners/mempoolListener.ts
  -> parsers/transactionParser.ts
  -> monitoring/integratedMonitor.ts
  -> storage/transactionService.ts
  -> PostgreSQL
```

## 后续扩展方向

- 将规则引擎从 integratedMonitor.ts 抽成独立 rules 模块
- 为 risk_hits 增加规则版本号和去重键
- 增加告警推送和人工确认工作流
- 增加 dashboard 或 API 层供前端查询
