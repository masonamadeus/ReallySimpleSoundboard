import { MSG } from '../Core/MSG.js';
import { store } from '../Core/StateStore.js';

// #region GRID MANAGER
export class GridManager {
    constructor() {
        this.draggedItem = { element: null, dragMode: null, payload: null };
        this.placeholder = this._createPlaceholder();
        this.gridContainer = null;
        this.controlDock = null;
        this.allCards = null;
    }

    init(gridContainer, controlDock) {
        this.gridContainer = gridContainer;
        this.controlDock = controlDock;
        this._attachEventListeners();

        store.subscribe(() => {
            const { layout, allCards, isRearranging } = store.getState();
            this.allCards = allCards;
            this.render(layout);
            this.setRearrangeMode(isRearranging);
        })

    }

    _createPlaceholder() {
        const placeholder = document.createElement('div');
        placeholder.className = 'drop-placeholder';
        return placeholder;
    }

    render(layoutData) {
        this.gridContainer.innerHTML = '';
        if (layoutData && layoutData.children) {
            layoutData.children.forEach(node => {
                const element = this._renderNodeRecursive(node);
                if (element) {
                    this.gridContainer.appendChild(element);
                }
            });
        }
    }

    _renderNodeRecursive(node) {
        if (node.type !== 'grid') {
            const cardInstance = this.allCards.get(node.id);
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

        const { allCards } = store.getState();
        allCards.forEach(card => {
            const cardElement = card.cardElement;
            cardElement.setAttribute('draggable', isEnabled);

            // Remove any existing rearrange UI before adding new ones
            const oldDeleteBtn = cardElement.querySelector('.delete-card-in-rearrange-btn');
            if (oldDeleteBtn) oldDeleteBtn.remove();
            const oldShield = cardElement.querySelector('.interaction-shield');
            if (oldShield) oldShield.remove();

            if (isEnabled) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-card-in-rearrange-btn';
                deleteBtn.innerHTML = '✕';
                cardElement.appendChild(deleteBtn);

                const shield = document.createElement('div');
                shield.className = 'interaction-shield';
                cardElement.appendChild(shield);
            }
        });
    }
    _attachEventListeners() {
        this.gridContainer.addEventListener('dragstart', this._handleDragStart.bind(this));
        this.controlDock.addEventListener('dragstart', this._handleDragStart.bind(this));
        this.gridContainer.addEventListener('dragover', this._handleDragOver.bind(this));
        this.gridContainer.addEventListener('drop', this._handleDrop.bind(this));
        this.gridContainer.addEventListener('dragend', this._handleDragEnd.bind(this));
        this.gridContainer.addEventListener('mousedown', this._onGridMouseDown.bind(this));

        // NEW: Add a listener for the delete buttons
        this.gridContainer.addEventListener('click', (e) => {
            // If the clicked element has our delete button class...
            if (e.target.classList.contains('delete-card-in-rearrange-btn')) {
                // ...find the parent card and dispatch the remove action.
                const cardElement = e.target.closest('.sound-card');
                if (cardElement) {
                    const cardId = cardElement.dataset.cardId;
                    MSG.say(MSG.ACTIONS.REQUEST_REMOVE_CARD, { cardId: cardId });
                }
            }
        });
    }

    //#region DRAG & DROP
    _handleDragStart(e) {
        const stickerElement = e.target.closest('.sticker-container .sound-card');
        const cardElement = e.target.closest('#soundboard-grid .sound-card');

        if (stickerElement) {
            const newCardType = stickerElement.dataset.cardType;
            this.draggedItem = { element: stickerElement, dragMode: 'create', payload: newCardType };
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('application/new-card-type', newCardType);
            this.placeholder.style.gridColumn = 'span 1';
            this.placeholder.style.gridRow = 'span 1';
        } else if (this.isRearranging && cardElement) {
            this.draggedItem = { element: cardElement, dragMode: 'reorder', payload: cardElement.dataset.cardId };
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', this.draggedItem.payload);

            const clone = cardElement.cloneNode(true);
            clone.classList.add('drag-image-custom');
            document.body.appendChild(clone);
            clone.style.position = 'absolute';
            clone.style.left = '-9999px';
            e.dataTransfer.setDragImage(clone, clone.offsetWidth / 2, clone.offsetHeight / 2);
            setTimeout(() => clone.remove(), 0);

            setTimeout(() => {
                // NEW: Get the layout from the store
                const { layout } = store.getState();
                const node = layout.findNode(this.draggedItem.payload);
                if (node) {
                    this.placeholder.style.gridColumn = `span ${node.gridSpan.column}`;
                    this.placeholder.style.gridRow = `span ${node.gridSpan.row}`;
                }
                cardElement.parentNode.insertBefore(this.placeholder, cardElement);
                cardElement.classList.add('grid-item-dragging');
            }, 0);
        }
    }

    _handleDragOver(e) {
        e.preventDefault();
        if (!this.draggedItem.dragMode) return;
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
        const targetParentId = parentElement.dataset.containerId || 'root';
        const children = Array.from(parentElement.children).filter(child => !child.classList.contains('grid-item-dragging'));
        const placeholderIndex = children.indexOf(this.placeholder);

        this.placeholder.remove();

        // MODIFIED: Dispatch MSG actions instead of direct calls
        if (this.draggedItem.dragMode === 'create') {
            MSG.say(MSG.ACTIONS.REQUEST_ADD_CARD, {
                type: this.draggedItem.payload,
                targetParentId: targetParentId,
                index: placeholderIndex
            });
        } else if (this.draggedItem.dragMode === 'reorder') {
            MSG.say(MSG.ACTIONS.REQUEST_MOVE_CARD, {
                cardId: this.draggedItem.payload,
                newParentId: targetParentId,
                newIndex: placeholderIndex
            });
        }
    }

    _handleDragEnd(e) {
        const draggedDOMElement = this.draggedItem.element;
        if (draggedDOMElement && draggedDOMElement.classList.contains('grid-item-dragging')) {
            draggedDOMElement.classList.remove('grid-item-dragging');
        }
        if (this.placeholder.parentNode) {
            this.placeholder.remove();
        }
        // --- FIX: Reset the state object to its initial, clean state ---
        this.draggedItem = { element: null, dragMode: null, payload: null };
    }
    //#endregion

    //#region RESIZING
    _onGridMouseDown(e) {
        if (!e.target.classList.contains('resize-handle')) return;
        e.preventDefault();

        const cardElement = e.target.closest('.sound-card');
        const cardId = cardElement.dataset.cardId;

        const onResizeEnd = (finalNodeData) => {
            document.removeEventListener('mousemove', onResizeMove);
            document.removeEventListener('mouseup', onResizeEndHandler);
            MSG.say(MSG.ACTIONS.REQUEST_RESIZE_CARD, {
                cardId: cardId,
                newGridSpan: finalNodeData.gridSpan
            });
        };

        const { layout } = store.getState();
        const node = layout.findNode(cardId);
        if (!cardElement || !node) return;

        const grid = this.gridContainer;
        const gridStyle = getComputedStyle(grid);
        const colCount = gridStyle.gridTemplateColumns.split(' ').length;
        const colGap = parseFloat(gridStyle.columnGap) || 0;
        const gridColumnWidth = (grid.getBoundingClientRect().width - (colGap * (colCount - 1))) / colCount;
        const firstGridItem = grid.firstElementChild;
        const gridRowHeight = firstGridItem ? firstGridItem.offsetHeight : 80;
        const startPos = { x: e.clientX, y: e.clientY };
        const startSpan = { ...node.gridSpan };

        const onResizeMove = (moveEvent) => {
            const dx = moveEvent.clientX - startPos.x;
            const dy = moveEvent.clientY - startPos.y;
            const dCol = Math.round(dx / gridColumnWidth);
            const dRow = Math.round(dy / gridRowHeight);

            node.gridSpan.column = Math.max(1, startSpan.column + dCol);
            node.gridSpan.row = Math.max(1, startSpan.row + dRow);

            // Render locally for immediate feedback, but don't save yet
            this.render(layout);
        };

        const onResizeEndHandler = () => onResizeEnd(node);

        document.addEventListener('mousemove', onResizeMove);
        document.addEventListener('mouseup', onResizeEndHandler, { once: true });
    }
}
// #endregion

