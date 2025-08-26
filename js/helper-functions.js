//@ts-nocheck

export function formatIdAsTitle(id) {
    if (!id) return '';
    return id
        .replace(/-/g, ' ') // my-gaming-sounds -> my gaming sounds
        .split(' ')          // -> ['my', 'gaming', 'sounds']
        .map(word => word.charAt(0).toUpperCase() + word.slice(1)) // -> ['My', 'Gaming', 'Sounds']
        .join(' ');          // -> "My Gaming Sounds"
}

export function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

export function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function base64ToArrayBuffer(base64) {
    const binary_string = atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

export function debounce(func, delay) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

export function slugify(text) {
    return text.toString().toLowerCase().trim()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w\-]+/g, '')       // Remove all non-word chars except -
        .replace(/\-\-+/g, '-');          // Replace multiple - with single -
}

export function loadGoogleFonts(fontNames) {
    if (!fontNames || fontNames.length === 0) {
        console.warn("No font names provided to loadGoogleFonts.");
        return;
    }

    const FONT_STYLESHEET_ID = 'google-fonts-stylesheet';

    // Check for and remove the old font link, if it exists
    const oldLink = document.getElementById(FONT_STYLESHEET_ID);
    if (oldLink) {
        oldLink.remove();
    }

    // Create and add the new font link
    const formattedNames = fontNames.map(name => name.replace(/\s+/g, '+'));
    const fontUrl = `https://fonts.googleapis.com/css?family=${formattedNames.join('|')}&display=swap`;
    const link = document.createElement('link');
    link.id = FONT_STYLESHEET_ID; // Give the new link a consistent ID
    link.href = fontUrl;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
};


export function getAdvancedContrastColor(bgHex) {
    // Helper function to convert Hex to RGB
    const hexToRgb = (hex) => {
        let r = 0, g = 0, b = 0;
        // 3 digits
        if (hex.length == 4) {
            r = "0x" + hex[1] + hex[1];
            g = "0x" + hex[2] + hex[2];
            b = "0x" + hex[3] + hex[3];
            // 6 digits
        } else if (hex.length == 7) {
            r = "0x" + hex[1] + hex[2];
            g = "0x" + hex[3] + hex[4];
            b = "0x" + hex[5] + hex[6];
        }
        return [parseInt(r), parseInt(g), parseInt(b)];
    };

    // Helper function to convert RGB to HSL
    const rgbToHsl = (r, g, b) => {
        r /= 255; g /= 255; b /= 255;
        let max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max == min) {
            h = s = 0; // achromatic
        } else {
            let d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return [h, s, l];
    };

    // Helper function to convert HSL to RGB
    const hslToRgb = (h, s, l) => {
        let r, g, b;
        if (s == 0) {
            r = g = b = l; // achromatic
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };
            let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            let p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    };

    // Helper function to convert an RGB component to a 2-digit hex string
    const componentToHex = (c) => {
        const hex = c.toString(16);
        return hex.length == 1 ? "0" + hex : hex;
    };

    // 1. Get RGB values from the hex color
    const [r, g, b] = hexToRgb(bgHex);

    // 2. Calculate luminance to determine if the color is light or dark
    // This is the same reliable formula from your original function.
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // 3. Convert the background color to HSL for easier manipulation
    let [h, s, l] = rgbToHsl(r, g, b);

    // 4. The "Magic": Adjust the color
    if (luminance > 0.5) { // If the background is light...
        // ...we want a dark text color.
        l = Math.max(0, l - 0.4); // Drastically reduce lightness
        s = Math.max(0, s - 0.5); // Desaturate to avoid weird dark colors
    } else { // If the background is dark...
        // ...we want a light text color.
        l = Math.min(1, l + 0.6); // Drastically increase lightness
        s = Math.max(0, s - 0.4); // Desaturate slightly to avoid overly vibrant light text
    }

    // 5. Convert the new HSL color back to RGB
    const [finalR, finalG, finalB] = hslToRgb(h, s, l);

    // 6. Convert the final RGB back to a hex string and return it
    return `#${componentToHex(finalR)}${componentToHex(finalG)}${componentToHex(finalB)}`;
}

export function getContrastColor(hexColor) {
    // 1. Remove '#' and convert hex to R, G, B numbers
    const r = parseInt(hexColor.substr(1, 2), 16);
    const g = parseInt(hexColor.substr(3, 2), 16);
    const b = parseInt(hexColor.substr(5, 2), 16);

    // 2. Calculate the luminance using the standard formula
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // 3. Return dark or light color based on a threshold
    return luminance > 0.45 ? 'var(--primary-color)' : 'var(--secondary-color)'; // Returns dark for light backgrounds, and vice-versa
}

export function getRandom(min, max) {
    const minCeiled = Math.ceil(min);
    const maxFloored = Math.floor(max);
    let value = Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled);
    return value // The maximum is exclusive and the minimum is inclusive
}

export function randomButNot(min, max, notThis) {
    const minCeiled = Math.ceil(min);
    const maxFloored = Math.floor(max);

    // If the range of possible numbers is 1 or less,
    // we might get an infinite loop.
    if (maxFloored - minCeiled <= 1) {
        // If the only possible value is the one we're trying to avoid,
        // we have no choice but to return it (or a default).
        if (minCeiled === notThis) {
            // This scenario should be handled based on desired behavior.
            // Returning `notThis` is one option, returning null is another.
            return notThis;
        }
        return minCeiled;
    }

    let value;
    do {
        value = getRandom(min, max);
    } while (value === notThis);
    return value;
}

class EventManager {
    constructor() {
        this.events = {};
    }

    // Subscribe to an event
    on(eventName, listener) {
        if (!this.events[eventName]) {
            this.events[eventName] = [];
        }
        this.events[eventName].push(listener);
    }

    // Unsubscribe from an event
    off(eventName, listenerToRemove) {
        if (!this.events[eventName]) return;

        this.events[eventName] = this.events[eventName].filter(
            listener => listener !== listenerToRemove
        );
    }

    // Dispatch an event
    dispatch(eventName, data) {
        if (!this.events[eventName]) return;

        this.events[eventName].forEach(listener => listener(data));
    }
}

// Create a single, shared instance for the entire application
export const appEvents = new EventManager();