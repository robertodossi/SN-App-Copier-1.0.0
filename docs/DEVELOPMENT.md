# App Copier — Developer Notes

A Now SDK application (`x_snc_appcopy`) that adds a UI page for copying a Now SDK
application's file tree from the instance it is installed on to another instance.

It drives the same Glider endpoints the Build Agent CLI `/sync` path uses:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/sn_glider/v2/sync/state` | recursive listing of a URI tree |
| `POST /api/sn_glider/v2/sync/files` | read file blobs (multipart response, parts keyed by SHA-1) |
| `POST /api/sn_glider/v2/sync/changes/apply` | create / update / remove (multipart request) |

Workspaces live at `settings:/users/<user_sys_id>/workspaces/<name>.code-workspace`;
that file's `folders[]` array is the list of applications, each pointing at
`now-file:/<app_sys_id>`.

## Building & installing from source

```bash
now-sdk auth --add https://<instance>.service-now.com --type basic --alias <alias>
now-sdk build
now-sdk install --auth <alias>
```

`now-sdk auth` needs a real TTY. For a non-interactive install the CLI reads
credentials from the environment instead:

```bash
export SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL
export SN_SDK_AUTH_TYPE=basic
export SN_SDK_INSTANCE_URL=https://<instance>.service-now.com
export SN_SDK_USER=... SN_SDK_USER_PWD=...
now-sdk build && now-sdk install
```

Then open it from the navigator — **All → App Copier → Copy application** — or
go straight to `https://<instance>.service-now.com/x_snc_appcopy_copier.do`.

The navigator entry is a `sys_app_application` menu plus a `sys_app_module` with
`link_type: 'DIRECT'` pointing at the page endpoint. Both are restricted to
`admin`, matching what the copy actually requires.

The page script is served as part of the page, so a tab opened before a
reinstall keeps running the old copy. Hard-reload the copier after every
`now-sdk install` or you will be testing the previous build.

## How it works

The browser talks to the **source** instance directly — it is same-origin, so the
session cookie plus the `X-UserToken` header (emitted into the page from
`gs.getSession().getSessionToken()`) is all it needs.

The **target** instance is cross-origin, so every call to it is funnelled through
the app's scripted REST API, which authenticates with the URL/username/password
typed into the form:

| Route | Does |
| --- | --- |
| `POST /api/x_snc_appcopy/appcopy/connect` | verify credentials, list target workspaces |
| `POST /api/x_snc_appcopy/appcopy/state` | proxy `sync/state` |
| `POST /api/x_snc_appcopy/appcopy/read` | proxy `sync/files`, return the raw multipart body |
| `POST /api/x_snc_appcopy/appcopy/create-app` | insert a `sys_app` row on the target |
| `POST /api/x_snc_appcopy/appcopy/buffer` | create a transfer buffer row to attach a payload to |
| `POST /api/x_snc_appcopy/appcopy/apply` | stream a staged multipart `sync/changes/apply` payload |

### Binary safety

`RESTMessageV2.setRequestBody()` takes a JS string, so pushing arbitrary bytes
through it would corrupt them, and `GlideSysAttachment.writeBase64()` — the
documented way to stage bytes server-side — returns null in a scoped app.

So the bytes never enter server-side script at all. The browser assembles the
whole multipart body (it already holds the exact source bytes, and reuses the
source's SHA-1 checksums as the blob part names), uploads it straight to a
transfer buffer row through the platform Attachment API, and hands `/apply` only
the attachment sys_id. The proxy streams it out with
`setRequestBodyFromAttachment()` without ever reading it.

`/apply` refuses any attachment whose `table_name` is not the buffer table —
otherwise the route would forward any attachment a caller can name to any URL.

Reads are the asymmetric case: the only thing ever read *from* the target is a
`.code-workspace` file, which is UTF-8 JSON, so `/read` returns the body as a
string. Application file blobs only ever flow *to* the target.

`x_snc_appcopy_buffer` exists only as an attachment anchor — it holds no data
between calls. Rows and attachments are deleted in a `finally` block, and
`/buffer` also sweeps anything older than an hour so an abandoned copy (closed
tab, dropped connection) cannot leave payloads behind.

## Platform behaviour this had to work around

Each of these was found by testing against a live instance; they are the reason
some of the code looks the way it does.

| Behaviour | Consequence |
| --- | --- |
| A CDATA section inside `<script>` makes a Jelly UI page render as a blank 200 | The page script lives in the `clientScript` field, not in `html`. XML-escaping it instead does not work either — the entities are emitted literally into the JS. |
| `g:evaluate` sets a phase-1 variable | Read it back with `${jvar_x}`; `$[jvar_x]` is phase 2 and silently yields an empty string. |
| `gs.getSessionToken()` is fenced in a scoped app | Use `gs.getSession().getSessionToken()`. The fencing exception aborts the whole page render. |
| `GlideSysAttachment.writeBase64()` returns null in a scoped app | The browser uploads the payload through the platform Attachment API instead; only `write()` works server-side, and it is not binary-safe. |
| The Attachment API rejects `application/octet-stream` | Payloads are uploaded as `text/plain` / `changes.txt`. Stored bytes are unaffected. |
| The instance edge proxy rewrites non-2xx scripted REST responses into a bodiless `405 Not Allowed` | Errors are returned as HTTP 200 with an `{error}` body so the real message reaches the page. |
| Session-authenticated calls to `/api/...` require `X-UserToken` | The page sends `g_ck` on every same-origin request. |

### Copy sequence

1. Resolve or create the destination app (`/create-app`, then register it as a
   folder in the target `.code-workspace` via `/apply`).
2. Read the target's current tree so existing paths go in `update` and new ones
   in `create`.
3. Create the folder entries.
4. Read source blobs and push them in batches of 40 files / 3 MB.

5. Rewrite `now.config.json` so it describes its new home.

By default nothing is deleted on the target: a copy is an overlay, so the target
ends up as the union of both trees with the source winning on any shared path.

## Mirror

Ticking **Mirror** (existing apps only) also deletes target entries so the target
ends up an exact copy of the source. It asks for confirmation first, listing what
will go, and the check runs *before* anything is written — declining leaves the
target untouched and falls back to a plain overlay.

What counts as surplus is compared against the **whole source tree, not the files
being copied**. A folder you excluded still exists on the source, so it is not
something the target has in excess and is left alone. Only paths the source
genuinely does not have are removed. That means with exclusions in play the
target is a mirror of the source *tree*, and the excluded paths keep whatever the
target already had.

Deletion runs after the files have been copied, so a copy that fails halfway
leaves the target with everything it started with rather than emptied for a
transfer that never completed. Entries are removed deepest-first so a folder is
never dropped before its contents.

`now.config.json` is never surplus — it exists in the source — and it is still
retargeted afterwards, so the target keeps its own `scopeId`, `scope` and `name`.
It remains the one file whose content differs after a mirror.

### Retargeting now.config.json

`now.config.json` carries `scopeId`, the sys_id of the application it was written
for. Copied verbatim it still names the *source* app, and `now-sdk install` on
the target fails with:

```
Error during sync Error: No valid scope found for the given scopeName: <source sys_id>
```

The build succeeds first, which makes this look like a build artifact problem —
it is not, the file simply points at an app that does not exist on that instance.

So the last step of every copy rewrites that file with the destination app's
`scopeId`, `scope` and `name`. It is the only file whose content differs between
source and target after a copy.

`package.json`'s `name` field (e.g. `x-snc-groqz-incident-intelligence`) is left
alone — the SDK resolves scope from `now.config.json`, so it does not block an
install, but it will still read as the old scope if you copy into an app with a
different one.

## Creating a new app on the target

"Create a new app" proposes the source application's own name and scope. The
source identity comes from its `sys_app` record; if that record is missing or
unreadable (a workspace folder can outlive its app) it falls back to the app's
`now.config.json`, and finally to a scope derived from the name. Anything typed
into either field is kept as-is and is never overwritten by a later source
change.

Copying to the same instance therefore proposes a scope that already exists;
`/create-app` rejects that with a clear message, so edit the scope first.

## Exclusions

`node_modules` and `dist/app` are excluded by default. Paths are relative to the
app root and exclude the path itself plus everything beneath it. Add more in the
text box, or untick any folder in the tree browser.
