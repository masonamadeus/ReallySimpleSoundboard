import { SoundboardManager } from './Managers/SoundboardManager.js';
import { SoundboardDB } from './Core/SoundboardDB.js';
import { CardRegistry } from './Core/CardRegistry.js';
import { ThemeManager } from './Managers/ThemeManager.js';
import { GridManager } from './Managers/GridManager.js';
import { ControlDockManager } from './Managers/ControlDockManager.js';
import { DataManager } from './Managers/DataManager.js';
import { store } from './Core/StateStore.js';

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

    // --- Create dependencies ---

    // Create the CardRegistry FIRST
    const cardRegistry = new CardRegistry();
    cardRegistry.register('sound', SoundCard);
    cardRegistry.register('timer', TimerCard);
    cardRegistry.register('notepad', NotepadCard);

    // Get the list of card types
    const cardTypes = Array.from(cardRegistry.getRegisteredTypes());

    // Pass the types to the DB constructor
    const db = new SoundboardDB(null, cardTypes); // Pass null to get boardId from URL
    await db.openDB();

    const defaultDb = new SoundboardDB('default', cardTypes);
    await defaultDb.openDB();

    // --- Instantiate all managers, passing the API to UI managers ---
    const soundboardManager = new SoundboardManager(db);
    const themeManager = new ThemeManager(soundboardManager.managerAPI);
    const gridManager = new GridManager();
    const controlDockManager = new ControlDockManager();
    const dataManager = new DataManager(soundboardManager.managerAPI);

    // 2. Set the SoundboardManager's dependencies so it knows about the UI managers
    soundboardManager.setDependencies({
        themeManager,
        gridManager,
        controlDockManager,
        dataManager,
        cardRegistry
    });

    // 3. Initialize all UI managers so they are ready to listen for events
    await themeManager.init(
        db,
        defaultDb,
    );

    await dataManager.init(
        db,
        defaultDb,
        cardRegistry
    )

    await gridManager.init(
        document.getElementById('soundboard-grid'), 
        document.getElementById('control-dock')
    );

    await controlDockManager.init(
        document.getElementById('control-dock'), 
        document.querySelectorAll('.control-dock-card'), 
        cardRegistry);

    // Add the current board to the master list if it's not already there.
    const urlParams = new URLSearchParams(window.location.search);
    const currentBoardId = urlParams.get('board') || 'default';
    await dataManager.addBoardId(currentBoardId);

    // 4. NOW, load the data. The UI managers are ready to catch the events.
    await soundboardManager.load();
});

