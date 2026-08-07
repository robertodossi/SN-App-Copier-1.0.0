import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    'api-appcopy': {
                        table: 'sys_ws_definition'
                        id: '52730e53a0034eaf8859e3ad978ac991'
                    }
                    'api-appcopy-app': {
                        table: 'sys_ws_operation'
                        id: '0ec398bd383c4acaa602ddee44b95718'
                    }
                    'api-appcopy-apply': {
                        table: 'sys_ws_operation'
                        id: '009afa092e49489b99026c274b5547a1'
                    }
                    'api-appcopy-buffer': {
                        table: 'sys_ws_operation'
                        id: '660d672d549f4672a6266c5f7a75835e'
                    }
                    'api-appcopy-connect': {
                        table: 'sys_ws_operation'
                        id: '30025fecdd7a4bae957ce993ef2703f2'
                    }
                    'api-appcopy-create-app': {
                        table: 'sys_ws_operation'
                        id: '2ea731c4e4e2439ea56a67297af5b75f'
                    }
                    'api-appcopy-read': {
                        table: 'sys_ws_operation'
                        id: 'a6da4d210d0d41f8b9bd1d2ff638db2d'
                    }
                    'api-appcopy-state': {
                        table: 'sys_ws_operation'
                        id: '710b418a55404901916b13bfcc2fd120'
                    }
                    bom_json: {
                        table: 'sys_module'
                        id: 'e7f21a3400154a71959affe9bad00353'
                    }
                    'menu-appcopy': {
                        table: 'sys_app_application'
                        id: '63f55dce96cc45c79d1ec32194709b09'
                    }
                    'menu-appcopy-module-copy': {
                        table: 'sys_app_module'
                        id: '9fe14e008bf243e69ec54890f10c03fd'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '38d55368d46543be8258691731c7498e'
                    }
                    'si-glider': {
                        table: 'sys_script_include'
                        id: 'dd510846540544f098a0ef4bffd9e5f8'
                    }
                    src_server_AppCopyGlider_js: {
                        table: 'sys_module'
                        id: '1973c5ce2bf04886a4f70cb4d75db647'
                    }
                    src_server_rest_app_js: {
                        table: 'sys_module'
                        id: '2731c609af9749e59e09d6208e0fff74'
                    }
                    src_server_rest_apply_js: {
                        table: 'sys_module'
                        id: '5777ada6a37b41c6b733660a228d0cf5'
                    }
                    src_server_rest_buffer_js: {
                        table: 'sys_module'
                        id: 'ef124928e3be4f47a971b05f46da4843'
                    }
                    src_server_rest_connect_js: {
                        table: 'sys_module'
                        id: '9ebccbce8a32448fb4c2a02555a4e1d1'
                    }
                    'src_server_rest_create-app_js': {
                        table: 'sys_module'
                        id: 'ebc27a8e470d4e8eac097693fb40c429'
                    }
                    src_server_rest_read_js: {
                        table: 'sys_module'
                        id: 'ab2e207feae8417cb6663f3acd2b8f24'
                    }
                    src_server_rest_state_js: {
                        table: 'sys_module'
                        id: 'a7ee111f2ecc4ce490b0d0b30391fdbb'
                    }
                }
                composite: [
                    {
                        table: 'ua_table_licensing_config'
                        id: '027a91d722744cf28f8a264ab5f4cc45'
                        key: {
                            name: 'x_snc_appcopy_buffer'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '1f2b669a50e94652a7cc45800794cfb5'
                        key: {
                            name: 'x_snc_appcopy_buffer'
                            element: 'NULL'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_db_object'
                        id: '29e879adfc5d4ea69097c01e55c378ba'
                        key: {
                            name: 'x_snc_appcopy_buffer'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '62f25b81393b4655b247a029eb72d2f6'
                        key: {
                            name: 'x_snc_appcopy_buffer'
                            element: 'NULL'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '97ebcfb43bd64487bd198fd3f8514b81'
                        key: {
                            name: 'x_snc_appcopy_buffer'
                            element: 'label'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'c3bffbc10c264259affafb40f135a40d'
                        key: {
                            name: 'x_snc_appcopy_buffer'
                            element: 'label'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_ui_page'
                        id: 'e5afa93e4bc84ba7a5b2e6953436f9d9'
                        key: {
                            endpoint: 'x_snc_appcopy_copier.do'
                        }
                    },
                ]
            }
        }
    }
}
