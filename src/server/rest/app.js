/**
 * POST /api/x_snc_appcopy/appcopy/app
 * body: { target: { url, user, pass }, sysId }
 * -> { sysId, name, scope }
 *
 * Used to learn the destination application's real scope before rewriting
 * now.config.json — the workspace folder that lists the app only carries a
 * display label.
 */
;(function process(/* RESTAPIRequest */ request, /* RESTAPIResponse */ response) {
    AppCopyGlider.serve(request, response, function (client, body) {
        return client.app(body.sysId)
    })
})(request, response)
