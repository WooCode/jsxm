import Instrument from './Instrument'
import Sample  from './Sample'
import EnvelopeFollower from './EnvelopeFollower'
import XMPlayer from './XMPlayer';

export default class ChannelInfo {
    constructor(data: Partial<ChannelInfo>) {
        Object.assign(this, data);
    }

    number: number

    filterstate: Float32Array

    vL: number
    vR: number
    vLprev: number
    vRprev: number

    mute: number
    retrig: number

    inst: Instrument
    note: number
    samp: Sample
    vol: number
    pan: number
    fine: number
    release: number
    voleffectfn: (player: XMPlayer, channel: ChannelInfo, data: any) => void
    voleffectdata: number
    vibratospeed: number
    vibratodepth: number
    portaspeed: number
    effect: number
    effectdata: number
    effectfn: (player: XMPlayer, ch, data) => void
    periodtarget: number
    env_vol: EnvelopeFollower
    env_pan: EnvelopeFollower
    envtick: number
    off: number
    period: number
    vibratotype: number
    vibratopos: number

    periodoffset: number
    doff: number
    filter: Array<number>
    volE: number
    panE: number
}
