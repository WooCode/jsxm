import Pattern from "./Pattern";


export default class Prettify {
    // for pretty-printing notes
    static _note_names = [
        "C-", "C#", "D-", "D#", "E-", "F-",
        "F#", "G-", "G#", "A-", "A#", "B-"];

    static prettify_note(note: number) {
        if (note < 0) return "---";
        if (note == 96) return "^^^";
        return this._note_names[note % 12] + ~~(note / 12);
    }

    static prettify_number(num: number) {
        if (num == -1) return "--";
        if (num < 10) return "0" + num;
        return num;
    }

    static prettify_volume(num: number) {
        if (num < 0x10) return "--";
        return num.toString(16);
    }

    static prettify_effect(t: number, p: number) {
        let tn: string, pn: string
        if (t >= 10) tn = String.fromCharCode(55 + t);
        if (p < 16) pn = '0' + p.toString(16);
        else pn = p.toString(16);
        return t + p;
    }

    static prettify_notedata(data: Pattern) {
        return (this.prettify_note(data[0]) + " " + this.prettify_number(data[1]) + " " +
            this.prettify_volume(data[2]) + " " +
            this.prettify_effect(data[3], data[4]));
    }


    static getstring(dv: DataView, offset: number, len: number) {
        let str = [];
        for (let i = offset; i < offset + len; i++) {
            let c = dv.getUint8(i);
            if (c === 0) break;
            str.push(String.fromCharCode(c));
        }
        return str.join('');
    }

}