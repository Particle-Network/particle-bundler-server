<div align="center">
  <a href="https://particle.network/">
    <img src="./media/logo.png?raw=true" />
  </a>
  <h3>
    Particle Bundler RPC Server
  </h3>
</div>

![](https://img.shields.io/badge/Typescript-💪-blue?style=round)
![GitHub](https://img.shields.io/github/license/silviopaganini/nft-market?style=round)

Particle Bundler RPC completes compatible with [ERC4337 standards](https://eips.ethereum.org/EIPS/eip-4337). It is extremely stable and supports high concurrency requests.

## ⚡️ Live
👉 We have deployed a server on production: https://docs.particle.network/developers/node-service/evm-chains-api/bundler-rpc

👉 Try the demo: https://scroll-testnet.particle.network/

## 🔬 Functionalities
<img align="right" width="400" src="./media/image.png"></img>

- All standard RPCs supported
- All can be configured: RPCs, Signers, etc
- Support any chain
- UserOp Persistence
- UserOp Concurrent Handling
- Built-in gas price oracle
- Multi Bundler Signers Manager
- Auto Retry for failed transaction
- Correct Transaction even when affected by MEV
- Deploy new chains with one line code

## 🔧 Quick Start

### 💿 Clone the project
```bash
git https://github.com/Particle-Network/particle-bundler-server.git
cd particle-bundler-server
yarn
```

### 🧷 Setup the environment
Set your configuration in **.env.dev**. We require the **mongodb** and **redis**. 

### 🏄🏻‍♂️ Start the project
```bash
npm run start:dev
```

### 🖖 Start a gasless transaction
create a new terminal and run the test
```bash
npm run test
```

### 🧷 Custom the bundler config
Set your configuration in **/src/configs/bundler-config.ts**.

### 📝 Scripts
deploy AA & Simple Account for a new chain
```bash
// set a signer in scripts/deploy-aa.ts first
npx ts-node scripts/deploy-aa.ts 11155111
```


## 🛀🏽 API doc

Learn more on [https://docs.particle.network/developers/node-service/evm-chains-api/bundler-rpc](https://docs.particle.network/developers/node-service/evm-chains-api/bundler-rpc)

## 💼 Feedback

If you got some problems, please report bugs or issues.

You can also join our [Discord](https://discord.gg/2y44qr6CR2).