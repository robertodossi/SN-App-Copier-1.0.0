/**
 * POST /api/x_snc_appcopy/appcopy/read
 * body: { target: { url, user, pass }, uris: [ "settings:/users/<id>/workspaces/x.code-workspace" ] }
 * -> { contentType, bodyBase64 }
 *
 * The whole multipart response is handed back base64 encoded; the browser
 * splits it. Doing the split here would mean pushing bytes through a JS string.
 */
;(function process(/* RESTAPIRequest */ request, /* RESTAPIResponse */ response) {
    AppCopyGlider.serve(request, response, function (client, body) {
        return client.read(body.uris || [])
    })
})(request, response)
