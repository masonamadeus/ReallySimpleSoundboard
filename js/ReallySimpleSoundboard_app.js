import { SoundboardManager } from './Managers/SoundboardManager.js';
import { SoundboardDB } from './Core/SoundboardDB.js';
import { CardRegistry } from './Core/CardRegistry.js';
import { ThemeManager } from './Managers/ThemeManager.js';
import { GridManager } from './Managers/LayoutManager.js';
import { ControlDockManager } from './Managers/ControlDockManager.js';
import { BoardManager } from './Managers/BoardManager.js';

// EVENTUALLY NEED TO MAKE IT SO THERE DO NOT NEED TO BE EXPLICIT REFS TO IMPORT CARD TYPES
import { SoundCard } from './Cards/SoundCard.js';
import { TimerCard } from './Cards/TimerCard.js';
import { NotepadCard } from './Cards/NotepadCard.js';

document.addEventListener('DOMContentLoaded', async () => {

    // --- PWA INSTALL HANDLER ---
    /** @type {Event & { prompt: () => Promise<void>, userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }} */
    let deferredPrompt; // This variable will save the event
    /** @type {HTMLButtonElement} */
    //@ts-ignore
    const installButton = document.getElementById('install-pwa-btn');

    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent the mini-infobar from appearing on mobile
        e.preventDefault();
        // Stash the event so it can be triggered later.
        //@ts-ignore
        deferredPrompt = e;
        // Update UI to notify the user they can install the PWA
        if (installButton) {
            installButton.disabled = false;
        }
    });

    if (installButton) {
        installButton.addEventListener('click', async () => {
            if (!deferredPrompt) {
                return; // The prompt isn't available
            }
            // Show the install prompt
            deferredPrompt.prompt();
            // Wait for the user to respond to the prompt
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response to the install prompt: ${outcome}`);
            // We've used the prompt, and can't use it again, throw it away
            deferredPrompt = null;
            // Hide the button
            installButton.disabled = true;
        });
    }

    // Listen for the appinstalled event to know when the PWA was successfully installed
    window.addEventListener('appinstalled', () => {
        // Clear the deferredPrompt so it can be garbage collected
        deferredPrompt = null;
        console.log('PWA was installed');
    });

    // 1. Create dependencies
    const db = new SoundboardDB();
    await db.openDB();

    const cardRegistry = new CardRegistry();
    // EVENTUALLY NEED TO MAKE IT SO THERE DO NOT NEED TO BE EXPLICIT REFS TO IMPORT CARD TYPES
    cardRegistry.register('sound', SoundCard);
    cardRegistry.register('timer', TimerCard);
    cardRegistry.register('notepad', NotepadCard);

    // 2. Instantiate all managers
    const soundboardManager = new SoundboardManager(db);
    const themeManager = new ThemeManager(soundboardManager); // Pass manager for modals
    const gridManager = new GridManager(soundboardManager);
    const controlDockManager = new ControlDockManager(soundboardManager);
    const boardManager = new BoardManager(soundboardManager);

    // 3. Initialize in a controlled order
    await themeManager.init(db, new SoundboardDB('default'));
    await boardManager.init(document.getElementById('board-switcher-modal'), document.getElementById('board-list'));
    await gridManager.init(document.getElementById('soundboard-grid'), document.getElementById('control-dock'), soundboardManager.allCards);
    await soundboardManager.init({ themeManager, gridManager, controlDockManager, boardManager, cardRegistry });

    // 4. Initialize the Control Dock LAST
    controlDockManager.init(document.getElementById('control-dock'), document.querySelectorAll('.control-dock-card'), cardRegistry);
});

