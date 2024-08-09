import { Interface } from 'ethers';

interface Itx {
    to: string;
    value: bigint;
    data: string;
}

const ExecutionStruct = '(address target, uint256 value, bytes data)';

const abis: { abi: any[]; batch: boolean }[] = [
    { abi: ['function execute(address dest, uint256 value, bytes calldata func) external'], batch: false },
    { abi: ['function execute(address to, uint256 value, bytes calldata data, uint8 operation) external'], batch: false },
    { abi: [`function execute(${ExecutionStruct} calldata execution) external`], batch: false },
    { abi: ['function executeBatch(address[] calldata dest, bytes[] calldata func) external'], batch: true },
    { abi: ['function executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) external'], batch: true },
    { abi: [`function executeBatch(${ExecutionStruct}[] calldata executions) external`], batch: true },
    { abi: ['function execute_ncC(address dest, uint256 value, bytes calldata func) public'], batch: false },
    { abi: ['function executeBatch_y6U(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) public'], batch: true },
];

const ifaces = abis.map((item) => {
    return {
        iface: new Interface(item.abi),
        abi: item.abi,
        batch: item.batch,
    };
});

export function deserializeUserOpCalldata(callData: string): Itx[] {
    const txs: Itx[] = [];

    for (const item of ifaces) {
        const functionFragment = item.iface.getFunction(item.abi[0]);
        if (!callData.startsWith(functionFragment.selector)) {
            continue;
        }

        const decoded = item.iface.decodeFunctionData(item.abi[0], callData);

        if (['0x34fcd5be', '0x5c1c6dcd'].includes(functionFragment.selector)) {
            for (const decodedItem of decoded) {
                txs.push({
                    to: decodedItem[0],
                    value: BigInt(decodedItem[1]),
                    data: decodedItem[2],
                });
            }
        }

        if (item.batch) {
            if (decoded.length === 2) {
                const dests = decoded[0];
                const funcs = decoded[1];
                for (let i = 0; i < dests.length; i++) {
                    txs.push({
                        to: dests[i],
                        value: 0n,
                        data: funcs[i],
                    });
                }
            }

            if (decoded.length === 3) {
                const dests = decoded[0];
                const values = decoded[1];
                const funcs = decoded[2];
                for (let i = 0; i < dests.length; i++) {
                    txs.push({
                        to: dests[i],
                        value: BigInt(values[i]),
                        data: funcs[i],
                    });
                }
            }
        } else {
            if (decoded.length >= 3) {
                txs.push({
                    to: decoded[0],
                    value: BigInt(decoded[1]),
                    data: decoded[2],
                });
            }
        }

        break;
    }

    return txs;
}
