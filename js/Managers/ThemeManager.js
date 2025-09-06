import {debounce, slugify, loadGoogleFonts } from '../Core/helper-functions.js'
//@ts-ignore: Object is possibly 'null'.

/**
 * Manages all aspects of the soundboard's appearance, including the current
 * board's theme and the global library of saved themes.
 */
export class ThemeManager {
    // Constants for database keys
    static COSMETICS_KEY = 'cosmetics-config';
    static THEME_LIBRARY_KEY = 'theme-library';

    constructor(db, defaultDb, soundboardManager) {
        // Core dependencies
        this.db = db;
        this.defaultDb = defaultDb;
        this.soundboardManager = soundboardManager; // For confirm modals

        // Data state
        this.cosmeticsData = null;
        this.debouncedSave = debounce(() => this.saveCurrentCosmetics(), 300);

        // UI Element References
        this.openModalButton = document.getElementById('cosmetics-btn');
        this.modal = document.getElementById('cosmetics-modal');
        this.fontInput = document.getElementById('font-input');
        this.colorPickers = this.modal.querySelectorAll('input[type="color"]');
        this.saveThemeNameInput = document.getElementById('save-theme-name-input');
        this.themeList = document.getElementById('theme-library-list');
        this.uploadThemeInput = document.getElementById('upload-theme-input');
        this.uploadThemeLibraryInput = document.getElementById('upload-themelibrary-input');

        // This single call sets up all modal interactivity.
        this._attachListeners();
    }

    /**
     * Initializes the manager by loading the current board's cosmetics.
     */
    async init() {
        await Promise.all([
            this.db.openDB(),
            this.defaultDb.openDB()
        ]);
        await this.loadCurrentCosmetics();
    }

    /**
     * Attaches all necessary event listeners for the cosmetics modal.
     * This keeps the setup logic contained within the class.
     */
    _attachListeners() {
        this.modal.addEventListener('click', (e) => {
            //@ts-ignore
            if (e.target.id === 'cosmetics-modal') this.close();
        });

        this.openModalButton.addEventListener('click', () => this.open());

        this.colorPickers.forEach(input => {
            //@ts-ignore
            input.addEventListener('input', (e) => this.updateColor(e.target.dataset.cssVar, e.target.value));
        });
        //@ts-ignore
        this.fontInput.addEventListener('change', (e) => this.updateFont(e.target.value));

        // THEME MANAGEMENT
        document.getElementById('download-theme-btn').addEventListener('click', () => this.downloadCurrentTheme());
        document.getElementById('upload-theme-btn').addEventListener('click', () => this.uploadThemeInput.click());
        this.uploadThemeInput.addEventListener('change', (e) => this._handleThemeUpload(e));

        document.getElementById('download-library-btn').addEventListener('click', () => this.downloadThemeLibrary());
        document.getElementById('upload-library-btn').addEventListener('click', () => this.uploadThemeLibraryInput.click());
        this.uploadThemeLibraryInput.addEventListener('change', (e) => this._handleLibraryUpload(e));

        document.getElementById('delete-cosmetics-key-btn').addEventListener('click', () => this._handleResetCosmetics());

        document.getElementById('save-theme-btn').addEventListener('click', () => this._handleSaveTheme());
        this.themeList.addEventListener('click', (e) => {
            //@ts-ignore
            const button = e.target.closest('button');
            if (!button) return;

            const themeId = button.dataset.themeId;
            if (!themeId) return;
            if (button.classList.contains('apply-theme-btn')) this._handleApplyTheme(themeId);
            if (button.classList.contains('rename-theme-btn')) this._handleRenameTheme(themeId)
            if (button.classList.contains('download-theme-btn')) this.downloadSpecificTheme(themeId);
            if (button.classList.contains('delete-theme-btn')) this._handleDeleteTheme(themeId);
        });
    }

    // ================================================================
    // PUBLIC UI Methods (Called from SoundboardManager)
    // ================================================================

    open() {
        this._updateModalInputs();
        this._renderThemeList();
        this.modal.style.display = 'flex';
    }

    close() {
        this.modal.style.display = 'none';
    }

    // ================================================================
    // INTERNAL UI Handlers and Renderers
    // ================================================================

    _updateModalInputs() {
        const { colors, fontFamily } = this.cosmeticsData;
        this.colorPickers.forEach(input => {
            //@ts-ignore
            const cssVar = input.dataset.cssVar;
            //@ts-ignore
            if (colors[cssVar]) input.value = colors[cssVar];
        });
        //@ts-ignore
        this.fontInput.value = fontFamily;
    }

    async _renderThemeList() {
        const template = document.getElementById('theme-list-item-template');
        const themes = await this.getThemeLibrary();

        this.themeList.innerHTML = ''; // Clear the list first
        const themeIds = Object.keys(themes);

        if (themeIds.length === 0) {
            this.themeList.innerHTML = '<li><small>No saved themes yet.</small></li>';
            return;
        }

        themeIds.forEach(themeId => {
            const theme = themes[themeId];
            // Create a new copy of the template for each theme
            //@ts-ignore
            const clone = template.content.cloneNode(true);

            // Find the elements inside the cloned template
            const nameSpan = clone.querySelector('.theme-name');
            const applyBtn = clone.querySelector('.apply-theme-btn');
            const renameBtn = clone.querySelector('.rename-theme-btn');
            const downloadBtn = clone.querySelector('.download-theme-btn');
            const deleteBtn = clone.querySelector('.delete-theme-btn');

            // Populate the elements with the correct data
            nameSpan.textContent = theme.name;
            applyBtn.dataset.themeId = themeId;
            renameBtn.dataset.themeId = themeId;
            downloadBtn.dataset.themeId = themeId;
            deleteBtn.dataset.themeId = themeId;

            // Add the finished item to the list
            this.themeList.appendChild(clone);
        });
    }

    async _handleResetCosmetics() {
        const confirmed = await this.soundboardManager.showConfirmModal('Are you sure you want to reset appearance settings? This cannot be undone.');
        if (confirmed) this.resetCurrentCosmetics();
    }

    async _handleLibraryUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // The confirmation message is now much clearer
        const confirmed = await this.soundboardManager.showConfirmModal("This will overwrite your entire theme library with the contents of this file. Are you sure?");

        if (confirmed) {
            const success = await this.uploadThemeLibrary(file);
            if (success) {
                // Refresh the list to show the newly uploaded themes
                await this._renderThemeList();
            } else {
                alert("Failed to read file. Please ensure it is a valid theme library JSON file.");
            }
        }
        event.target.value = ''; // Reset file input
    }

    async _handleThemeUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // The confirmation message is now much clearer
        const applyNow = await this.soundboardManager.showConfirmModal(`Uploaded Theme: ${file.name}. Apply Now?`);
        const success = await this.uploadTheme(file, applyNow);
        if (success) {
            // Refresh the list to show the newly uploaded themes
            await this._renderThemeList();
        } else {
            alert("Failed to read file. Please ensure it is a valid theme library JSON file.");
        }


    }

    async _handleSaveTheme() {
        //@ts-ignore
        const themeName = this.saveThemeNameInput.value.trim();
        if (!themeName) {
            alert('Please enter a name for your theme.');
            return;
        }
        await this.saveThemeToLibrary(themeName);
        //@ts-ignore
        this.saveThemeNameInput.value = '';
        this._renderThemeList();
    }

    async _handleApplyTheme(themeId) {
        const appliedThemeName = await this.applyThemeFromLibrary(themeId);
        if (appliedThemeName) {
            this._updateModalInputs();
        }
    }

    async _handleDeleteTheme(themeId) {
        const themes = await this.getThemeLibrary();
        const themeName = themes[themeId]?.name || 'this theme';
        const confirmed = await this.soundboardManager.showConfirmModal(`Delete "${themeName}" from your library?`);
        if (confirmed) {
            await this.deleteThemeFromLibrary(themeId);
            this._renderThemeList();
        }
    }

    async _handleRenameTheme(themeId) {
        const themes = await this.getThemeLibrary();
        const currentName = themes[themeId]?.name;
        if (!currentName) return;

        const newName = prompt("Enter a new name for the theme:", currentName);

        if (newName && newName.trim() !== currentName) {
            const success = await this.renameTheme(themeId, newName.trim());
            if (success) {
                // If the rename was successful, re-render the list to show the change
                await this._renderThemeList();
            }
        }
    }


    // ================================================================
    // DATA MANAGEMENT Methods (The "Model" part of the class)
    // ================================================================


    /**
     * Loads the cosmetic configuration from the current board's database.
     * If none exists, it creates and saves a default configuration.
     */
    async loadCurrentCosmetics() {
        let data = await this.db.get(ThemeManager.COSMETICS_KEY);
        if (!data) {
            data = {
                id: ThemeManager.COSMETICS_KEY,
                fontFamily: 'Wellfleet',
                colors: {
                    '--background-color': '#f7fafc',
                    '--panel-color': '#e3f0ff',
                    '--accent-color': '#33a367',
                    '--highlight-color': '#ff914d',
                    '--primary-color': '#234e70',
                    '--secondary-color': '#e7e7e7',
                },
                themeName: null
            };
            await this.db.save(data.id, data);
        }
        this.cosmeticsData = data;
        this.applyCosmetics();

    }

    /**
     * Applies the current in-memory cosmeticsData to the document's styles.
     */
    applyCosmetics() {
        if (!this.cosmeticsData) return;

        const root = document.documentElement;
        const { colors, fontFamily } = this.cosmeticsData;

        // Apply base colors
        for (const [key, value] of Object.entries(colors)) {
            root.style.setProperty(key, value);
        }

        // Dynamically set contrasting text colors
        const darkText = colors['--primary-color'];
        const lightText = colors['--secondary-color'];
        const setContrast = (bgVar, textVar) => {
            const bgColor = colors[bgVar];
            const luminance = (0.299 * parseInt(bgColor.substr(1, 2), 16) + 0.587 * parseInt(bgColor.substr(3, 2), 16) + 0.114 * parseInt(bgColor.substr(5, 2), 16)) / 255;
            root.style.setProperty(textVar, luminance > 0.5 ? darkText : lightText);
        };

        setContrast('--panel-color', '--panel-color-text');
        setContrast('--accent-color', '--accent-color-text');
        setContrast('--highlight-color', '--highlight-color-text');
        setContrast('--primary-color', '--primary-color-text');
        setContrast('--background-color', '--background-color-text');
        setContrast('--secondary-color', '--secondary-color-text');

        // Apply font
        loadGoogleFonts([fontFamily]);
        root.style.setProperty('--font-family-primary', `'${fontFamily}', sans-serif`);
    }

    /**
     * Saves the current cosmeticsData to the current board's database.
     */
    async saveCurrentCosmetics() {
        await this.db.save(this.cosmeticsData.id, this.cosmeticsData);
    }

    /**
     * Updates a specific color value, applies it, and saves.
     * @param {string} cssVar - The CSS variable for the color (e.g., '--panel-color').
     * @param {string} value - The new hex color value.
     */
    updateColor(cssVar, value) {
        this.cosmeticsData.colors[cssVar] = value;
        this.cosmeticsData.themeName = null;
        this.applyCosmetics();
        this.debouncedSave();
    }

    /**
     * Updates the font family, applies it, and saves.
     * @param {string} fontFamily - The name of the new font.
     */
    updateFont(fontFamily) {
        this.cosmeticsData.fontFamily = fontFamily.trim();
        this.cosmeticsData.themeName = null;
        this.applyCosmetics();

        this.saveCurrentCosmetics(); // Save immediately for fonts
    }

    /**
     * Resets the current board's appearance to default by deleting its config.
     */
    async resetCurrentCosmetics() {
        await this.db.delete(ThemeManager.COSMETICS_KEY);
        // Reload the page to apply the default settings cleanly.
        window.location.reload();
    }


    // ================================================================
    // Methods for the GLOBAL Theme Library
    // ================================================================

    /*
    * Retrieves the theme library. If no library exists, it creates
    * and saves a default library for the user.
    * @returns {Promise<object>} An object containing all saved themes.
    */
    async getThemeLibrary() {
        let libraryData = await this.defaultDb.get(ThemeManager.THEME_LIBRARY_KEY);

        // If no library exists in the database...
        if (!libraryData) {
            console.log("No theme library found. Creating default library.");
            // This is the default theme object you provided.
            const defaultLibrary = {
                id: "theme-library",
                themes: {
                    "default-moss": {
                        name: "Default Moss",
                        fontFamily: "Wellfleet",
                        colors: {
                            "--background-color": "#f7fafc",
                            "--panel-color": "#e3f0ff",
                            "--accent-color": "#33a367",
                            "--highlight-color": "#ff914d",
                            "--primary-color": "#234e70",
                            "--secondary-color": "#e7e7e7"
                        }
                    },
                    "solarized-bug": {
                        name: "Solarized Bug",
                        fontFamily: "Wellfleet",
                        colors: {
                            "--background-color": "#385b71",
                            "--panel-color": "#9fc6c6",
                            "--accent-color": "#4a8c6a",
                            "--highlight-color": "#ff914d",
                            "--primary-color": "#1f2e42",
                            "--secondary-color": "#d0d0a9"
                        }
                    }
                }
            };

            // Save the new default library to the database.
            await this.defaultDb.save(ThemeManager.THEME_LIBRARY_KEY, defaultLibrary);

            // Set libraryData to our new default so the rest of the app can use it immediately.
            libraryData = defaultLibrary;
        }

        return libraryData.themes;
    }

    /**
     * Saves the current board's theme to the global library.
     * @param {string} themeName - The user-provided name for the theme.
     */
    async saveThemeToLibrary(themeName) {
        const themeId = slugify(themeName);
        const allThemes = await this.getThemeLibrary();

        allThemes[themeId] = {
            name: themeName,
            fontFamily: this.cosmeticsData.fontFamily,
            colors: this.cosmeticsData.colors
        };

        await this.defaultDb.save(ThemeManager.THEME_LIBRARY_KEY, {
            id: ThemeManager.THEME_LIBRARY_KEY,
            themes: allThemes
        });
    }

    /**
     * Deletes a theme from the global library.
     * @param {string} themeId - The slugified ID of the theme to delete.
     */
    async deleteThemeFromLibrary(themeId) {
        const allThemes = await this.getThemeLibrary();
        if (allThemes[themeId]) {
            delete allThemes[themeId];
            await this.defaultDb.save(ThemeManager.THEME_LIBRARY_KEY, {
                id: ThemeManager.THEME_LIBRARY_KEY,
                themes: allThemes
            });
        }
    }

    /**
     * Applies a theme from the library to the current board.
     * @param {string} themeId - The slugified ID of the theme to apply.
     */
    async applyThemeFromLibrary(themeId) {
        const themes = await this.getThemeLibrary();
        const themeToApply = themes[themeId];

        if (!themeToApply) {
            console.error("Theme not found:", themeId);
            return;
        }

        // Overwrite the current in-memory theme
        this.cosmeticsData.colors = themeToApply.colors;
        this.cosmeticsData.fontFamily = themeToApply.fontFamily;

        this.applyCosmetics();
        await this.saveCurrentCosmetics(); // Save the newly applied theme to this board

        this.cosmeticsData.themeName = themeToApply.name;
        return themeToApply.name;
    }

    /**
    * Downloads the entire theme library as a single JSON file.
    */
    async downloadThemeLibrary() {
        const themes = await this.getThemeLibrary();
        if (Object.keys(themes).length === 0) {
            alert("There are no saved themes in your library to download.");
            return;
        }

        // The data we want to save is the entire 'themes' object.
        const dataToSave = {
            id: ThemeManager.THEME_LIBRARY_KEY, // Keep the key for validation
            themes: themes
        };

        const json = JSON.stringify(dataToSave, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ReallySimpleSoundboard Theme Library_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        alert("Theme library downloaded successfully.");

    }

    /**
     * Reads a JSON file and overwrites the entire theme library with its content.
     * @param {File} file - The file object from the input element.
     * @returns {Promise<boolean>} True if the upload was successful, false otherwise.
     */
    uploadThemeLibrary(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    //@ts-ignore
                    const uploadedData = JSON.parse(e.target.result);

                    // Perform validation to ensure it's a valid library file.
                    if (!uploadedData.id || uploadedData.id !== ThemeManager.THEME_LIBRARY_KEY || typeof uploadedData.themes !== 'object') {
                        throw new Error("Invalid or corrupted theme library file.");
                    }

                    // Overwrite the existing library with the uploaded data.
                    await this.defaultDb.save(ThemeManager.THEME_LIBRARY_KEY, uploadedData);

                    resolve(true); // Indicate success
                } catch (err) {
                    console.error("Theme library upload error:", err);
                    resolve(false); // Indicate failure
                }
            };
            reader.onerror = () => resolve(false);
            reader.readAsText(file);
        });
    }

    async downloadCurrentTheme() {
        let themeName = this.cosmeticsData.themeName;

        // If the theme is "dirty" (unnamed), we need to prompt the user.
        if (!themeName) {
            const timestamp = new Date().toISOString().slice(0, 10); // e.g., "2025-08-23"
            const suggestedName = `${this.soundboardManager.boardName}_Theme ${timestamp}`;

            // Use the browser's built-in prompt to ask the user for a name.
            themeName = prompt("This is an unsaved theme. Please provide a name to save and download it.", suggestedName);

            // If the user clicks "Cancel" in the prompt, stop the entire process.
            if (!themeName) {
                return;
            }

            // Since we have a new name, save this theme to the library.
            await this.saveThemeToLibrary(themeName);

            // Update our state to remember the name of this newly saved theme.
            this.cosmeticsData.themeName = themeName;

            // Refresh the list in the UI so the user can see their new theme.
            await this._renderThemeList();
        }

        // Now, proceed with the download using the determined theme name.
        const json = JSON.stringify(this.cosmeticsData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        // Use the "slugify" helper for a clean, web-safe filename.
        a.download = `RSS_Theme_${slugify(themeName)}.json`;

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // In ThemeManager, DELETE downloadCurrentTheme and ADD this method:
    /**
     * Downloads a specific theme from the library as a JSON file.
     * @param {string} themeId - The slugified ID of the theme to download.
     */
    async downloadSpecificTheme(themeId) {
        const allThemes = await this.getThemeLibrary();
        const themeToDownload = allThemes[themeId];

        if (!themeToDownload) {
            alert("Could not find the selected theme to download.");
            return;
        }

        // Create a data structure similar to a standard cosmetics object for consistency
        const dataToSave = {
            id: ThemeManager.COSMETICS_KEY,
            fontFamily: themeToDownload.fontFamily,
            colors: themeToDownload.colors,
            themeName: themeToDownload.name // Include the name
        };

        const json = JSON.stringify(dataToSave, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `RSS_Theme_${slugify(themeToDownload.name)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    uploadTheme(file, applyNow = true) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    //@ts-ignore
                    const uploadedData = JSON.parse(e.target.result);
                    if (!uploadedData.id || !uploadedData.colors || !uploadedData.fontFamily) {
                        throw new Error("Invalid theme file structure.");
                    }

                    const themeName = uploadedData.themeName || `Imported Theme - ${file.name}`;
                    const themeId = slugify(themeName);
                    const allThemes = await this.getThemeLibrary();


                    // Check if a theme with this ID already exists.
                    if (allThemes[themeId]) {
                        const confirmed = await this.soundboardManager.showConfirmModal(`A theme named "${themeName}" already exists. Do you want to overwrite it?`);
                        if (!confirmed) {
                            resolve(false); // User canceled, resolve as failure.
                            return;
                        }
                    }

                    const themeToSave = {
                        name: themeName,
                        fontFamily: uploadedData.fontFamily,
                        colors: uploadedData.colors
                    };

                    // Save the theme to the library.
                    allThemes[themeId] = themeToSave;
                    await this.defaultDb.save(ThemeManager.THEME_LIBRARY_KEY, {
                        id: ThemeManager.THEME_LIBRARY_KEY,
                        themes: allThemes
                    });

                    // Apply if requested.
                    if (applyNow) {
                        this.cosmeticsData = uploadedData;
                        this.cosmeticsData.themeName = themeName;
                        this.applyCosmetics();
                        await this.saveCurrentCosmetics();
                    }

                    resolve(true); // Success
                } catch (err) {
                    console.error("Theme upload error:", err);
                    resolve(false); // Failure
                }
            };
            reader.onerror = () => resolve(false);
            reader.readAsText(file);
        });
    }

    /**
     * Renames a theme in the global library.
     * @param {string} oldThemeId - The original, slugified ID of the theme.
     * @param {string} newThemeName - The new, user-provided name for the theme.
     * @returns {Promise<boolean>} True if rename was successful, false otherwise.
     */
    async renameTheme(oldThemeId, newThemeName) {
        const newThemeId = slugify(newThemeName);
        if (!newThemeName || oldThemeId === newThemeId) {
            return false; // Do nothing if the name is empty or unchanged
        }

        const allThemes = await this.getThemeLibrary();
        if (allThemes[newThemeId]) {
            alert(`A theme with the name "${newThemeName}" already exists.`);
            return false;
        }

        if (allThemes[oldThemeId]) {
            // Copy the data to a new key and then delete the old one
            allThemes[newThemeId] = { ...allThemes[oldThemeId], name: newThemeName };
            delete allThemes[oldThemeId];

            await this.defaultDb.save(ThemeManager.THEME_LIBRARY_KEY, {
                id: ThemeManager.THEME_LIBRARY_KEY,
                themes: allThemes
            });
            return true;
        }
        return false;
    }
}
