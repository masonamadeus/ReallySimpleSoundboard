// js/Managers/BroadcastManager.js
import { getOverlayUrl } from '../Core/helper-functions.js';
import { MSG } from '../Core/MSG.js';

export class BroadcastManager {
    async init() {
        const userHash = new URL(getOverlayUrl()).searchParams.get('u');
        this.peer = new Peer(`bmrss-host-${userHash}`);
        this.activeOverlays = new Set();

        this.peer.on('open', (id) => {
            console.log(`Soundboard Broadcast Host Online: ${id}`);
        });

        this.peer.on('connection', (conn) => {
            console.log("New Overlay joined the broadcast!");
            this.activeOverlays.add(conn);

            conn.on('close', () => this.activeOverlays.delete(conn));
            conn.on('error', () => this.activeOverlays.delete(conn));
        });

        // Listen to the central app events
        MSG.on('overlay:trigger', (data) => this.broadcast({ action: 'trigger_overlay', ...data }));
        MSG.on('overlay:stop', (data) => this.broadcast({ action: 'stop_overlay', ...data }));
    }

    broadcast(payload) {
        this.activeOverlays.forEach(conn => {
            if (conn.open) conn.send(payload);
        });
    }
}