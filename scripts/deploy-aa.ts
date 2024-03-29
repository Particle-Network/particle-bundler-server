// npx ts-node scripts/deploy-aa.ts privateKey 11155111 false
import { Wallet } from 'ethers';
import { deployDetermineDeployer } from './deploy-determine-deployer';
import { deploySimpleAccountFactory } from './deploy-simple-account-factory';
import { deployEntryPoint } from './deploy-entry-point';
import { initializeBundlerConfig } from '../src/configs/bundler-common';
import { deployBTCAccountFactory } from './deploy-btc-account-factory';
import { deployBTCAccountFactory as deployBTCAccountFactoryV1 } from './deploy-btc-account-v1-factory';

const args = process.argv.slice(2);
const privateKey = args[0];
const chainId = args[1] ? parseInt(args[1]) : 5;
const deployBTCAccount = args[2] ? args[2] === 'true' : false;
const deployBTCAccountV1 = args[3] ? args[3] === 'true' : false;

(async () => {
    const signer = new Wallet(privateKey);

    await initializeBundlerConfig();
    await deployDetermineDeployer(chainId, signer);
    await deploySimpleAccountFactory(chainId, signer);
    await deployEntryPoint(chainId, signer);
    if (deployBTCAccount) {
        await deployBTCAccountFactory(chainId, signer);
        console.log('Deployed BTC Account Factory');
    }
    if (deployBTCAccountV1) {
        await deployBTCAccountFactoryV1(chainId, signer);
        console.log('Deployed BTC Account V1 Factory');
    }
})();
