import { setPopup } from "./routes";
import { setDevicePermissionState } from "./acts";
import type { QueriedPermissions, DevicePermission, BrowserPermissionID } from "./device_permissions";

export function askForPermission(permissions: QueriedPermissions, permission: keyof QueriedPermissions) {
    if (permissions[permission] !== "granted") {
        setPopup({ requestPermission: permission });
    }
}

async function scanPermission(permission: DevicePermission, browserPermissionID: BrowserPermissionID) {
    try {
        const permissionState = await navigator.permissions.query({ name: browserPermissionID });
        setDevicePermissionState(permission, permissionState.state);
        permissionState.addEventListener("change", () => {
            setDevicePermissionState(permission, permissionState.state);
        });
    } catch (e) {
        console.error("could not get permission state for", browserPermissionID, e);
    }
}

export function startPermissionScanning() {
    scanPermission("notifications", "notifications");
}
