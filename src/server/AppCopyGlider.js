/**
 * AppCopyGlider
 *
 * Server side proxy to a *remote* ServiceNow instance's Glider sync API — the
 * same endpoints the Build Agent CLI `/sync` path uses:
 *
 *   POST /api/sn_glider/v2/sync/state          list a URI tree (recursive)
 *   POST /api/sn_glider/v2/sync/files          read file blobs (multipart out)
 *   POST /api/sn_glider/v2/sync/changes/apply  create/update/remove (multipart in)
 *
 * The browser can talk to the *source* (this) instance directly because it is
 * same-origin. It cannot talk to the target instance, so every target call is
 * funnelled through here and authenticated with basic auth.
 *
 * Binary safety: multipart payloads are handed over base64 encoded, written to
 * an attachment and streamed out with setRequestBodyFromAttachment(). Responses
 * come back the same way. Nothing binary is ever forced through a JS string.
 */
var AppCopyGlider = Class.create()

AppCopyGlider.BUFFER_TABLE = 'x_snc_appcopy_buffer'
AppCopyGlider.TIMEOUT_MS = 60000
AppCopyGlider.BUFFER_TTL_SECONDS = 3600

/**
 * Shared plumbing for every route in the appcopy scripted REST API: decode the
 * JSON body, build a client for the target described by `body.target`, and turn
 * thrown errors into a predictable `{error: "..."}` response.
 *
 * @param {any} request
 * @param {any} response
 * @param {function(AppCopyGlider, any): any} handler
 */
AppCopyGlider.serve = function (request, response, handler) {
    response.setContentType('application/json')
    var body
    try {
        body = (request.body && request.body.data) || {}
        if (typeof body === 'string') {
            body = JSON.parse(body)
        }
    } catch (parseError) {
        response.setStatus(400)
        response.setBody({ error: 'request body is not valid JSON' })
        return
    }
    try {
        response.setBody(handler(new AppCopyGlider(body.target), body) || {})
    } catch (error) {
        gs.error('AppCopyGlider: ' + (error && error.message ? error.message : error))
        // Deliberately a 200 carrying `{error}` rather than a 4xx/5xx: the
        // instance edge proxy rewrites non-2xx responses from scripted REST
        // into a bodiless "405 Not Allowed", which would hide the real cause
        // from the page. The client treats any `error` key as a failure.
        response.setBody({ error: String((error && error.message) || error) })
    }
}

AppCopyGlider.prototype = {
    /**
     * @param {{url: string, user: string, pass: string}} target
     */
    initialize: function (target) {
        target = target || {}
        // Validated lazily in _message(): buffer() is a local-only operation and
        // has no target to describe.
        this.base = String(target.url || '').trim() ? this._normalizeBase(target.url) : ''
        this.user = String(target.user || '')
        this.pass = String(target.pass || '')
    },

    // ---------------------------------------------------------------- public

    /**
     * Authenticate against the target and list the caller's Glider workspaces.
     */
    connect: function () {
        var me = this._currentUser()
        var workspaces = this._listWorkspaces(me.sysId)
        return { userId: me.sysId, userName: me.userName, displayName: me.name, workspaces: workspaces }
    },

    /**
     * Raw sync/state passthrough. Returns the parsed JSON body.
     */
    state: function (uris) {
        var res = this._postJson('/api/sn_glider/v2/sync/state', { uris: uris || [] })
        if (res.status < 200 || res.status >= 300) {
            throw this._httpError('sync/state', res)
        }
        return this._parseJson(res.body, 'sync/state')
    },

    /**
     * sync/files passthrough. Returns the raw multipart response so the caller
     * can split it.
     *
     * This is only ever used to read `.code-workspace` files, which are UTF-8
     * JSON, so the response body is safe to carry as a string. Application file
     * blobs are never read from the target — they only ever flow *to* it, and
     * that path goes through apply() where bytes stay in an attachment.
     */
    read: function (uris) {
        var part = this._multipartUris(uris || [])
        var message = this._message('POST', '/api/sn_glider/v2/sync/files')
        message.setRequestHeader('Content-Type', 'multipart/form-data; boundary=' + part.boundary)
        message.setRequestBody(part.body)

        var response = message.execute()
        var status = response.getStatusCode()
        var body = response.getBody() || ''
        if (status < 200 || status >= 300) {
            throw this._httpError('sync/files', { status: status, body: body })
        }
        return { contentType: response.getHeader('Content-Type') || '', body: body }
    },

    /**
     * Look up an application on the target. The copier needs the real scope to
     * rewrite now.config.json; a workspace folder only carries a display label.
     */
    app: function (sysId) {
        sysId = String(sysId || '').trim()
        if (!sysId) {
            throw new Error('an application sys_id is required')
        }
        var res = this._get('/api/now/table/sys_app/' + encodeURIComponent(sysId) + '?sysparm_fields=sys_id,name,scope')
        if (res.status === 404) {
            return { sysId: sysId, name: '', scope: '' }
        }
        if (res.status < 200 || res.status >= 300) {
            throw this._httpError('read target application', res)
        }
        var record = (this._parseJson(res.body, 'read target application') || {}).result
        if (!record) {
            return { sysId: sysId, name: '', scope: '' }
        }
        return { sysId: sysId, name: String(record.name || ''), scope: String(record.scope || '') }
    },

    /**
     * Create an empty buffer row for the browser to attach a payload to.
     * Returns the sys_id to pass to attach + apply.
     */
    buffer: function () {
        this._purgeStaleBuffers()
        var record = this._newBuffer('apply')
        return { table: AppCopyGlider.BUFFER_TABLE, sysId: String(record.getUniqueValue()) }
    },

    /**
     * sync/changes/apply passthrough. The complete multipart/form-data body was
     * assembled by the browser and uploaded to `attachmentId` via the platform
     * Attachment API — the browser can push raw bytes, whereas staging them here
     * would mean routing binary through a JS string.
     */
    apply: function (boundary, attachmentId) {
        if (!boundary) {
            throw new Error('apply requires a multipart boundary')
        }
        attachmentId = String(attachmentId || '').trim()
        if (!attachmentId) {
            throw new Error('apply requires the sys_id of the staged payload attachment')
        }

        // Only ever stream attachments this app staged: without this check the
        // route would forward any attachment the caller can name to any URL.
        var attachment = new GlideRecord('sys_attachment')
        if (!attachment.get(attachmentId)) {
            throw new Error('staged payload ' + attachmentId + ' was not found')
        }
        if (String(attachment.getValue('table_name')) !== AppCopyGlider.BUFFER_TABLE) {
            throw new Error('staged payload ' + attachmentId + ' is not an app copy transfer buffer')
        }

        var buffer = new GlideRecord(AppCopyGlider.BUFFER_TABLE)
        if (!buffer.get(attachment.getValue('table_sys_id'))) {
            buffer = null
        }

        try {
            var message = this._message('POST', '/api/sn_glider/v2/sync/changes/apply')
            message.setRequestBodyFromAttachment(attachmentId)
            message.setRequestHeader('Content-Type', 'multipart/form-data; boundary=' + boundary)

            var response = message.execute()
            var status = response.getStatusCode()
            var body = response.getBody() || ''
            if (status < 200 || status >= 300) {
                throw this._httpError('sync/changes/apply', { status: status, body: body })
            }
            return { status: status, body: body }
        } finally {
            this._discard(buffer, attachmentId)
        }
    },

    /**
     * Create a scoped application record on the target instance. Glider accepts
     * writes against `now-file:/<sys_id>` as soon as the sys_app row exists.
     */
    createApp: function (name, scope, description) {
        name = String(name || '').trim()
        scope = String(scope || '').trim()
        if (!name) {
            throw new Error('an application name is required')
        }
        if (!/^[a-z0-9_]{1,18}$/.test(scope)) {
            throw new Error('scope "' + scope + '" must be lowercase letters, digits or underscore, max 18 characters')
        }
        if (this._scopeExists(scope)) {
            throw new Error('scope "' + scope + '" already exists on the target instance')
        }

        var res = this._postJson('/api/now/table/sys_app', {
            name: name,
            scope: scope,
            short_description: String(description || ''),
            version: '1.0.0',
            active: 'true',
            private: 'false',
        })
        if (res.status < 200 || res.status >= 300) {
            throw this._httpError('create sys_app', res)
        }
        var parsed = this._parseJson(res.body, 'create sys_app')
        var record = parsed && parsed.result
        if (!record || !record.sys_id) {
            throw new Error('target did not return a sys_id for the new application')
        }
        return { sysId: String(record.sys_id), scope: String(record.scope || scope), name: String(record.name || name) }
    },

    // --------------------------------------------------------------- private

    _currentUser: function () {
        // `javascript:` in an encoded query resolves on the target instance, so
        // this works whether the caller logs in with a user name, an email or
        // anything else that maps to a sys_user row.
        var url =
            '/api/now/table/sys_user' +
            '?sysparm_query=' +
            encodeURIComponent('user_name=javascript:gs.getUserName()') +
            '&sysparm_fields=sys_id,user_name,name&sysparm_limit=1'
        var res = this._get(url)
        if (res.status === 401) {
            throw new Error('the target instance rejected those credentials')
        }
        if (res.status < 200 || res.status >= 300) {
            throw this._httpError('identify target user', res)
        }
        var parsed = this._parseJson(res.body, 'identify target user')
        var rows = (parsed && parsed.result) || []
        if (!rows.length || !rows[0].sys_id) {
            throw new Error('could not resolve the authenticated user on the target instance')
        }
        return { sysId: String(rows[0].sys_id), userName: String(rows[0].user_name || ''), name: String(rows[0].name || '') }
    },

    _listWorkspaces: function (userId) {
        var parsed = this.state(['settings:/users/' + userId])
        var files = (parsed && parsed.files) || []
        var out = []
        for (var i = 0; i < files.length; i++) {
            var entry = files[i] || {}
            if (String(entry.type || '').toLowerCase() !== 'file') continue
            if (entry.dtime) continue
            var uri = String(entry.uri || '')
            if (uri.indexOf('/workspaces/') < 0 || uri.slice(-15) !== '.code-workspace') continue
            var name = uri.substring(uri.lastIndexOf('/') + 1).replace(/\.code-workspace$/, '')
            out.push({
                name: decodeURIComponent(name),
                uri: uri,
                checksum: String(entry.checksum || ''),
                size: String(entry.size || '0'),
                createdAt: String(entry.ctime || ''),
                updatedAt: String(entry.mtime || ''),
            })
        }
        out.sort(function (a, b) {
            return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1
        })
        return out
    },

    _scopeExists: function (scope) {
        var url =
            '/api/now/table/sys_scope?sysparm_query=' +
            encodeURIComponent('scope=' + scope) +
            '&sysparm_fields=sys_id&sysparm_limit=1'
        var res = this._get(url)
        if (res.status < 200 || res.status >= 300) {
            // Not being able to check is not the same as a collision; let the
            // insert itself fail if the scope is really taken.
            return false
        }
        var parsed = this._parseJson(res.body, 'scope lookup')
        return !!(parsed && parsed.result && parsed.result.length)
    },

    _normalizeBase: function (url) {
        var raw = String(url || '').trim()
        if (!raw) {
            throw new Error('a target instance URL is required')
        }
        if (raw.indexOf('://') < 0) {
            raw = 'https://' + raw
        }
        raw = raw.replace(/\/+$/, '')
        if (!/^https?:\/\/[^/\s]+$/i.test(raw)) {
            throw new Error('target instance URL "' + url + '" is not a bare https://host URL')
        }
        return raw
    },

    _message: function (method, path) {
        if (!this.base) {
            throw new Error('a target instance URL is required')
        }
        var message = new sn_ws.RESTMessageV2()
        message.setHttpMethod(method)
        message.setEndpoint(this.base + path)
        message.setBasicAuth(this.user, this.pass)
        message.setHttpTimeout(AppCopyGlider.TIMEOUT_MS)
        message.setRequestHeader('Accept', '*/*')
        message.setRequestHeader('Origin', this.base)
        message.setRequestHeader('Referer', this.base + '/sn_glider_app/ide.do')
        message.setRequestHeader('X-Requested-With', 'XMLHttpRequest')
        try {
            // File contents may legitimately contain ${...}; never let the REST
            // message treat those as its own variables.
            message.disableForcedVariableSubstitution()
        } catch (ignored) {
            // Older releases do not expose it — the substitution only fires when
            // variables are set, and this class never sets any.
        }
        return message
    },

    _get: function (path) {
        var message = this._message('GET', path)
        message.setRequestHeader('Accept', 'application/json')
        var response = message.execute()
        return { status: response.getStatusCode(), body: response.getBody() || '' }
    },

    _postJson: function (path, payload) {
        var message = this._message('POST', path)
        message.setRequestHeader('Content-Type', 'application/json')
        message.setRequestHeader('Accept', 'application/json')
        message.setRequestBody(JSON.stringify(payload))
        var response = message.execute()
        return { status: response.getStatusCode(), body: response.getBody() || '' }
    },

    _multipartUris: function (uris) {
        var boundary = '----appcopy' + new GlideDateTime().getNumericValue() + Math.floor(Math.random() * 1e9)
        var body = ''
        body += '--' + boundary + '\r\n'
        body += 'Content-Disposition: form-data; name="uris"; filename="blob"\r\n'
        body += 'Content-Type: application/octet-stream\r\n\r\n'
        body += JSON.stringify(uris) + '\r\n'
        body += '--' + boundary + '--\r\n'
        return { boundary: boundary, body: body }
    },

    _newBuffer: function (label) {
        var record = new GlideRecord(AppCopyGlider.BUFFER_TABLE)
        record.initialize()
        record.setValue('label', String(label || 'transfer'))
        var sysId = record.insert()
        if (!sysId) {
            throw new Error('could not create a transfer buffer record')
        }
        // Re-query: GlideSysAttachment needs a GlideRecord positioned on a row
        // that already exists, not the post-insert instance.
        var fresh = new GlideRecord(AppCopyGlider.BUFFER_TABLE)
        if (!fresh.get(sysId)) {
            throw new Error('transfer buffer record ' + sysId + ' could not be read back')
        }
        return fresh
    },

    /**
     * A buffer row is orphaned whenever the browser asks for one and then never
     * reaches /apply — a failed copy, a closed tab, a dropped connection. Sweep
     * them on the way in so the table cannot grow without bound; nothing here
     * needs to outlive a single copy.
     */
    _purgeStaleBuffers: function () {
        try {
            var cutoff = new GlideDateTime()
            cutoff.addSeconds(-AppCopyGlider.BUFFER_TTL_SECONDS)

            // Attachments first, and by age rather than by parent: deleting the
            // rows does not reliably cascade to them, which would leave the
            // payloads behind as the only thing still holding real bytes.
            var staleAttachments = new GlideRecord('sys_attachment')
            staleAttachments.addQuery('table_name', AppCopyGlider.BUFFER_TABLE)
            staleAttachments.addQuery('sys_created_on', '<', cutoff)
            staleAttachments.deleteMultiple()

            var stale = new GlideRecord(AppCopyGlider.BUFFER_TABLE)
            stale.addQuery('sys_created_on', '<', cutoff)
            stale.deleteMultiple()
        } catch (error) {
            gs.warn('AppCopyGlider: could not purge stale transfer buffers: ' + error)
        }
    },

    _discard: function (buffer, attachmentId) {
        try {
            if (attachmentId) {
                new GlideSysAttachment().deleteAttachment(attachmentId)
            }
        } catch (attachmentError) {
            gs.warn('AppCopyGlider: could not delete attachment ' + attachmentId + ': ' + attachmentError)
        }
        try {
            if (buffer) {
                buffer.deleteRecord()
            }
        } catch (recordError) {
            gs.warn('AppCopyGlider: could not delete transfer buffer: ' + recordError)
        }
    },

    _parseJson: function (body, what) {
        try {
            return JSON.parse(body)
        } catch (error) {
            throw new Error(what + ' returned a non-JSON response: ' + String(body).substring(0, 400))
        }
    },

    _httpError: function (what, res) {
        var detail = String((res && res.body) || '').substring(0, 400)
        try {
            var parsed = JSON.parse(res.body)
            if (parsed && parsed.error && parsed.error.message) {
                detail = parsed.error.message + (parsed.error.detail ? ' — ' + parsed.error.detail : '')
            }
        } catch (ignored) {
            // keep the raw body excerpt
        }
        return new Error(what + ' failed on ' + this.base + ' (HTTP ' + res.status + ')' + (detail ? ': ' + detail : ''))
    },

    type: 'AppCopyGlider',
}
