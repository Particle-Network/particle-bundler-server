export class ProcessLock<T> {
    private _isAcquired = false;
    private _acquiredMap: Map<T, boolean> = new Map<T, boolean>();
    private _timeoutMap: Map<T, NodeJS.Timeout> = new Map<T, NodeJS.Timeout>();
    private waitingMap: Map<T, (() => void)[]> = new Map<T, (() => void)[]>();
    private waitingList: (() => void)[] = [];

    public constructor(private readonly _timeoutMs: number = 60000) {}

    public acquire(key?: T): Promise<void> {
        if (key) {
            if (!this._acquiredMap.has(key) || !this._acquiredMap.get(key)) {
                this._acquiredMap.set(key, true);
                this._setTimeout(key);
                return Promise.resolve();
            }
        } else if (!this._isAcquired) {
            this._isAcquired = true;
            this._setTimeout(key);
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            if (key) {
                if (this.waitingMap.has(key)) {
                    const resolvers = this.waitingMap.get(key);
                    resolvers.push(resolve);
                    this.waitingMap.set(key, resolvers);
                } else {
                    this.waitingMap.set(key, [resolve]);
                }
            } else {
                this.waitingList.push(resolve);
            }
        });
    }

    public isAcquired(key?: T): boolean {
        if (key) {
            if (!this._acquiredMap.has(key)) {
                return false;
            } else {
                return this._acquiredMap.get(key);
            }
        } else {
            return this._isAcquired;
        }
    }

    public release(key?: T): void {
        if (key) {
            if (!this._acquiredMap.has(key) || !this._acquiredMap.get(key)) {
                return;
            } else {
                if (this.waitingMap.get(key)?.length > 0) {
                    const resolve = this.waitingMap.get(key).shift();
                    this._setTimeout(key);
                    resolve();
                } else {
                    if (this.waitingMap.has(key)) {
                        this.waitingMap.delete(key);
                    }

                    this._clearTimeout(key);
                    this._acquiredMap.set(key, false);
                }
            }
        } else {
            if (!this._isAcquired) {
                return;
            } else {
                if (this.waitingList.length > 0) {
                    const resolve = this.waitingList.shift();
                    this._setTimeout(key);
                    resolve();
                } else {
                    this._clearTimeout(key);
                    this._isAcquired = false;
                }
            }
        }
    }

    private _setTimeout(key?: T): void {
        this._clearTimeout(key);

        const timeId = setTimeout(() => this._onTimeout(key), this._timeoutMs);
        this._timeoutMap.set(key, timeId);
    }

    private _onTimeout(key?: T): void {
        this.release(key);
    }

    private _clearTimeout(key?: T): void {
        if (this._timeoutMap.has(key)) {
            const timeId = this._timeoutMap.get(key);
            clearTimeout(timeId);

            this._timeoutMap.delete(key);
        }
    }
}

const Lock = new ProcessLock();
export default Lock;
