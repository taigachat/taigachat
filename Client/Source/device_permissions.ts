// TODO: If we ever get a data or model directory than this file belongs there.
import { z } from "zod";

export const devicePermissions = z.enum(["notifications", "microphone"]);

export type DevicePermission = z.infer<typeof devicePermissions>;

export type PermissionState = "denied" | "granted" | "prompt";

export type QueriedPermissions = Record<DevicePermission, PermissionState>;

export type BrowserPermissionID = "notifications";
