import { MSG } from './MSG.js';
import { LayoutNode, Layout } from './Layout.js';
import { store } from './StateStore.js';

export function reducer(state, action) {
    MSG.log('Reducer handling action', 1, action);

    switch (action.type) {

        // INITIALIZE STATE
        case MSG.is.INITIALIZE_STATE:
            return {
                ...state, // a good practice to keep any other existing state properties
                allCards: action.payload.allCards,
                layout: action.payload.layout,
                boardId: action.payload.boardId,
            };

        // CARD ADDED
        case MSG.is.CARD_ADDED: {
            const { cardInstance, parentId, index } = action.payload;

            // Create a new Map instead of mutating the old one
            const newAllCards = new Map(state.allCards);
            newAllCards.set(cardInstance.id, cardInstance);

            // Create a deep, rehydrated copy of the layout
            const newLayout = Layout.rehydrate(JSON.parse(JSON.stringify(state.layout)));
            const newNode = new LayoutNode(cardInstance.id, cardInstance.data.type);
            newLayout.insertNode(newNode, parentId, index);

            // Return a new state object with the new data structures
            return { ...state, allCards: newAllCards, layout: newLayout };
        }

        // CARD REMOVED
        case MSG.is.CARD_REMOVED: {
            const { cardId } = action.payload;

            // Create a new Map instead of mutating the old one
            const newAllCards = new Map(state.allCards);
            newAllCards.delete(cardId);

            // Create a deep, rehydrated copy of the layout
            const newLayout = Layout.rehydrate(JSON.parse(JSON.stringify(state.layout)));
            newLayout.removeNode(cardId);
            
            // Return a new state object with the new data structures
            return { ...state, allCards: newAllCards, layout: newLayout };
        }

        // MOVE CARD
        case MSG.is.REQUEST_MOVE_CARD: {
            const { cardId, newParentId, newIndex } = action.payload;

            // 1. Create a deep, rehydrated copy of the layout to ensure we don't mutate the original state.
            const newLayout = Layout.rehydrate(JSON.parse(JSON.stringify(state.layout)));

            // 2. Find the specific node that needs to be moved within the new layout copy.
            const { node } = newLayout.findNodeAndParent(cardId);

            if (node) {
                // 3. Perform the move operation on the new copy.
                newLayout.removeNode(cardId);
                newLayout.insertNode(node, newParentId, newIndex);
            }

            // 4. Return a new state object with the newly created layout.
            return { ...state, layout: newLayout };
        }


        // RESIZE CARD
        case MSG.is.CARD_RESIZED: {
            const { cardId, newGridSpan } = action.payload;
            
            // Create a deep copy for immutable update
            const newLayout = Layout.rehydrate(JSON.parse(JSON.stringify(state.layout)));
            const nodeToUpdate = newLayout.findNode(cardId);
            
            if (nodeToUpdate) {
                nodeToUpdate.gridSpan = newGridSpan;
            }

            return { ...state, layout: newLayout };
        }

        // LAYOUT UPDATED
        case MSG.is.LAYOUT_UPDATED: {
            return {
                ...state,
                layout: action.payload.layout
            };
        }

        // REARRANGE MODE TOGGLED
        case MSG.is.REARRANGE_MODE_TOGGLED: {
            return {
                ...state,
                isRearranging: action.payload.isRearranging,
            };
        }


        default:
            return state;
    }
}