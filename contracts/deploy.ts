import { ethers, upgrades } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // 1. Deploy MockERC20 (test token)
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy();
  await token.waitForDeployment();
  console.log("MockERC20 (STVOR):", await token.getAddress());

  // 2. Deploy AgenticCommerce (upgradeable proxy)
  const AgenticCommerce = await ethers.getContractFactory("AgenticCommerce");
  const commerce = await upgrades.deployProxy(AgenticCommerce, [
    await token.getAddress(),
    deployer.address,
  ], { initializer: "initialize" });
  await commerce.waitForDeployment();
  const commerceAddr = await commerce.getAddress();
  console.log("AgenticCommerce:", commerceAddr);

  // 3. Mint test tokens to deployer
  await token.mint(deployer.address, ethers.parseEther("100000"));
  console.log("Minted 100,000 STVOR to deployer");

  // 4. Save addresses to ../src/contracts/addresses.json
  const addresses = {
    network: "sepolia",
    chainId: 11155111,
    token: await token.getAddress(),
    agenticCommerce: commerceAddr,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  };

  const fs = await import("fs");
  const path = await import("path");
  const dir = path.resolve("../src/contracts");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "addresses.json"),
    JSON.stringify(addresses, null, 2)
  );
  console.log("Addresses saved to src/contracts/addresses.json");
  console.log("\n✅ Deployment complete!");
  console.log("AgenticCommerce:", commerceAddr);
  console.log("Sepolia explorer: https://sepolia.etherscan.io/address/" + commerceAddr);
}

main().catch(console.error);
