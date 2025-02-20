<script>
export let icon;
export let size;

// TODO: I am not so sure about this aria-label usage
</script>

<svg
    role="button"
    class="icon"
    aria-label={icon.alt + " icon"}
    width={size}
    height={size}
    viewBox="0 0 {icon.box} {icon.box}">
    <path d={icon.path}></path>
</svg>
