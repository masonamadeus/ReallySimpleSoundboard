// Remove the async get method and replace it with this:
export class CardRegistry {
    constructor() {
        this.registry = new Map();
    }

    register(type, cardClass) {
        this.registry.set(type, cardClass);
    }

    get(type) {
        return this.registry.get(type);
    }

    getRegisteredTypes() {
        return this.registry.keys();
    }

    /**
     * Get all registered card classes.
     * @returns {Array<typeof import('../Cards/BaseCard.js').default>}
     */
    getRegisteredClasses() {
        return Array.from(this.registry.values());
    }
}