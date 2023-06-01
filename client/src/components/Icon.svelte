<script>
export let icon
export let size
</script>

<svg
    role="button"
    class="icon"
    alt={icon.alt + ' icon'}
    width={size}
    height={size}
    viewBox="0 0 {icon.box} {icon.box}">{@html icon.svg}</svg>
