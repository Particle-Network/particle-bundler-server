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
👉 We have deployed a server on production: https://bundler.particle.network

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
git clone the project and install the dependencies

```bash
git https://github.com/Particle-Network/particle-bundler-server.git
cd particle-bundler-server
yarn
```

### 🧷 Setup the environment
Set your configuration in **.env.dev**. We require the **mongodb** and **redis**. 

Because we need to use transactions in the mongodb, so the mongodb should be a cluster. 

An easy way to create a mongodb cluster is to go to [the official website](https://www.mongodb.com/products/platform/cloud) and apply a free cluster.

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
Set your configuration in **bundler-config.json**.
```
# The signers in bundler server which sign the bundle and send
BUNDLER_PRIVATE_KEYS

# The chain you want to support
RPC_CONFIG
```

## 🛀🏽 API doc

Learn more on [https://eips.ethereum.org/EIPS/eip-4337](https://eips.ethereum.org/EIPS/eip-4337)

## 💼 Feedback

If you got some problems, please report bugs or issues.

You can also join our [Discord](https://discord.gg/2y44qr6CR2).