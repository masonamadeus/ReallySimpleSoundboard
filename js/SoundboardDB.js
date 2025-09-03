// ====================================================================
// Soundboard Database Manager Class
// ====================================================================

export class SoundboardDB {
    constructor(boardIdOverride = null) {
        
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
        this.DB_VERSION = 10;
        
        // --- REFACTOR: Explicitly define store names for consistency ---
        this.CARDS_STORE = 'cards';
        this.CONFIG_STORE = 'config';
        // --- LEGACY SUPPORT: Define the old store name to be used ONLY during migration ---
        this.LEGACY_SOUNDS_STORE = 'sounds'; 

        this.db = null;

        
    }

    async openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onupgradeneeded = event => {
                this.db = event.target.result;
                
                if (!this.db.objectStoreNames.contains(this.CARDS_STORE)) {
                    this.db.createObjectStore(this.CARDS_STORE, { keyPath: 'id' });
                }

                if (!this.db.objectStoreNames.contains(this.CONFIG_STORE)) {
                    this.db.createObjectStore(this.CONFIG_STORE, { keyPath: 'id' });
                }

                const transaction = event.target.transaction;


                // --- REFACTOR: Use the defined property for the legacy store name ---
                if (this.db.objectStoreNames.contains(this.LEGACY_SOUNDS_STORE)) {
                    const oldSoundsStore = transaction.objectStore(this.LEGACY_SOUNDS_STORE);
                    const newCardsStore = transaction.objectStore(this.CARDS_STORE);
                    
                    oldSoundsStore.getAll().onsuccess = (e) => {
                        const allSounds = e.target.result;
                        allSounds.forEach(sound => {
                            const newId = `sound-${sound.id}`;
                            // Ensure we don't overwrite existing data if migration runs multiple times
                            newCardsStore.get(newId).onsuccess = (getRequest) => {
                                if (!getRequest.result) {
                                    newCardsStore.put({ ...sound, id: newId, type: 'sound' });
                                }
                            };
                        });
                    };
                    // It's good practice to delete the old store after migration
                    // this.db.deleteObjectStore(this.LEGACY_SOUNDS_STORE);
                }
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

    /* 
        I think I want to make this smarter.
        Rather than define a list of cards here, why not just create a store based on the CLASS of what is calling save?
        Surely we could get the name of the class from just the data object. Or use the 'type' field
    */

   // Save a piece of data to the appropriate store
    async save(id, data) {
        const isCardId = this.CARD_PREFIXES.some(prefix => id.startsWith(prefix));
        const storeName = isCardId ? this.CARDS_STORE : this.CONFIG_STORE;
        
        const saveData = { id, ...(data.id !== undefined ? data : { ...data, id }) };
        return this._dbRequest(storeName, 'readwrite', 'put', saveData);
    }

    // Get a piece of data from the appropriate store
    async get(id) {
        const isCardId = this.CARD_PREFIXES.some(prefix => id.startsWith(prefix));
        const storeName = isCardId ? this.CARDS_STORE : this.CONFIG_STORE;
        return this._dbRequest(storeName, 'readonly', 'get', id);
    }

    // Get all data from both stores
    async getAll() {
        const cardData = await this._dbRequest(this.CARDS_STORE, 'readonly', 'getAll');
        const configData = await this._dbRequest(this.CONFIG_STORE, 'readonly', 'getAll');
        return [...cardData, ...configData];
    }

    // Delete a record from the appropriate store
    async delete(id) {
        const isCardId = this.CARD_PREFIXES.some(prefix => id.startsWith(prefix));
        const storeName = isCardId ? this.CARDS_STORE : this.CONFIG_STORE;
        return this._dbRequest(storeName, 'readwrite', 'delete', id);
    }

    async clear() {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                return reject("Database is not open.");
            }
            // Open a transaction that includes all stores you want to clear
            const transaction = this.db.transaction([this.CARDS_STORE, this.CONFIG_STORE], 'readwrite');
            
            transaction.oncomplete = () => {
                resolve();
            };
            
            transaction.onerror = () => {
                reject(transaction.error);
            };

            // Clear each store within the same transaction
            transaction.objectStore(this.CARDS_STORE).clear();
            transaction.objectStore(this.CONFIG_STORE).clear();
        });
    }

    

    async getNewId(type){
        return `${type}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
    }
}