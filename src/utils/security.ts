// Security Utilities

/**
 * Validates user input to prevent injections or invalid data.
 * @param {any} input - The user input to validate.
 * @returns {boolean} - True if valid, false otherwise.
 */
function validateInput(input) {
    // Simple validation logic (to be expanded)
    return typeof input === 'string' && input.trim() !== '';
}

/**
 * Checks if a token has expired based on a given expiration date.
 * @param {Date} expirationDate - The date to check.
 * @returns {boolean} - True if the token is expired, false otherwise.
 */
function isTokenExpired(expirationDate) {
    return new Date() > expirationDate;
}

/**
 * Sanitizes error messages before sending them to the client.
 * @param {string} errorMessage - The error message to sanitize.
 * @returns {string} - Sanitized error message.
 */
function sanitizeErrorMessage(errorMessage) {
    return errorMessage.replace(/<script.*?>.*?<\/script>/gi, ''); // naive example
}

module.exports = { validateInput, isTokenExpired, sanitizeErrorMessage };