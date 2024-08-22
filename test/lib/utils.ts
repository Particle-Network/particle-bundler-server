import { solidityPacked } from 'ethers';
import { random } from 'lodash';

export function createUserOpRandomNonce(gap?: number): string {
    return solidityPacked(['uint192', 'uint64'], [`${Date.now() + (gap ?? 0)}${random(100000000, 999999999)}`, 0]);
}
