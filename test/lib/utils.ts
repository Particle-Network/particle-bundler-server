import { solidityPacked } from 'ethers';
import { random } from 'lodash';

export function createUserOpRandomNonce(): string {
    return solidityPacked(['uint192', 'uint64'], [`${Date.now()}${random(100000000, 999999999)}`, 0]);
}
