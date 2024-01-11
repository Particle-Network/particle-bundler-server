// npx ts-node scripts/deploy-aa.ts privateKey 11155111
import { Wallet } from 'ethers';
import { deployDetermineDeployer } from './deploy-determine-deployer';
import { deploySimpleAccountFactory } from './deploy-simple-account-factory';
import { deployEntryPoint } from './deploy-entry-point';
import { initializeBundlerConfig } from '../src/configs/bundler-common';
import { deployBTCAccountFactory } from './deploy-btc-account-factory';

const args = process.argv.slice(2);
const privateKey = args[0];
const chainId = args[1] ? parseInt(args[1]) : 5;

(async () => {
    const signer = new Wallet(privateKey);

    await initializeBundlerConfig();
    await deployDetermineDeployer(chainId, signer);
    await deploySimpleAccountFactory(chainId, signer);
    await deployEntryPoint(chainId, signer);
    await deployBTCAccountFactory(chainId, signer);
})();
