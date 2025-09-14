// ====================================================================
// Soundboard Database Manager Class
// ====================================================================
import { MigrationManager } from "../Managers/MigrationManager.js";
export class SoundboardDB {
    constructor(boardIdOverride = null, cardTypes = ['sound', 'notepad', 'timer']) { // Accept cardTypes as a parameter with a default value
        
        this.CARD_PREFIXES = ['sound-', 'notepad-', 'timer-'];


        let boardId;
        // If a boardId is explicitly passed, use it. Otherwise, get it from the URL.
        if (boardIdOverride) {
            boardId = boardIdOverride;
        } else {
            const urlParams = new URLSearchParams(window.location.search);
            boardId = urlParams.get('board') || 'default';
        }

        this.boardId = boardId;

        this.DB_NAME = `BugAndMossSoundboardDB_${boardId}`;
        this.DB_VERSION = 11;
        
        this.CONFIG_STORE = 'config';
        this.cardTypes = cardTypes

        this.db = null;

        
    }

    async openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onupgradeneeded = async (event) => {
                this.db = event.target.result;

                // Create necessary object stores if they don't exist
                if (!this.db.objectStoreNames.contains(this.CONFIG_STORE)) {
                    this.db.createObjectStore(this.CONFIG_STORE, { keyPath: 'id' });
                }

                // Create type-specific card stores
                this.cardTypes.forEach(type => {
                    const storeName = `${type}_cards`;
                    if (!this.db.objectStoreNames.contains(storeName)) {
                        this.db.createObjectStore(storeName, { keyPath: 'id' });
                    }
                });

                // Run migrations if needed
                await MigrationManager.run(event, { cardTypes: this.cardTypes });
            };

            request.onsuccess = event => {
                this.db = event.target.result;
                resolve();
            };

            request.onerror = event => {
                console.error("Database error:", event.target.error);
                reject("Database error");
            };
        });
    }

    // A generic helper method to handle all IndexedDB requests
    _dbRequest(storeName, mode, action, data) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                return reject("Database is not open.");
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


    _getStoreName(idOrType) {
        // an ID will be like 'sound-uuid', a type will just be 'sound'
        const type = idOrType.split('-')[0];
        if (this.cardTypes.includes(type)) {
            return `${type}_cards`;
        }
        return this.CONFIG_STORE; // Default to config store
    }
    
    async save(id, data) {
        const storeName = this._getStoreName(id);
        const saveData = { ...data, id };
        return this._dbRequest(storeName, 'readwrite', 'put', saveData);
    }

    async get(id) {
        const storeName = this._getStoreName(id);
        return this._dbRequest(storeName, 'readonly', 'get', id);
    }

    async delete(id) {
        const storeName = this._getStoreName(id);
        return this._dbRequest(storeName, 'readwrite', 'delete', id);
    }

    async getAllCards() {
        if (!this.db) return [];

        const existingCardStores = this.cardTypes
            .map(type => `${type}_cards`)
            .filter(storeName => this.db.objectStoreNames.contains(storeName));

        // If no card stores exist in this DB yet, there's nothing to fetch.
        if (existingCardStores.length === 0) {
            return [];
        }

        const transaction = this.db.transaction(existingCardStores, 'readonly');
        const allCards = [];

        await Promise.all(
            existingCardStores.map(storeName => {
                return new Promise((resolve, reject) => {
                    const request = transaction.objectStore(storeName).getAll();
                    request.onsuccess = () => {
                        allCards.push(...request.result);
                        resolve();
                    };
                    request.onerror = () => reject(request.error);
                });
            })
        );
        return allCards;
    }

    // Get all data from both stores
    async getAll() {
        const cardData = await this.getAllCards();
        const configData = await this._dbRequest(this.CONFIG_STORE, 'readonly', 'getAll');
        return [...cardData, ...configData];
    }

   async clear() {
        if (!this.db) return Promise.reject("Database is not open.");
        const storeNames = [this.CONFIG_STORE, ...this.cardTypes.map(type => `${type}_cards`)];
        const transaction = this.db.transaction(storeNames, 'readwrite');
        await Promise.all(storeNames.map(name => {
            return new Promise((resolve, reject) => {
                const request = transaction.objectStore(name).clear();
                request.onsuccess = resolve;
                request.onerror = reject;
            });
        }));
    }

     /**
     * Deletes an entire IndexedDB database by its boardId.
     * This is a static method because it operates without an open connection.
     * @param {string} boardId The board ID (e.g., "my-cool-board").
     * @returns {Promise<boolean>}
     */
    static deleteDatabase(boardId) {
        const dbName = `BugAndMossSoundboardDB_${boardId}`;
        return new Promise((resolve, reject) => {
            console.log(`Requesting deletion of database: ${dbName}`);
            const deleteRequest = indexedDB.deleteDatabase(dbName);

            deleteRequest.onsuccess = () => {
                console.log(`Database "${dbName}" deleted successfully.`);
                resolve(true);
            };
            deleteRequest.onerror = (event) => {
                console.error(`Error deleting database "${dbName}":`, event);
                reject(new Error(`Error deleting database.`));
            };
            deleteRequest.onblocked = () => {
                console.warn(`Deletion of database "${dbName}" is blocked.`);
                alert(`Could not delete the board because it's open in another tab. Please close other tabs and try again.`);
                reject(new Error('Deletion blocked.'));
            };
        });
    }

    /**
     * A static helper to get all data from a specific board's database.
     * Ensures the database connection is properly closed.
     * @param {string} boardId The ID of the board to query.
     * @returns {Promise<Array<Object>>}
     */
    static async getDataFromBoard(boardId) {
        const tempDb = new SoundboardDB(boardId);
        try {
            await tempDb.openDB();
            return await tempDb.getAll();
        } finally {
            // CRITICAL FIX: Ensure the connection is closed even if errors occur.
            if (tempDb.db && typeof tempDb.db.close === 'function') {
                tempDb.db.close();
            }
        }
    }


}