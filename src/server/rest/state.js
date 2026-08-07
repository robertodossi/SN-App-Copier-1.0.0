/**
 * POST /api/x_snc_appcopy/appcopy/state
 * body: { target: { url, user, pass }, uris: [ "now-file:/<sys_id>", ... ] }
 * -> the target's raw sync/state payload, e.g. { timeStamp, files: [...] }
 */
;(function process(/* RESTAPIRequest */ request, /* RESTAPIResponse */ response) {
    AppCopyGlider.serve(request, response, function (client, body) {
        return client.state(body.uris || [])
    })
})(request, response)
