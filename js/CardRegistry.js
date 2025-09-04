export const CardRegistry = {
    registry: new Map(),

    // The 'register' method is no longer needed, as cards will be loaded on-demand.

    async get(type) {
        // 1. Check if the class is already loaded and cached.
        if (this.registry.has(type)) {
            return this.registry.get(type);
        }

        // 2. If not cached, construct the file path based on our convention.
        const capitalizedType = type.charAt(0).toUpperCase() + type.slice(1);
        const path = `./${capitalizedType}Card.js`;

        try {
            // 3. Attempt to dynamically import the module.
            const module = await import(path);
            const cardClass = module[`${capitalizedType}Card`];

            if (cardClass) {
                // 4. Cache the class for future requests and return it.
                this.registry.set(type, cardClass);
                return cardClass;
            } else {
                throw new Error(`Class not found in module.`);
            }
        } catch (error) {
            console.error(`Failed to dynamically load card type "${type}" from ${path}:`, error);
            return null;
        }
    }
};