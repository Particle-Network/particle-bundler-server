// npx ts-node scripts/deploy-aa.ts 11155111
import { Wallet } from 'ethers';
import { deployDetermineDeployer } from './deploy-determine-deployer';
import { deploySimpleAccountFactory } from './deploy-simple-account-factory';
import { deployEntryPoint } from './deploy-entry-point';
import { initializeBundlerConfig } from '../src/configs/bundler-common';

const args = process.argv.slice(2);
const chainId = args[0] ? parseInt(args[0]) : 5;

(async () => {
    const privateKey = 'Your private key to deploy the contracts';
    const signer = new Wallet(privateKey);

    await initializeBundlerConfig();
    await deployDetermineDeployer(chainId, signer);
    await deploySimpleAccountFactory(chainId, signer);
    await deployEntryPoint(chainId, signer);
})();
