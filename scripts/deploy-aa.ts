// npx ts-node scripts/deploy-aa.ts [privateKey] 11155111 false
import { Wallet } from 'ethers';
import { deployDetermineDeployer } from './deploy-determine-deployer';
import { deploySimpleAccountFactory as deploySimpleAccountFactoryV1 } from './deploy-simple-account-v1-factory';
import { deploySimpleAccountFactory as deploySimpleAccountFactoryV2 } from './deploy-simple-account-v2-factory';
import { deployEntryPoint } from './deploy-entry-point';
import { initializeBundlerConfig } from '../src/configs/bundler-common';
import { deployBTCAccountFactory as deployBTCAccountFactoryV1 } from './deploy-btc-account-v1-factory';
// import { deployBTCAccountFactory as deployBTCAccountFactoryV1_1 } from './deploy-btc-account-v1.1-factory';
import { deployBTCAccountFactory as deployBTCAccountFactoryV2 } from './deploy-btc-account-v2-factory';
import { deployBTCAccountFactory as deployBTCAccountFactoryV2_1 } from './deploy-btc-account-v2.1-factory';
import { deployPassKeyModule } from './deploy-passkey-module';

const args = process.argv.slice(2);
const privateKey = args[0];
const chainId = args[1] ? parseInt(args[1]) : 5;
const deployBTCAccountV1 = args[2] ? args[2] === 'true' : false;
const deployBTCAccountV2 = args[3] ? args[3] === 'true' : false;
const deployPasskey = args[4] ? args[4] === 'true' : false;

(async () => {
    const signer = new Wallet(privateKey);

    await initializeBundlerConfig();
    await deployDetermineDeployer(chainId, signer);
    await deployEntryPoint(chainId, signer);

    await deploySimpleAccountFactoryV1(chainId, signer);
    console.log('Deployed Simple Account V1 Factory');
    await deploySimpleAccountFactoryV2(chainId, signer);
    console.log('Deployed Simple Account V2 Factory');

    if (deployBTCAccountV1) {
        await deployBTCAccountFactoryV1(chainId, signer);
        console.log('Deployed BTC Account V1 Factory');

        // no use
        // await deployBTCAccountFactoryV1_1(chainId, signer);
        // console.log('Deployed BTC Account V1.1 Factory');
    }
    if (deployBTCAccountV2) {
        await deployBTCAccountFactoryV2(chainId, signer);
        console.log('Deployed BTC Account V2 Factory');

        await deployBTCAccountFactoryV2_1(chainId, signer);
        console.log('Deployed BTC Account V2.1 Factory');
    }

    if (deployPasskey) {
        await deployPassKeyModule(chainId, signer);
        console.log('Deployed Passkey Module');
    }
})();
