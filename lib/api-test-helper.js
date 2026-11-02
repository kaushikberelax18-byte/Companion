'use strict';
/* Test helper for API error handling tests */

class ApiError extends Error {
  constructor(status, kind, message) {
    super(message);
    this.status = status;
    this.kind = kind;
  }
}

module.exports = { ApiError };
