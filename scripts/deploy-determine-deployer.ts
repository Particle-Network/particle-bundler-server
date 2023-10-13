import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { RPC_CONFIG } from '../src/configs/bundler-common';

const contractAddress = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
const factoryDeployer = '0x3fab184622dc19b6109349b94811493bf2a45362';

export const deployDetermineDeployer = async (chainId: number, signer: Wallet) => {
    const rpcUrl = RPC_CONFIG[chainId].rpcUrl;
    const provider = new JsonRpcProvider(rpcUrl);
    signer = signer.connect(provider);

    const code = await provider.getCode(contractAddress);
    if (code !== '0x') {
        console.log('Determine Deployer already deployed');
        return;
    }

    const balance = await provider.getBalance(factoryDeployer);
    console.log('balance', balance);

    const feeData = await provider.getFeeData();
    console.log('feeData', feeData);

    if (balance < parseEther('0.1') && ![169].includes(chainId)) {
        const r = await signer.sendTransaction({ to: factoryDeployer, value: parseEther('0.1') });
        console.log('send tx transfer 0.1 to', factoryDeployer, r.hash);
    }

    const rawTransaction =
        '0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222';

    const r = await provider.send('eth_sendRawTransaction', [rawTransaction]);
    
    console.log('send tx deploy', r);
};
