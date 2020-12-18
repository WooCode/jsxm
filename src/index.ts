import "./shell";
import "./trackview";
import "./xmeffects";

import XMPlayer from "./models/XMPlayer"

declare global {
    interface Window {
        XMPlayer: XMPlayer;
        XMView: any;

        // Audio constructors
        webkitAudioContext: any;
        AudioContext: any;

        // Sketch file loading via js
        xmuris: any;
        baseuri: any;
     }
}