// ====================================================================
// Soundboard Database Manager Class
// ====================================================================

export class SoundboardDB {
    constructor(boardIdOverride = null) {
        let boardId;
        // If a boardId is explicitly passed, use it. Otherwise, get it from the URL.
        if (boardIdOverride) {
            boardId = boardIdOverride;
        } else {
            const urlParams = new URLSearchParams(window.location.search);
            boardId = urlParams.get('board') || 'default';

            // We'll move the "guest book" logic to be called after the constructor.
        }

        this.DB_NAME = `BugAndMossSoundboardDB_${boardId}`;
        this.DB_VERSION = 9; // Increment version for this structural change idea
        this.SOUNDS_STORE = 'sounds';
        this.CONFIG_STORE = 'config';
        this.CONFIG_KEY = 'global-config';
        this.COSMETICS_KEY = 'cosmetics-config';
        this.db = null;
    }

    async openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            request.onupgradeneeded = event => {
                this.db = event.target.result;
                if (!this.db.objectStoreNames.contains(this.SOUNDS_STORE)) {
                    this.db.createObjectStore(this.SOUNDS_STORE, {
                        keyPath: 'id'
                    });
                }
                if (!this.db.objectStoreNames.contains(this.CONFIG_STORE)) {
                    this.db.createObjectStore(this.CONFIG_STORE, {
                        keyPath: 'id'
                    });
                }
            };
            request.onsuccess = event => {
                this.db = event.target.result;
                resolve(this.db);
            };
            request.onerror = event => reject(event.target.error);
        });
    }

    _dbRequest(storeName, mode, action, data) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject("Database not initialized.");
                return;
            }
            const transaction = this.db.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            let request;
            if (data !== undefined) {
                request = store[action](data);
            } else {
                request = store[action]();
            }
            transaction.oncomplete = () => resolve(request.result);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async save(id, data) {
        const storeName = typeof id === 'number' ? this.SOUNDS_STORE : this.CONFIG_STORE;
        const saveData = { id, ...(data.id !== undefined ? data : { ...data, id }) };
        return this._dbRequest(storeName, 'readwrite', 'put', saveData);
    }


    async get(id) {
        const storeName = typeof id === 'number' ? this.SOUNDS_STORE : this.CONFIG_STORE;
        return this._dbRequest(storeName, 'readonly', 'get', id);
    }

    async getAll() {
        const soundData = await this._dbRequest(this.SOUNDS_STORE, 'readonly', 'getAll');
        const configData = await this._dbRequest(this.CONFIG_STORE, 'readonly', 'getAll');
        return [...soundData, ...configData];
    }

    async delete(id) {
        const storeName = typeof id === 'number' ? this.SOUNDS_STORE : this.CONFIG_STORE;
        return this._dbRequest(storeName, 'readwrite', 'delete', id);
    }

    async clear() {
        await this._dbRequest(this.SOUNDS_STORE, 'readwrite', 'clear');
        await this._dbRequest(this.CONFIG_STORE, 'readwrite', 'clear');
    }
}
