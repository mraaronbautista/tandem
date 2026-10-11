/**
 * Tandem: issue photo back-up. Paste this whole file into a new Google Apps
 * Script project (script.google.com), then follow apps-script/README.md.
 *
 * What it does: receives one photo (or the report.txt beside it) from Tandem
 * and files it in your Drive folder as
 *   {your folder} / {location} / {unit} / {date and short description} / photo 1.jpg
 *
 * What it cannot do, by design:
 *   - It never deletes, renames or overwrites anything.
 *   - It only writes inside the one folder you give it (FOLDER_ID).
 *   - It only creates files named "photo N.jpg" or "report.txt".
 *   - It ignores any request that does not carry the shared password (TOKEN).
 *
 * The two settings live in Project Settings > Script properties, not in this
 * file: TOKEN (a long random password you make up) and FOLDER_ID (the id of
 * the Drive folder, the long text after /folders/ in its address).
 */

var MAX_BYTES = 8 * 1024 * 1024;
var FILE_NAME_PATTERN = /^(photo [0-9]{1,4}\.jpg|report\.txt)$/;

// Run this once from the editor (Run > authorize) so Google asks you to allow
// the script to use your Drive. It changes nothing.
function authorize() {
  var folderId = PropertiesService.getScriptProperties().getProperty('FOLDER_ID');
  return DriveApp.getFolderById(folderId).getName();
}

// Opening the web address in a browser only says the script is alive.
function doGet() {
  return json_({ ok: true, service: 'tandem-issue-photo-backup' });
}

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('TOKEN');
    var folderId = props.getProperty('FOLDER_ID');
    if (!token || !folderId) return json_({ ok: false, error: 'not_configured' });

    var body = JSON.parse(e.postData.contents);
    if (!sameText_(String(body.token || ''), token)) return json_({ ok: false, error: 'unauthorized' });

    var path = body.path;
    if (!Array.isArray(path) || path.length < 1 || path.length > 4) return json_({ ok: false, error: 'bad_request', message: 'path' });
    var cleanPath = [];
    for (var i = 0; i < path.length; i++) {
      var part = cleanName_(path[i]);
      if (!part) return json_({ ok: false, error: 'bad_request', message: 'path' });
      cleanPath.push(part);
    }
    var fileName = String(body.fileName || '');
    if (!FILE_NAME_PATTERN.test(fileName)) return json_({ ok: false, error: 'bad_request', message: 'file name' });

    var bytes = Utilities.base64Decode(String(body.dataBase64 || ''));
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return json_({ ok: false, error: 'bad_request', message: 'size' });

    var folder = ensurePath_(DriveApp.getFolderById(folderId), cleanPath);

    // report.txt beside the photos, written once.
    var text = typeof body.reportText === 'string' ? body.reportText.slice(0, 4000) : '';
    if (text && !folder.getFilesByName('report.txt').hasNext()) {
      folder.createFile('report.txt', text, MimeType.PLAIN_TEXT);
    }

    // A photo that is already there (a retry) is not written again; its real
    // size is returned so Tandem can still check it.
    var existing = folder.getFilesByName(fileName);
    var file = existing.hasNext()
      ? existing.next()
      : folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', fileName));

    return json_({ ok: true, fileId: file.getId(), size: file.getSize(), name: fileName, folderUrl: folder.getUrl() });
  } catch (err) {
    return json_({ ok: false, error: 'failed', message: String((err && err.message) || err).slice(0, 200) });
  }
}

function ensurePath_(root, parts) {
  var folder = root;
  for (var i = 0; i < parts.length; i++) {
    var found = folder.getFoldersByName(parts[i]);
    folder = found.hasNext() ? found.next() : folder.createFolder(parts[i]);
  }
  return folder;
}

// Folder names: no slashes or other path characters, no leading dots.
function cleanName_(value) {
  var name = String(value || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/(^| )\.+(?= |$)/g, ' ').trim().replace(/^\.+/, '').trim();
  return name.length > 80 ? name.slice(0, 80).trim() : name;
}

// Compares without stopping at the first different character.
function sameText_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json_(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}
