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
          "Name": "tailordb"
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
      "Namespace": "tailordb",
      "Types": [
        {
          "Name": "Customer",
          "Description": "カスタマー",
          "Fields": {
            "name": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [
                {
                  "Action": "deny",
                  "ErrorMessage": "Name must be longer than 5 characters",
                  "Expr": "",
                  "Script": {
                    "Expr": "!(({value})=>value.length>5)({ value: _value, user })"
                  }
                }
              ],
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
              "Validate": [
                {
                  "Action": "deny",
                  "ErrorMessage": "failed by `({value})=>value.length>1`",
                  "Expr": "",
                  "Script": {
                    "Expr": "!(({value})=>value.length>1)({ value: _value, user })"
                  }
                },
                {
                  "Action": "deny",
                  "ErrorMessage": "failed by `({value})=>value.length<100`",
                  "Expr": "",
                  "Script": {
                    "Expr": "!(({value})=>value.length<100)({ value: _value, user })"
                  }
                }
              ],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "fullAddress": {
              "Type": "string",
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
                  "Expr": "(({data})=>`\\u3012${data.postalCode} ${data.address} ${data.city}`)({ value: _value, data: _data, user })"
                },
                "Update": {
                  "Expr": "(({data})=>`\\u3012${data.postalCode} ${data.address} ${data.city}`)({ value: _value, data: _data, user })"
                }
              }
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
                }
              }
            }
          },
          "Relationships": {
            "salesOrders": {
              "RefType": "SalesOrder",
              "RefField": "customerID",
              "SrcField": "id",
              "Array": true,
              "Description": ""
            }
          },
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
          "Name": "Invoice",
          "Description": "",
          "Fields": {
            "invoiceNumber": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Serial": {
                "Start": 1000,
                "Format": "INV-%05d"
              }
            },
            "salesOrderID": {
              "Type": "uuid",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": true,
              "Required": true,
              "Unique": true,
              "ForeignKey": true,
              "ForeignKeyType": "SalesOrder",
              "Vector": false
            },
            "amount": {
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
            "sequentialId": {
              "Type": "integer",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Serial": {
                "Start": 1,
                "MaxValue": 999999
              }
            },
            "status": {
              "Type": "enum",
              "AllowedValues": [
                {
                  "value": "draft",
                  "description": ""
                },
                {
                  "value": "sent",
                  "description": ""
                },
                {
                  "value": "paid",
                  "description": ""
                },
                {
                  "value": "cancelled",
                  "description": ""
                }
              ],
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
                }
              }
            }
          },
          "Relationships": {
            "salesOrder": {
              "RefType": "SalesOrder",
              "RefField": "id",
              "SrcField": "salesOrderID",
              "Array": false,
              "Description": ""
            }
          },
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
          "Name": "NestedProfile",
          "Description": "",
          "Fields": {
            "userInfo": {
              "Type": "nested",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Fields": {
                "personal": {
                  "Type": "nested",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": true,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false,
                  "Fields": {
                    "name": {
                      "Type": "string",
                      "AllowedValues": [],
                      "Description": "",
                      "Validate": [],
                      "Required": true,
                      "Array": false,
                      "Index": false,
                      "Unique": false,
                      "ForeignKey": false,
                      "Vector": false
                    },
                    "age": {
                      "Type": "integer",
                      "AllowedValues": [],
                      "Description": "",
                      "Validate": [],
                      "Required": false,
                      "Array": false,
                      "Index": false,
                      "Unique": false,
                      "ForeignKey": false,
                      "Vector": false
                    },
                    "bio": {
                      "Type": "string",
                      "AllowedValues": [],
                      "Description": "",
                      "Validate": [],
                      "Required": false,
                      "Array": false,
                      "Index": false,
                      "Unique": false,
                      "ForeignKey": false,
                      "Vector": false
                    }
                  }
                },
                "contact": {
                  "Type": "nested",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": true,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false,
                  "Fields": {
                    "email": {
                      "Type": "string",
                      "AllowedValues": [],
                      "Description": "",
                      "Validate": [],
                      "Required": true,
                      "Array": false,
                      "Index": false,
                      "Unique": false,
                      "ForeignKey": false,
                      "Vector": false
                    },
                    "phone": {
                      "Type": "string",
                      "AllowedValues": [],
                      "Description": "",
                      "Validate": [],
                      "Required": false,
                      "Array": false,
                      "Index": false,
                      "Unique": false,
                      "ForeignKey": false,
                      "Vector": false
                    },
                    "address": {
                      "Type": "nested",
                      "AllowedValues": [],
                      "Description": "",
                      "Validate": [],
                      "Required": true,
                      "Array": false,
                      "Index": false,
                      "Unique": false,
                      "ForeignKey": false,
                      "Vector": false,
                      "Fields": {
                        "street": {
                          "Type": "string",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": true,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false
                        },
                        "city": {
                          "Type": "string",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": true,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false
                        },
                        "country": {
                          "Type": "string",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": true,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false
                        },
                        "coordinates": {
                          "Type": "nested",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": false,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false,
                          "Fields": {
                            "latitude": {
                              "Type": "float",
                              "AllowedValues": [],
                              "Description": "",
                              "Validate": [],
                              "Required": true,
                              "Array": false,
                              "Index": false,
                              "Unique": false,
                              "ForeignKey": false,
                              "Vector": false
                            },
                            "longitude": {
                              "Type": "float",
                              "AllowedValues": [],
                              "Description": "",
                              "Validate": [],
                              "Required": true,
                              "Array": false,
                              "Index": false,
                              "Unique": false,
                              "ForeignKey": false,
                              "Vector": false
                            }
                          }
                        }
                      }
                    }
                  }
                },
                "preferences": {
                  "Type": "nested",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": false,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false,
                  "Fields": {
                    "notifications": {
                      "Type": "nested",
                      "AllowedValues": [],
                      "Description": "",
                      "Validate": [],
                      "Required": true,
                      "Array": false,
                      "Index": false,
                      "Unique": false,
                      "ForeignKey": false,
                      "Vector": false,
                      "Fields": {
                        "email": {
                          "Type": "boolean",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": true,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false
                        },
                        "sms": {
                          "Type": "boolean",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": true,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false
                        },
                        "push": {
                          "Type": "boolean",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": true,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false
                        }
                      }
                    },
                    "privacy": {
                      "Type": "nested",
                      "AllowedValues": [],
                      "Description": "",
                      "Validate": [],
                      "Required": false,
                      "Array": false,
                      "Index": false,
                      "Unique": false,
                      "ForeignKey": false,
                      "Vector": false,
                      "Fields": {
                        "profileVisible": {
                          "Type": "boolean",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": true,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false
                        },
                        "dataSharing": {
                          "Type": "boolean",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": true,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false
                        }
                      }
                    }
                  }
                }
              }
            },
            "metadata": {
              "Type": "nested",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Fields": {
                "created": {
                  "Type": "datetime",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": true,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false
                },
                "lastUpdated": {
                  "Type": "datetime",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": false,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false
                },
                "version": {
                  "Type": "integer",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": true,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false
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
              "Index": true,
              "Required": true,
              "Unique": false,
              "ForeignKey": true,
              "ForeignKeyType": "Supplier",
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
            "attachedFiles": {
              "Type": "nested",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": true,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Fields": {
                "id": {
                  "Type": "uuid",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": true,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false
                },
                "name": {
                  "Type": "string",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": true,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false
                },
                "size": {
                  "Type": "integer",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": true,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false
                },
                "type": {
                  "Type": "enum",
                  "AllowedValues": [
                    {
                      "value": "text",
                      "description": ""
                    },
                    {
                      "value": "image",
                      "description": ""
                    }
                  ],
                  "Description": "",
                  "Validate": [],
                  "Required": true,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false
                }
              }
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
                }
              }
            }
          },
          "Relationships": {
            "supplier": {
              "RefType": "Supplier",
              "RefField": "id",
              "SrcField": "supplierID",
              "Array": false,
              "Description": ""
            }
          },
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "purchaseOrderList",
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
              "Index": true,
              "Required": true,
              "Unique": false,
              "ForeignKey": true,
              "ForeignKeyType": "Customer",
              "Vector": false
            },
            "approvedByUserID": {
              "Type": "uuid",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": true,
              "ForeignKeyType": "User",
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
                }
              }
            }
          },
          "Relationships": {
            "customer": {
              "RefType": "Customer",
              "RefField": "id",
              "SrcField": "customerID",
              "Array": false,
              "Description": ""
            },
            "invoice": {
              "RefType": "Invoice",
              "RefField": "salesOrderID",
              "SrcField": "id",
              "Array": false,
              "Description": ""
            }
          },
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "salesOrderList",
            "PublishRecordEvents": true
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
                }
              }
            }
          },
          "Relationships": {
            "purchaseOrders": {
              "RefType": "PurchaseOrder",
              "RefField": "supplierID",
              "SrcField": "id",
              "Array": true,
              "Description": ""
            }
          },
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
                }
              }
            }
          },
          "Relationships": {
            "setting": {
              "RefType": "UserSetting",
              "RefField": "userID",
              "SrcField": "id",
              "Array": false,
              "Description": ""
            }
          },
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "",
            "PublishRecordEvents": true
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
          "Name": "UserSetting",
          "Description": "",
          "Fields": {
            "language": {
              "Type": "enum",
              "AllowedValues": [
                {
                  "value": "jp",
                  "description": ""
                },
                {
                  "value": "en",
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
            "userID": {
              "Type": "uuid",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": true,
              "Required": true,
              "Unique": true,
              "ForeignKey": true,
              "ForeignKeyType": "User",
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
                }
              }
            }
          },
          "Relationships": {
            "user": {
              "RefType": "User",
              "RefField": "id",
              "SrcField": "userID",
              "Array": false,
              "Description": ""
            }
          },
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
                    "Name": "user",
                    "Description": "",
                    "Type": {
                      "Kind": "UserDefined",
                      "Name": "StepChainInputUser",
                      "Description": "",
                      "Required": true,
                      "Fields": [
                        {
                          "Name": "name",
                          "Description": "",
                          "Type": {
                            "Kind": "UserDefined",
                            "Name": "StepChainInputUserName",
                            "Description": "",
                            "Required": true,
                            "Fields": [
                              {
                                "Name": "first",
                                "Description": "",
                                "Type": {
                                  "Kind": "ScalarType",
                                  "Name": "String",
                                  "Description": "",
                                  "Required": false
                                },
                                "Array": false,
                                "Required": true
                              },
                              {
                                "Name": "last",
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
                          },
                          "Array": false,
                          "Required": true
                        }
                      ]
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
                  "Name": "result",
                  "Description": "",
                  "Type": {
                    "Kind": "UserDefined",
                    "Name": "StepChainOutputResult",
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
                  "Array": false,
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
              "Name": "kyselyStep",
              "OperationName": "kyselyStep",
              "Description": "kyselyStep",
              "OperationType": 2,
              "OperationSourcePath": "tests/fixtures/expected/functions/stepChain__kyselyStep.js",
              "OperationHook": {
                "Expr": "({ ...context.pipeline, ...context.args });"
              },
              "PostScript": "args.kyselyStep"
            },
            {
              "Name": "__construct_output",
              "OperationName": "__construct_output",
              "Description": "Construct output from resolver",
              "OperationType": 2,
              "OperationSource": "globalThis.main = context=>({result:{summary:[context.step1,context.step2,context.sqlStep,context.kyselyStep]}})",
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
        "Namespace": "tailordb",
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
    },
    {
      "Kind": "executor",
      "Executors": [
        {
          "Name": "sales-order-created",
          "Description": "Triggered when a new sales order is created",
          "TriggerEvent": {
            "Kind": "Event",
            "EventType": "tailordb.type_record.created",
            "Condition": {
              "Expr": "args.typeName === \"SalesOrder\" && (({newRecord})=>(newRecord.totalPrice??0)>1e6)({ ...args, appNamespace: args.namespaceName })"
            }
          },
          "TargetWebhook": {
            "Kind": "webhook",
            "URL": {
              "Expr": "(({newRecord})=>`https://example.com/webhook/${newRecord.id}`)(args)"
            },
            "Headers": [
              {
                "Key": "Content-Type",
                "RawValue": "application/json"
              },
              {
                "Key": "Authorization",
                "SecretValue": {
                  "VaultName": "my-vault",
                  "SecretKey": "my-secret"
                }
              }
            ],
            "Body": {
              "Expr": "(({newRecord})=>({orderId:newRecord.id,customerID:newRecord.customerID,totalPrice:newRecord.totalPrice}))(args)"
            }
          },
          "Trigger": {
            "Kind": "Event",
            "EventType": "tailordb.type_record.created",
            "Condition": {
              "Expr": "args.typeName === \"SalesOrder\" && (({newRecord})=>(newRecord.totalPrice??0)>1e6)({ ...args, appNamespace: args.namespaceName })"
            }
          },
          "Target": {
            "Kind": "webhook",
            "URL": {
              "Expr": "(({newRecord})=>`https://example.com/webhook/${newRecord.id}`)(args)"
            },
            "Headers": [
              {
                "Key": "Content-Type",
                "Value": "application/json"
              },
              {
                "Key": "Authorization",
                "Value": {
                  "VaultName": "my-vault",
                  "SecretKey": "my-secret"
                }
              }
            ],
            "Body": {
              "Expr": "(({newRecord})=>({orderId:newRecord.id,customerID:newRecord.customerID,totalPrice:newRecord.totalPrice}))(args)"
            }
          }
        },
        {
          "Name": "user-created",
          "Description": "Triggered when a new user is created",
          "TriggerEvent": {
            "Kind": "Event",
            "EventType": "tailordb.type_record.created",
            "Condition": {
              "Expr": "args.typeName === \"User\" && (({newRecord})=>newRecord.email.endsWith(\"@tailor.tech\"))({ ...args, appNamespace: args.namespaceName })"
            }
          },
          "TargetFunction": {
            "Kind": "function",
            "Name": "user-created__target",
            "ScriptPath": "tests/fixtures/expected/executors/user-created.js",
            "Variables": {
              "Expr": "({ ...args, appNamespace: args.namespaceName })"
            }
          },
          "Trigger": {
            "Kind": "Event",
            "EventType": "tailordb.type_record.created",
            "Condition": {
              "Expr": "args.typeName === \"User\" && (({newRecord})=>newRecord.email.endsWith(\"@tailor.tech\"))({ ...args, appNamespace: args.namespaceName })"
            }
          },
          "Target": {
            "Kind": "function",
            "Name": "user-created__target"
          }
        }
      ],
      "Version": "v2"
    }
  ],
  "Auths": [
    {
      "Kind": "auth",
      "Namespace": "my-auth",
      "IdProviderConfigs": [
        {
          "Name": "sample",
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
        "Namespace": "tailordb",
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
                    "Name": "user",
                    "Description": "",
                    "Type": {
                      "Kind": "UserDefined",
                      "Name": "StepChainInputUser",
                      "Description": "",
                      "Required": true,
                      "Fields": [
                        {
                          "Name": "name",
                          "Description": "",
                          "Type": {
                            "Kind": "UserDefined",
                            "Name": "StepChainInputUserName",
                            "Description": "",
                            "Required": true,
                            "Fields": [
                              {
                                "Name": "first",
                                "Description": "",
                                "Type": {
                                  "Kind": "ScalarType",
                                  "Name": "String",
                                  "Description": "",
                                  "Required": false
                                },
                                "Array": false,
                                "Required": true
                              },
                              {
                                "Name": "last",
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
                          },
                          "Array": false,
                          "Required": true
                        }
                      ]
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
                  "Name": "result",
                  "Description": "",
                  "Type": {
                    "Kind": "UserDefined",
                    "Name": "StepChainOutputResult",
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
                  "Array": false,
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
              "Name": "kyselyStep",
              "OperationName": "kyselyStep",
              "Description": "kyselyStep",
              "OperationType": 2,
              "OperationSourcePath": "tests/fixtures/expected/functions/stepChain__kyselyStep.js",
              "OperationHook": {
                "Expr": "({ ...context.pipeline, ...context.args });"
              },
              "PostScript": "args.kyselyStep"
            },
            {
              "Name": "__construct_output",
              "OperationName": "__construct_output",
              "Description": "Construct output from resolver",
              "OperationType": 2,
              "OperationSource": "globalThis.main = context=>({result:{summary:[context.step1,context.step2,context.sqlStep,context.kyselyStep]}})",
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
  "Executors": [
    {
      "Kind": "executor",
      "Executors": [
        {
          "Name": "sales-order-created",
          "Description": "Triggered when a new sales order is created",
          "TriggerEvent": {
            "Kind": "Event",
            "EventType": "tailordb.type_record.created",
            "Condition": {
              "Expr": "args.typeName === \"SalesOrder\" && (({newRecord})=>(newRecord.totalPrice??0)>1e6)({ ...args, appNamespace: args.namespaceName })"
            }
          },
          "TargetWebhook": {
            "Kind": "webhook",
            "URL": {
              "Expr": "(({newRecord})=>`https://example.com/webhook/${newRecord.id}`)(args)"
            },
            "Headers": [
              {
                "Key": "Content-Type",
                "RawValue": "application/json"
              },
              {
                "Key": "Authorization",
                "SecretValue": {
                  "VaultName": "my-vault",
                  "SecretKey": "my-secret"
                }
              }
            ],
            "Body": {
              "Expr": "(({newRecord})=>({orderId:newRecord.id,customerID:newRecord.customerID,totalPrice:newRecord.totalPrice}))(args)"
            }
          },
          "Trigger": {
            "Kind": "Event",
            "EventType": "tailordb.type_record.created",
            "Condition": {
              "Expr": "args.typeName === \"SalesOrder\" && (({newRecord})=>(newRecord.totalPrice??0)>1e6)({ ...args, appNamespace: args.namespaceName })"
            }
          },
          "Target": {
            "Kind": "webhook",
            "URL": {
              "Expr": "(({newRecord})=>`https://example.com/webhook/${newRecord.id}`)(args)"
            },
            "Headers": [
              {
                "Key": "Content-Type",
                "Value": "application/json"
              },
              {
                "Key": "Authorization",
                "Value": {
                  "VaultName": "my-vault",
                  "SecretKey": "my-secret"
                }
              }
            ],
            "Body": {
              "Expr": "(({newRecord})=>({orderId:newRecord.id,customerID:newRecord.customerID,totalPrice:newRecord.totalPrice}))(args)"
            }
          }
        },
        {
          "Name": "user-created",
          "Description": "Triggered when a new user is created",
          "TriggerEvent": {
            "Kind": "Event",
            "EventType": "tailordb.type_record.created",
            "Condition": {
              "Expr": "args.typeName === \"User\" && (({newRecord})=>newRecord.email.endsWith(\"@tailor.tech\"))({ ...args, appNamespace: args.namespaceName })"
            }
          },
          "TargetFunction": {
            "Kind": "function",
            "Name": "user-created__target",
            "ScriptPath": "tests/fixtures/expected/executors/user-created.js",
            "Variables": {
              "Expr": "({ ...args, appNamespace: args.namespaceName })"
            }
          },
          "Trigger": {
            "Kind": "Event",
            "EventType": "tailordb.type_record.created",
            "Condition": {
              "Expr": "args.typeName === \"User\" && (({newRecord})=>newRecord.email.endsWith(\"@tailor.tech\"))({ ...args, appNamespace: args.namespaceName })"
            }
          },
          "Target": {
            "Kind": "function",
            "Name": "user-created__target"
          }
        }
      ],
      "Version": "v2"
    }
  ],
  "Stateflows": [],
  "Tailordbs": [
    {
      "Kind": "tailordb",
      "Namespace": "tailordb",
      "Types": [
        {
          "Name": "Customer",
          "Description": "カスタマー",
          "Fields": {
            "name": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [
                {
                  "Action": "deny",
                  "ErrorMessage": "Name must be longer than 5 characters",
                  "Expr": "",
                  "Script": {
                    "Expr": "!(({value})=>value.length>5)({ value: _value, user })"
                  }
                }
              ],
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
              "Validate": [
                {
                  "Action": "deny",
                  "ErrorMessage": "failed by `({value})=>value.length>1`",
                  "Expr": "",
                  "Script": {
                    "Expr": "!(({value})=>value.length>1)({ value: _value, user })"
                  }
                },
                {
                  "Action": "deny",
                  "ErrorMessage": "failed by `({value})=>value.length<100`",
                  "Expr": "",
                  "Script": {
                    "Expr": "!(({value})=>value.length<100)({ value: _value, user })"
                  }
                }
              ],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false
            },
            "fullAddress": {
              "Type": "string",
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
                  "Expr": "(({data})=>`\\u3012${data.postalCode} ${data.address} ${data.city}`)({ value: _value, data: _data, user })"
                },
                "Update": {
                  "Expr": "(({data})=>`\\u3012${data.postalCode} ${data.address} ${data.city}`)({ value: _value, data: _data, user })"
                }
              }
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
                }
              }
            }
          },
          "Relationships": {
            "salesOrders": {
              "RefType": "SalesOrder",
              "RefField": "customerID",
              "SrcField": "id",
              "Array": true,
              "Description": ""
            }
          },
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
          "Name": "Invoice",
          "Description": "",
          "Fields": {
            "invoiceNumber": {
              "Type": "string",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Serial": {
                "Start": 1000,
                "Format": "INV-%05d"
              }
            },
            "salesOrderID": {
              "Type": "uuid",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": true,
              "Required": true,
              "Unique": true,
              "ForeignKey": true,
              "ForeignKeyType": "SalesOrder",
              "Vector": false
            },
            "amount": {
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
            "sequentialId": {
              "Type": "integer",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": false,
              "Vector": false,
              "Serial": {
                "Start": 1,
                "MaxValue": 999999
              }
            },
            "status": {
              "Type": "enum",
              "AllowedValues": [
                {
                  "value": "draft",
                  "description": ""
                },
                {
                  "value": "sent",
                  "description": ""
                },
                {
                  "value": "paid",
                  "description": ""
                },
                {
                  "value": "cancelled",
                  "description": ""
                }
              ],
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
                }
              }
            }
          },
          "Relationships": {
            "salesOrder": {
              "RefType": "SalesOrder",
              "RefField": "id",
              "SrcField": "salesOrderID",
              "Array": false,
              "Description": ""
            }
          },
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
          "Name": "NestedProfile",
          "Description": "",
          "Fields": {
            "userInfo": {
              "Type": "nested",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Fields": {
                "personal": {
                  "Type": "nested",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": true,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false,
                  "Fields": {
                    "name": {
                      "Type": "string",
                      "AllowedValues": [],
                      "Description": "",
                      "Validate": [],
                      "Required": true,
                      "Array": false,
                      "Index": false,
                      "Unique": false,
                      "ForeignKey": false,
                      "Vector": false
                    },
                    "age": {
                      "Type": "integer",
                      "AllowedValues": [],
                      "Description": "",
                      "Validate": [],
                      "Required": false,
                      "Array": false,
                      "Index": false,
                      "Unique": false,
                      "ForeignKey": false,
                      "Vector": false
                    },
                    "bio": {
                      "Type": "string",
                      "AllowedValues": [],
                      "Description": "",
                      "Validate": [],
                      "Required": false,
                      "Array": false,
                      "Index": false,
                      "Unique": false,
                      "ForeignKey": false,
                      "Vector": false
                    }
                  }
                },
                "contact": {
                  "Type": "nested",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": true,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false,
                  "Fields": {
                    "email": {
                      "Type": "string",
                      "AllowedValues": [],
                      "Description": "",
                      "Validate": [],
                      "Required": true,
                      "Array": false,
                      "Index": false,
                      "Unique": false,
                      "ForeignKey": false,
                      "Vector": false
                    },
                    "phone": {
                      "Type": "string",
                      "AllowedValues": [],
                      "Description": "",
                      "Validate": [],
                      "Required": false,
                      "Array": false,
                      "Index": false,
                      "Unique": false,
                      "ForeignKey": false,
                      "Vector": false
                    },
                    "address": {
                      "Type": "nested",
                      "AllowedValues": [],
                      "Description": "",
                      "Validate": [],
                      "Required": true,
                      "Array": false,
                      "Index": false,
                      "Unique": false,
                      "ForeignKey": false,
                      "Vector": false,
                      "Fields": {
                        "street": {
                          "Type": "string",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": true,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false
                        },
                        "city": {
                          "Type": "string",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": true,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false
                        },
                        "country": {
                          "Type": "string",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": true,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false
                        },
                        "coordinates": {
                          "Type": "nested",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": false,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false,
                          "Fields": {
                            "latitude": {
                              "Type": "float",
                              "AllowedValues": [],
                              "Description": "",
                              "Validate": [],
                              "Required": true,
                              "Array": false,
                              "Index": false,
                              "Unique": false,
                              "ForeignKey": false,
                              "Vector": false
                            },
                            "longitude": {
                              "Type": "float",
                              "AllowedValues": [],
                              "Description": "",
                              "Validate": [],
                              "Required": true,
                              "Array": false,
                              "Index": false,
                              "Unique": false,
                              "ForeignKey": false,
                              "Vector": false
                            }
                          }
                        }
                      }
                    }
                  }
                },
                "preferences": {
                  "Type": "nested",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": false,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false,
                  "Fields": {
                    "notifications": {
                      "Type": "nested",
                      "AllowedValues": [],
                      "Description": "",
                      "Validate": [],
                      "Required": true,
                      "Array": false,
                      "Index": false,
                      "Unique": false,
                      "ForeignKey": false,
                      "Vector": false,
                      "Fields": {
                        "email": {
                          "Type": "boolean",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": true,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false
                        },
                        "sms": {
                          "Type": "boolean",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": true,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false
                        },
                        "push": {
                          "Type": "boolean",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": true,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false
                        }
                      }
                    },
                    "privacy": {
                      "Type": "nested",
                      "AllowedValues": [],
                      "Description": "",
                      "Validate": [],
                      "Required": false,
                      "Array": false,
                      "Index": false,
                      "Unique": false,
                      "ForeignKey": false,
                      "Vector": false,
                      "Fields": {
                        "profileVisible": {
                          "Type": "boolean",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": true,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false
                        },
                        "dataSharing": {
                          "Type": "boolean",
                          "AllowedValues": [],
                          "Description": "",
                          "Validate": [],
                          "Required": true,
                          "Array": false,
                          "Index": false,
                          "Unique": false,
                          "ForeignKey": false,
                          "Vector": false
                        }
                      }
                    }
                  }
                }
              }
            },
            "metadata": {
              "Type": "nested",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Fields": {
                "created": {
                  "Type": "datetime",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": true,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false
                },
                "lastUpdated": {
                  "Type": "datetime",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": false,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false
                },
                "version": {
                  "Type": "integer",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": true,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false
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
              "Index": true,
              "Required": true,
              "Unique": false,
              "ForeignKey": true,
              "ForeignKeyType": "Supplier",
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
            "attachedFiles": {
              "Type": "nested",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": true,
              "Index": false,
              "Required": true,
              "Unique": false,
              "ForeignKey": false,
              "Fields": {
                "id": {
                  "Type": "uuid",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": true,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false
                },
                "name": {
                  "Type": "string",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": true,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false
                },
                "size": {
                  "Type": "integer",
                  "AllowedValues": [],
                  "Description": "",
                  "Validate": [],
                  "Required": true,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false
                },
                "type": {
                  "Type": "enum",
                  "AllowedValues": [
                    {
                      "value": "text",
                      "description": ""
                    },
                    {
                      "value": "image",
                      "description": ""
                    }
                  ],
                  "Description": "",
                  "Validate": [],
                  "Required": true,
                  "Array": false,
                  "Index": false,
                  "Unique": false,
                  "ForeignKey": false,
                  "Vector": false
                }
              }
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
                }
              }
            }
          },
          "Relationships": {
            "supplier": {
              "RefType": "Supplier",
              "RefField": "id",
              "SrcField": "supplierID",
              "Array": false,
              "Description": ""
            }
          },
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "purchaseOrderList",
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
              "Index": true,
              "Required": true,
              "Unique": false,
              "ForeignKey": true,
              "ForeignKeyType": "Customer",
              "Vector": false
            },
            "approvedByUserID": {
              "Type": "uuid",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": false,
              "Required": false,
              "Unique": false,
              "ForeignKey": true,
              "ForeignKeyType": "User",
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
                }
              }
            }
          },
          "Relationships": {
            "customer": {
              "RefType": "Customer",
              "RefField": "id",
              "SrcField": "customerID",
              "Array": false,
              "Description": ""
            },
            "invoice": {
              "RefType": "Invoice",
              "RefField": "salesOrderID",
              "SrcField": "id",
              "Array": false,
              "Description": ""
            }
          },
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "salesOrderList",
            "PublishRecordEvents": true
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
                }
              }
            }
          },
          "Relationships": {
            "purchaseOrders": {
              "RefType": "PurchaseOrder",
              "RefField": "supplierID",
              "SrcField": "id",
              "Array": true,
              "Description": ""
            }
          },
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
                }
              }
            }
          },
          "Relationships": {
            "setting": {
              "RefType": "UserSetting",
              "RefField": "userID",
              "SrcField": "id",
              "Array": false,
              "Description": ""
            }
          },
          "Settings": {
            "Aggregation": false,
            "BulkUpsert": false,
            "Draft": false,
            "DefaultQueryLimitSize": 100,
            "MaxBulkUpsertSize": 1000,
            "PluralForm": "",
            "PublishRecordEvents": true
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
          "Name": "UserSetting",
          "Description": "",
          "Fields": {
            "language": {
              "Type": "enum",
              "AllowedValues": [
                {
                  "value": "jp",
                  "description": ""
                },
                {
                  "value": "en",
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
            "userID": {
              "Type": "uuid",
              "AllowedValues": [],
              "Description": "",
              "Validate": [],
              "Array": false,
              "Index": true,
              "Required": true,
              "Unique": true,
              "ForeignKey": true,
              "ForeignKeyType": "User",
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
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
                  "Expr": "(() => (/* @__PURE__ */ new Date()).toISOString())({ value: _value, data: _data, user })"
                }
              }
            }
          },
          "Relationships": {
            "user": {
              "RefType": "User",
              "RefField": "id",
              "SrcField": "userID",
              "Array": false,
              "Description": ""
            }
          },
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
