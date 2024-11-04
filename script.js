const { ethers } = require("ethers");
const {
  FlashbotsBundleProvider,
  FlashbotsBundleTransaction,
  SimulationResponseSuccess,
} = require("@flashbots/ethers-provider-bundle");
const axios = require("axios");
require("dotenv").config();

const RPC_URL = process.env.RPC_URL;
const flashbotsRelaySigningKey = process.env.FLASHBOTS_RELAY_SIGNING_KEY;
const DISTRIBUTE_PRIVATE_KEY = process.env.DISTRIBUTE_PRIVATE_KEY;
const COLLECT_PRIVATE_KEYS = process.env.COLLECT_PRIVATE_KEY.split(","); // 拆分多个私钥

const maxPriorityFeePerGas = ethers.utils.parseUnits(
  process.env.MAX_PRIORITY_FEE_PER_GAS,
  "gwei"
);
const gasLimit = ethers.BigNumber.from(process.env.GAS_LIMIT);

// 使用新的 Provider 方法
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

// 分发钱包
const distributeWallet = new ethers.Wallet(DISTRIBUTE_PRIVATE_KEY, provider);

// 归集钱包数组
const collectWallets = COLLECT_PRIVATE_KEYS.map(
  (key) => new ethers.Wallet(key, provider)
);

const builders = [
  "flashbots",
  "f1b.io",
  "rsync",
  "beaverbuild.org",
  "builder0x69",
  "Titan",
  "EigenPhi",
  "boba-builder",
  "Gambit Labs",
  "payload",
  "Loki",
  "BuildAI",
  "JetBuilder",
  "tbuilder",
  "penguinbuild",
  "bobthebuilder",
  "BTCS",
  "bloXroute",
];

async function printBalances() {
  const distributeBalance = await provider.getBalance(distributeWallet.address);
  console.log(
    `分发主钱包 (${distributeWallet.address}) 余额: ${ethers.utils.formatEther(
      distributeBalance
    )} ETH（BNB）`
  );

  // 打印每个归集钱包的余额
  for (const collectWallet of collectWallets) {
    const collectBalance = await provider.getBalance(collectWallet.address);
    console.log(
      `批量钱包 (${collectWallet.address}) 余额: ${ethers.utils.formatEther(
        collectBalance
      )} ETH（BNB）`
    );
  }
}

async function distribute(amount) {
  // Get current base fee
  const block = await provider.getBlock("latest");
  const baseFeePerGas = block.baseFeePerGas || ethers.BigNumber.from(0);

  // Estimate gas price and gas limit
  const maxFeePerGas = baseFeePerGas.add(maxPriorityFeePerGas); // Set maxFeePerGas higher than baseFeePerGas
  const authSigner = new ethers.Wallet(flashbotsRelaySigningKey, provider);
  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    authSigner,
    "https://relay.flashbots.net"
  );

  const bundleTransactions = []; // Array to store all transactions

  // 分发给所有归集钱包
  let nonce = await distributeWallet.getTransactionCount();
  for (const collectWallet of collectWallets) {
    const tx = {
      to: collectWallet.address,
      value: ethers.utils.parseEther(amount.toString()),
      gasLimit: gasLimit,
      maxFeePerGas: maxFeePerGas,
      maxPriorityFeePerGas: maxPriorityFeePerGas,
      nonce,
      type: 2,
    };

    bundleTransactions.push({
      signer: distributeWallet,
      transaction: {
        ...tx,
        chainId: provider.network.chainId,
        type: 2,
      },
    });

    if (provider.network.chainId !== 1) {
      const transaction = await distributeWallet.sendTransaction(tx);
      await transaction.wait();
    }

    console.log(`成功分发 ${amount} ETH（BNB） 到 ${collectWallet.address}`);
    nonce += 1;
  }

  if (provider.network.chainId === 1) {
    // Check if bundleTransactions is empty
    if (bundleTransactions.length === 0) {
      console.error("Error: No transactions to process.");
      return; // Exit the function or script here
    }

    console.log("Signing the bundle...");
    const signedBundle = await flashbotsProvider.signBundle(bundleTransactions);

    console.log("Simulating the bundle...");
    let blockNumber = (await provider.getBlockNumber()) + 1;
    const simulation = await flashbotsProvider.simulate(
      signedBundle,
      blockNumber
    );

    console.log(JSON.stringify(simulation, null, 2));

    let hasError = false;

    // Checking for errors in the simulation results
    if ("error" in simulation) {
      console.error(
        `Simulation contains errors. Aborting: ${simulation.error.message}`
      );
      hasError = true;
    } else if ("results" in simulation) {
      const results = simulation.results;

      for (const result of results) {
        if ("error" in result) {
          let readableError = "Unknown Error";
          try {
            readableError = ethers.utils.toUtf8String(result.revert);
          } catch (err) {
            readableError = `Hex data: ${result.revert}`;
          }
          console.error(
            `Simulation error in transaction ${result.txHash}: ${readableError}`
          );
          hasError = true;
        }
      }

      if (hasError) {
        console.error("Simulation contains errors. Aborting.");
        return false;
      }

      console.log("Simulation result: Success");
    }
    if (!hasError) {
      blockNumber = (await provider.getBlockNumber()) + 1;
      const transactionLinks = [];
      const bundleReceipt = await sendBundleWithSignature(
        signedBundle,
        blockNumber,
        builders,
        authSigner
      );

      if ("bundleTransactions" in bundleReceipt) {
        for (const tx of bundleReceipt.bundleTransactions) {
          transactionLinks.push(`https://etherscan.io/tx/${tx.hash}`);
        }
      }
      console.log(
        `Bundle submitted for block https://blocks.flashbots.net/v1/blocks/${blockNumber}, https://blocks.flashbots.net/v1/bundle/${simulation["bundleHash"]}`
      );

      console.log("Transaction links for executed transactions:");
      transactionLinks.forEach((link) => console.log(link));
      return true;
    } else {
      return !hasError;
    }
  }
}

async function collect() {
  // Get current base fee
  const block = await provider.getBlock("latest");
  const baseFeePerGas = block.baseFeePerGas || ethers.BigNumber.from(0);

  // Estimate gas price and gas limit
  const maxFeePerGas = baseFeePerGas.add(maxPriorityFeePerGas); // Set maxFeePerGas higher than baseFeePerGas
  const authSigner = new ethers.Wallet(flashbotsRelaySigningKey, provider);
  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    authSigner,
    "https://relay.flashbots.net"
  );

  // const minBalanceToKeep = ethers.utils.parseEther("0.0005"); // 保留的最小余额
  const bundleTransactions = []; // Array to store all transactions

  for (const collectWallet of collectWallets) {
    let nonce = await collectWallet.getTransactionCount();
    const balance = await provider.getBalance(collectWallet.address);

    // 计算可归集的余额
    const collectibleAmount = balance.sub(gasLimit.mul(maxFeePerGas));

    if (collectibleAmount.isNegative() || collectibleAmount.isZero()) {
      console.log(
        `没有资金可归集 ${
          collectWallet.address
        }, 保留 ${ethers.utils.formatEther(balance)} ETH（BNB）.`
      );
      continue; // 如果余额不够，跳过归集
    }

    const tx = {
      to: distributeWallet.address,
      value: collectibleAmount,
      gasLimit: gasLimit,
      maxFeePerGas: maxFeePerGas,
      maxPriorityFeePerGas: maxPriorityFeePerGas,
      nonce,
      type: 2,
    };

    bundleTransactions.push({
      signer: collectWallet,
      transaction: {
        ...tx,
        chainId: provider.network.chainId,
        type: 2,
      },
    });

    if (provider.network.chainId !== 1) {
      const transaction = await collectWallet.sendTransaction(tx);
      await transaction.wait();
    }

    console.log(
      `已成功归集 ${ethers.utils.formatEther(
        collectibleAmount
      )} ETH（BNB） 从 ${collectWallet.address} 到 ${distributeWallet.address}`
    );
  }
  if (provider.network.chainId === 1) {
    // Check if bundleTransactions is empty
    if (bundleTransactions.length === 0) {
      console.error("Error: No transactions to process.");
      return; // Exit the function or script here
    }

    console.log("Signing the bundle...");
    const signedBundle = await flashbotsProvider.signBundle(bundleTransactions);

    console.log("Simulating the bundle...");
    let blockNumber = (await provider.getBlockNumber()) + 1;
    const simulation = await flashbotsProvider.simulate(
      signedBundle,
      blockNumber
    );

    console.log(JSON.stringify(simulation, null, 2));

    let hasError = false;

    // Checking for errors in the simulation results
    if ("error" in simulation) {
      console.error(
        `Simulation contains errors. Aborting: ${simulation.error.message}`
      );
      hasError = true;
    } else if ("results" in simulation) {
      const results = simulation.results;

      for (const result of results) {
        if ("error" in result) {
          let readableError = "Unknown Error";
          try {
            readableError = ethers.utils.toUtf8String(result.revert);
          } catch (err) {
            readableError = `Hex data: ${result.revert}`;
          }
          console.error(
            `Simulation error in transaction ${result.txHash}: ${readableError}`
          );
          hasError = true;
        }
      }

      if (hasError) {
        console.error("Simulation contains errors. Aborting.");
        return false;
      }

      console.log("Simulation result: Success");
    }
    if (!hasError) {
      blockNumber = (await provider.getBlockNumber()) + 1;
      const transactionLinks = [];
      const bundleReceipt = await sendBundleWithSignature(
        signedBundle,
        blockNumber,
        builders,
        authSigner
      );

      if ("bundleTransactions" in bundleReceipt) {
        for (const tx of bundleReceipt.bundleTransactions) {
          transactionLinks.push(`https://etherscan.io/tx/${tx.hash}`);
        }
      }
      console.log(
        `Bundle submitted for block https://blocks.flashbots.net/v1/blocks/${blockNumber}, https://blocks.flashbots.net/v1/bundle/${simulation["bundleHash"]}`
      );

      console.log("Transaction links for executed transactions:");
      transactionLinks.forEach((link) => console.log(link));
      return true;
    } else {
      return !hasError;
    }
  }
}

async function sendBundleWithSignature(
  signedBundle,
  blockNumber,
  builders,
  authSigner
) {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_sendBundle",
    params: [
      {
        txs: signedBundle,
        blockNumber: ethers.utils.hexValue(blockNumber),
        builders: builders,
      },
    ],
  };

  const requestBody = JSON.stringify(payload);

  const signature = await authSigner.signMessage(ethers.utils.id(requestBody));

  try {
    const response = await axios.post(
      "https://relay.flashbots.net",
      requestBody,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Flashbots-Signature": `${authSigner.address}:${signature}`,
        },
      }
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        "Error sending bundle:",
        error.response?.data || error.message
      );
    } else {
      console.error("Unexpected error:", error);
    }
    return null;
  }
}

(async () => {
  await printBalances();

  // 提示用户选择操作
  const prompt = require("prompt-sync")();
  console.log("选择操作:");
  console.log("1 - 分发ETH（BNB）");
  console.log("2 - 归集ETH（BNB）");

  const action = prompt("输入操作编号: "); // 获取用户输入
  let amount;

  if (action === "1") {
    amount = parseFloat(prompt("输入要分配给每个钱包的 ETH(BNB) 数量: ")); // 获取分发金额
    if (isNaN(amount) || amount <= 0) {
      console.log("请提供有效金额进行分配.");
      return;
    }
    await distribute(amount);
  } else if (action === "2") {
    await collect();
  } else {
    console.log("操作无效。使用“1”表示分发，使用“2”表示归集.");
  }

  await printBalances();
})();
