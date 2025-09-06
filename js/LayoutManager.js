
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
            gridColumnStart = null, // Add this
            gridRowStart = null     // Add this
        } = {}) {
        this.id = id;
        this.type = type;
        this.gridSpan = gridSpan;
        this.children = children;
        this.gridColumnStart = gridColumnStart; // Add this
        this.gridRowStart = gridRowStart;       // Add this
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
// In LayoutManager.js (replace the existing GridManager)

export class GridManager {
    /**
     * @param {HTMLElement} gridContainer - The main grid DOM element.
     * @param {HTMLElement} controlDock - The control dock DOM element for adding new cards.
     * @param {Map<string, Card>} allCardsMap - A reference to the manager's map of card instances.
     * @param {Function} onLayoutChanged - Callback to save the layout.
     * @param {Function} onCardAdd - Callback to create a new card instance.
     */
    constructor(gridContainer, controlDock, allCardsMap, onLayoutChanged, onCardAdd) {
        this.gridContainer = gridContainer;
        this.controlDock = controlDock;
        this.allCardsMap = allCardsMap;
        this.onLayoutChanged = onLayoutChanged;
        this.onCardAdd = onCardAdd;

        this.layout = new Layout();
        this.isRearranging = false;

        this.draggedItem = { element: null, type: null, id: null };
        this.placeholder = this._createPlaceholder();
        this.swapTargetElement = null;
        this.placeholderContextCard = null;
        this.hiddenCardForSwap = null;

        // A place to store the starting position of the card being dragged
        this.draggedCardOriginalRect = null;

        // Create two preview elements, one for each card in the swap
        const createPreviewElement = () => {
            const el = document.createElement('div');
            el.classList.add('sound-card');
            el.style.position = 'fixed';
            el.style.pointerEvents = 'none';
            el.style.display = 'none';
            el.style.border = '3px dashed var(--highlight-color)';
            el.style.boxSizing = 'border-box';
            el.style.zIndex = '1001';
            document.body.appendChild(el);
            return el;
        };
        this.draggedCardPreview = createPreviewElement(); // Will show the dragged card in the new spot
        this.targetCardPreview = createPreviewElement();  // Will show the target card in the old spot
        this.lastDragAction = null;     // To track the last action (e.g., 'swap')
        this.lastContextCard = null;


        this._attachEventListeners();
    }

    render(layoutData) {
        this.layout = layoutData;
        this.gridContainer.innerHTML = ''; // Clear the grid

        // The root layout's children are rendered directly into the main grid container
        this.layout.children.forEach(node => {
            const element = this._renderNodeRecursive(node);
            if (element) {
                this.gridContainer.appendChild(element);
            }
        });
    }

    /**
     * Recursively builds the DOM element for a given layout node.
     * @param {LayoutNode} node The layout node to render.
     * @returns {HTMLElement | null} The rendered DOM element.
     * @private
     */
    _renderNodeRecursive(node) {
        // Base Case: This node is a leaf (a real card)
        if (node.type !== 'grid') { // Assuming 'grid' is the type for containers for now
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

        // Recursive Step: This node is a container
        const containerElement = document.createElement('div');
        containerElement.className = 'layout-container';
        containerElement.dataset.containerId = node.id; // Important for D&D later

        // Apply grid span styles to the container itself
        containerElement.style.gridColumn = `span ${node.gridSpan.column}`;
        containerElement.style.gridRow = `span ${node.gridSpan.row}`;

        // If the node has explicit start positions, apply them.
        if (node.gridColumnStart) {
            containerElement.style.gridColumnStart = node.gridColumnStart;
        }
        if (node.gridRowStart) {
            containerElement.style.gridRowStart = node.gridRowStart;
        }

        // Render children and append them to this new container
        node.children.forEach(childNode => {
            const childElement = this._renderNodeRecursive(childNode);
            if (childElement) {
                containerElement.appendChild(childElement);
            }
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

    // --- Private Methods ---

    _createPlaceholder() {
        const placeholder = document.createElement('div');
        placeholder.className = 'drop-placeholder';
        return placeholder;
    }

    _attachEventListeners() {
        // Listen on the container for drags starting on existing cards
        this.gridContainer.addEventListener('dragstart', this._handleDragStart.bind(this));

        // Listen on the control dock for drags starting for new cards
        this.controlDock.addEventListener('dragstart', this._handleDragStart.bind(this));

        // Listen on the container for drop zone events
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

            // --- NEW: Custom Drag Image Logic ---
            // 1. Create a clone of the card.
            const clone = cardElement.cloneNode(true);
            clone.classList.add('drag-image-custom');

            // 2. Add it to the body but position it off-screen.
            // It must be in the DOM for the browser to render it.
            document.body.appendChild(clone);
            clone.style.position = 'absolute';
            clone.style.left = '-9999px';

            // 3. Tell the browser to use our styled clone as the drag image.
            // e.offsetX/Y uses the mouse's position inside the card as the anchor point.
            e.dataTransfer.setDragImage(clone, e.offsetX, e.offsetY);

            // 4. Clean up the clone from the DOM immediately after this frame.
            setTimeout(() => clone.remove(), 0);
            // --- END NEW ---

            if (this.draggedItem.type === 'reorder') {
                this.draggedCardOriginalRect = this.draggedItem.element.getBoundingClientRect();
            }

        } else if (newCardType) {
            this.draggedItem = { element: e.target, id: newCardType, type: 'create' };
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('application/new-card-type', newCardType);
        }

        setTimeout(() => {
            if (this.draggedItem.element) {
                this.draggedItem.element.classList.add('dragging');
            }
        }, 0);
    }

    _handleDragOver(e) {
        e.preventDefault();
        if (!this.draggedItem.type || !this.draggedItem.element) return;

        // If we are already in a swap preview state, check if the mouse is still
        // within the preview's bounds. If so, do nothing to prevent the flicker cycle.
        if (this.lastDragAction === 'swap' && this.draggedCardPreview.style.display === 'block') {
            const rect = this.draggedCardPreview.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom) {
                return; // Exit early, preserving the current state.
            }
        }

        // --- 1. Determine current context and desired action ---
        let contextCard, hitTestElement = e.target;
        if (hitTestElement.classList.contains('drop-placeholder')) {
            contextCard = this.placeholderContextCard;
        } else {
            contextCard = hitTestElement.closest('.sound-card:not(.dragging)');
            hitTestElement = contextCard;
        }

        let action = 'none';
        if (contextCard) {
            const rect = hitTestElement.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const swapZoneStart = rect.width * 0.25;
            const swapZoneEnd = rect.width * 0.75;
            action = (x < swapZoneStart) ? 'before' : (x > swapZoneEnd) ? 'after' : 'swap';
        }

        // --- 2. THE ANTI-FLICKER GUARD: Check if state has changed ---
        if (action === this.lastDragAction && contextCard === this.lastContextCard) {
            return; // Nothing has changed, so don't touch the DOM.
        }

        // --- 3. If state HAS changed, first UNDO the previous state's visuals ---
        this.placeholder.remove();
        this.draggedCardPreview.style.display = 'none';
        this.targetCardPreview.style.display = 'none';
        if (this.hiddenCardForSwap) this.hiddenCardForSwap.style.visibility = 'visible';
        if (this.draggedItem.element) this.draggedItem.element.style.visibility = 'visible';

        // --- 4. Now, APPLY the new state's visuals ---
        if (action === 'swap') {
            const targetRect = contextCard.getBoundingClientRect();
            this.draggedCardPreview.style.display = 'block';
            this.draggedCardPreview.style.width = `${targetRect.width}px`; /*...*/
            this.draggedCardPreview.style.height = `${targetRect.height}px`;
            this.draggedCardPreview.style.top = `${targetRect.top}px`;
            this.draggedCardPreview.style.left = `${targetRect.left}px`;
            this.draggedCardPreview.innerHTML = this.draggedItem.element.innerHTML;

            if (this.draggedCardOriginalRect) {
                const originalRect = this.draggedCardOriginalRect;
                this.targetCardPreview.style.display = 'block';
                this.targetCardPreview.style.width = `${originalRect.width}px`; /*...*/
                this.targetCardPreview.style.height = `${originalRect.height}px`;
                this.targetCardPreview.style.top = `${originalRect.top}px`;
                this.targetCardPreview.style.left = `${originalRect.left}px`;
                this.targetCardPreview.innerHTML = contextCard.innerHTML;
            }
            contextCard.style.visibility = 'hidden';
            this.hiddenCardForSwap = contextCard;
            this.draggedItem.element.style.visibility = 'hidden';

        } else if (action === 'before' || action === 'after') {
            const insertNode = (action === 'before') ? contextCard : contextCard.nextSibling;
            contextCard.parentNode.insertBefore(this.placeholder, insertNode);
            this.placeholderContextCard = contextCard;
            this.hiddenCardForSwap = null;
        } else {
            this.hiddenCardForSwap = null;
        }

        // --- 5. Update the stored state for the next frame ---
        this.lastDragAction = action;
        this.lastContextCard = contextCard;
    }

    async _handleDrop(e) {
        e.preventDefault();
        if (!this.draggedItem.type) return;

        // Check if a swap operation was indicated
        if (this.swapTargetElement) {
            const draggedId = this.draggedItem.id;
            const targetId = this.swapTargetElement.dataset.cardId;

            if (draggedId !== targetId) {
                this.layout.swapNodes(draggedId, targetId);
                this.onLayoutChanged(this.layout); // Trigger save and re-render
            }

        } else if (this.placeholder.parentNode) {
            // If no swap, use the existing placeholder logic for insertion
            const parentElement = this.placeholder.closest('.layout-container, #soundboard-grid');
            const targetParentId = parentElement.dataset.containerId || 'root';
            const placeholderIndex = Array.from(this.placeholder.parentNode.children).indexOf(this.placeholder);

            if (this.draggedItem.type === 'create') {
                await this.onCardAdd(this.draggedItem.id, targetParentId, placeholderIndex);
            } else if (this.draggedItem.type === 'reorder') {
                const result = this.layout.findNodeAndParent(this.draggedItem.id);
                if (result) {
                    this.layout.removeNode(this.draggedItem.id);
                    this.layout.insertNode(result.node, targetParentId, placeholderIndex);
                    this.onLayoutChanged(this.layout);
                }
            }
        }

        // Cleanup is now handled by dragend, so we just reset the swap target
        if (this.swapTargetElement) {
            this.swapTargetElement.classList.remove('swap-target');
            this.swapTargetElement = null;
        }
    }

    _handleDragEnd(e) {
        // This event fires when the drag operation is completely finished (e.g., mouse up).
        // It's the most reliable place to clean up all visual drag artifacts.
        this._cleanupDragState();
    }

    _cleanupDragState() {
        // Make the original dragged element fully visible and remove the 'dragging' class.
        if (this.draggedItem.element) {
            this.draggedItem.element.style.visibility = 'visible';
            this.draggedItem.element.classList.remove('dragging');
        }

        // Remove the placeholder from the DOM.
        if (this.placeholder.parentNode) {
            this.placeholder.remove();
        }

        // Hide both preview elements and clear their content.
        this.draggedCardPreview.style.display = 'none';
        this.draggedCardPreview.innerHTML = '';
        this.targetCardPreview.style.display = 'none';
        this.targetCardPreview.innerHTML = '';

        // Make sure the card that was hidden under a preview is visible again.
        if (this.hiddenCardForSwap) {
            this.hiddenCardForSwap.style.visibility = 'visible';
        }

        // Reset all state variables.
        this.draggedItem = { element: null, type: null, id: null };
        this.placeholderContextCard = null;
        this.hiddenCardForSwap = null;
        this.draggedCardOriginalRect = null;
        this.lastDragAction = null;
        this.lastContextCard = null;
    }

    //#endregion
}
// #endregion

