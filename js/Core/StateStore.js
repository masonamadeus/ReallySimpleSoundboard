import { MSG } from './MSG.js';
import { reducer } from './Reducer.js';

class StateStore {
    constructor() {
        this.state = {
            allCards: new Map(),
            layout: null,
            isRearranging: false,
            currentBoardId: null,
            // Add other global state properties here as needed
        };
        this.listeners = [];
    }

    getState() {
        return this.state;
    }

    dispatch(action) {
        // Delegate state updates to the reducer
        this.state = reducer(this.state, action);
        MSG.log('State Updated', 1, this.state);

        // Notify all subscribers that the state has changed
        this.listeners.forEach(listener => listener());
    }

    subscribe(listener) {
        this.listeners.push(listener);
        // Return an unsubscribe function
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }
}

export const store = new StateStore();