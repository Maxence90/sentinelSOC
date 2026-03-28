/**
 * ABI 数据库：主流DeFi协议的简化ABI
 */

export const ABIS = {
  // ERC20 标准接口
  ERC20: [
    'function approve(address spender, uint256 amount) public returns (bool)',
    'function transfer(address to, uint256 amount) public returns (bool)',
    'function transferFrom(address from, address to, uint256 amount) public returns (bool)',
    'function balanceOf(address account) public view returns (uint256)',
    'function allowance(address owner, address spender) public view returns (uint256)',
    'event Approval(address indexed owner, address indexed spender, uint256 value)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ],

  // WETH (Wrapped Ether)
  WETH: [
    'function deposit() public payable',
    'function withdraw(uint256 amount) public',
    'function approve(address spender, uint256 amount) public returns (bool)',
    'function transfer(address to, uint256 amount) public returns (bool)',
  ],

  // Uniswap V2 Router
  UNISWAP_ROUTER: [
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
    'function swapTokensForExactETH(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)',
    'function removeLiquidity(address tokenA, address tokenB, uint liquidity, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB)',
  ],

  // Uniswap V3 Router
  UNISWAP_V3_ROUTER: [
    'function exactInputSingle(tuple(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)',
    'function exactOutputSingle(tuple(bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum) params) external payable returns (uint256 amountIn)',
    'function exactInput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)',
    'function exactOutput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum) params) external payable returns (uint256 amountIn)',
  ],

  // Aave V2 Lending Pool
  AAVE_POOL: [
    'function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external',
    'function withdraw(address asset, uint256 amount, address to) external returns (uint256)',
    'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external',
    'function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) external returns (uint256)',
    'function swapBorrowRateMode(address asset, uint256 rateMode) external',
    'function setUserUseReserveAsCollateral(address asset, bool useAsCollateral) external',
    'function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken) external',
    'function flashLoan(address receiverAddress, address token, uint256 amount, bytes calldata params) external',
  ],

  // Aave V3 Pool
  AAVE_V3_POOL: [
    'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external',
    'function withdraw(address asset, uint256 amount, address to) external returns (uint256)',
    'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external',
    'function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) external returns (uint256)',
    'function repayWithATokens(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) external returns (uint256)',
    'function flashLoan(address receiver, address token, uint256 amount, bytes calldata params, uint16 referralCode) external',
    'function flashLoanSimple(address receiver, address token, uint256 amount, bytes calldata params, uint16 referralCode) external',
  ],

  // Curve Finance Pool
  CURVE_POOL: [
    'function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external returns (uint256)',
    'function exchange_underlying(int128 i, int128 j, uint256 dx, uint256 min_dy) external returns (uint256)',
    'function add_liquidity(uint256[2] calldata amounts, uint256 _min_mint_amount) external returns (uint256)',
    'function add_liquidity(uint256[3] calldata amounts, uint256 _min_mint_amount) external returns (uint256)',
    'function add_liquidity(uint256[4] calldata amounts, uint256 _min_mint_amount) external returns (uint256)',
    'function remove_liquidity(uint256 _burn_amount, uint256[2] calldata _min_amounts) external returns (uint256[2] memory)',
    'function remove_liquidity_imbalance(uint256[2] calldata _amounts, uint256 _max_burn_amount) external returns (uint256)',
  ],

  // OpenZeppelin Governor (DAO治理)
  GOVERNANCE: [
    'function propose(address[] memory targets, uint[] memory values, string[] memory signatures, bytes[] memory calldatas, string memory description) public returns (uint)',
    'function castVote(uint proposalId, uint8 support) public',
    'function castVoteWithReason(uint proposalId, uint8 support, string calldata reason) public',
    'function queue(address[] memory targets, uint[] memory values, string[] memory signatures, bytes[] memory calldatas, bytes32 descriptionHash) public',
    'function execute(address[] memory targets, uint[] memory values, bytes[] memory calldatas, bytes32 descriptionHash) public payable',
  ],

  // 1inch Router (DEX Aggregator)
  ONE_INCH_ROUTER: [
    'function swap(address executor, tuple(address tokenIn, address tokenOut, address recipient, uint256 amount, uint256 minReturn, uint256 flags, bytes permit, bytes data) calldata desc, bytes calldata permit, bytes calldata data) external payable returns (uint256 returnAmount, uint256 spentAmount, uint256 gasLeft)',
  ],
};
