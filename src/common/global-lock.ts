import { Lock as LockInstance } from 'async-await-mutex-lock';

const Lock = new LockInstance();

export default Lock;
