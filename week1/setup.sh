#!/bin/bash
# 快速启动脚本

echo "🚀 SentinelSOC Week 1 Setup"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js >= 16"
    exit 1
fi

echo "✅ Node.js: $(node --version)"
echo "✅ npm: $(npm --version)"
echo ""

# 安装依赖
echo "📦 Installing dependencies..."
npm install

# 编译TypeScript
echo "🔨 Building TypeScript..."
npm run build

# 检查环境变量
if [ ! -f .env ]; then
    echo ""
    echo "⚠️  .env file not found"
    echo "📝 Creating .env from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit .env and add your Infura/Alchemy API key"
    echo ""
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Available commands:"
echo "  npm run mempool:listen    - Listen to pending transactions"
echo "  npm run tx:parse          - Parse transaction call data"
echo "  npm run db:init           - Initialize database"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your API key"
echo "  2. Run: npm run mempool:listen"
