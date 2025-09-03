export class EventManager {
    constructor() {
        this.is = {
            // Card-specific actions
            CARD_TRIGGER_ACTION: 'Card:TriggerAction',
            CARD_COMMANDS_CHANGED: 'Card:CommandsChanged',
            CARD_MIGRATION_NEEDED: 'Card:MigrationNeeded',

            // Soundboard-level actions
            SOUNDBOARD_REFRESH_CARDS: 'Soundboard:RefreshCards',
            SOUNDBOARD_DELETED_CARD: 'Soundboard:DeletedCard',

            // SoundCard-specific requests
            SOUNDCARD_GET_DURATION: 'SoundCard:GetDurationInfo',
            SOUNDCARD_PRIORITY_STARTED: 'SoundCard:PriorityStarted',
            SOUNDCARD_PRIORITY_ENDED: 'SoundCard:PriorityEnded',
        };

        this.debugLevel = 0; // -1 is nothing, 0 is all
    }

    // Subscribe to an event
    on(eventName, listener) {
        if (!this.is[eventName]) {
            this.is[eventName] = [];
        }
        this.is[eventName].push(listener);
    }

    // Unsubscribe from an event
    off(eventName, listenerToRemove) {
        if (!this.is[eventName]) return;

        this.is[eventName] = this.is[eventName].filter(
            listener => listener !== listenerToRemove
        );
    }

    // Dispatch an event
    say(eventName, data) {
        if (!this.is[eventName]) return;

        this.is[eventName].forEach(listener => listener(data));
    }

    setDebug(lvl){
        console.log(
            `DEBUG LEVEL CHANGED FROM ${this.debugLevel} TO ${lvl}`);
            
        this.debugLevel = parseInt(lvl)
    }

    log(string, lvl = 0, obj = null) {
    const formattedString = typeof string === 'string' ? string : JSON.stringify(string);
    if (this.debugLevel <= lvl) {
      console.log(`
        DEBUG LEVEL: ${this.debugLevel}\n
        LEVEL ${lvl} MESSAGE: ${formattedString}
      `);

      if (obj !== null) {
        if (typeof obj === 'object') {
          console.log('OBJECT:', JSON.stringify(obj, null, 2));
        } else {
          console.log('Object parameter provided, but not an object:', obj);
        }
      }
    }
  }
}

export const MSG = new EventManager();
