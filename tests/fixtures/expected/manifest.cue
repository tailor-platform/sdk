{
  "Apps": [
    {
      "Kind": "application",
      "Name": "my-app",
      "Cors": [],
      "AllowedIPAddresses": [],
      "DisableIntrospection": false,
      "Auth": {
        "Namespace": "my-auth",
        "IdProviderConfigName": "sample"
      },
      "Subgraphs": [
        {
          "Type": "auth",
          "Name": "my-auth"
        },
        {
          "Type": "tailordb",
          "Name": "my-db"
        },
        {
          "Type": "pipeline",
          "Name": "my-pipeline"
        }
      ],
      "Version": "v2"
    }
  ],
  "Kind": "workspace",
  "Services": [
    {
      "Kind": "tailordb",
      "Namespace": "my-db",
      "Types": [
        {
          "Name": "Customer",
          "Description": "",
          "Fields": {
            "name": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "email": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "phone": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "address": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "city": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "state": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "country": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "postalCode": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "createdAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Create": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            },
            "updatedAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Update": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            }
          },
          "Relationships": {},
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "",
            "PublishRecordEvents": false
          },
          "Extends": false,
          "Directives": [],
          "Indexes": {},
          "TypePermission": {
            "Create": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Read": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Update": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Delete": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Admin": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ]
          }
        },
        {
          "Name": "PurchaseOrder",
          "Description": "",
          "Fields": {
            "supplierID": {
              "Type": "uuid",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "totalPrice": {
              "Type": "integer",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "discount": {
              "Type": "float",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "status": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "createdAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Create": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            },
            "updatedAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Update": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            }
          },
          "Relationships": {},
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "",
            "PublishRecordEvents": false
          },
          "Extends": false,
          "Directives": [],
          "Indexes": {},
          "TypePermission": {
            "Create": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Read": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Update": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Delete": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Admin": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ]
          }
        },
        {
          "Name": "Role",
          "Description": "",
          "Fields": {
            "name": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            }
          },
          "Relationships": {},
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "",
            "PublishRecordEvents": false
          },
          "Extends": false,
          "Directives": [],
          "Indexes": {},
          "TypePermission": {
            "Create": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Read": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Update": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Delete": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Admin": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ]
          }
        },
        {
          "Name": "SalesOrder",
          "Description": "",
          "Fields": {
            "customerID": {
              "Type": "uuid",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "totalPrice": {
              "Type": "integer",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "discount": {
              "Type": "float",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "status": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "cancelReason": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "canceledAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "createdAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Create": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            },
            "updatedAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Update": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            }
          },
          "Relationships": {},
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "",
            "PublishRecordEvents": false
          },
          "Extends": false,
          "Directives": [],
          "Indexes": {},
          "TypePermission": {
            "Create": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Read": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Update": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Delete": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Admin": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ]
          }
        },
        {
          "Name": "Supplier",
          "Description": "",
          "Fields": {
            "name": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "phone": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "fax": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "email": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "postalCode": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "country": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "state": {
              "Type": "enum",
              "AllowedValues": [
                {
                  "value": "Alabama",
                  "description": ""
                },
                {
                  "value": "Alaska",
                  "description": ""
                }
              ],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "city": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "createdAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Create": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            },
            "updatedAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Update": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            }
          },
          "Relationships": {},
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "",
            "PublishRecordEvents": false
          },
          "Extends": false,
          "Directives": [],
          "Indexes": {},
          "TypePermission": {
            "Create": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Read": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Update": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Delete": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Admin": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ]
          }
        },
        {
          "Name": "User",
          "Description": "",
          "Fields": {
            "name": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "email": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "createdAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Create": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            },
            "updatedAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Update": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            }
          },
          "Relationships": {},
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "",
            "PublishRecordEvents": false
          },
          "Extends": false,
          "Directives": [],
          "Indexes": {},
          "TypePermission": {
            "Create": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Read": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Update": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Delete": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Admin": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ]
          }
        }
      ],
      "Version": "v2"
    },
    {
      "Kind": "pipeline",
      "Description": "",
      "Namespace": "my-pipeline",
      "Resolvers": [
        {
          "Authorization": "true==true",
          "Description": "stepChain resolver",
          "Inputs": [
            {
              "Name": "input",
              "Description": "",
              "Array": false,
              "Required": true,
              "Type": {
                "Kind": "UserDefined",
                "Name": "StepChainInput",
                "Description": "",
                "Required": false,
                "Fields": [
                  {
                    "Name": "name",
                    "Description": "",
                    "Type": {
                      "Kind": "ScalarType",
                      "Name": "String",
                      "Description": "",
                      "Required": false
                    },
                    "Array": false,
                    "Required": true
                  }
                ]
              }
            }
          ],
          "Name": "stepChain",
          "Response": {
            "Type": {
              "Kind": "UserDefined",
              "Name": "StepChainOutput",
              "Description": "",
              "Required": true,
              "Fields": [
                {
                  "Name": "summary",
                  "Description": "",
                  "Type": {
                    "Kind": "ScalarType",
                    "Name": "String",
                    "Description": "",
                    "Required": false
                  },
                  "Array": true,
                  "Required": true
                }
              ]
            },
            "Description": "",
            "Array": false,
            "Required": true
          },
          "Pipelines": [
            {
              "Name": "step1",
              "OperationName": "step1",
              "Description": "step1",
              "OperationType": 2,
              "OperationSourcePath": "tests/fixtures/expected/functions/stepChain__step1.js",
              "OperationHook": {
                "Expr": "({ ...context.pipeline, ...context.args });"
              },
              "PostScript": "args.step1"
            },
            {
              "Name": "step2",
              "OperationName": "step2",
              "Description": "step2",
              "OperationType": 2,
              "OperationSourcePath": "tests/fixtures/expected/functions/stepChain__step2.js",
              "OperationHook": {
                "Expr": "({ ...context.pipeline, ...context.args });"
              },
              "PostScript": "args.step2"
            },
            {
              "Name": "sqlStep",
              "OperationName": "sqlStep",
              "Description": "sqlStep",
              "OperationType": 2,
              "OperationSourcePath": "tests/fixtures/expected/functions/stepChain__sqlStep.js",
              "OperationHook": {
                "Expr": "({ ...context.pipeline, ...context.args });"
              },
              "PostScript": "args.sqlStep"
            },
            {
              "Name": "__construct_output",
              "OperationName": "__construct_output",
              "Description": "Construct output from resolver",
              "OperationType": 2,
              "OperationSource": "globalThis.main = context=>({summary:[context.step1,context.step2,context.sqlStep]})",
              "OperationHook": {
                "Expr": "({ ...context.pipeline, ...context.args });"
              },
              "PostScript": "args.__construct_output"
            }
          ],
          "PostHook": {
            "Expr": "({ ...context.pipeline.__construct_output });"
          },
          "PublishExecutionEvents": false
        }
      ],
      "Version": "v2"
    },
    {
      "Kind": "auth",
      "Namespace": "my-auth",
      "IdProviderConfigs": [
        {
          "Name": "sample",
          "Config": {
            "Kind": "IDToken",
            "ClientID": "exampleco",
            "ProviderURL": "https://exampleco-enterprises.auth0.com/"
          },
          "IdTokenConfig": {
            "Kind": "IDToken",
            "ClientID": "exampleco",
            "ProviderURL": "https://exampleco-enterprises.auth0.com/"
          }
        }
      ],
      "UserProfileProvider": "TAILORDB",
      "UserProfileProviderConfig": {
        "Kind": "TAILORDB",
        "Namespace": "my-db",
        "Type": "User",
        "UsernameField": "email",
        "AttributesFields": [
          "roles"
        ]
      },
      "SCIMConfig": null,
      "TenantProvider": "",
      "TenantProviderConfig": null,
      "MachineUsers": [
        {
          "Name": "admin-machine-user",
          "Attributes": [
            "4293a799-4398-55e6-a19a-fe8427d1a415"
          ]
        }
      ],
      "OAuth2Clients": []
    }
  ],
  "Auths": [
    {
      "Kind": "auth",
      "Namespace": "my-auth",
      "IdProviderConfigs": [
        {
          "Name": "sample",
          "Config": {
            "Kind": "IDToken",
            "ClientID": "exampleco",
            "ProviderURL": "https://exampleco-enterprises.auth0.com/"
          },
          "IdTokenConfig": {
            "Kind": "IDToken",
            "ClientID": "exampleco",
            "ProviderURL": "https://exampleco-enterprises.auth0.com/"
          }
        }
      ],
      "UserProfileProvider": "TAILORDB",
      "UserProfileProviderConfig": {
        "Kind": "TAILORDB",
        "Namespace": "my-db",
        "Type": "User",
        "UsernameField": "email",
        "AttributesFields": [
          "roles"
        ]
      },
      "SCIMConfig": null,
      "TenantProvider": "",
      "TenantProviderConfig": null,
      "MachineUsers": [
        {
          "Name": "admin-machine-user",
          "Attributes": [
            "4293a799-4398-55e6-a19a-fe8427d1a415"
          ]
        }
      ],
      "OAuth2Clients": []
    }
  ],
  "Pipelines": [
    {
      "Kind": "pipeline",
      "Description": "",
      "Namespace": "my-pipeline",
      "Resolvers": [
        {
          "Authorization": "true==true",
          "Description": "stepChain resolver",
          "Inputs": [
            {
              "Name": "input",
              "Description": "",
              "Array": false,
              "Required": true,
              "Type": {
                "Kind": "UserDefined",
                "Name": "StepChainInput",
                "Description": "",
                "Required": false,
                "Fields": [
                  {
                    "Name": "name",
                    "Description": "",
                    "Type": {
                      "Kind": "ScalarType",
                      "Name": "String",
                      "Description": "",
                      "Required": false
                    },
                    "Array": false,
                    "Required": true
                  }
                ]
              }
            }
          ],
          "Name": "stepChain",
          "Response": {
            "Type": {
              "Kind": "UserDefined",
              "Name": "StepChainOutput",
              "Description": "",
              "Required": true,
              "Fields": [
                {
                  "Name": "summary",
                  "Description": "",
                  "Type": {
                    "Kind": "ScalarType",
                    "Name": "String",
                    "Description": "",
                    "Required": false
                  },
                  "Array": true,
                  "Required": true
                }
              ]
            },
            "Description": "",
            "Array": false,
            "Required": true
          },
          "Pipelines": [
            {
              "Name": "step1",
              "OperationName": "step1",
              "Description": "step1",
              "OperationType": 2,
              "OperationSourcePath": "tests/fixtures/expected/functions/stepChain__step1.js",
              "OperationHook": {
                "Expr": "({ ...context.pipeline, ...context.args });"
              },
              "PostScript": "args.step1"
            },
            {
              "Name": "step2",
              "OperationName": "step2",
              "Description": "step2",
              "OperationType": 2,
              "OperationSourcePath": "tests/fixtures/expected/functions/stepChain__step2.js",
              "OperationHook": {
                "Expr": "({ ...context.pipeline, ...context.args });"
              },
              "PostScript": "args.step2"
            },
            {
              "Name": "sqlStep",
              "OperationName": "sqlStep",
              "Description": "sqlStep",
              "OperationType": 2,
              "OperationSourcePath": "tests/fixtures/expected/functions/stepChain__sqlStep.js",
              "OperationHook": {
                "Expr": "({ ...context.pipeline, ...context.args });"
              },
              "PostScript": "args.sqlStep"
            },
            {
              "Name": "__construct_output",
              "OperationName": "__construct_output",
              "Description": "Construct output from resolver",
              "OperationType": 2,
              "OperationSource": "globalThis.main = context=>({summary:[context.step1,context.step2,context.sqlStep]})",
              "OperationHook": {
                "Expr": "({ ...context.pipeline, ...context.args });"
              },
              "PostScript": "args.__construct_output"
            }
          ],
          "PostHook": {
            "Expr": "({ ...context.pipeline.__construct_output });"
          },
          "PublishExecutionEvents": false
        }
      ],
      "Version": "v2"
    }
  ],
  "Executors": [],
  "Stateflows": [],
  "Tailordbs": [
    {
      "Kind": "tailordb",
      "Namespace": "my-db",
      "Types": [
        {
          "Name": "Customer",
          "Description": "",
          "Fields": {
            "name": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "email": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "phone": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "address": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "city": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "state": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "country": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "postalCode": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "createdAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Create": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            },
            "updatedAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Update": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            }
          },
          "Relationships": {},
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "",
            "PublishRecordEvents": false
          },
          "Extends": false,
          "Directives": [],
          "Indexes": {},
          "TypePermission": {
            "Create": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Read": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Update": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Delete": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Admin": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ]
          }
        },
        {
          "Name": "PurchaseOrder",
          "Description": "",
          "Fields": {
            "supplierID": {
              "Type": "uuid",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "totalPrice": {
              "Type": "integer",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "discount": {
              "Type": "float",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "status": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "createdAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Create": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            },
            "updatedAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Update": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            }
          },
          "Relationships": {},
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "",
            "PublishRecordEvents": false
          },
          "Extends": false,
          "Directives": [],
          "Indexes": {},
          "TypePermission": {
            "Create": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Read": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Update": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Delete": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Admin": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ]
          }
        },
        {
          "Name": "Role",
          "Description": "",
          "Fields": {
            "name": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            }
          },
          "Relationships": {},
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "",
            "PublishRecordEvents": false
          },
          "Extends": false,
          "Directives": [],
          "Indexes": {},
          "TypePermission": {
            "Create": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Read": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Update": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Delete": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Admin": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ]
          }
        },
        {
          "Name": "SalesOrder",
          "Description": "",
          "Fields": {
            "customerID": {
              "Type": "uuid",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "totalPrice": {
              "Type": "integer",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "discount": {
              "Type": "float",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "status": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "cancelReason": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "canceledAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "createdAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Create": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            },
            "updatedAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Update": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            }
          },
          "Relationships": {},
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "",
            "PublishRecordEvents": false
          },
          "Extends": false,
          "Directives": [],
          "Indexes": {},
          "TypePermission": {
            "Create": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Read": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Update": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Delete": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Admin": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ]
          }
        },
        {
          "Name": "Supplier",
          "Description": "",
          "Fields": {
            "name": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "phone": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "fax": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "email": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "postalCode": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "country": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "state": {
              "Type": "enum",
              "AllowedValues": [
                {
                  "value": "Alabama",
                  "description": ""
                },
                {
                  "value": "Alaska",
                  "description": ""
                }
              ],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "city": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "createdAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Create": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            },
            "updatedAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Update": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            }
          },
          "Relationships": {},
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "",
            "PublishRecordEvents": false
          },
          "Extends": false,
          "Directives": [],
          "Indexes": {},
          "TypePermission": {
            "Create": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Read": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Update": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Delete": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Admin": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ]
          }
        },
        {
          "Name": "User",
          "Description": "",
          "Fields": {
            "name": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "email": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "createdAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Create": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            },
            "updatedAt": {
              "Type": "datetime",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Hooks": {
                "Update": {
                  "expr": "(() => (/* @__PURE__ */ new Date()).toISOString())()"
                }
              }
            }
          },
          "Relationships": {},
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "",
            "PublishRecordEvents": false
          },
          "Extends": false,
          "Directives": [],
          "Indexes": {},
          "TypePermission": {
            "Create": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Read": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Update": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Delete": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ],
            "Admin": [
              {
                "Id": "everyone",
                "Ids": [],
                "Permit": "allow"
              }
            ]
          }
        }
      ],
      "Version": "v2"
    }
  ]
}