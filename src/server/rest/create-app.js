/**
 * POST /api/x_snc_appcopy/appcopy/create-app
 * body: { target: { url, user, pass }, name, scope, description }
 * -> { sysId, scope, name }
 *
 * Only the sys_app row is created here. Registering the new app as a folder in
 * the target workspace is a normal Glider file update, so the browser does it
 * through /apply along with everything else.
 */
;(function process(/* RESTAPIRequest */ request, /* RESTAPIResponse */ response) {
    AppCopyGlider.serve(request, response, function (client, body) {
        return client.createApp(body.name, body.scope, body.description)
    })
})(request, response)
