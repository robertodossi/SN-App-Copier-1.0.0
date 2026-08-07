/**
 * POST /api/x_snc_appcopy/appcopy/connect
 * body: { target: { url, user, pass } }
 * -> { userId, userName, displayName, workspaces: [{name, uri, checksum, size, updatedAt}] }
 */
;(function process(/* RESTAPIRequest */ request, /* RESTAPIResponse */ response) {
    AppCopyGlider.serve(request, response, function (client) {
        return client.connect()
    })
})(request, response)
