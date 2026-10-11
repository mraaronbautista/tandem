# Google Drive back-up for issue photos

Tandem keeps the house manager's issue photos in its own storage (1 GB on the
free plan). **Settings > Issue photos** copies them to your Google Drive through
a small script that runs on your Google account, then lets an admin remove the
backed-up photos of finished issues from Tandem.

You do this once, in about ten minutes. Nothing here needs a password to be
pasted into a chat: the two private values go straight into your own terminal.

## 1. Make the Drive folder

1. In Google Drive, create a folder, for example **Tandem issue photos**.
2. Open it. In the address bar, copy the long text after `/folders/`
   (`https://drive.google.com/drive/folders/THIS-PART`). That is the folder id.

## 2. Make the script

1. Go to <https://script.google.com> and choose **New project**. Name it
   "Tandem issue photo back-up".
2. Delete the sample code, paste in the whole of `issue-photo-backup.gs`, and save.
3. Open **Project Settings** (the gear), then **Script properties**, and add two:
   - `FOLDER_ID` = the folder id from step 1
   - `TOKEN` = a long random password you make up (30+ characters). Keep a copy
     somewhere private; you need it again in step 4.
4. Back in the editor, pick the function **authorize** and press **Run**. Google
   asks you to allow the script to use your Drive; allow it. (It only reads the
   name of your folder.)

## 3. Publish it

1. **Deploy > New deployment**, type **Web app**.
2. **Execute as:** Me. **Who has access:** Anyone. (The password in `TOKEN`
   is what protects it; without it the script ignores a request.)
3. **Deploy**, then copy the **Web app URL** (it ends in `/exec`).
4. Optional check: open that URL in a browser. You should see
   `{"ok":true,"service":"tandem-issue-photo-backup"}`.

## 4. Give Tandem the address and the password

In a terminal on your computer, in the Tandem project folder (use your own
values; do not paste them into a chat):

```bash
supabase secrets set DRIVE_BACKUP_URL='https://script.google.com/macros/s/.../exec' DRIVE_BACKUP_TOKEN='your-token'
```

Then deploy the function (an AI session may do this step for you; it never sees
the values):

```bash
supabase functions deploy issue-photo-backup --no-verify-jwt
```

## 5. Use it

Settings > Issue photos > **Back up to Google Drive**. Keep the screen open
until it finishes. Photos land in your folder as
`{location} / {unit} / {date and short description} / photo 1.jpg`, with a
`report.txt` beside them. Backing up again never makes duplicates.

**Remove from Tandem** (admins only) deletes only photos that were checked in
Drive and whose issue is done. It asks you to confirm first.

## If you change the script later

Edit it, then **Deploy > Manage deployments > Edit > New version**. The web app
address stays the same.
