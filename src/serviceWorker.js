/* global OmnibugSettings, OmnibugProvider, OmnibugPort */

/**
 * Set/Load/Migrate settings when extension / browser is installed / updated.
 */
chrome.runtime.onInstalled.addListener((details) => {
    let settings = new OmnibugSettings();
    settings.migrate();
});


/**
 * Load settings when storage has changed
 */
chrome.storage.onChanged.addListener((changes, storageType) => {
    const settings = new OmnibugSettings();
    settings.load().then(sendSettingsToTabs);
});

/*
 Persistent(ish) storage of the open tabs
 Not ideal, but the keep alive script should keep this variable in existence
 */
const tabs = {};
const tabOrigins = {}; // Track origins for each tab

// Keep alive funcs
const forceReconnect = (port) => {
    console.log(`Reconnecting port ${port.name} to stay alive`);
    deleteTimer(port);
    port.disconnect();
};

const deleteTimer = (port) => {
    console.log(`Port ${port.name} disconnected`);
    if (port._timer) {
        clearTimeout(port._timer);
        delete port._timer;
        delete tabs[port.name];
        delete tabOrigins[parseInt(port.name)]; // Clean up origin tracking
    }
};

// Function to detect Trackingplan script on the page
function detectTrackingplanOnPage() {
    try {
        if (typeof window.Trackingplan !== "undefined" && window.Trackingplan.tpId) {
            return window.Trackingplan.tpId;
        }
    } catch (e) {
        console.log("Error accessing Trackingplan:", e);
    }
    return null;
}

var providerPattern;
var port;
/**
 * Accept incoming connections from our devtools panels
 */
chrome.runtime.onConnect.addListener((incomingPort) => {
    port = incomingPort;
    console.log(`Port ${port.name} connected`);

    port.onDisconnect.addListener(deleteTimer);
    port._timer = setTimeout(forceReconnect, 250e3, port);
    tabs[port.name] = port;

    // Get the tab URL to track its origin
    const tabId = parseInt(port.name);
    chrome.tabs.get(tabId).then(tab => {
        if (tab && tab.url) {
            try {
                const origin = new URL(tab.url).origin;
                tabOrigins[tabId] = origin;
                console.log(`Tracking origin ${origin} for tab ${tabId}`);
            } catch (e) {
                console.log(`Could not parse URL for tab ${tabId}:`, tab.url);
            }
        }
    }).catch(error => {
        console.log(`Could not get tab info for ${tabId}:`, error);
    });

    const settings = new OmnibugSettings();

    // Ensure the panel has the latest settings
    settings.load().then((loadedSettings) => {
        const data = {
            "event": "settings",
            "data": loadedSettings
        };
        port.postMessage(data);

        // Cache the provider RegExp for slightly better performance
        providerPattern = OmnibugProvider.getPattern(loadedSettings.providers);

        // Automatically detect Trackingplan when devtools connects/reconnects
        setTimeout(() => {
            chrome.scripting.executeScript({
                target: { tabId: parseInt(port.name) },
                func: detectTrackingplanOnPage,
                world: "MAIN"  // Run in main world to access page's window object
            }).then((results) => {
                if (results && results[0] && results[0].result) {
                    const trackingplanData = {
                        "event": "trackingplanDetected",
                        "tpId": results[0].result
                    };
                    port.postMessage(trackingplanData);
                }
            }).catch((error) => {
                console.log("Error auto-detecting Trackingplan on connect:", error);
            });
        }, 500); // Shorter delay since page is likely already loaded
    });

    port.onMessage.addListener((messages) => {
        messages.forEach((message) => {
            if (message.type === "settings") {
                if (typeof message.key === "string" && message.value) {
                    settings.updateItem(message.key, message.value);
                } else {
                    settings.save(message.value);
                }
            } else if (message.type === "linkClick" && message.url) {
                chrome.tabs.create({ url: message.url });
            } else if (message.type === "openSettings") {
                chrome.runtime.openOptionsPage();
            } else if (message.type === "detectTrackingplan") {
                // Inject script to detect Trackingplan on the page
                chrome.scripting.executeScript({
                    target: { tabId: parseInt(port.name) },
                    func: detectTrackingplanOnPage,
                    world: "MAIN"  // Run in main world to access page's window object
                }).then((results) => {
                    if (results && results[0] && results[0].result) {
                        const data = {
                            "event": "trackingplanDetected",
                            "tpId": results[0].result
                        };
                        port.postMessage(data);
                    }
                }).catch((error) => {
                    console.log("Error detecting Trackingplan:", error);
                });
            }
        });
    });
});

/**
 * Check if a service worker request is related to any of our tracked tab origins
 * @param {Object} details - The request details
 * @returns {Array} - Array of tab IDs that match the request origin
 */
function getRelatedTabsForServiceWorkerRequest(details) {
    if (!details.initiator) {
        return [];
    }
    
    const relatedTabs = [];
    for (const [tabId, origin] of Object.entries(tabOrigins)) {
        if (details.initiator === origin || details.initiator.startsWith(origin)) {
            relatedTabs.push(parseInt(tabId));
        }
    }
    
    return relatedTabs;
}

/**
 * Listen for all requests that match our providers
 */
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {

        // Ignore any requests for windows where devtools isn't open, or options requests
        if (!validProviderRequest(details)) { return; }


        let data = {
            "request": {
                "initiator": details.initiator,
                "method": details.method,
                "id": details.requestId,
                "tab": details.tabId,
                "timestamp": details.timeStamp,
                "type": details.type,
                "url": details.url,
                "postData": "",
                "postError": false
            },
            "event": "webRequest"
        };

        // Grab any POST data that is included
        if (details.method === "POST" && typeof details.requestBody !== "undefined" && details.requestBody) {
            const body = details.requestBody;
            if(typeof body.error !== "undefined" && body.error) {
                data.request.postError = true;
            } else if (typeof body.raw !== "undefined" && body.raw[0]) {
                data.request.postData = (new Uint8Array(body.raw[0].bytes)).reduce((postData, byte) => {
                    return postData + String.fromCharCode(byte);
                }, "");
            } else if (typeof body.formData === "object") {
                data.request.postData = body.formData;
            }
        }

        let providerDataArray = OmnibugProvider.parseUrl(data.request.url, data.request.postData);
        console.log("Provider data array", providerDataArray);
        if (!Array.isArray(providerDataArray)) {
            providerDataArray = [providerDataArray];
        } else {
            data.multipleEntriesPerRequest = true;
            console.log("Multiple entries per request", data);
        }

        providerDataArray.forEach(providerData => {
            // Parse the URL and join our request info to the parsed data
            let finalData = Object.assign(
                data,
                providerData
            );
            
            // Handle service worker requests (tabId = -1) and regular tab requests
            if (details.tabId === -1) {
                // Service worker request - find related tabs by origin
                const relatedTabIds = getRelatedTabsForServiceWorkerRequest(details);
                
                if (relatedTabIds.length > 0) {
                    // Send to specific tabs that match the service worker's origin
                    relatedTabIds.forEach(tabId => {
                        if (tabs[tabId]) {
                            try {
                                tabs[tabId].postMessage(finalData);
                            } catch (error) {
                                console.log(`Failed to send SW message to tab ${tabId}:`, error);
                            }
                        }
                    });
                } else {
                    // Fallback: if we can't determine the origin, send to all tabs
                    console.log(`Service worker request from unknown origin: ${details.initiator}`);
                    Object.values(tabs).forEach(tab => {
                        try {
                            tab.postMessage(finalData);
                        } catch (error) {
                            console.log(`Failed to send message to tab ${tab.name}:`, error);
                        }
                    });
                }
            } else if (tabs[details.tabId]) {
                // Regular tab request - send to specific tab
                tabs[details.tabId].postMessage(finalData);
            } else {
                // Fallback: send to first available tab if specific tab not found
                const availableTabs = Object.values(tabs);
                if (availableTabs.length > 0) {
                    availableTabs[0].postMessage(finalData);
                }
            }
        });

    },
    {  urls: ["<all_urls>"] },
    ["requestBody"]
);

// HTTP 4xx/5xx Errors
chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
        // Ignore any requests for windows where devtools isn't open, or options requests
        if (!validProviderRequest(details) || details.statusCode < 400) { return; }

        const data = {
            "request": {
                "id": details.requestId,
                "error": details.statusCode,
            },
            "event": "requestError"
        };

        tabs[details.tabId].postMessage(data);
    },
    { urls: ["<all_urls>"]}
);

// Cancelled/blocked requests (other extensions e.g. adblockers, network errors, etc.)
chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
        // Ignore any requests for windows where devtools isn't open, or options requests
        if (!validProviderRequest(details)) { return; }

        const data = {
            "request": {
                "id": details.requestId,
                "error": details.error,
            },
            "event": "requestError"
        };

        tabs[details.tabId].postMessage(data);
    },
    { urls: ["<all_urls>"]}
);

/**
 * Listen for all navigations that occur on a top-level frame
 */
chrome.webNavigation.onCommitted.addListener(
    (details) => {
        if (!tabHasOmnibugOpen(details.tabId) || details.frameId !== 0) { return; }

        // Update origin tracking for this tab
        try {
            const origin = new URL(details.url).origin;
            tabOrigins[details.tabId] = origin;
            console.log(`Updated origin ${origin} for tab ${details.tabId}`);
        } catch (e) {
            console.log(`Could not parse navigation URL for tab ${details.tabId}:`, details.url);
        }

        const data = {
            "request": {
                "tab": details.tabId,
                "timestamp": details.timeStamp,
                "url": details.url
            },
            "event": "webNavigation"
        };

        tabs[details.tabId].postMessage(data);

        // Automatically detect Trackingplan on the new page after a short delay
        // to allow the page to load and initialize
        setTimeout(() => {
            chrome.scripting.executeScript({
                target: { tabId: details.tabId },
                func: detectTrackingplanOnPage,
                world: "MAIN"  // Run in main world to access page's window object
            }).then((results) => {
                // Always send trackingplan detection result, even if null
                const tpId = (results && results[0] && results[0].result) ? results[0].result : null;
                const trackingplanData = {
                    "event": "trackingplanDetected",
                    "tpId": tpId
                };
                
                if (tabs[details.tabId]) {
                    console.log(`Auto-detected Trackingplan on navigation for tab ${details.tabId}: ${tpId}`);
                    tabs[details.tabId].postMessage(trackingplanData);
                }
            }).catch((error) => {
                console.log("Error auto-detecting Trackingplan on navigation:", error);
                // Send null result even on error so the panel knows detection was attempted
                if (tabs[details.tabId]) {
                    tabs[details.tabId].postMessage({
                        "event": "trackingplanDetected",
                        "tpId": null
                    });
                }
            });
        }, 1500); // Wait 1.5 seconds for page to load
    }
);

/**
 * Check request to see if we care about it or not
 * @param details
 * @returns {boolean}
 */
function validProviderRequest(details) {
    if(typeof providerPattern === "undefined" || !(providerPattern instanceof RegExp)) {
        providerPattern = OmnibugProvider.getPattern();
    }
    
    // Handle service worker requests (tabId = -1) with origin filtering
    let isValidTab;
    if (details.tabId === -1) {
        // Service worker request - check if it's from a tracked origin
        const relatedTabs = getRelatedTabsForServiceWorkerRequest(details);
        isValidTab = relatedTabs.length > 0 || Object.keys(tabs).length > 0; // Fallback to any open tabs
    } else {
        // Regular tab request
        isValidTab = tabHasOmnibugOpen(details.tabId);
    }
    
    return details.method !== "OPTIONS" &&
            isValidTab &&
            providerPattern.test(details.url) &&
            !/\/.well-known\//i.test(details.url);
}

/**
 * Verify we have a tab that we have devtools open for
 *
 * @param tabId
 * @return {boolean}
 */
function tabHasOmnibugOpen(tabId) {
    return (tabId !== -1 && tabId in tabs);
}

/**
 * Send new settings values to all tabs
 *
 * @param   settings
 */
function sendSettingsToTabs(settings) {
    console.log("Sending settings to tabs", settings);
    Object.values(tabs).forEach((tab) => {
        tab.postMessage({
            "event": "settings",
            "data": settings
        });
    });
    providerPattern = OmnibugProvider.getPattern(settings.providers);
}
