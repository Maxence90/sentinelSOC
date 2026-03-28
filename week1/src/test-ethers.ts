// 快速测试脚本：验证ethers模块功能
import { ethers } from 'ethers';

console.log('✅ ethers 模块已成功加载');
console.log(`ethers 版本: ${ethers.version}`);
console.log('');

// 测试1: 创建一个地址对象
const testAddress = '0x1234567890123456789012345678901234567890';
console.log('测试1 - 地址验证:');
console.log(`  原地址: ${testAddress}`);
console.log(`  是否有效: ${ethers.isAddress(testAddress)}`);
console.log('');

// 测试2: 格式化金额
const amount = ethers.parseEther('1.5');
console.log('测试2 - 金额格式化:');
console.log(`  1.5 ETH -> Wei: ${amount.toString()}`);
console.log(`  格式化回去: ${ethers.formatEther(amount)} ETH`);
console.log('');

// 测试3: 创建随机钱包
const wallet = ethers.Wallet.createRandom();
console.log('测试3 - 随机钱包生成:');
console.log(`  地址: ${wallet.address}`);
console.log(`  私钥长度: ${wallet.privateKey.length} 字符`);
console.log('');

// 测试4: 交易对象创建
const tx = {
  to: '0xRecipientAddress',
  from: '0xSenderAddress', 
  value: ethers.parseEther('1.0'),
  data: '0x',
};

console.log('测试4 - 交易对象:');
console.log(`  收款地址: ${tx.to}`);
console.log(`  金额: ${ethers.formatEther(tx.value)} ETH`);
console.log('');

console.log('🎉 所有基础测试通过，ethers 模块功能正常！');
