// This file contains code for handling push notifications.

import { registerDebugCommand } from "./debug_mode";
import { randomBase64, toBase64 } from "./encoding_schemes";
import { safeURL } from "./join_url";
import type { URLGetter } from "./join_url";
import { defaultNotificationServerURL } from "./options";

function subscribeWithApplicationServerKey(key: string, sw: ServiceWorkerRegistration) {
    return sw.pushManager.subscribe({
        applicationServerKey: key,
        userVisibleOnly: true,
    });
}

async function subscribeToNotificationEndpoint(
    baseURL: URLGetter,
    sw: ServiceWorkerRegistration
): Promise<PushSubscriptionJSON> {
    const keyRequest = await fetch(baseURL("applicationServerKey0"));
    const key = await keyRequest.text();

    let subscription = await sw.pushManager.getSubscription();
    if (!subscription) {
        subscription = await subscribeWithApplicationServerKey(key, sw);
    } else {
        // Make sure we are still subscribed to the correct one.
        const otherKey = subscription.options.applicationServerKey;
        if (otherKey && toBase64(otherKey) !== key) {
            await subscription.unsubscribe();
            subscription = await subscribeWithApplicationServerKey(key, sw);
        }
    }
    return subscription.toJSON();
}

export async function createServerNotificationToken(user: string, session: string, ip: string) {
    if (Notification.permission !== "granted") {
        // TODO: Show a popup somewhere. But not from here.
        // NOTE: Not the actual browser permission popup but one that leads to the browser popup.
        return "";
    }
    const sw = await navigator.serviceWorker.ready;
    // TODO: on the server, store it as Record<notification_server_ip, token>

    const baseURL = safeURL(defaultNotificationServerURL);
    const notifications = await subscribeToNotificationEndpoint(baseURL, sw);
    const keys = notifications.keys;
    if (!keys) {
        console.error("push subscription did not contain keys");
        // TODO: Are there cases when sending push notifications are possible anyway?
        return "";
    }
    const parameters = new URLSearchParams();
    const token = randomBase64(24);

    // Authentication.
    parameters.set("user", user);
    parameters.set("session", session);

    // Used by the subscription entry.
    parameters.set("pusher", ip);
    parameters.set("token", token);

    // Used by the endpoint entry.
    parameters.set("endpoint", notifications.endpoint || "");
    parameters.set("authSecret", keys["auth"] || "");
    parameters.set("publicKey", keys["p256dh"] || "");

    const request = await fetch(baseURL(`addNotificationToken0?${parameters}`));
    const goodToken = await request.text();

    return goodToken;
}

registerDebugCommand("connectWithCentralNotificationServer", () => createServerNotificationToken);
