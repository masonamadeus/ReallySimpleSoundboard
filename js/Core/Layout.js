//#region LAYOUT CLASSES
/**
 * Represents a single node in the layout tree. This can be a container or a card.
 */
export class LayoutNode {
    constructor(
        id,
        type, {
            gridSpan = { column: 1, row: 1 },
            children = [],
            gridColumnStart = null,
            gridRowStart = null
        } = {}) {
        this.id = id;
        this.type = type;
        this.gridSpan = gridSpan;
        this.children = children;
        this.gridColumnStart = gridColumnStart;
        this.gridRowStart = gridRowStart;
    }
}

/**
 * Represents the root of the entire soundboard layout.
 */
export class Layout extends LayoutNode {
    constructor(children = []) {
        super('root', 'grid', { children: children });
    }

    findNode(nodeId) {
        const queue = [...this.children];
        while (queue.length > 0) {
            const node = queue.shift();
            if (node.id === nodeId) {
                return node;
            }
            if (node.children && node.children.length > 0) {
                queue.push(...node.children);
            }
        }
        return null;
    }

    findNodeAndParent(nodeId) {
        if (this.id === nodeId) {
            return { node: this, parent: null };
        }
        const queue = [{ node: this, parent: null }];
        while (queue.length > 0) {
            const { node: current } = queue.shift();
            for (const child of current.children) {
                if (child.id === nodeId) {
                    return { node: child, parent: current };
                }
                if (child.children && child.children.length > 0) {
                    queue.push({ node: child, parent: current });
                }
            }
        }
        return null;
    }

    removeNode(nodeId) {
        const search = (nodes) => {
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].id === nodeId) {
                    nodes.splice(i, 1);
                    return true;
                }
                if (nodes[i].children && search(nodes[i].children)) {
                    return true;
                }
            }
            return false;
        };
        return search(this.children);
    }

    insertNode(newNode, targetParentId, index) {
        const parent = this.findNode(targetParentId) || this;
        if (parent && parent.children) {
            parent.children.splice(index, 0, newNode);
        }
    }

    static rehydrate(layoutData) {
        if (!layoutData || !layoutData.children) {
            return new Layout([]);
        }
        const _rehydrateNodeRecursive = (nodeData) => {
            const children = (nodeData.children || []).map(childData => _rehydrateNodeRecursive(childData));
            return new LayoutNode(nodeData.id, nodeData.type, {
                children: children,
                gridSpan: nodeData.gridSpan,
                gridColumnStart: nodeData.gridColumnStart,
                gridRowStart: nodeData.gridRowStart
            });
        };
        const rehydratedChildren = layoutData.children.map(_rehydrateNodeRecursive);
        return new Layout(rehydratedChildren);
    }
}

// #endregion
