
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

    /**
     * Finds a node anywhere in the tree by its ID.
     * @param {string} nodeId 
     * @returns {LayoutNode | null}
     */
    findNode(nodeId) {
        const queue = [...this.children];
        while (queue.length > 0) {
            const node = queue.shift();
            if (node.id === nodeId) {
                return node;
            }
            if (node.children.length > 0) {
                queue.push(...node.children);
            }
        }
        return null;
    }

    /**
     * Finds a node and its parent anywhere in the tree.
     * @param {string} nodeId The ID of the node to find.
     * @returns {{node: LayoutNode, parent: LayoutNode} | null}
     */
    findNodeAndParent(nodeId) {
        if (this.id === nodeId) {
            return { node: this, parent: null }; // Should not happen for root, but good practice
        }

        const queue = [{ node: this, parent: null }];

        while (queue.length > 0) {
            const { node: current, parent } = queue.shift();

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

    /**
     * Removes a node from the tree.
     * @param {string} nodeId 
     * @returns {boolean} - True if a node was removed.
     */
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

    /**
     * Inserts a new node at a specific location.
     * @param {LayoutNode} newNode - The node to insert.
     * @param {string} targetParentId - The ID of the parent to insert into.
     * @param {number} index - The position in the parent's children array.
     */
    insertNode(newNode, targetParentId, index) {
        const parent = this.findNode(targetParentId) || this;
        if (parent && parent.children) {
            parent.children.splice(index, 0, newNode);
        }
    }

    /**
     * Swaps the positions of two nodes in the layout tree.
     * Assumes for now that nodes share the same parent for simplicity.
     * @param {string} nodeId1 
     * @param {string} nodeId2 
     */
    swapNodes(nodeId1, nodeId2) {
        const result1 = this.findNodeAndParent(nodeId1);
        const result2 = this.findNodeAndParent(nodeId2);

        // Ensure both nodes exist and share the same parent
        if (result1 && result2 && result1.parent === result2.parent) {
            const parent = result1.parent;
            const index1 = parent.children.findIndex(child => child.id === nodeId1);
            const index2 = parent.children.findIndex(child => child.id === nodeId2);

            if (index1 !== -1 && index2 !== -1) {
                // The classic array swap
                [parent.children[index1], parent.children[index2]] =
                    [parent.children[index2], parent.children[index1]];
                return true;
            }
        }
        return false;
    }

    /**
     * Creates a new Layout instance from plain data (e.g., from a database).
     * @param {object} layoutData The plain object to rehydrate.
     * @returns {Layout} A new, fully-instantiated Layout object.
     */
    static rehydrate(layoutData) {
        if (!layoutData || !layoutData.children) {
            return new Layout([]); // Return an empty, valid Layout
        }

        // A private, recursive helper function
        const _rehydrateNodeRecursive = (nodeData) => {
            const children = (nodeData.children || []).map(childData => _rehydrateNodeRecursive(childData));
            // Update the return statement to include the new properties
            return new LayoutNode(nodeData.id, nodeData.type, {
                children: children,
                gridSpan: nodeData.gridSpan,
                gridColumnStart: nodeData.gridColumnStart, // Add this
                gridRowStart: nodeData.gridRowStart      // Add this
            });
        };

        const rehydratedChildren = layoutData.children.map(_rehydrateNodeRecursive);
        return new Layout(rehydratedChildren);
    }
}

// #region GRID MANAGER

export class GridManager {
    constructor(managerAPI, gridContainer, controlDock, allCardsMap) {

        this.managerAPI = managerAPI;
        this.gridContainer = gridContainer;
        this.controlDock = controlDock;
        this.allCardsMap = allCardsMap;

        this.isRearranging = false;
        this.layout = new Layout(); // It still needs a layout property to render from

        this.draggedItem = { element: null, type: null, id: null };
        this.placeholder = this._createPlaceholder();

        this._attachEventListeners();
    }


    _createPlaceholder() {
        const placeholder = document.createElement('div');
        placeholder.className = 'drop-placeholder';
        return placeholder;
    }

    render(layoutData) {
        this.layout = layoutData;
        this.gridContainer.innerHTML = '';
        if (this.layout && this.layout.children) {
            this.layout.children.forEach(node => {
                const element = this._renderNodeRecursive(node);
                if (element) {
                    this.gridContainer.appendChild(element);
                }
            });
        }
    }

    _renderNodeRecursive(node) {
        if (node.type !== 'grid') {
            const cardInstance = this.allCardsMap.get(node.id);
            if (cardInstance) {
                const cardElement = cardInstance.cardElement;
                cardElement.setAttribute('draggable', this.isRearranging);
                cardElement.style.gridColumn = `span ${node.gridSpan.column}`;
                cardElement.style.gridRow = `span ${node.gridSpan.row}`;
                return cardElement;
            }
            return null;
        }
        const containerElement = document.createElement('div');
        containerElement.className = 'layout-container';
        containerElement.dataset.containerId = node.id;
        containerElement.style.gridColumn = `span ${node.gridSpan.column}`;
        containerElement.style.gridRow = `span ${node.gridSpan.row}`;
        if (node.gridColumnStart) containerElement.style.gridColumnStart = node.gridColumnStart;
        if (node.gridRowStart) containerElement.style.gridRowStart = node.gridRowStart;

        node.children.forEach(childNode => {
            const childElement = this._renderNodeRecursive(childNode);
            if (childElement) containerElement.appendChild(childElement);
        });
        return containerElement;
    }

    setRearrangeMode(isEnabled) {
        this.isRearranging = isEnabled;
        this.gridContainer.classList.toggle('rearrange-mode', isEnabled);
        this.allCardsMap.forEach(card => {
            card.cardElement.setAttribute('draggable', isEnabled);
        });
    }

    _attachEventListeners() {
        this.gridContainer.addEventListener('dragstart', this._handleDragStart.bind(this));
        this.controlDock.addEventListener('dragstart', this._handleDragStart.bind(this));
        this.gridContainer.addEventListener('dragover', this._handleDragOver.bind(this));
        this.gridContainer.addEventListener('drop', this._handleDrop.bind(this));
        this.gridContainer.addEventListener('dragend', this._handleDragEnd.bind(this));
    }

    //#region DRAG & DROP
    _handleDragStart(e) {
    const cardElement = e.target.closest('.sound-card');
    const newCardType = e.target.dataset.cardType;

    if (this.isRearranging && cardElement) {
        this.draggedItem = { element: cardElement, id: cardElement.dataset.cardId, type: 'reorder' };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.draggedItem.id);

        // --- Custom Drag Image Logic (Centered) ---
        const clone = cardElement.cloneNode(true);
        clone.classList.add('drag-image-custom');
        document.body.appendChild(clone);
        clone.style.position = 'absolute';
        clone.style.left = '-9999px';
        
        // Use the clone's dimensions to center the cursor
        e.dataTransfer.setDragImage(clone, clone.offsetWidth / 2, clone.offsetHeight / 2);
        
        // The clone is no longer needed after this frame
        setTimeout(() => clone.remove(), 0);

        // --- Live Reflow and Jump Prevention ---
        // Use a timeout to modify the DOM *after* the drag image has been created
        setTimeout(() => {
            // 1. Insert the placeholder where the card was. This holds the
            //    original spot open and prevents the other cards from jumping.
            cardElement.parentNode.insertBefore(this.placeholder, cardElement);

            // 2. Hide the original card to allow the placeholder to move
            //    freely and to create the live reflow effect.
            cardElement.classList.add('grid-item-dragging');
        }, 0);

    } else if (newCardType) {
        this.draggedItem = { element: e.target, id: newCardType, type: 'create' };
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/new-card-type', newCardType);
    }
}

    _handleDragOver(e) {
        e.preventDefault();
        if (!this.draggedItem.type) return;

        const overElement = e.target.closest('.sound-card:not(.grid-item-dragging)');
        const container = e.target.closest('.layout-container, #soundboard-grid');

        if (overElement) {
            const rect = overElement.getBoundingClientRect();
            const isFirstHalf = e.clientX < rect.left + rect.width / 2;
            overElement.parentNode.insertBefore(this.placeholder, isFirstHalf ? overElement : overElement.nextSibling);
        } else if (container && !container.querySelector('.sound-card:not(.grid-item-dragging)')) {
            container.appendChild(this.placeholder);
        }
    }

    async _handleDrop(e) {
        e.preventDefault();
        if (!this.placeholder.parentNode) return;

        const parentElement = this.placeholder.parentNode;
        //@ts-ignore
        const targetParentId = parentElement.dataset.containerId || 'root';
        const children = Array.from(parentElement.children).filter(child => !child.classList.contains('grid-item-dragging'));
        const placeholderIndex = children.indexOf(this.placeholder);

        this.placeholder.remove();

        if (this.draggedItem.type === 'create') {
            await this.managerAPI.addCard(this.draggedItem.id, targetParentId, placeholderIndex);
        } else if (this.draggedItem.type === 'reorder') {
            await this.managerAPI.moveCard(this.draggedItem.id, targetParentId, placeholderIndex);
        }
    }

    _handleDragEnd(e) {
        const draggedDOMElement = this.draggedItem.element;
        // Check if the element exists and has the class before trying to remove it.
        if (draggedDOMElement && draggedDOMElement.classList.contains('grid-item-dragging')) {
            draggedDOMElement.classList.remove('grid-item-dragging');
        }

        if (this.placeholder.parentNode) {
            this.placeholder.remove();
        }
        this.draggedItem = { element: null, type: null, id: null };
    }

    //#endregion
}
// #endregion

