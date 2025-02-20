// @ts-check

class AudioDetectorWorklet extends AudioWorkletProcessor {
    constructor() {
        super();
        this.clipping = false;
        this.lastClip = 0;
        this.volume = 0;
        this.announcedState = false;
    }
    static get parameterDescriptors() {
        return [
            {
                name: "averaging",
                defaultValue: 0.95,
                automationRate: "k-rate",
            },
            {
                name: "clipLevel",
                defaultValue: 0.03,
                automationRate: "k-rate",
            },
            {
                name: "clipLag",
                defaultValue: 1.0,
                automationRate: "k-rate",
            },
        ];
    }

    /**
     * @param {any} inputs
     * @param {any} _outputs
     * @param {Object} parameters
     * @param {Float32Array<ArrayBufferLike>} parameters.averaging
     * @param {Float32Array<ArrayBufferLike>} parameters.clipLag
     * @param {Float32Array<ArrayBufferLike>} parameters.clipLevel
     */
    process(inputs, _outputs, { averaging, clipLag, clipLevel }) {
        const clipLevelValue = clipLevel[0] || 0;
        const buffer = inputs[0][0] || [];
        let sum = 0;

        // Do a root-mean-square on the samples: sum up the squares...
        for (const x of buffer) {
            if (Math.abs(x) >= clipLevelValue) {
                this.clipping = true;
                this.lastClip = currentTime;
            }
            sum += x * x;
        }

        const rms = Math.sqrt(sum / buffer.length);

        // Now smooth this out with the averaging factor applied
        // to the previous sample - take the max here because we
        // want "fast attack, slow release."
        this.volume = Math.max(rms, this.volume * (averaging[0] || 0));

        if (this.clipping) {
            if (this.lastClip + (clipLag[0] || 0) < currentTime) {
                this.clipping = false;
            }
        }

        /*if (this.clipping) {
            //console.log('clipping', this.lastClip + clipLag[0], currentTime)
            console.log('clipping')
        } else {
            console.log('not clipping')
        }*/

        if (this.clipping !== this.announcedState) {
            this.announcedState = this.clipping;
            this.port.postMessage({ clipping: this.clipping, volume: this.volume });
        }

        return true;
    }
}

registerProcessor("audio-detector-processor", AudioDetectorWorklet);

/// Modifications to the original code:
/// * Is now an AudioWorkletNode
/// * Now uses modern ES6 features
/// * Added JSDoc TypeScript verification
/// * Changed the default values to fit audio detection
///
/// The original code can be found at: https://github.com/cwilso/volume-meter/blob/master/main.js
/// Original License:

/*
The MIT License (MIT)
Copyright (c) 2014 Chris Wilson
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
