import {nanoid} from "nanoid"

import {isDevRuntime} from "./channelHelper"
import {getUserAgent} from "./googleAnalyzeHelper"
import secret, { GA_DEBUG_ENDPOINT, GA_ENDPOINT } from "./secret"
// 引入 FingerprintJS
import FingerprintJS from '@fingerprintjs/fingerprintjs';

// Get via https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events?client_type=gtag#recommended_parameters_for_reports
const MEASUREMENT_ID = secret.GA_MEASUREMENT_ID
const API_SECRET = secret.GA_API_SECRET
const DEFAULT_ENGAGEMENT_TIME_MSEC = 100

// Duration of inactivity after which a new session is created
const SESSION_EXPIRATION_IN_MIN = 30

export class Analytics {
  constructor(debug = false) {
    this.visitorId= ''
    this.debug = debug
  }

  // Returns the client id, or creates a new one if one doesn't exist.
  // Stores client id in local storage to keep the same client id as long as
  // the extension is installed.
  async getOrCreateClientId() {
    let { clientId } = await chrome.storage.local.get("clientId")
    if (!clientId) {
      // Generate a unique client ID, the actual value is not relevant
      clientId = nanoid()
      // 初始化 FingerprintJS
      const fp = await FingerprintJS.load();
      const result = await fp.get();
      const visitorId = result.visitorId;
      console.log("瀏覽器指紋：" + visitorId);
      console.log('result components:', result.components);//瀏覽器指紋生成依賴環境變量
      this.visitorId = result.visitorId;
      clientId = this.visitorId
      await chrome.storage.local.set({ clientId })
    }
    return clientId
  }

  // Returns the current session id, or creates a new one if one doesn't exist or
  // the previous one has expired.
  async getOrCreateSessionId() {
    // Use storage.session because it is only in memory
    let { sessionData } = await chrome.storage.session.get("sessionData")
    const currentTimeInMs = Date.now()
    // Check if session exists and is still valid
    if (sessionData && sessionData.timestamp) {
      // Calculate how long ago the session was last updated
      const durationInMin = (currentTimeInMs - sessionData.timestamp) / 60000
      // Check if last update lays past the session expiration threshold
      if (durationInMin > SESSION_EXPIRATION_IN_MIN) {
        // Clear old session id to start a new session
        sessionData = null
      } else {
        // Update timestamp to keep session alive
        sessionData.timestamp = currentTimeInMs
        await chrome.storage.session.set({ sessionData })
      }
    }
    if (!sessionData) {
      // Create and store a new session
      sessionData = {
        session_id: currentTimeInMs.toString(),
        timestamp: currentTimeInMs.toString()
      }
      await chrome.storage.session.set({ sessionData })
    }
    return sessionData.session_id
  }

  // Fires an event with optional params. Event names must only include letters and underscores.
  async fireEvent(name, params = {}) {
    const ua = await getUserAgent()

    if (isDevRuntime()) {
      console.log("fireEvent on dev", name, params)
      return
    }

    // Configure session id and engagement time if not present, for more details see:
    // https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events?client_type=gtag#recommended_parameters_for_reports
    if (!params.session_id) {
      params.session_id = await this.getOrCreateSessionId()
    }
    if (!params.engagement_time_msec) {
      params.engagement_time_msec = DEFAULT_ENGAGEMENT_TIME_MSEC
    }

    let GAGA_ENDPOINT = this.debug ? GA_DEBUG_ENDPOINT : GA_ENDPOINT
    if (!GAGA_ENDPOINT || !MEASUREMENT_ID || !API_SECRET) {
      console.error("Google Analytics GA params null")
      return
    }

    try {
      const response = await fetch(
        `${GAGA_ENDPOINT}?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`,
        {
          method: "POST",
          headers: { "User-Agent": ua },
          body: JSON.stringify({
            client_id: await this.getOrCreateClientId(),
            visitorId: this.visitorId,
            events: [
              {
                name,
                params
              }
            ]
          })
        }
      )
      if (!this.debug) {
        return
      }
      console.log(await response.text())
    } catch (e) {
      console.error("Google Analytics request failed with an exception", e)
    }
  }

  // Fire a page view event.
  async firePageViewEvent(pageTitle, pageLocation, additionalParams = {}) {
    return this.fireEvent("page_view", {
      page_title: pageTitle,
      page_location: pageLocation,
      ...additionalParams
    })
  }

  // Fire an error event.
  async fireErrorEvent(error, additionalParams = {}) {
    // Note: 'error' is a reserved event name and cannot be used
    // see https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference?client_type=gtag#reserved_names
    return this.fireEvent("extension_error", {
      ...error,
      ...additionalParams
    })
  }
}

const analytics = new Analytics()
export { analytics }
export default analytics
