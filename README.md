# App Copier

**[Download App Copier (app-copier-1.0.0.xml.zip)](https://raw.githubusercontent.com/arizzi74/App-Copier/main/app-copier-1.0.0.xml.zip)**

## What it does

App Copier is a small tool for ServiceNow that lets you copy a custom
application from one instance to another — for example, from a development
instance to a test instance, or between two demo instances — without
rebuilding or reinstalling it from scratch.

It adds a single page to your instance where you pick an app, point it at
another instance, and copy it across. Everything runs from your browser; no
extra software is needed once it's installed.

## Installing it

1. Download the file linked at the top of this page.
2. Unzip it — you'll get `app-copier-1.0.0.xml`.
3. In the ServiceNow instance where you want to use App Copier, go to
   **System Update Sets → Import Update Set from XML**, upload the file, then
   **Preview** and **Commit** it.
4. Open the tool from the navigator: **All → App Copier → Copy application**,
   or go directly to `https://<your-instance>.service-now.com/x_snc_appcopy_copier.do`.

You'll need admin access on the instance to install and use it.

## Using it

- **Copy** — pick the app you want to copy, enter the target instance's URL
  and login details, and start the copy. Files are added or updated on the
  target; nothing is removed unless you turn on Mirror.
- **Mirror** — makes the target an exact match of the source, including
  removing anything on the target that isn't in the source. You'll always see
  what's about to be removed and have to confirm before anything happens.
- **Exclusions** — some folders (like `node_modules`) are skipped by default
  since they're not needed on the target. You can exclude more, or include
  them back, before copying.
- **Create a new app** — instead of copying into an app that already exists on
  the target, you can create a fresh copy under a new name.

## Good to know

- The copy happens directly between your browser and the two instances —
  nothing is sent anywhere else.
- If a copy is interrupted partway through, the target is left as it was; it
  won't be left half-copied or emptied out.

---

Looking to modify or extend App Copier itself? See
[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) for the technical details.
