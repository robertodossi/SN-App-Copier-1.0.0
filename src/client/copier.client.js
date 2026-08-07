(function () {
    'use strict'

    var CTX = window.APPCOPY_CTX || {}
    var API = '/api/x_snc_appcopy/appcopy'
    var GLIDER = '/api/sn_glider/v2'
    var DEFAULT_EXCLUDES = ['node_modules', 'dist/app']
    var MAX_BATCH_FILES = 40
    var MAX_BATCH_BYTES = 3 * 1024 * 1024

    var state = {
        src: {
            workspaces: [],
            workspaceUri: '',
            apps: [],
            appId: '',
            appName: '',
            appScope: '',
            entries: [],
            tree: null,
            collapsed: {}
        },
        excludes: DEFAULT_EXCLUDES.slice(),
        tgt: {
            connected: false,
            workspaces: [],
            workspace: null,
            workspaceJson: null,
            apps: [],
            appId: '',
            appName: '',
            mode: 'existing'
        },
        busy: false
    }

    document.body.className = (document.body.className + ' appcopy').trim()

    // ------------------------------------------------------------- utils

    function el(id) { return document.getElementById(id) }

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
    }

    function bytes(n) {
        n = Number(n) || 0
        if (n < 1024) return n + ' B'
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
        return (n / (1024 * 1024)).toFixed(2) + ' MB'
    }

    function note(id, kind, message) {
        var box = el(id)
        if (!message) { box.className = 'ac-note ac-hide'; box.textContent = ''; return }
        box.className = 'ac-note ac-' + kind
        box.textContent = message
    }

    function errorText(error) {
        if (!error) return 'unknown error'
        return error.message ? error.message : String(error)
    }

    // ------------------------------------------------ source instance IO

    function gliderHeaders(extra) {
        var headers = { 'X-UserToken': CTX.token || window.g_ck || '' }
        for (var key in extra) { if (extra.hasOwnProperty(key)) headers[key] = extra[key] }
        return headers
    }

    function sourceState(uris) {
        return fetch(GLIDER + '/sync/state', {
            method: 'POST',
            credentials: 'same-origin',
            headers: gliderHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
            body: JSON.stringify({ uris: uris })
        }).then(function (res) {
            if (!res.ok) {
                return res.text().then(function (body) {
                    throw new Error('sync/state failed (HTTP ' + res.status + '): ' + body.slice(0, 300))
                })
            }
            return res.json()
        })
    }

    function sourceFiles(uris) {
        var form = new FormData()
        form.append('uris', new Blob([JSON.stringify(uris)], { type: 'application/octet-stream' }), 'blob')
        return fetch(GLIDER + '/sync/files', {
            method: 'POST',
            credentials: 'same-origin',
            headers: gliderHeaders({}),
            body: form
        }).then(function (res) {
            if (!res.ok) {
                return res.text().then(function (body) {
                    throw new Error('sync/files failed (HTTP ' + res.status + '): ' + body.slice(0, 300))
                })
            }
            var type = res.headers.get('Content-Type') || ''
            return res.arrayBuffer().then(function (buffer) {
                return parseMultipart(new Uint8Array(buffer), type)
            })
        })
    }

    // ------------------------------------------------ target instance IO

    function target() {
        return {
            url: el('ac-tgt-url').value.trim(),
            user: el('ac-tgt-user').value.trim(),
            pass: el('ac-tgt-pass').value
        }
    }

    function call(path, payload) {
        payload.target = payload.target || target()
        return fetch(API + path, {
            method: 'POST',
            credentials: 'same-origin',
            headers: gliderHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
            body: JSON.stringify(payload)
        }).then(function (res) {
            return res.text().then(function (text) {
                var parsed = null
                try { parsed = text ? JSON.parse(text) : null } catch (ignored) { parsed = null }
                var payloadOut = parsed && parsed.result !== undefined ? parsed.result : parsed
                if (!res.ok) {
                    var detail = (payloadOut && payloadOut.error) || (parsed && parsed.error && parsed.error.message) || text.slice(0, 300)
                    throw new Error(detail || ('HTTP ' + res.status))
                }
                if (payloadOut && payloadOut.error) throw new Error(payloadOut.error)
                return payloadOut
            })
        })
    }

    // -------------------------------------------------- multipart codecs

    function stringBytes(text) {
        var out = []
        for (var i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 0xff)
        return new Uint8Array(out)
    }

    function latin1(view) {
        var out = ''
        for (var i = 0; i < view.length; i++) out += String.fromCharCode(view[i])
        return out
    }

    function indexOfBytes(hay, needle, from) {
        var limit = hay.length - needle.length
        for (var i = from; i <= limit; i++) {
            var hit = true
            for (var j = 0; j < needle.length; j++) {
                if (hay[i + j] !== needle[j]) { hit = false; break }
            }
            if (hit) return i
        }
        return -1
    }

    function parseMultipart(view, contentType) {
        var out = {}
        var match = /boundary=("?)([^;"\s]+)\1/i.exec(contentType || '')
        if (!match) return out
        var delim = stringBytes('--' + match[2])
        var blank = stringBytes('\r\n\r\n')
        var pos = indexOfBytes(view, delim, 0)
        while (pos >= 0) {
            var next = indexOfBytes(view, delim, pos + delim.length)
            var part = view.subarray(pos + delim.length, next < 0 ? view.length : next)
            var split = indexOfBytes(part, blank, 0)
            if (split >= 0) {
                var name = /name="([^"]*)"/i.exec(latin1(part.subarray(0, split)))
                if (name) {
                    var content = part.subarray(split + blank.length)
                    var end = content.length
                    if (end >= 2 && content[end - 2] === 13 && content[end - 1] === 10) end -= 2
                    out[name[1]] = content.subarray(0, end)
                }
            }
            if (next < 0) break
            pos = next
        }
        return out
    }

    function buildMultipart(boundary, jsonParts, blobs) {
        var chunks = []
        var name
        for (name in jsonParts) {
            if (!jsonParts.hasOwnProperty(name)) continue
            chunks.push(
                '--' + boundary + '\r\n' +
                'Content-Disposition: form-data; name="' + name + '"; filename="blob"\r\n' +
                'Content-Type: application/json\r\n\r\n'
            )
            chunks.push(JSON.stringify(jsonParts[name]))
            chunks.push('\r\n')
        }
        for (var i = 0; i < blobs.length; i++) {
            chunks.push(
                '--' + boundary + '\r\n' +
                'Content-Disposition: form-data; name="' + blobs[i].name + '"; filename="' + blobs[i].name + '"\r\n' +
                'Content-Type: application/octet-stream\r\n\r\n'
            )
            chunks.push(blobs[i].content)
            chunks.push('\r\n')
        }
        chunks.push('--' + boundary + '--\r\n')
        return new Blob(chunks)
    }

    function newBoundary() {
        return '----appcopy' + Date.now().toString(16) + Math.floor(Math.random() * 1e9).toString(16)
    }

    function sha1Hex(view) {
        return crypto.subtle.digest('SHA-1', view).then(function (digest) {
            var out = ''
            var raw = new Uint8Array(digest)
            for (var i = 0; i < raw.length; i++) out += ('0' + raw[i].toString(16)).slice(-2)
            return out
        })
    }

    function utf8(text) { return new TextEncoder().encode(text) }

    // -------------------------------------------------- workspace parsing

    function workspacesFromState(payload, userId) {
        var files = (payload && payload.files) || []
        var out = []
        for (var i = 0; i < files.length; i++) {
            var entry = files[i] || {}
            if (String(entry.type || '').toLowerCase() !== 'file' || entry.dtime) continue
            var uri = String(entry.uri || '')
            if (uri.indexOf('/workspaces/') < 0 || uri.slice(-15) !== '.code-workspace') continue
            var name = uri.slice(uri.lastIndexOf('/') + 1, -15)
            try { name = decodeURIComponent(name) } catch (ignored) { /* keep raw */ }
            out.push({
                name: name,
                uri: uri,
                checksum: String(entry.checksum || ''),
                createdAt: String(entry.ctime || ''),
                updatedAt: String(entry.mtime || '')
            })
        }
        out.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1 })
        return out
    }

    function appsFromWorkspaceJson(doc) {
        var folders = (doc && doc.folders) || []
        var out = []
        for (var i = 0; i < folders.length; i++) {
            var folder = folders[i] || {}
            var uri = String(folder.uri || folder.path || '')
            if (uri.indexOf('now-file:') !== 0) continue
            var sysId = uri.replace(/^now-file:/, '').replace(/^\/+/, '').split(/[?#]/)[0]
            if (!sysId) continue
            out.push({ name: String(folder.name || sysId), sysId: sysId, uri: uri })
        }
        return out
    }

    function decodeText(view) {
        return new TextDecoder('utf-8').decode(view)
    }

    // --------------------------------------------------------- exclusions

    function isExcluded(relative) {
        for (var i = 0; i < state.excludes.length; i++) {
            var prefix = state.excludes[i]
            if (relative === prefix || relative.indexOf(prefix + '/') === 0) return true
        }
        return false
    }

    function addExclude(raw) {
        var value = String(raw || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
        if (!value) return
        if (state.excludes.indexOf(value) < 0) state.excludes.push(value)
        renderSource()
    }

    function removeExclude(value) {
        var at = state.excludes.indexOf(value)
        if (at >= 0) state.excludes.splice(at, 1)
        renderSource()
    }

    // ------------------------------------------------------- source model

    function entriesToTree(entries) {
        var root = { name: '', path: '', type: 'dir', size: 0, children: {} }
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i]
            var parts = entry.path.split('/')
            var node = root
            for (var p = 0; p < parts.length; p++) {
                var last = p === parts.length - 1
                var key = parts[p]
                if (!node.children[key]) {
                    node.children[key] = {
                        name: key,
                        path: parts.slice(0, p + 1).join('/'),
                        type: last ? entry.type : 'dir',
                        size: last ? entry.size : 0,
                        children: {}
                    }
                } else if (last && entry.type === 'file') {
                    node.children[key].type = 'file'
                    node.children[key].size = entry.size
                }
                node = node.children[key]
            }
        }
        return root
    }

    function sortedChildren(node) {
        var out = []
        for (var key in node.children) { if (node.children.hasOwnProperty(key)) out.push(node.children[key]) }
        out.sort(function (a, b) {
            var da = a.type === 'dir', db = b.type === 'dir'
            if (da !== db) return da ? -1 : 1
            return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1
        })
        return out
    }

    function includedFiles() {
        var out = []
        for (var i = 0; i < state.src.entries.length; i++) {
            var entry = state.src.entries[i]
            if (entry.type === 'file' && !isExcluded(entry.path)) out.push(entry)
        }
        return out
    }

    function includedDirs() {
        var out = []
        for (var i = 0; i < state.src.entries.length; i++) {
            var entry = state.src.entries[i]
            if (entry.type === 'dir' && !isExcluded(entry.path)) out.push(entry.path)
        }
        return out
    }

    // ---------------------------------------------------------- rendering

    function renderStats() {
        var files = 0, dirs = 0, total = 0
        var keptFiles = 0, keptBytes = 0
        var byExt = {}
        for (var i = 0; i < state.src.entries.length; i++) {
            var entry = state.src.entries[i]
            if (entry.type === 'dir') { dirs++; continue }
            files++
            total += entry.size
            if (!isExcluded(entry.path)) {
                keptFiles++
                keptBytes += entry.size
                var dot = entry.name.lastIndexOf('.')
                var ext = dot > 0 ? entry.name.slice(dot) : '(none)'
                byExt[ext] = (byExt[ext] || 0) + 1
            }
        }
        var tops = []
        for (var ext in byExt) { if (byExt.hasOwnProperty(ext)) tops.push([ext, byExt[ext]]) }
        tops.sort(function (a, b) { return b[1] - a[1] })
        var topText = tops.slice(0, 4).map(function (pair) { return pair[0] + ' ' + pair[1] }).join(', ') || '—'

        el('ac-src-stats').innerHTML =
            stat(files, 'files') +
            stat(dirs, 'folders') +
            stat(bytes(total), 'total size') +
            stat(keptFiles, 'files to copy', 'ac-keep') +
            stat(bytes(keptBytes), 'bytes to copy', 'ac-keep') +
            stat(files - keptFiles, 'excluded', 'ac-drop') +
            '<div class="ac-stat"><b style="font-size:13px">' + esc(topText) + '</b><span>top types</span></div>'
    }

    function stat(value, label, extra) {
        return '<div class="ac-stat ' + (extra || '') + '"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>'
    }

    function renderChips() {
        var html = state.excludes.map(function (value) {
            return '<span class="ac-chip">' + esc(value) +
                '<button type="button" data-remove="' + esc(value) + '" title="Stop excluding">&#215;</button></span>'
        }).join('')
        el('ac-src-chips').innerHTML = html || '<span class="ac-muted">Nothing excluded — every file will be copied.</span>'
    }

    function renderTree() {
        var lines = []
        var children = sortedChildren(state.src.tree)
        for (var i = 0; i < children.length; i++) renderNode(children[i], 0, false, lines)
        el('ac-src-tree').innerHTML = lines.join('') || '<div class="ac-node"><span class="ac-muted">This application has no files.</span></div>'
    }

    function renderNode(node, depth, parentExcluded, lines) {
        var excluded = parentExcluded || isExcluded(node.path)
        var isDir = node.type === 'dir'
        var collapsed = state.src.collapsed[node.path]
        var pad = 10 + depth * 16

        lines.push(
            '<div class="ac-node ' + (isDir ? 'ac-dir' : '') + (excluded ? ' ac-excluded' : '') + '" style="padding-left:' + pad + 'px">' +
            (isDir
                ? '<span class="ac-twist" data-toggle="' + esc(node.path) + '">' + (collapsed ? '&#9656;' : '&#9662;') + '</span>'
                : '<span class="ac-twist"></span>') +
            '<input type="checkbox" data-include="' + esc(node.path) + '"' + (excluded ? '' : ' checked="checked"') +
            (parentExcluded ? ' disabled="disabled"' : '') + ' title="Include in the copy" />' +
            '<span class="ac-name">' + esc(node.name) + (isDir ? '/' : '') + '</span>' +
            (isDir ? '' : '<span class="ac-size">' + esc(bytes(node.size)) + '</span>') +
            '</div>'
        )

        if (isDir && !collapsed) {
            var children = sortedChildren(node)
            for (var i = 0; i < children.length; i++) renderNode(children[i], depth + 1, excluded, lines)
        }
    }

    function renderSource() {
        if (!state.src.appId) { el('ac-src-detail').className = 'ac-hide'; renderSummary(); return }
        el('ac-src-detail').className = ''
        renderStats()
        renderChips()
        renderTree()
        renderSummary()
    }

    function renderSummary() {
        var button = el('ac-copy-run')
        var box = el('ac-copy-summary')
        if (state.busy) return

        if (!state.src.appId) {
            box.className = 'ac-note ac-info'
            box.textContent = 'Pick a source application and a target destination.'
            button.disabled = true
            return
        }
        var files = includedFiles()
        var totalBytes = files.reduce(function (sum, entry) { return sum + entry.size }, 0)
        var destination = destinationLabel()
        if (!destination) {
            box.className = 'ac-note ac-info'
            box.textContent = files.length + ' files (' + bytes(totalBytes) + ') ready from "' + state.src.appName + '". Now choose a target.'
            button.disabled = true
            return
        }
        box.className = 'ac-note ac-info'
        box.textContent = 'Copy ' + files.length + ' files (' + bytes(totalBytes) + ') from "' + state.src.appName +
            '" to ' + destination + '.' +
            (mirrorEnabled() ? ' Files on the target that do not exist in the source will be deleted.' : '')
        button.disabled = files.length === 0
    }

    function destinationLabel() {
        if (!state.tgt.connected || !state.tgt.workspace) return ''
        var host = el('ac-tgt-url').value.trim()
        if (state.tgt.mode === 'new') {
            var name = el('ac-new-name').value.trim()
            var scope = el('ac-new-scope').value.trim()
            if (!name || !scope) return ''
            return 'a new app "' + name + '" (' + scope + ') in workspace "' + state.tgt.workspace.name + '" on ' + host
        }
        if (!state.tgt.appId) return ''
        return '"' + state.tgt.appName + '" in workspace "' + state.tgt.workspace.name + '" on ' + host
    }

    // ------------------------------------------------------------ logging

    function logReset() {
        el('ac-copy-log').className = 'ac-log'
        el('ac-copy-log').innerHTML = ''
        el('ac-copy-bar').className = 'ac-bar'
        el('ac-copy-bar').firstChild.style.width = '0%'
    }

    function log(message, kind) {
        var line = document.createElement('div')
        if (kind) line.className = 'ac-l-' + kind
        line.textContent = message
        var box = el('ac-copy-log')
        box.appendChild(line)
        box.scrollTop = box.scrollHeight
    }

    function progress(done, total) {
        el('ac-copy-bar').firstChild.style.width = (total ? Math.round((done / total) * 100) : 0) + '%'
    }

    // ------------------------------------------------------ source loading

    function loadSourceWorkspaces() {
        note('ac-src-note', '', '')
        var picker = el('ac-src-ws')
        picker.innerHTML = '<option value="">Loading…</option>'
        return sourceState(['settings:/users/' + CTX.userId])
            .then(function (payload) {
                state.src.workspaces = workspacesFromState(payload, CTX.userId)
                if (!state.src.workspaces.length) {
                    picker.innerHTML = '<option value="">No workspaces found</option>'
                    note('ac-src-note', 'err', 'No Glider workspaces exist for your user on this instance.')
                    return
                }
                picker.innerHTML = '<option value="">Select…</option>' + state.src.workspaces.map(function (ws) {
                    return '<option value="' + esc(ws.uri) + '">' + esc(ws.name) + '</option>'
                }).join('')
            })
            .catch(function (error) {
                picker.innerHTML = '<option value="">Unavailable</option>'
                note('ac-src-note', 'err', 'Could not list workspaces: ' + errorText(error))
            })
    }

    function loadSourceApps(uri) {
        var picker = el('ac-src-app')
        picker.disabled = true
        picker.innerHTML = '<option value="">Loading…</option>'
        state.src.appId = ''
        renderSource()
        if (!uri) {
            picker.innerHTML = '<option value="">Select a workspace first</option>'
            return Promise.resolve()
        }
        return sourceFiles([uri])
            .then(function (parts) {
                var content = null
                for (var key in parts) { if (parts.hasOwnProperty(key) && key !== 'uris') { content = parts[key]; break } }
                if (!content) throw new Error('the workspace file came back empty')
                var doc = JSON.parse(decodeText(content))
                state.src.apps = appsFromWorkspaceJson(doc)
                if (!state.src.apps.length) {
                    picker.innerHTML = '<option value="">No applications in this workspace</option>'
                    return
                }
                picker.disabled = false
                picker.innerHTML = '<option value="">Select…</option>' + state.src.apps.map(function (app) {
                    return '<option value="' + esc(app.sysId) + '">' + esc(app.name) + '</option>'
                }).join('')
            })
            .catch(function (error) {
                picker.innerHTML = '<option value="">Unavailable</option>'
                note('ac-src-note', 'err', 'Could not read the workspace: ' + errorText(error))
            })
    }

    function loadSourceTree(sysId) {
        state.src.entries = []
        state.src.appId = ''
        renderSource()
        if (!sysId) return Promise.resolve()

        note('ac-src-note', 'info', 'Reading the application file tree…')
        var root = 'now-file:/' + sysId
        return sourceState([root])
            .then(function (payload) {
                var files = (payload && payload.files) || []
                var entries = []
                for (var i = 0; i < files.length; i++) {
                    var entry = files[i] || {}
                    if (entry.dtime) continue
                    var uri = String(entry.uri || '')
                    if (uri.indexOf(root + '/') !== 0) continue
                    var path = uri.slice(root.length + 1)
                    if (!path) continue
                    entries.push({
                        path: path,
                        name: path.slice(path.lastIndexOf('/') + 1),
                        uri: uri,
                        type: String(entry.type || 'file').toLowerCase() === 'dir' ? 'dir' : 'file',
                        size: parseInt(entry.size, 10) || 0,
                        checksum: String(entry.checksum || ''),
                        createdAt: String(entry.ctime || ''),
                        updatedAt: String(entry.mtime || '')
                    })
                }
                state.src.entries = entries
                state.src.appId = sysId
                var match = state.src.apps.filter(function (app) { return app.sysId === sysId })[0]
                state.src.appName = match ? match.name : sysId
                state.src.appScope = ''
                state.src.tree = entriesToTree(entries)
                state.src.collapsed = {}
                note('ac-src-note', '', '')
                renderSource()
                return resolveSourceIdentity(sysId).then(applySourceDefaults)
            })
            .catch(function (error) {
                note('ac-src-note', 'err', 'Could not read the application: ' + errorText(error))
            })
    }

    /**
     * Work out what the source application is really called and scoped as, so
     * "create a new app" can propose the same. The workspace folder only
     * carries a display label, which is not necessarily the app name and never
     * the scope.
     *
     * sys_app is authoritative; now.config.json is the fallback for apps whose
     * record is missing or unreadable (a workspace can outlive its app).
     */
    function resolveSourceIdentity(sysId) {
        return fetch(
            '/api/now/table/sys_app/' + encodeURIComponent(sysId) + '?sysparm_fields=name,scope',
            {
                method: 'GET',
                credentials: 'same-origin',
                headers: gliderHeaders({ Accept: 'application/json' })
            }
        )
            .then(function (res) {
                if (!res.ok) return null
                return res.json().then(function (payload) {
                    return (payload && payload.result) || null
                })
            })
            .catch(function () { return null })
            .then(function (record) {
                if (record && record.scope) {
                    return { name: String(record.name || ''), scope: String(record.scope) }
                }
                return sourceNowConfig(sysId)
            })
            .catch(function () { return null })
    }

    function sourceNowConfig(sysId) {
        var config = state.src.entries.filter(function (entry) {
            return entry.type === 'file' && entry.path === 'now.config.json'
        })[0]
        if (!config) return null
        return sourceFiles([config.uri])
            .then(function (parts) {
                var content = parts[config.checksum]
                if (!content) return null
                var doc = JSON.parse(decodeText(content))
                if (!doc || !doc.scope) return null
                return { name: String(doc.name || ''), scope: String(doc.scope) }
            })
            .catch(function () { return null })
    }

    /**
     * Seed the "create a new app" fields from the source app. Anything the user
     * has already typed wins — this only ever fills in a proposal.
     */
    function applySourceDefaults(identity) {
        if (identity && identity.scope) {
            state.src.appScope = identity.scope
            if (identity.name) state.src.appName = identity.name
        }
        var nameInput = el('ac-new-name')
        var scopeInput = el('ac-new-scope')
        if (!nameInput.getAttribute('data-touched')) {
            nameInput.value = state.src.appName || ''
        }
        if (!scopeInput.getAttribute('data-touched')) {
            scopeInput.value = state.src.appScope || scopeFromName(nameInput.value)
        }
        renderSummary()
    }

    function scopeFromName(name) {
        var slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
        return slug ? 'x_snc_' + slug.slice(0, 12) : ''
    }

    // ------------------------------------------------------ target loading

    function connectTarget() {
        var creds = target()
        if (!creds.url || !creds.user) {
            note('ac-tgt-note', 'err', 'An instance URL and a username are required.')
            return
        }
        state.tgt.connected = false
        el('ac-tgt-detail').className = 'ac-hide'
        el('ac-tgt-dest').className = 'ac-hide'
        note('ac-tgt-note', 'info', 'Authenticating against ' + creds.url + '…')
        el('ac-tgt-connect').disabled = true

        call('/connect', {})
            .then(function (result) {
                state.tgt.connected = true
                state.tgt.workspaces = result.workspaces || []
                note('ac-tgt-note', 'ok', 'Connected as ' + (result.displayName || result.userName) +
                    ' — ' + state.tgt.workspaces.length + ' workspace(s) available.')
                el('ac-tgt-detail').className = ''
                el('ac-tgt-ws').innerHTML = '<option value="">Select…</option>' + state.tgt.workspaces.map(function (ws, index) {
                    return '<option value="' + index + '">' + esc(ws.name) + '</option>'
                }).join('')
            })
            .catch(function (error) {
                note('ac-tgt-note', 'err', errorText(error))
            })
            .then(function () {
                el('ac-tgt-connect').disabled = false
                renderSummary()
            })
    }

    function loadTargetApps(index) {
        state.tgt.workspace = null
        state.tgt.workspaceJson = null
        state.tgt.appId = ''
        el('ac-tgt-dest').className = 'ac-hide'
        renderSummary()
        if (index === '') return Promise.resolve()

        var workspace = state.tgt.workspaces[Number(index)]
        if (!workspace) return Promise.resolve()
        note('ac-tgt-note', 'info', 'Reading workspace "' + workspace.name + '"…')

        return call('/read', { uris: [workspace.uri] })
            .then(function (result) {
                var parts = parseMultipart(utf8(result.body || ''), result.contentType)
                var content = null
                for (var key in parts) { if (parts.hasOwnProperty(key) && key !== 'uris') { content = parts[key]; break } }
                if (!content) throw new Error('the target workspace file came back empty')
                var doc = JSON.parse(decodeText(content))
                state.tgt.workspace = workspace
                state.tgt.workspaceJson = doc
                state.tgt.apps = appsFromWorkspaceJson(doc)
                el('ac-tgt-app').innerHTML = '<option value="">Select…</option>' + state.tgt.apps.map(function (app) {
                    return '<option value="' + esc(app.sysId) + '">' + esc(app.name) + '</option>'
                }).join('')
                el('ac-tgt-dest').className = ''
                note('ac-tgt-note', 'ok', 'Workspace "' + workspace.name + '" has ' + state.tgt.apps.length + ' application(s).')
                renderSummary()
            })
            .catch(function (error) {
                note('ac-tgt-note', 'err', 'Could not read the target workspace: ' + errorText(error))
            })
    }

    // --------------------------------------------------------- copy engine

    function batchFiles(files) {
        var batches = []
        var current = []
        var size = 0
        for (var i = 0; i < files.length; i++) {
            if (current.length && (current.length >= MAX_BATCH_FILES || size + files[i].size > MAX_BATCH_BYTES)) {
                batches.push(current)
                current = []
                size = 0
            }
            current.push(files[i])
            size += files[i].size
        }
        if (current.length) batches.push(current)
        return batches
    }

    // The payload is uploaded to a transfer buffer row on this instance with
    // the platform Attachment API, then streamed out by the proxy. Going via
    // an attachment keeps the bytes intact: GlideSysAttachment.writeBase64()
    // returns null in a scoped context, and RESTMessageV2.setRequestBody()
    // only takes a string, so neither can carry binary safely.
    function applyChanges(create, update, blobs, remove) {
        var boundary = newBoundary()
        var payload = buildMultipart(boundary, { create: create, update: update, remove: remove || [] }, blobs)
        return call('/buffer', {})
            .then(function (buffer) {
                return uploadPayload(buffer, payload)
            })
            .then(function (attachmentId) {
                return call('/apply', { boundary: boundary, attachmentId: attachmentId })
            })
    }

    function uploadPayload(buffer, payload) {
        var url = '/api/now/attachment/file?table_name=' + encodeURIComponent(buffer.table) +
            '&table_sys_id=' + encodeURIComponent(buffer.sysId) +
            '&file_name=changes.txt'
        // text/plain, not octet-stream: instances reject octet-stream uploads
        // by default ("Invalid file type"). The declared type is metadata only
        // — the bytes are stored and streamed back out verbatim either way.
        return fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: gliderHeaders({ 'Content-Type': 'text/plain', Accept: 'application/json' }),
            body: payload
        }).then(function (res) {
            return res.text().then(function (text) {
                var parsed = null
                try { parsed = text ? JSON.parse(text) : null } catch (ignored) { parsed = null }
                if (!res.ok) {
                    var detail = (parsed && parsed.error && parsed.error.message) || text.slice(0, 300)
                    throw new Error('could not stage the payload (HTTP ' + res.status + '): ' + detail)
                }
                var sysId = parsed && parsed.result && parsed.result.sys_id
                if (!sysId) throw new Error('the attachment API did not return a sys_id')
                return sysId
            })
        })
    }

    function ensureDestinationApp() {
        if (state.tgt.mode !== 'new') {
            // The scope is needed to retarget now.config.json, and the workspace
            // folder only gives a display label — read the real record.
            return call('/app', { sysId: state.tgt.appId }).then(function (record) {
                return {
                    sysId: state.tgt.appId,
                    name: record.name || state.tgt.appName,
                    scope: record.scope || '',
                    created: false
                }
            })
        }
        var name = el('ac-new-name').value.trim()
        var scope = el('ac-new-scope').value.trim()
        log('Creating application "' + name + '" (' + scope + ') on the target…')
        return call('/create-app', { name: name, scope: scope, description: 'Copied from ' + (CTX.host || 'another instance') })
            .then(function (created) {
                log('Created ' + created.name + ' — sys_id ' + created.sysId, 'ok')
                return { sysId: created.sysId, name: created.name, scope: created.scope, created: true }
            })
    }

    function mirrorEnabled() {
        return state.tgt.mode === 'existing' && el('ac-mirror').checked
    }

    /**
     * Everything on the target that has no counterpart in the source app.
     *
     * The comparison is against the *whole* source tree, not just the files
     * being copied: a folder you excluded still exists on the source, so it is
     * not something the target has in excess and is left alone. Only paths the
     * source genuinely does not have are removed.
     */
    function surplusTargetEntries(targetEntries) {
        var inSource = {}
        for (var i = 0; i < state.src.entries.length; i++) {
            inSource[state.src.entries[i].path] = true
        }
        return targetEntries
            .filter(function (entry) { return !inSource[entry.path] })
            // deepest first, so a folder is never removed before its contents
            .sort(function (a, b) { return b.path.split('/').length - a.path.split('/').length })
    }

    function describeSurplus(surplus) {
        var files = surplus.filter(function (e) { return e.type === 'file' }).length
        var dirs = surplus.length - files
        var parts = []
        if (files) parts.push(files + ' file' + (files === 1 ? '' : 's'))
        if (dirs) parts.push(dirs + ' folder' + (dirs === 1 ? '' : 's'))
        return parts.join(' and ')
    }

    /**
     * Delete the surplus so the target ends up matching the source. Runs after
     * the files have been copied: if the copy fails halfway the target keeps
     * everything it had rather than being emptied for a transfer that never
     * completed.
     */
    function mirrorTarget(app, surplus) {
        if (!surplus.length) return Promise.resolve(0)
        log('Mirror: removing ' + describeSurplus(surplus) + ' not present in the source…')

        var now = Date.now()
        var chain = Promise.resolve()
        var removed = 0
        for (var i = 0; i < surplus.length; i += MAX_BATCH_FILES) {
            (function (chunk) {
                chain = chain.then(function () {
                    var remove = chunk.map(function (entry) {
                        var change = {
                            dtime: now,
                            mtime: now,
                            size: entry.size,
                            type: entry.type,
                            uri: 'now-file:/' + app.sysId + '/' + entry.path
                        }
                        if (entry.checksum) change.checksum = entry.checksum
                        return change
                    })
                    return applyChanges([], [], [], remove).then(function () {
                        removed += chunk.length
                    })
                })
            })(surplus.slice(i, i + MAX_BATCH_FILES))
        }
        return chain.then(function () {
            log('Mirror: removed ' + removed + ' entries.', 'ok')
            return removed
        })
    }

    /**
     * now.config.json identifies the application to the SDK, and its `scopeId`
     * is the sys_id of the app it was written for. Copied verbatim it still
     * names the *source* app, and `now-sdk install` on the target fails with
     * "No valid scope found for the given scopeName: <source sys_id>".
     *
     * So the copy is not finished until that file describes its new home.
     */
    function retargetNowConfig(app) {
        var entry = includedFiles().filter(function (file) { return file.path === 'now.config.json' })[0]
        if (!entry) return Promise.resolve(false)

        return sourceFiles([entry.uri]).then(function (parts) {
            var content = parts[entry.checksum]
            if (!content) return false
            var doc
            try {
                doc = JSON.parse(decodeText(content))
            } catch (ignored) {
                log('now.config.json is not valid JSON — left as copied', 'err')
                return false
            }
            var before = JSON.stringify(doc)
            doc.scopeId = app.sysId
            if (app.scope) doc.scope = app.scope
            if (app.name) doc.name = app.name
            if (JSON.stringify(doc) === before) return false

            var text = JSON.stringify(doc, null, 2) + '\n'
            var bytes = utf8(text)
            var now = Date.now()
            return sha1Hex(bytes).then(function (checksum) {
                return applyChanges(
                    [],
                    [{
                        checksum: checksum,
                        ctime: Number(entry.createdAt) || now,
                        mtime: now,
                        size: bytes.length,
                        type: 'file',
                        uri: 'now-file:/' + app.sysId + '/now.config.json'
                    }],
                    [{ name: checksum, content: bytes }]
                ).then(function () {
                    log('Retargeted now.config.json — scopeId ' + app.sysId +
                        (app.scope ? ', scope ' + app.scope : ''), 'ok')
                    return true
                })
            })
        })
    }

    function registerInWorkspace(app) {
        var doc = state.tgt.workspaceJson || {}
        var folders = doc.folders || []
        var uri = 'now-file:/' + app.sysId
        for (var i = 0; i < folders.length; i++) {
            if (String(folders[i].uri || folders[i].path || '') === uri) return Promise.resolve()
        }
        folders.push({ name: app.name, uri: uri })
        doc.folders = folders
        if (!doc.settings) doc.settings = { 'workbench.editor.untitled.hint': 'hidden' }

        var text = JSON.stringify(doc, null, 4)
        var content = utf8(text)
        var workspace = state.tgt.workspace
        var now = Date.now()
        log('Registering the app in workspace "' + workspace.name + '"…')

        return sha1Hex(content).then(function (checksum) {
            var entry = {
                checksum: checksum,
                ctime: Number(workspace.createdAt) || now,
                mtime: now,
                size: content.length,
                type: 'file',
                uri: workspace.uri
            }
            return applyChanges([], [entry], [{ name: checksum, content: content }])
        })
    }

    function copyBatch(app, batch, existing) {
        var uris = batch.map(function (entry) { return entry.uri })
        return sourceFiles(uris).then(function (parts) {
            var create = []
            var update = []
            var blobs = []
            var now = Date.now()
            var seen = {}
            for (var i = 0; i < batch.length; i++) {
                var entry = batch[i]
                var content = parts[entry.checksum]
                if (!content) {
                    log('skipped ' + entry.path + ' — the source returned no content', 'err')
                    continue
                }
                var change = {
                    checksum: entry.checksum,
                    ctime: Number(entry.createdAt) || now,
                    mtime: Number(entry.updatedAt) || now,
                    size: content.length,
                    type: 'file',
                    uri: 'now-file:/' + app.sysId + '/' + entry.path
                }
                if (existing[entry.path]) update.push(change)
                else create.push(change)
                if (!seen[entry.checksum]) {
                    seen[entry.checksum] = true
                    blobs.push({ name: entry.checksum, content: content })
                }
            }
            if (!create.length && !update.length) return 0
            return applyChanges(create, update, blobs).then(function () {
                return create.length + update.length
            })
        })
    }

    function startCopy() {
        var files = includedFiles()
        if (!files.length) return

        state.busy = true
        el('ac-copy-run').disabled = true
        logReset()
        el('ac-copy-summary').className = 'ac-note ac-info'
        el('ac-copy-summary').textContent = 'Copying…'

        var app = null
        var existing = {}
        var targetEntries = []
        var surplus = []
        var copied = 0
        var batches = batchFiles(files)

        ensureDestinationApp()
            .then(function (destination) {
                app = destination
                return app.created ? registerInWorkspace(app) : null
            })
            .then(function () {
                log('Reading the target file tree…')
                return call('/state', { uris: ['now-file:/' + app.sysId] })
            })
            .then(function (payload) {
                var rows = (payload && payload.files) || []
                var prefix = 'now-file:/' + app.sysId + '/'
                for (var i = 0; i < rows.length; i++) {
                    if (rows[i].dtime) continue
                    var uri = String(rows[i].uri || '')
                    if (uri.indexOf(prefix) !== 0) continue
                    var path = uri.slice(prefix.length)
                    if (!path) continue
                    existing[path] = true
                    targetEntries.push({
                        path: path,
                        type: String(rows[i].type || 'file').toLowerCase() === 'dir' ? 'dir' : 'file',
                        size: parseInt(rows[i].size, 10) || 0,
                        checksum: String(rows[i].checksum || '')
                    })
                }
                log('Target already has ' + targetEntries.length + ' entries; matching paths will be updated.')

                // Confirm before anything is written, so declining leaves the
                // target exactly as it was.
                if (mirrorEnabled()) {
                    surplus = surplusTargetEntries(targetEntries)
                    if (!surplus.length) {
                        log('Mirror: nothing on the target is missing from the source.')
                    } else {
                        var sample = surplus.slice(0, 10).map(function (e) {
                            return '  ' + e.path + (e.type === 'dir' ? '/' : '')
                        }).join('\n')
                        var more = surplus.length > 10 ? '\n  …and ' + (surplus.length - 10) + ' more' : ''
                        if (!confirm(
                            'Mirror will permanently delete ' + describeSurplus(surplus) + ' from "' + app.name +
                            '" on ' + el('ac-tgt-url').value.trim() + ':\n\n' + sample + more +
                            '\n\nThis cannot be undone. Continue?'
                        )) {
                            surplus = []
                            log('Mirror cancelled — files will be copied, nothing will be deleted.', 'err')
                        }
                    }
                }

                var dirs = includedDirs()
                if (!dirs.length) return null
                var now = Date.now()
                var create = dirs.filter(function (path) { return !existing[path] }).map(function (path) {
                    return { ctime: now, mtime: now, size: 0, type: 'dir', uri: prefix + path }
                })
                if (!create.length) return null
                log('Creating ' + create.length + ' folders…')
                return applyChanges(create, [], [])
            })
            .then(function () {
                log('Copying ' + files.length + ' files in ' + batches.length + ' batch(es)…')
                var chain = Promise.resolve()
                batches.forEach(function (batch, index) {
                    chain = chain.then(function () {
                        return copyBatch(app, batch, existing).then(function (count) {
                            copied += count
                            progress(index + 1, batches.length)
                            log('batch ' + (index + 1) + '/' + batches.length + ' — ' + count + ' files')
                        })
                    })
                })
                return chain
            })
            .then(function () {
                return mirrorTarget(app, surplus)
            })
            .then(function () {
                return retargetNowConfig(app)
            })
            .then(function () {
                log('Done. ' + copied + ' files copied into "' + app.name + '".', 'ok')
                el('ac-copy-summary').className = 'ac-note ac-ok'
                el('ac-copy-summary').textContent = copied + ' files copied into "' + app.name + '" on ' +
                    el('ac-tgt-url').value.trim() + '.'
                progress(1, 1)
            })
            .catch(function (error) {
                log('FAILED: ' + errorText(error), 'err')
                el('ac-copy-summary').className = 'ac-note ac-err'
                el('ac-copy-summary').textContent = 'Copy failed: ' + errorText(error)
            })
            .then(function () {
                state.busy = false
                el('ac-copy-run').disabled = false
            })
    }

    // ------------------------------------------------------------- wiring

    el('ac-src-host').textContent = CTX.host ? 'this instance: ' + CTX.host : ''

    el('ac-src-ws').addEventListener('change', function () {
        state.src.workspaceUri = this.value
        loadSourceApps(this.value)
    })
    el('ac-src-app').addEventListener('change', function () { loadSourceTree(this.value) })
    el('ac-src-reload').addEventListener('click', function () {
        el('ac-src-app').innerHTML = '<option value="">Select a workspace first</option>'
        el('ac-src-app').disabled = true
        state.src.appId = ''
        renderSource()
        loadSourceWorkspaces()
    })

    el('ac-src-chips').addEventListener('click', function (event) {
        var value = event.target.getAttribute('data-remove')
        if (value) removeExclude(value)
    })
    el('ac-src-exclude-add').addEventListener('click', function () {
        addExclude(el('ac-src-exclude-input').value)
        el('ac-src-exclude-input').value = ''
    })
    el('ac-src-exclude-input').addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); el('ac-src-exclude-add').click() }
    })
    el('ac-src-exclude-reset').addEventListener('click', function () {
        state.excludes = DEFAULT_EXCLUDES.slice()
        renderSource()
    })

    el('ac-src-tree').addEventListener('click', function (event) {
        var toggle = event.target.getAttribute && event.target.getAttribute('data-toggle')
        if (toggle !== null && toggle !== undefined) {
            state.src.collapsed[toggle] = !state.src.collapsed[toggle]
            renderTree()
        }
    })
    el('ac-src-tree').addEventListener('change', function (event) {
        var path = event.target.getAttribute && event.target.getAttribute('data-include')
        if (!path) return
        if (event.target.checked) removeExclude(path)
        else addExclude(path)
    })

    el('ac-tgt-connect').addEventListener('click', connectTarget)
    el('ac-tgt-pass').addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); connectTarget() }
    })
    el('ac-tgt-ws').addEventListener('change', function () { loadTargetApps(this.value) })
    el('ac-tgt-app').addEventListener('change', function () {
        var sysId = this.value
        state.tgt.appId = sysId
        var match = state.tgt.apps.filter(function (app) { return app.sysId === sysId })[0]
        state.tgt.appName = match ? match.name : sysId
        renderSummary()
    })

    var modeInputs = document.getElementsByName('ac-dest-mode')
    for (var m = 0; m < modeInputs.length; m++) {
        modeInputs[m].addEventListener('change', function () {
            state.tgt.mode = this.value
            el('ac-dest-existing').className = this.value === 'existing' ? 'ac-row' : 'ac-row ac-hide'
            el('ac-dest-new').className = this.value === 'new' ? 'ac-row' : 'ac-row ac-hide'
            if (this.value === 'new') applySourceDefaults(null)
            renderSummary()
        })
    }
    el('ac-new-name').addEventListener('input', function () {
        this.setAttribute('data-touched', '1')
        var scope = el('ac-new-scope')
        // Once the name is edited it no longer matches the source app, so the
        // proposed scope should not either — go back to deriving it.
        if (!scope.getAttribute('data-touched')) {
            scope.value = scopeFromName(this.value)
        }
        renderSummary()
    })
    el('ac-new-scope').addEventListener('input', function () {
        this.setAttribute('data-touched', '1')
        renderSummary()
    })

    el('ac-mirror').addEventListener('change', renderSummary)

    el('ac-copy-run').addEventListener('click', startCopy)

    renderChips()
    loadSourceWorkspaces()
})()
