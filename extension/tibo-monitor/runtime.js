(function (global) {
  "use strict";

  function errorMessage(error) {
    if (error && typeof error.message === "string") return error.message;
    return String(error == null ? "" : error);
  }

  function isExtensionContextInvalidated(error) {
    return /extension context invalidated|context invalidated|chrome\.runtime(?:\.sendMessage)?[^\n]*(?:unavailable|undefined)|reading ['"]sendMessage['"]/i.test(
      errorMessage(error),
    );
  }

  function runSafely(task, onError) {
    return Promise.resolve()
      .then(task)
      .catch((error) => {
        try {
          if (typeof onError === "function") onError(error);
        } catch {
          // The old content script must never create another unhandled rejection.
        }
      });
  }

  global.TiboExtensionRuntime = {
    errorMessage,
    isExtensionContextInvalidated,
    runSafely,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
