<script lang="ts">
import { fade } from '../svelte_actions'

export let showBalls: boolean = false

// https://stackoverflow.com/a/47593316
function sfc32(a: number, b: number, c: number, d: number) {
    return function() {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; 
      var t = (a + b) | 0;
      a = b ^ b >>> 9;
      b = c + (c << 3) | 0;
      c = (c << 21 | c >>> 11);
      d = d + 1 | 0;
      t = t + d | 0;
      c = c + t | 0;
      return (t >>> 0) / 4294967296;
    }
}

const balls: [number, number, number][] = []
let rand = sfc32(14, 2, 7, 8)
let y = 0
let side = false
for(let i = 0; i < 8; i++) {
    balls.push([
        (rand() * 10) + (side ? 85 : 0),
        rand() * 50 + y,
        rand() * 100 + 100,
    ])
    y += 150
    side = !side
}

</script>
<style>
.glassmorphic-ball {
    border-radius: 50%;
    position: absolute;
    background: rgb(251,4,134);
    background: linear-gradient(0deg, rgba(251,4,134,1) 0%, rgba(202,91,229,1) 100%);
    border: 2px solid white;
}
.glassmorphic-background {
    height: 100%;
    overflow: hidden;
    position: relative;
    background: linear-gradient(90deg, #2b3a72, #420d68);
}
.glassmorphic-background:before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    right: 0;
    mask-image: linear-gradient(to bottom, transparent, black);
    -webkit-mask-image: linear-gradient(to bottom, transparent, black);
    background: linear-gradient(90deg, #45137c, #0e1430);
}
.glassmorphic-content {
    height: 100%;
    overflow: hidden;
    backdrop-filter: blur(7.5px);
    -webkit-backdrop-filter: blur(7.5px);
    /*background: #12121270;*/
}
</style>


<div class="glassmorphic-background">
     <div use:fade={showBalls}>
         {#each balls as ball}
            <div class="glassmorphic-ball" style:left="{ball[0]}%"
                                           style:top="{ball[1]}px"
                                           style:width="{ball[2]}px"
                                           style:height="{ball[2]}px" />
         {/each}
     </div>
     <div class="glassmorphic-content">
        <slot/>
     </div>
</div>
