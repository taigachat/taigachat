
const soundEffects = {
    userJoin: './static/sounds/SynthJoin.mp3',
    userLeave: './static/sounds/SynthLeave.mp3'
}

type Sounds = keyof typeof soundEffects

let useSound = true

export function playSound(sound: Sounds) {
    if (useSound) {
        const audio = new Audio()
        const soundEffect = soundEffects[sound]
        audio.src = soundEffect
        audio.play()
        audio.muted = false
    }
}

export function setAllSoundsEnabled(b: boolean) {
    useSound = b
}

; (window as any).debugSetAllSoundsEnabled = setAllSoundsEnabled
