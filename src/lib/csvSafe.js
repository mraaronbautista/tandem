// Spreadsheet-safe text for CSV exports.
//
// A cell that starts with = + - or @ can be read as a formula when the CSV
// is opened in Excel or Sheets, so such text gets a leading apostrophe,
// which keeps it literal. Two cases must NOT be changed, because the
// apostrophe would corrupt real data without making anything safer:
//   * plain numbers and phone numbers ("-87.65", "+1 (555) 010-1234"):
//     only digits, spaces, dots, parentheses and hyphens, so there is
//     nothing in them a formula could call;
//   * values the caller marks `exact` (a password or username in a Vault
//     export): that file exists so the values can be moved elsewhere, and a
//     password that happens to start with = + - or @ must come out exactly
//     as stored.
const PLAIN_NUMBER_OR_PHONE = /^[+-]?[\d\s().-]*\d[\d\s().-]*$/

export function formulaSafeText(value, { exact = false } = {}) {
  const text = String(value ?? '')
  if (exact) return text
  if (!/^\s*[=+\-@]/.test(text)) return text
  if (PLAIN_NUMBER_OR_PHONE.test(text.trim())) return text
  return `'${text}`
}
