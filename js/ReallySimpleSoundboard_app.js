import { SoundboardManager } from './Managers/SoundboardManager.js';
import { SoundboardDB } from './Core/SoundboardDB.js';
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

    const db = new SoundboardDB();
    await db.openDB(); // Wait for the database to be ready and migrated
    
    // Now pass the opened database instance to the manager
    const app = new SoundboardManager(db);
    app.initialize();
});
