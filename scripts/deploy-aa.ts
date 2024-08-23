// npx ts-node scripts/deploy-aa.ts [privateKey] 11155111 false
import { Wallet } from 'ethers';
import * as minimist from 'minimist';
import { deployDetermineDeployer } from './deploy-determine-deployer';
import { deploySimpleAccountFactory as deploySimpleAccountFactoryV1 } from './deploy-simple-account-v1-factory';
import { deploySimpleAccountFactory as deploySimpleAccountFactoryV2 } from './deploy-simple-account-v2-factory';
import { deploySimpleAccountFactory as deploySimpleAccountFactoryV3 } from './deploy-simple-account-v3-factory';
import { deployEntryPoint } from './deploy-entry-point';
import { initializeBundlerConfig } from '../src/configs/bundler-common';
import { deployBTCAccountFactory as deployBTCAccountFactoryV1 } from './deploy-btc-account-v1-factory';
import { deployBTCAccountFactory as deployBTCAccountFactoryV2 } from './deploy-btc-account-v2-factory';
import { deployBTCAccountFactory as deployBTCAccountFactoryV2_1 } from './deploy-btc-account-v2.1-factory';
import { deployCoinbaseFactory } from './deploy-coinbase-account-v1';
import { deployPasskeyModule } from './deploy-passkey-module';
import { deployUniversalModule } from './deploy-universal-module';

const args = process.argv.slice(2);
const argsM = minimist(args);
const entrypointVerion = argsM['e'] || argsM['entrypoint'];
const privateKey = argsM['p'] || argsM['privateKey'];
const chainId = argsM['c'] || argsM['chainId'];
const deployBTCAccountV1 = argsM['b1'] || argsM['btc-v1'];
const deployBTCAccountV2 = argsM['b2'] || argsM['btc-v2'];
const deployPasskey = argsM['passkey'];
const deployCoinbase = argsM['coinbase'];
const deployUniversal = argsM['universal'];

(async () => {
    const signer = new Wallet(privateKey);

    await initializeBundlerConfig();
    await deployDetermineDeployer(chainId, signer);

    // Entrypoint version 0.7
    if (entrypointVerion === '0.7') {
        await deploySimpleAccountFactoryV3(chainId, signer);
        console.log('Deployed Simple Account V3 Factory: 0.7');

        return;
    }

    // Entrypoint version 0.6
    await deployEntryPoint(chainId, signer);
    await deploySimpleAccountFactoryV1(chainId, signer);
    console.log('Deployed Simple Account V1 Factory');
    await deploySimpleAccountFactoryV2(chainId, signer);
    console.log('Deployed Simple Account V2 Factory');

    if (deployBTCAccountV1) {
        await deployBTCAccountFactoryV1(chainId, signer);
        console.log('Deployed BTC Account V1 Factory');
    }
    if (deployBTCAccountV2) {
        await deployBTCAccountFactoryV2(chainId, signer);
        console.log('Deployed BTC Account V2 Factory');

        await deployBTCAccountFactoryV2_1(chainId, signer);
        console.log('Deployed BTC Account V2.1 Factory');
    }

    if (deployCoinbase) {
        await deployCoinbaseFactory(chainId, signer);
        console.log('Deployed Coinbase v1 Factory');
    }

    if (deployPasskey) {
        await deployPasskeyModule(chainId, signer);
        console.log('Deployed Passkey Module');
    }

    if (deployUniversal) {
        await deployUniversalModule(chainId, signer);
        console.log('Deployed Universal Module');
    }
})();
