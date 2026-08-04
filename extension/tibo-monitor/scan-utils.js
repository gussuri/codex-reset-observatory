(function (global) {
  "use strict";

  function selectNewestParsedTweet(current, candidate) {
    if (!candidate || typeof candidate.tweetId !== "string" || candidate.tweetId.length === 0) {
      return current || null;
    }

    const timestamp = new Date(candidate.createdAt).getTime();
    if (!Number.isFinite(timestamp)) return current || null;
    if (current && timestamp <= current.timestamp) return current;

    return {
      tweetId: candidate.tweetId,
      createdAt: new Date(timestamp).toISOString(),
      timestamp,
    };
  }

  global.TiboMonitorScan = {
    selectNewestParsedTweet,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
