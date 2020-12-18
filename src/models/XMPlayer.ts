import ChannelInfo from "./ChannelInfo"
import Envelope from "./Envelope"
import EnvelopeFollower from "./EnvelopeFollower";
import Instrument from "./Instrument";
import Pattern from "./Pattern";
import Prettify from "./Prettify";
import foo from "../xmeffects";
import Sample from "./Sample";
import XM from "./XM"



export default class XMPlayer {
    handleDrop: (e: any) => boolean;
    allowDrop: (ev: any) => boolean;

    constructor() {
        this.xm = new XM();  // contains all song data
        this.xm.global_volume = this.max_global_volume = 128;
    }

    xm: XM
    XMView = window.XMView;
    jsNode: ScriptProcessorNode;
    gainNode: GainNode;

    f_smp = 44100;  // updated by play callback, default value here

    // per-sample exponential moving average for volume changes (to prevent pops
    // and clicks); evaluated every 8 samples
    popfilter_alpha = 0.9837;

    cur_songpos = -1;
    cur_pat = -1;
    cur_row = 64;
    cur_ticksamp = 0;
    cur_tick = 6;

    max_global_volume: number

    Envelope: Envelope;

    next_row: number

    effects_t0: Array<(player: XMPlayer, number, any) => any> = foo.effects_t0
    effects_t1: Array<(player: XMPlayer, number, any) => any>= foo.effects_t1

    audioctx: AudioContext
    playing: boolean = false


    init() {
        console.log("init effekts", this.effects_t1)

        if (!this.audioctx) {
            let audioContext = window.AudioContext || window.webkitAudioContext;
            let ctx: AudioContext = new audioContext()
            console.log("Create audioctx", ctx)
            this.audioctx = ctx;
            this.gainNode = this.audioctx.createGain();
            this.gainNode.gain.value = 0.1;  // master volume
        }
        if (this.audioctx.createScriptProcessor === undefined) {
            //Fallback for older browsers
            console.log("Create old js node")
            this.jsNode = (this.audioctx as any).createJavaScriptNode(16384, 0, 2);
        } else {
            console.log("Create new js node")
            this.jsNode = this.audioctx.createScriptProcessor(16384, 0, 2);
        }
 
        this.jsNode.onaudioprocess = (e) => this.audio_cb(e);
        this.gainNode.connect(this.audioctx.destination);
    }

    
  audio_cb(e: AudioProcessingEvent) {
    this.f_smp = this.audioctx.sampleRate;

    let buflen = e.outputBuffer.length;
    let dataL = e.outputBuffer.getChannelData(0);
    let dataR = e.outputBuffer.getChannelData(1);

    for (let i = 0; i < buflen; i++) {
        dataL[i] = 0;
        dataR[i] = 0;
    }

    let offset = 0;
    let ticklen = 0 | (this.f_smp * 2.5 / this.xm.bpm);
    let scopewidth = this.XMView.scope_width;

    while (buflen > 0) {
        if (this.cur_pat == -1 || this.cur_ticksamp >= ticklen) {
            // Sample rate?!
            // nextTick(f_smp);
            this.nextTick();
            this.cur_ticksamp -= ticklen;
        }
        let tickduration = Math.min(buflen, ticklen - this.cur_ticksamp);
        let VU = new Float32Array(this.xm.nchan);
        let scopes = undefined;
        for (let j = 0; j < this.xm.nchan; j++) {
            let scope: Float32Array;
            if (tickduration >= 4 * scopewidth) {
                scope = new Float32Array(scopewidth);
                for (let k = 0; k < scopewidth; k++) {
                    scope[k] = -dataL[offset + k * 4] - dataR[offset + k * 4];
                }
            }

            VU[j] = this.MixChannelIntoBuf(
                this.xm.channelinfo[j], offset, offset + tickduration, dataL, dataR) /
                tickduration;

            if (tickduration >= 4 * scopewidth) {
                for (let k = 0; k < scopewidth; k++) {
                    scope[k] += dataL[offset + k * 4] + dataR[offset + k * 4];
                }
                if (scopes === undefined) scopes = [];
                scopes.push(scope);
            }
        }
        if (this.XMView.pushEvent) {
            this.XMView.pushEvent({
                t: e.playbackTime + (0.0 + offset) / this.f_smp,
                vu: VU,
                scopes: scopes,
                songpos: this.cur_songpos,
                pat: this.cur_pat,
                row: this.cur_row
            });
        }
        offset += tickduration;
        this.cur_ticksamp += tickduration;
        buflen -= tickduration;
    }
}
 

    load(arrayBuf: ArrayBuffer) {
        let dv = new DataView(arrayBuf);

        this.xm = new XM();
        this.xm.songname = Prettify.getstring(dv, 17, 20);

        let hlen = dv.getUint32(0x3c, true) + 0x3c;
        let songlen = dv.getUint16(0x40, true);
        this.xm.song_looppos = dv.getUint16(0x42, true);
        this.xm.nchan = dv.getUint16(0x44, true);
        let npat = dv.getUint16(0x46, true);
        let ninst = dv.getUint16(0x48, true);
        this.xm.flags = dv.getUint16(0x4a, true);
        this.xm.tempo = dv.getUint16(0x4c, true);
        this.xm.bpm = dv.getUint16(0x4e, true);
        this.xm.channelinfo = [];
        this.xm.global_volume = this.max_global_volume;

        for (let i = 0; i < this.xm.nchan; i++) {
            this.xm.channelinfo.push(new ChannelInfo({
                number: i,
                filterstate: new Float32Array(3),
                vol: 0,
                pan: 128,
                period: 1920 - 48 * 16,
                vL: 0, vR: 0,   // left right volume envelope followers (changes per sample)
                vLprev: 0, vRprev: 0,
                mute: 0,
                volE: 0, panE: 0,
                retrig: 0,
                vibratopos: 0,
                vibratodepth: 1,
                vibratospeed: 1,
                vibratotype: 0,
            }));
        }
        // console.log("header len " + hlen);

        // console.log("songlen %d, %d channels, %d patterns, %d instruments", songlen, this.xm.nchan, npat, ninst);
        // console.log("loop @%d", this.xm.song_looppos);
        // console.log("flags=%d tempo %d bpm %d", this.xm.flags, this.xm.tempo, this.xm.bpm);

        this.xm.songpats = [];
        for (let i = 0; i < songlen; i++) {
            this.xm.songpats.push(dv.getUint8(0x50 + i));
        }
        console.log("song patterns: ", this.xm.songpats);

        let idx = hlen;
        this.xm.patterns = [];
        for (let i = 0; i < npat; i++) {
            let pattern: Pattern[][] = [];
            // let patheaderlen = dv.getUint32(idx, true);
            let patrows = dv.getUint16(idx + 5, true);
            let patsize = dv.getUint16(idx + 7, true);

            // console.log("pattern %d: %d bytes, %d rows", i, patsize, patrows);

            idx += 9;
            for (let j = 0; patsize > 0 && j < patrows; j++) {
                const row: Pattern[] = [];
                for (let k = 0; k < this.xm.nchan; k++) {
                    let byte0 = dv.getUint8(idx); idx++;
                    let note = -1, inst = -1, vol = -1, efftype = 0, effparam = 0;
                    if (byte0 & 0x80) {
                        if (byte0 & 0x01) {
                            note = dv.getUint8(idx) - 1; idx++;
                        }
                        if (byte0 & 0x02) {
                            inst = dv.getUint8(idx); idx++;
                        }
                        if (byte0 & 0x04) {
                            vol = dv.getUint8(idx); idx++;
                        }
                        if (byte0 & 0x08) {
                            efftype = dv.getUint8(idx); idx++;
                        }
                        if (byte0 & 0x10) {
                            effparam = dv.getUint8(idx); idx++;
                        }
                    } else {
                        // byte0 is note from 1..96 or 0 for nothing or 97 for release
                        // so we subtract 1 so that C-0 is stored as 0
                        note = byte0 - 1;
                        inst = dv.getUint8(idx); idx++;
                        vol = dv.getUint8(idx); idx++;
                        efftype = dv.getUint8(idx); idx++;
                        effparam = dv.getUint8(idx); idx++;
                    }
                    let notedata = [note, inst, vol, efftype, effparam];
                    row.push(notedata);
                }
                pattern.push(row);
            }
            this.xm.patterns.push(pattern);
        }

        this.xm.instruments = [];
        // now load instruments
        for (let i = 0; i < ninst; i++) {
            let hdrsiz = dv.getUint32(idx, true);
            let instname = Prettify.getstring(dv, idx + 0x4, 22);
            let nsamp = dv.getUint16(idx + 0x1b, true);

            let inst = new Instrument(instname, i)

            if (nsamp > 0) {
                let samplemap = new Uint8Array(arrayBuf, idx + 33, 96);

                let env_nvol = dv.getUint8(idx + 225);
                let env_vol_type = dv.getUint8(idx + 233);
                let env_vol_sustain = dv.getUint8(idx + 227);
                let env_vol_loop_start = dv.getUint8(idx + 228);
                let env_vol_loop_end = dv.getUint8(idx + 229);
                let env_npan = dv.getUint8(idx + 226);
                let env_pan_type = dv.getUint8(idx + 234);
                let env_pan_sustain = dv.getUint8(idx + 230);
                let env_pan_loop_start = dv.getUint8(idx + 231);
                let env_pan_loop_end = dv.getUint8(idx + 232);
                let vol_fadeout = dv.getUint16(idx + 239, true);
                let env_vol: Array<number> = [];
                for (let j = 0; j < env_nvol * 2; j++) {
                    env_vol.push(dv.getUint16(idx + 129 + j * 2, true));
                }
                let env_pan = [];
                for (let j = 0; j < env_npan * 2; j++) {
                    env_pan.push(dv.getUint16(idx + 177 + j * 2, true));
                }
                // FIXME: ignoring keymaps for now and assuming 1 sample / instrument
                // let keymap = getarray(dv, idx+0x21);
                let samphdrsiz = dv.getUint32(idx + 0x1d, true);
                // console.log("hdrsiz %d; instrument %s: '%s' %d samples, samphdrsiz %d",
                //     hdrsiz, (i + 1).toString(16), instname, nsamp, samphdrsiz);
                idx += hdrsiz;
                let totalsamples = 0;
                let samps: Array<Sample> = [];
                for (let j = 0; j < nsamp; j++) {
                    let samplen = dv.getUint32(idx, true);
                    let samploop = dv.getUint32(idx + 4, true);
                    let samplooplen = dv.getUint32(idx + 8, true);
                    let sampvol = dv.getUint8(idx + 12);
                    let sampfinetune = dv.getInt8(idx + 13);
                    let samptype = dv.getUint8(idx + 14);
                    let samppan = dv.getUint8(idx + 15);
                    let sampnote = dv.getInt8(idx + 16);
                    let sampname = Prettify.getstring(dv, idx + 18, 22);
                    let sampleoffset = totalsamples;
                    if (samplooplen === 0) {
                        samptype &= ~3;
                    }
                    // console.log("sample %d: len %d name '%s' loop %d/%d vol %d offset %s",
                    //     j, samplen, sampname, samploop, samplooplen, sampvol, sampleoffset.toString(16));
                    // console.log("           type %d note %s(%d) finetune %d pan %d",
                    //     samptype, Prettify.prettify_note(sampnote + 12 * 4), sampnote, sampfinetune, samppan);
                    // console.log("           vol env", env_vol, env_vol_sustain,
                    //     env_vol_loop_start, env_vol_loop_end, "type", env_vol_type,
                    //     "fadeout", vol_fadeout);
                    // console.log("           pan env", env_pan, env_pan_sustain,
                    //     env_pan_loop_start, env_pan_loop_end, "type", env_pan_type);
                    let samp = new Sample({
                        len: samplen,
                        loop: samploop,
                        looplen: samplooplen,
                        note: sampnote,
                        fine: sampfinetune,
                        pan: samppan,
                        type: samptype,
                        vol: sampvol,
                        fileoffset: sampleoffset
                    });
                    // length / pointers are all specified in bytes; fixup for 16-bit samples
                    samps.push(samp);
                    idx += samphdrsiz;
                    totalsamples += samplen;
                }
                for (let j = 0; j < nsamp; j++) {
                    let samp = samps[j];
                    samp.sampledata = this.ConvertSample(
                        new Uint8Array(arrayBuf, idx + samp.fileoffset, samp.len), samp.type & 16);
                    if (samp.type & 16) {
                        samp.len /= 2;
                        samp.loop /= 2;
                        samp.looplen /= 2;
                    }
                    // unroll short loops and any pingpong loops
                    if ((samp.type & 3) && (samp.looplen < 2048 || (samp.type & 2))) {
                        this.UnrollSampleLoop(samp);
                    }
                }
                idx += totalsamples;
                inst.samplemap = samplemap;
                inst.samples = samps;
                if (env_vol_type) {
                    // insert an automatic fadeout to 0 at the end of the envelope
                    let env_end_tick = env_vol[env_vol.length - 2];
                    if (!(env_vol_type & 2)) {  // if there's no sustain point, create one
                        env_vol_sustain = env_vol.length / 2;
                    }
                    if (vol_fadeout > 0) {
                        let fadeout_ticks = 65536.0 / vol_fadeout;
                        env_vol.push(env_end_tick + fadeout_ticks);
                        env_vol.push(0);
                    }
                    inst.env_vol = new Envelope(
                        env_vol,
                        env_vol_type,
                        env_vol_sustain,
                        env_vol_loop_start,
                        env_vol_loop_end);
                } else {
                    // no envelope, then just make a default full-volume envelope.
                    // i thought this would use fadeout, but apparently it doesn't.
                    inst.env_vol = new Envelope([0, 64, 1, 0], 2, 0, 0, 0);
                }
                if (env_pan_type) {
                    if (!(env_pan_type & 2)) {  // if there's no sustain point, create one
                        env_pan_sustain = env_pan.length / 2;
                    }
                    inst.env_pan = new Envelope(
                        env_pan,
                        env_pan_type,
                        env_pan_sustain,
                        env_pan_loop_start,
                        env_pan_loop_end);
                } else {
                    // create a default empty envelope
                    inst.env_pan = new Envelope([0, 32], 0, 0, 0, 0);
                }
            } else {
                idx += hdrsiz;
                console.log("empty instrument", i, hdrsiz, idx);
            }
            this.xm.instruments.push(inst);
        }

        console.log("loaded \"" + this.xm.songname + "\"");
        return true;
    }


    ConvertSample(array: Uint8Array, bits: number): Float32Array {
        let len = array.length;

        if (bits === 0) {  // 8 bit sample
            const samp = new Float32Array(len);
            let acc = 0;
            let b = 0;
            for (let k = 0; k < len; k++) {
                acc += array[k];
                b = acc & 255;
                if (b & 128) b = b - 256;
                samp[k] = b / 128.0;
            }
            return samp;
        } else {
            len /= 2;
            const samp = new Float32Array(len);
            let acc = 0;
            let b = 0;

            for (let k = 0; k < len; k++) {
                b = array[k * 2] + (array[k * 2 + 1] << 8);
                if (b & 32768) b = b - 65536;
                acc = Math.max(-1, Math.min(1, acc + b / 32768.0));
                samp[k] = acc;
            }
            return samp;
        }
    }



    // optimization: unroll short sample loops so we can run our inner mixing loop
    // uninterrupted for as long as possible; this also handles pingpong loops.
    UnrollSampleLoop(samp: Sample) {
        let nloops = ((2048 + samp.looplen - 1) / samp.looplen) | 0;
        const pingpong = samp.type & 2;
        if (pingpong) {
            // make sure we have an even number of loops if we are pingponging
            nloops = (nloops + 1) & (~1);
        }
        const samplesiz = samp.loop + nloops * samp.looplen;
        let data = new Float32Array(samplesiz);
        for (var i = 0; i < samp.loop; i++) {
            data[i] = samp.sampledata[i];
        }

        for (let j = 0; j < nloops; j++) {
            if ((j & 1) && pingpong) {
                for (let k = samp.looplen - 1; k >= 0; k--) {
                    data[i++] = samp.sampledata[samp.loop + k];
                }
            } else {
                for (let k = 0; k < samp.looplen; k++) {
                    data[i++] = samp.sampledata[samp.loop + k];
                }
            }
        }
        // console.log("unrolled sample loop; looplen", samp.looplen, "x", nloops, " = ", samplesiz);
        samp.sampledata = data;
        samp.looplen = nloops * samp.looplen;
        samp.type = 1;
    }

    play() {
        if (!this.playing) {
            // put paused events back into action, if any
            if (this.XMView.resume) this.XMView.resume();
            // start playing
            this.jsNode.connect(this.gainNode);

            // hack to get iOS to play anything
            let temp_osc = this.audioctx.createOscillator();
            temp_osc.connect(this.audioctx.destination);
            !!temp_osc.start ? temp_osc.start(0) : (temp_osc as any).noteOn(0);
            !!temp_osc.stop ? temp_osc.stop(0) : (temp_osc as any).noteOff(0);
            temp_osc.disconnect();
        }
        this.playing = true;
    }


    pause() {
        if (this.playing) {
            this.jsNode.disconnect(this.gainNode);
            if (this.XMView.pause) this.XMView.pause();
        }
        this.playing = false;
    }

    stop() {
        if (this.playing) {
            this.jsNode.disconnect(this.gainNode);
            this.playing = false;
        }
        this.cur_pat = -1;
        this.cur_row = 64;
        this.cur_songpos = -1;
        this.cur_ticksamp = 0;
        this.xm.global_volume = this.max_global_volume;
        if (this.XMView.stop) this.XMView.stop();
        this.init();
    }


    updateChannelPeriod(ch: ChannelInfo, period: number) {
        let freq = 8363 * Math.pow(2, (1152.0 - period) / 192.0);
        if (isNaN(freq)) {
            console.log("invalid period!", period);
            return;
        }
        ch.doff = freq / this.f_smp;
        ch.filter = this.filterCoeffs(ch.doff / 2);
    }


    // Return 2-pole Butterworth lowpass filter coefficients for
    // center frequncy f_c (relative to sampling frequency)
    filterCoeffs(f_c: number) {
        if (f_c > 0.5) {  // we can't lowpass above the nyquist frequency...
            f_c = 0.5;
        }
        const wct = Math.sqrt(2) * Math.PI * f_c;
        const e = Math.exp(-wct);
        const c = e * Math.cos(wct);
        const gain = (1 - 2 * c + e * e) / 2;
        return [gain, 2 * c, -e * e];
    }


    nextTick() {
        this.cur_tick++;
        let ch: ChannelInfo;

        for (let j = 0; j < this.xm.nchan; j++) {
            ch = this.xm.channelinfo[j];
            ch.periodoffset = 0;
        }
        if (this.cur_tick >= this.xm.tempo) {
            this.cur_tick = 0;
            this.nextRow();
        }

        for (let j = 0; j < this.xm.nchan; j++) {
            const ch: ChannelInfo = this.xm.channelinfo[j];
            let inst = ch.inst;
            if (this.cur_tick !== 0) {
                if (ch.voleffectfn) ch.voleffectfn(this, ch, undefined);
                if (ch.effectfn) ch.effectfn(this, ch, undefined);
            }
            if (isNaN(ch.period)) {
                console.log(Prettify.prettify_notedata(
                    this.xm.patterns[this.cur_pat][this.cur_row][j]),
                    "set channel", j, "period to NaN");
            }
            if (inst === undefined) continue;
            if (ch.env_vol === undefined) {
                console.log(Prettify.prettify_notedata(
                    this.xm.patterns[this.cur_pat][this.cur_row][j]),
                    "set channel", j, "env_vol to undefined, but note is playing");
                continue;
            }
            ch.volE = ch.env_vol.Tick(ch.release);
            ch.panE = ch.env_pan.Tick(ch.release);
            this.updateChannelPeriod(ch, ch.period + ch.periodoffset);
        }
    }

    nextRow() {
        if (typeof this.next_row === "undefined") { this.next_row = this.cur_row + 1; }
        this.cur_row = this.next_row;
        this.next_row++;

        if (this.cur_pat == -1 || this.cur_row >= this.xm.patterns[this.cur_pat].length) {
            this.cur_row = 0;
            this.next_row = 1;
            this.cur_songpos++;
            if (this.cur_songpos >= this.xm.songpats.length)
                this.cur_songpos = this.xm.song_looppos;

            this.setCurrentPattern();
        }
        let p = this.xm.patterns[this.cur_pat];
        let r = p[this.cur_row];
        for (let i = 0; i < r.length; i++) {
            let ch: ChannelInfo = this.xm.channelinfo[i];
            let inst = ch.inst;
            let triggernote = false;
            // instrument trigger
            if (r[i][1] != -1) {
                inst = this.xm.instruments[r[i][1] - 1];
                if (inst && inst.samplemap) {
                    ch.inst = inst;
                    // retrigger unless overridden below
                    triggernote = true;
                    if (ch.note && inst.samplemap) {
                        ch.samp = inst.samples[inst.samplemap[ch.note]];
                        ch.vol = ch.samp.vol;
                        ch.pan = ch.samp.pan;
                        ch.fine = ch.samp.fine;
                    }
                } else {
                    // console.log("invalid inst", r[i][1], instruments.length);
                }
            }

            // note trigger
            if (r[i][0] != -1) {
                if (r[i][0] == 96) {
                    ch.release = 1;
                    triggernote = false;
                } else {
                    if (inst && inst.samplemap) {
                        let note = r[i][0];
                        ch.note = note;
                        ch.samp = inst.samples[inst.samplemap[ch.note]];
                        if (triggernote) {
                            // if we were already triggering the note, reset vol/pan using
                            // (potentially) new sample
                            ch.pan = ch.samp.pan;
                            ch.vol = ch.samp.vol;
                            ch.fine = ch.samp.fine;
                        }
                        triggernote = true;
                    }
                }
            }

            ch.voleffectfn = undefined;
            if (r[i][2] != -1) {  // volume column
                let v = r[i][2];
                ch.voleffectdata = v & 0x0f;
                if (v < 0x10) {
                    console.log("channel", i, "invalid volume", v.toString(16));
                } else if (v <= 0x50) {
                    ch.vol = v - 0x10;
                } else if (v >= 0x60 && v < 0x70) {  // volume slide down
                    ch.voleffectfn = function (player, ch) {
                        ch.vol = Math.max(0, ch.vol - ch.voleffectdata);
                    };
                } else if (v >= 0x70 && v < 0x80) {  // volume slide up
                    ch.voleffectfn = function (player, ch) {
                        ch.vol = Math.min(64, ch.vol + ch.voleffectdata);
                    };
                } else if (v >= 0x80 && v < 0x90) {  // fine volume slide down
                    ch.vol = Math.max(0, ch.vol - (v & 0x0f));
                } else if (v >= 0x90 && v < 0xa0) {  // fine volume slide up
                    ch.vol = Math.min(64, ch.vol + (v & 0x0f));
                } else if (v >= 0xa0 && v < 0xb0) {  // vibrato speed
                    ch.vibratospeed = v & 0x0f;
                } else if (v >= 0xb0 && v < 0xc0) {  // vibrato w/ depth
                    ch.vibratodepth = v & 0x0f;
                    ch.voleffectfn = this.effects_t1[4];  // use vibrato effect directly
                    this.effects_t1[4](this, ch, undefined);  // and also call it on tick 0
                } else if (v >= 0xc0 && v < 0xd0) {  // set panning
                    ch.pan = (v & 0x0f) * 0x11;
                } else if (v >= 0xf0 && v <= 0xff) {  // portamento
                    if (v & 0x0f) {
                        ch.portaspeed = (v & 0x0f) << 4;
                    }
                    ch.voleffectfn = this.effects_t1[3];  // just run 3x0
                } else {
                    console.log("channel", i, "volume effect", v.toString(16));
                }
            }

            ch.effect = r[i][3];
            ch.effectdata = r[i][4];
            if (ch.effect < 36) {
                ch.effectfn = this.effects_t1[ch.effect];
                let eff_t0 = this.effects_t0[ch.effect];
                if (eff_t0 && eff_t0(this, ch, ch.effectdata)) {
                    triggernote = false;
                }
            } else {
                console.log("channel", i, "effect > 36", ch.effect);
            }

            // special handling for portamentos: don't trigger the note
            if (ch.effect == 3 || ch.effect == 5 || r[i][2] >= 0xf0) {
                if (r[i][0] != -1) {
                    ch.periodtarget = this.periodForNote(ch, ch.note);
                }
                triggernote = false;
                if (inst && inst.samplemap) {
                    if (ch.env_vol == undefined) {
                        // note wasn't already playing; we basically have to ignore the
                        // portamento and just trigger
                        triggernote = true;
                    } else if (ch.release) {
                        // reset envelopes if note was released but leave offset/pitch/etc
                        // alone
                        ch.envtick = 0;
                        ch.release = 0;
                        ch.env_vol = new EnvelopeFollower(inst.env_vol);
                        ch.env_pan = new EnvelopeFollower(inst.env_pan);
                    }
                }
            }

            if (triggernote) {
                // there's gotta be a less hacky way to handle offset commands...
                if (ch.effect != 9) ch.off = 0;
                ch.release = 0;
                ch.envtick = 0;
                ch.env_vol = new EnvelopeFollower(inst.env_vol);
                ch.env_pan = new EnvelopeFollower(inst.env_pan);
                if (ch.note) {
                    ch.period = this.periodForNote(ch, ch.note);
                }
                // waveforms 0-3 are retriggered on new notes while 4-7 are continuous
                if (ch.vibratotype < 4) {
                    ch.vibratopos = 0;
                }
            }
        }
    }


    setCurrentPattern() {
        let nextPat = this.xm.songpats[this.cur_songpos];

        // check for out of range pattern index
        while (nextPat >= this.xm.patterns.length) {
            if (this.cur_songpos + 1 < this.xm.songpats.length) {
                // first try skipping the position
                this.cur_songpos++;
            } else if ((this.cur_songpos === this.xm.song_looppos && this.cur_songpos !== 0)
                || this.xm.song_looppos >= this.xm.songpats.length) {
                // if we allready tried song_looppos or if song_looppos
                // is out of range, go to the first position
                this.cur_songpos = 0;
            } else {
                // try going to song_looppos
                this.cur_songpos = this.xm.song_looppos;
            }

            nextPat = this.xm.songpats[this.cur_songpos];
        }

        this.cur_pat = nextPat;
    }


    MixChannelIntoBuf(ch: ChannelInfo, start: number, end: number, dataL: Float32Array, dataR: Float32Array) {
        let inst = ch.inst;
        let instsamp = ch.samp;
        let loop = false;
        let looplen = 0, loopstart = 0;

        // nothing on this channel, just filter the last dc offset back down to zero
        if (instsamp == undefined || inst == undefined || ch.mute) {
            return this.MixSilenceIntoBuf(ch, start, end, dataL, dataR);
        }

        let samp = instsamp.sampledata;
        let sample_end = instsamp.len;
        if ((instsamp.type & 3) == 1 && instsamp.looplen > 0) {
            loop = true;
            loopstart = instsamp.loop;
            looplen = instsamp.looplen;
            sample_end = loopstart + looplen;
        }
        let volE = ch.volE / 64.0;    // current volume envelope
        let panE = 4 * (ch.panE - 32);  // current panning envelope
        let p = panE + ch.pan - 128;  // final pan
        let volL = this.xm.global_volume * volE * (128 - p) * ch.vol / (64 * 128 * 128);
        let volR = this.xm.global_volume * volE * (128 + p) * ch.vol / (64 * 128 * 128);
        if (volL < 0) volL = 0;
        if (volR < 0) volR = 0;
        if (volR === 0 && volL === 0)
            return;
        if (isNaN(volR) || isNaN(volL)) {
            console.log("NaN volume!?", ch.number, volL, volR, volE, panE, ch.vol, this.xm.global_volume);
            return;
        }
        let k: number = ch.off;
        let dk: number = ch.doff;
        let Vrms: number = 0;
        let f0 = ch.filter[0], f1 = ch.filter[1], f2 = ch.filter[2];
        let fs0 = ch.filterstate[0], fs1 = ch.filterstate[1], fs2 = ch.filterstate[2];

        // we also low-pass filter volume changes with a simple one-zero,
        // one-pole filter to avoid pops and clicks when volume changes.
        let vL = this.popfilter_alpha * ch.vL + (1 - this.popfilter_alpha) * (volL + ch.vLprev) * 0.5;
        let vR = this.popfilter_alpha * ch.vR + (1 - this.popfilter_alpha) * (volR + ch.vRprev) * 0.5;
        let pf_8 = Math.pow(this.popfilter_alpha, 8);
        ch.vLprev = volL;
        ch.vRprev = volR;

        // we can mix up to this many bytes before running into a sample end/loop
        let i: number = start;
        let failsafe = 100;
        while (i < end) {
            if (failsafe-- === 0) {
                console.log("failsafe in mixing loop! channel", ch.number, k, sample_end,
                    loopstart, looplen, dk);
                break;
            }
            if (k >= sample_end) {  // TODO: implement pingpong looping
                if (loop) {
                    k = loopstart + (k - loopstart) % looplen;
                } else {
                    // kill sample
                    ch.inst = undefined;
                    // fill rest of buf with filtered dc offset using loop above
                    return Vrms + this.MixSilenceIntoBuf(ch, i, end, dataL, dataR);
                }
            }
            let next_event = Math.max(1, Math.min(end, i + (sample_end - k) / dk));
            // this is the inner loop of the this

            // unrolled 8x
            let s: number, y: number;
            for (; i + 7 < next_event; i += 8) {
                s = samp[k | 0];
                y = f0 * (s + fs0) + f1 * fs1 + f2 * fs2;
                fs2 = fs1; fs1 = y; fs0 = s;
                k += dk;
                dataL[i] += vL * y;
                dataR[i] += vR * y;
                Vrms += (vL + vR) * y * y;

                s = samp[k | 0];
                y = f0 * (s + fs0) + f1 * fs1 + f2 * fs2;
                fs2 = fs1; fs1 = y; fs0 = s;
                k += dk;
                dataL[i + 1] += vL * y;
                dataR[i + 1] += vR * y;
                Vrms += (vL + vR) * y * y;

                s = samp[k | 0];
                y = f0 * (s + fs0) + f1 * fs1 + f2 * fs2;
                fs2 = fs1; fs1 = y; fs0 = s;
                k += dk;
                dataL[i + 2] += vL * y;
                dataR[i + 2] += vR * y;
                Vrms += (vL + vR) * y * y;

                s = samp[k | 0];
                y = f0 * (s + fs0) + f1 * fs1 + f2 * fs2;
                fs2 = fs1; fs1 = y; fs0 = s;
                k += dk;
                dataL[i + 3] += vL * y;
                dataR[i + 3] += vR * y;
                Vrms += (vL + vR) * y * y;

                s = samp[k | 0];
                y = f0 * (s + fs0) + f1 * fs1 + f2 * fs2;
                fs2 = fs1; fs1 = y; fs0 = s;
                k += dk;
                dataL[i + 4] += vL * y;
                dataR[i + 4] += vR * y;
                Vrms += (vL + vR) * y * y;

                s = samp[k | 0];
                y = f0 * (s + fs0) + f1 * fs1 + f2 * fs2;
                fs2 = fs1; fs1 = y; fs0 = s;
                k += dk;
                dataL[i + 5] += vL * y;
                dataR[i + 5] += vR * y;
                Vrms += (vL + vR) * y * y;

                s = samp[k | 0];
                y = f0 * (s + fs0) + f1 * fs1 + f2 * fs2;
                fs2 = fs1; fs1 = y; fs0 = s;
                k += dk;
                dataL[i + 6] += vL * y;
                dataR[i + 6] += vR * y;
                Vrms += (vL + vR) * y * y;

                s = samp[k | 0];
                y = f0 * (s + fs0) + f1 * fs1 + f2 * fs2;
                fs2 = fs1; fs1 = y; fs0 = s;
                k += dk;
                dataL[i + 7] += vL * y;
                dataR[i + 7] += vR * y;
                Vrms += (vL + vR) * y * y;

                vL = pf_8 * vL + (1 - pf_8) * volL;
                vR = pf_8 * vR + (1 - pf_8) * volR;
            }

            for (; i < next_event; i++) {
                s = samp[k | 0];
                // we low-pass filter here since we are resampling some arbitrary
                // frequency to f_smp; this is an anti-aliasing filter and is
                // implemented as an IIR butterworth filter (usually we'd use an FIR
                // brick wall filter, but this is much simpler computationally and
                // sounds fine)
                y = f0 * (s + fs0) + f1 * fs1 + f2 * fs2;
                fs2 = fs1; fs1 = y; fs0 = s;
                dataL[i] += vL * y;
                dataR[i] += vR * y;
                Vrms += (vL + vR) * y * y;
                k += dk;
            }
        }
        ch.off = k;
        ch.filterstate[0] = fs0;
        ch.filterstate[1] = fs1;
        ch.filterstate[2] = fs2;
        ch.vL = vL;
        ch.vR = vR;
        return Vrms * 0.5;
    }


    // This function gradually brings the channel back down to zero if it isn't
    // already to avoid clicks and pops when samples end.
    MixSilenceIntoBuf(ch: ChannelInfo, start: number, end: number, dataL: Float32Array, dataR: Float32Array) {
        let s = ch.filterstate[1];
        if (isNaN(s)) {
            console.log("NaN filterstate?", ch.filterstate, ch.filter);
            return;
        }
        for (let i = start; i < end; i++) {
            if (Math.abs(s) < 1.526e-5) {  // == 1/65536.0
                s = 0;
                break;
            }
            dataL[i] += s * ch.vL;
            dataR[i] += s * ch.vR;
            s *= this.popfilter_alpha;
        }
        ch.filterstate[1] = s;
        ch.filterstate[2] = s;
        if (isNaN(s)) {
            console.log("NaN filterstate after adding silence?", ch.filterstate, ch.filter);
            return;
        }
        return 0;
    }


    periodForNote(ch: ChannelInfo, note: number) {
        return 1920 - (note + ch.samp.note) * 16 - ch.fine / 8.0;
    }
}