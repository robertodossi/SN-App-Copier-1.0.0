import '@servicenow/sdk/global'
import { ApplicationMenu, Record, RestApi, ScriptInclude, StringColumn, Table, UiPage } from '@servicenow/sdk/core'

/**
 * Scratch table used only as an attachment anchor. Outbound multipart bodies are
 * staged here as attachments so RESTMessageV2 can stream them byte for byte
 * (setRequestBodyFromAttachment), and inbound multipart responses land here via
 * saveResponseBodyAsAttachment. Rows live for the duration of one HTTP call.
 */
export const x_snc_appcopy_buffer = Table({
    name: 'x_snc_appcopy_buffer',
    label: 'App Copy Transfer Buffer',
    display: 'label',
    actions: ['create', 'read', 'delete'],
    schema: {
        label: StringColumn({ label: 'Label', maxLength: 100 }),
    },
})

ScriptInclude({
    $id: Now.ID['si-glider'],
    name: 'AppCopyGlider',
    description: 'Proxies Glider sync/state, sync/files and sync/changes/apply calls to a remote instance.',
    active: true,
    clientCallable: false,
    accessibleFrom: 'package_private',
    script: Now.include('../server/AppCopyGlider.js'),
})

RestApi({
    $id: Now.ID['api-appcopy'],
    name: 'App Copy',
    serviceId: 'appcopy',
    shortDescription: 'Server side bridge to a target instance for copying a Now SDK application.',
    consumes: 'application/json',
    produces: 'application/json',
    active: true,
    routes: [
        {
            $id: Now.ID['api-appcopy-connect'],
            name: 'connect',
            method: 'POST',
            path: '/connect',
            shortDescription: 'Authenticate against the target instance and list its Glider workspaces.',
            script: Now.include('../server/rest/connect.js'),
        },
        {
            $id: Now.ID['api-appcopy-state'],
            name: 'state',
            method: 'POST',
            path: '/state',
            shortDescription: 'Proxy sync/state against the target instance.',
            script: Now.include('../server/rest/state.js'),
        },
        {
            $id: Now.ID['api-appcopy-read'],
            name: 'read',
            method: 'POST',
            path: '/read',
            shortDescription: 'Proxy sync/files against the target instance and return the raw multipart body.',
            script: Now.include('../server/rest/read.js'),
        },
        {
            $id: Now.ID['api-appcopy-create-app'],
            name: 'create app',
            method: 'POST',
            path: '/create-app',
            shortDescription: 'Create a scoped application record on the target instance.',
            script: Now.include('../server/rest/create-app.js'),
        },
        {
            $id: Now.ID['api-appcopy-app'],
            name: 'app',
            method: 'POST',
            path: '/app',
            shortDescription: 'Read an application record (name and scope) from the target instance.',
            script: Now.include('../server/rest/app.js'),
        },
        {
            $id: Now.ID['api-appcopy-buffer'],
            name: 'buffer',
            method: 'POST',
            path: '/buffer',
            shortDescription: 'Create a transfer buffer row for the browser to attach a payload to.',
            script: Now.include('../server/rest/buffer.js'),
        },
        {
            $id: Now.ID['api-appcopy-apply'],
            name: 'apply',
            method: 'POST',
            path: '/apply',
            shortDescription: 'Proxy a prepared multipart sync/changes/apply payload to the target instance.',
            script: Now.include('../server/rest/apply.js'),
        },
    ],
})

const applicationMenu = ApplicationMenu({
    $id: Now.ID['menu-appcopy'],
    title: 'App Copier',
    description: 'Copy a Now SDK application file tree from this instance to another instance.',
    hint: 'Copy an application to another instance',
    roles: ['admin'],
    active: true,
})

Record({
    $id: Now.ID['menu-appcopy-module-copy'],
    table: 'sys_app_module',
    data: {
        title: 'Copy application',
        application: applicationMenu,
        link_type: 'DIRECT',
        query: 'x_snc_appcopy_copier.do',
        hint: 'Browse an application on this instance and copy its files to another instance',
        roles: ['admin'],
        active: true,
        order: 100,
    },
})

UiPage({
    $id: Now.ID['page-copier'],
    endpoint: 'x_snc_appcopy_copier.do',
    category: 'general',
    description: 'Browse a Now SDK application on this instance and copy its files to another instance.',
    direct: true,
    html: Now.include('../server/ui/copier.html'),
    // The page script lives in its own field, not in a <script> block inside
    // html: a CDATA section inside <script> makes the Jelly render fail
    // silently (blank 200), and XML-escaping it instead emits the entities
    // literally into the JS. clientScript is passed through verbatim.
    clientScript: Now.include('../client/copier.client.js'),
})
