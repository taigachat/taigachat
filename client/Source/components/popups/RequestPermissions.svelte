<script lang="ts">
import type { Immutable } from "../../immutable";
import type { Popup } from "../../routes";
import type { QueriedPermissions, DevicePermission } from "../../device_permissions";
export let popup: Immutable<Popup>;
export let permissions: Immutable<QueriedPermissions>;

type DisplayedPermission = {
    name: string;
    id: DevicePermission;
    request: () => void;
};

const displayedPermissions: DisplayedPermission[] = [
    {
        name: "Notifications",
        id: "notifications",
        request() {
            return Notification.requestPermission();
        },
    },
];

function noop() {}
</script>

<style>
.permission-box {
    display: flex;
    padding: 10px;
    flex-flow: row nowrap;
    align-items: center;
    justify-content: space-between;
}
.permission-list {
    display: flex;
    padding-top: 10px;
    flex-flow: column nowrap;
}
</style>

{#if "requestPermission" in popup}
    <div>Please give access to:</div>
    <div>
        {popup["requestPermission"]}
    </div>
    <div class="permission-list">
        {#each displayedPermissions as permission}
            <div class="permission-box panel-glass panel-border">
                <span>
                    {permission.name}
                </span>
                <button
                    on:click={permissions[permission.id] === "granted" ? noop : permission.request}
                    class="big-button green"
                    class:blue={permissions[permission.id] === "granted"}
                    class:green={permissions[permission.id] !== "granted"}>
                    {#if permissions[permission.id] === "granted"}
                        Perfect
                    {:else}
                        Grant
                    {/if}
                </button>
            </div>
        {/each}
    </div>
{/if}
