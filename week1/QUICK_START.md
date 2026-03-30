# SentinelSOC - Quick Start

## 5 分钟跑起来

### 1. 安装依赖

```bash
cd d:\block-chain\SentinelSOC\code\week1
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

填入至少这三项：

```env
INFURA_WS_URL=wss://mainnet.infura.io/ws/v3/YOUR_INFURA_KEY
INFURA_HTTP_URL=https://mainnet.infura.io/v3/YOUR_INFURA_KEY
DATABASE_URL=postgres://postgres:postgres@localhost:5432/sentinelsoc
```

如果你希望接收飞书告警，再额外配置：

```env
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/your-webhook
FEISHU_ALERT_MIN_SCORE=30
```

### 3. 初始化数据库

```bash
npm run db:init
```

### 4. 写入演示数据

```bash
npm run db:demo
```

### 5. 跑核心功能

```bash
npm run tx:parse
npm run mempool:listen
npm run integrated
```

## 命令速查

| 命令 | 用途 |
|------|------|
| npm run dev | 查看项目信息 |
| npm run build | TypeScript 编译 |
| npm run clean | 清理 dist 输出 |
| npm run db:init | 建表并执行旧字段迁移 |
| npm run db:demo | 插入一条样例分析记录 |
| npm run tx:parse | 解析最近区块的交易 |
| npm run mempool:listen | 监听 pending 交易 |
| npm run integrated | 运行完整监控链路，包含启动重试、预热和有限队列 |

## 目录速查

```text
src/
├── listeners/    # 实时监听
├── notifications/ # 告警通知
├── parsers/      # 交易解析
├── monitoring/   # 端到端监控
├── monitoring/rules/ # 本地规则评分
├── scripts/      # npm 脚本入口
├── storage/      # PostgreSQL 持久化
└── utils/        # ABI 与日志工具
```

## 常见问题

### 1. npm run db:init 提示 DATABASE_URL 缺失

- 确认 .env 已保存
- 确认 DATABASE_URL 指向存在的数据库
- 如果数据库不存在，先在 PostgreSQL 中创建 sentinelsoc

### 2. tx:parse 出现 Too Many Requests

- 当前解析器已经做了请求频率优化
- 如果仍被限流，建议更换 RPC key 或切换更高配额套餐

### 3. mempool:listen 没输出

- 检查 WebSocket URL 是否可用
- 检查网络是否允许 WSS 出站连接
- 将 LOG_LEVEL 调到 debug 观察 provider 错误

### 4. integrated 出现 Pending queue is full

- 这是当前的限流保护在生效，不表示服务已经崩溃
- 当前 RPC 配额不足以吃下全部 pending 流量时，会主动丢弃超出队列容量的交易
- 如果希望提高吞吐，可以调大队列、并发数，或更换更高配额的 RPC

### 5. 旧库里还保留 value_eth 和 call_data_length 吗

- db:init 会自动把旧字段迁移到 value_wei 和 call_data_bytes
- 迁移完成后旧字段会被删除
- risk_hits 也会自动补 dedupe_key，并清理旧的重复命中记录

## 推荐验证顺序

1. 先跑 npm run build，确认 TypeScript 无错误
2. 再跑 npm run db:init，确认 PostgreSQL 可连接
3. 然后跑 npm run db:demo，验证事务化写入链路
4. 最后再跑 tx:parse 或 integrated

**最后更新**: 2026-03-30
