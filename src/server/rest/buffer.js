/**
 * POST /api/x_snc_appcopy/appcopy/buffer
 * body: {}
 * -> { table, sysId }
 *
 * Creates an empty transfer buffer row. The browser attaches the assembled
 * multipart payload to it via the platform Attachment API, then hands the
 * attachment sys_id to /apply. Both the row and the attachment are deleted once
 * the payload has been forwarded.
 */
;(function process(/* RESTAPIRequest */ request, /* RESTAPIResponse */ response) {
    AppCopyGlider.serve(request, response, function (client) {
        return client.buffer()
    })
})(request, response)
