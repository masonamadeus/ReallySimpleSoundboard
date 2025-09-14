export class MigrationManager {
    /**
     * The list of migration tasks, ordered by the DB version they upgrade TO.
     * @type {Object.<number, function(IDBTransaction, object): Promise<void>>}
     */
    static MIGRATIONS = {
        // Upgrade TO version 11: Migrates from the old 'cards' store to type-specific stores.
        11: async (transaction, { cardTypes }) => {
            console.log("Running migration to v11...");

            // 1. Check if the old 'cards' store exists
            if (!transaction.db.objectStoreNames.contains('cards')) {
                console.log("Old 'cards' store not found, skipping migration step.");
                return;
            }

            const oldCardsStore = transaction.objectStore('cards');
            const getRequest = oldCardsStore.getAll();

            const oldCards = await new Promise((resolve, reject) => {
                getRequest.onsuccess = () => resolve(getRequest.result);
                getRequest.onerror = () => reject(getRequest.error);
            });

            if (!oldCards || oldCards.length === 0) return;

            // 2. Distribute cards to their new, type-specific stores
            for (const cardData of oldCards) {
                if (cardData.type && cardTypes.includes(cardData.type)) {
                    const newStoreName = `${cardData.type}_cards`;
                    const newStore = transaction.objectStore(newStoreName);
                    newStore.put(cardData);
                }
            }
             // 3. (Optional but recommended) Delete the old store after migration
            transaction.db.deleteObjectStore('cards');
            console.log("Migration to v11 complete. Old 'cards' store removed.");
        },

        // Future migrations would go here, e.g.:
        // 12: async (transaction) => { /* ... do something for v12 ... */ }
    };

    /**
     * Runs all necessary migrations between the old and new database versions.
     * @param {IDBVersionChangeEvent} event The event from onupgradeneeded.
     * @param {object} context An object containing any necessary data for migrations (e.g., cardTypes)
     */
    static async run(event, context) {
        const { oldVersion } = event;
        const transaction = event.target.transaction;

        console.log(`Upgrading database from version ${oldVersion}...`);

        // Get all migration versions that are newer than the old DB version
        const versionsToRun = Object.keys(this.MIGRATIONS)
            .map(Number)
            .filter(v => v > oldVersion)
            .sort((a, b) => a - b);

        for (const version of versionsToRun) {
            await this.MIGRATIONS[version](transaction, context);
        }
    }
}