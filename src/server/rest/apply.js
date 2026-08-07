/**
 * POST /api/x_snc_appcopy/appcopy/apply
 * body: { target: { url, user, pass }, boundary, attachmentId }
 * -> { status, body }
 *
 * `attachmentId` points at a complete multipart/form-data body the browser
 * assembled and uploaded to a transfer buffer row: the create/update/remove
 * manifests plus one part per file blob, named by the blob's SHA-1.
 */
;(function process(/* RESTAPIRequest */ request, /* RESTAPIResponse */ response) {
    AppCopyGlider.serve(request, response, function (client, body) {
        return client.apply(body.boundary, body.attachmentId)
    })
})(request, response)
