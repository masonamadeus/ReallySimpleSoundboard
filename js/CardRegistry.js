export const CardRegistry = {
    registry: new Map(),

    async get(type) {
        if (this.registry.has(type)) {
            return this.registry.get(type);
        }

        const capitalizedType = type.charAt(0).toUpperCase() + type.slice(1);
        const path = `./${capitalizedType}Card.js`;

        try {
            const module = await import(path);
            const cardClass = module[`${capitalizedType}Card`];

            if (cardClass) {
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